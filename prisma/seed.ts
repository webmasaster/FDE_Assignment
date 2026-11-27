import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Role } from "@prisma/client";
import { extractPdf } from "../lib/pdf";
import { deletePdf, uploadPdf } from "../lib/storage";
import { normalizePoNumber } from "../lib/validation";
import { logError } from "../lib/logger";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (
    !password ||
    password.length < 12 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error("Set a unique SEED_PASSWORD with 12+ characters, upper/lowercase letters, a number, and a symbol.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const users = [
    ["creator1@pep.local", [Role.CREATOR]],
    ["creator2@pep.local", [Role.CREATOR]],
    ["approver1@pep.local", [Role.APPROVER]],
    ["lead1@pep.local", [Role.CREATOR, Role.APPROVER]]
  ] as const;
  for (const [email, roles] of users) {
    await prisma.user.upsert({
      where: { email },
      update: { roles: [...roles], passwordHash },
      create: { email, passwordHash, roles: [...roles] }
    });
  }

  const creator1 = await prisma.user.findUniqueOrThrow({ where: { email:"creator1@pep.local" } });
  const creator2 = await prisma.user.findUniqueOrThrow({ where: { email:"creator2@pep.local" } });

  const samples = [
    ["sample_1_digital.pdf", creator1.id],
    ["sample_2_mismatch.pdf", creator2.id],
    ["sample_4_garbled.pdf", creator1.id]
  ] as const;

  for (const [filename, creatorId] of samples) {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    const buffer = fs.readFileSync(filePath);
    const extracted = await extractPdf(buffer);
    const poNumber = normalizePoNumber(extracted.poNumber || `DRAFT-${filename.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/-PDF$/, "")}`);
    const existing = await prisma.purchaseOrder.findUnique({ where:{poNumberNormalized:poNumber} });
    if (existing) continue;
    const key = `samples/${filename}`;
    await uploadPdf(buffer, key);
    const calculated = extracted.calculatedTotalPaise;
    try {
      await prisma.purchaseOrder.create({
        data:{
          poNumber,
          poNumberNormalized:poNumber,
          poDate:extracted.poDate,
          vendorName:extracted.vendorName,
          documentTotalPaise:extracted.documentTotalPaise,
          calculatedTotalPaise:calculated,
          totalsMatch:extracted.totalsMatch,
          extractionMethod:extracted.extractionMethod,
          extractionWarnings:extracted.warnings,
          originalFileKey:key,
          originalFileName:filename,
          creatorId,
          lineItems:{create:extracted.lineItems.map(({lineMathMatches: _lineMathMatches,...item},index)=>({...item,sortOrder:index}))}
        }
      });
    } catch (error) {
      try {
        await deletePdf(key);
      } catch (cleanupError) {
        console.error(new Date().toISOString(), "SEED_STORAGE_CLEANUP_FAILED", cleanupError instanceof Error ? cleanupError.name : "UnknownError");
      }
      throw error;
    }
  }
}

main()
  .catch((error: unknown) => {
    logError("SEED_FAILED", error);
    process.exitCode = 1;
  })
  .finally(()=>prisma.$disconnect());
