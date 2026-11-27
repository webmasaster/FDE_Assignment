import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Role } from "@prisma/client";
import { extractPdf } from "../lib/pdf";
import { uploadPdf } from "../lib/storage";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD || "ChangeMe!123";
  const users = [
    ["creator1@pep.local", [Role.CREATOR]],
    ["creator2@pep.local", [Role.CREATOR]],
    ["approver1@pep.local", [Role.APPROVER]],
    ["lead1@pep.local", [Role.CREATOR, Role.APPROVER]]
  ] as const;
  for (const [email, roles] of users) {
    await prisma.user.upsert({
      where: { email },
      update: { roles: [...roles] },
      create: { email, passwordHash: await bcrypt.hash(password, 12), roles: [...roles] }
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
    const poNumber = extracted.poNumber || `DRAFT-${filename.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/-PDF$/, "")}`;
    const existing = await prisma.purchaseOrder.findUnique({ where:{poNumber} });
    if (existing) continue;
    const key = `samples/${filename}`;
    try { await uploadPdf(buffer, key); } catch (error) { console.warn("Seed PDF upload skipped:", (error as Error).message); continue; }
    const calculated = extracted.lineItems.reduce((sum,item)=>sum+item.lineTotalPaise,0);
    await prisma.purchaseOrder.create({
      data:{
        poNumber,
        poDate:extracted.poDate,
        vendorName:extracted.vendorName,
        documentTotalPaise:extracted.documentTotalPaise,
        calculatedTotalPaise:calculated,
        totalsMatch:extracted.lineItems.length>0 && Math.abs(calculated-extracted.documentTotalPaise)<=100,
        extractionMethod:extracted.extractionMethod,
        originalFileKey:key,
        originalFileName:filename,
        creatorId,
        lineItems:{create:extracted.lineItems.map((item,index)=>({...item,sortOrder:index}))}
      }
    });
  }
}

main().finally(()=>prisma.$disconnect());
