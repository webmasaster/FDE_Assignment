import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { addPaise } from "@/lib/checks";
import { deletePdf, uploadPdf } from "@/lib/storage";
import { extractPdf } from "@/lib/pdf";
import { normalizePoNumber, pdfUploadFormSchema } from "@/lib/validation";
import { getErrorCode, logError } from "@/lib/logger";

const MAX_PDF_SIZE = 5 * 1024 * 1024;
const PDF_SIGNATURE = Buffer.from("%PDF-");

export async function POST(request: NextRequest) {
  const eventId = crypto.randomUUID();
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!session.roles.includes("CREATOR")) return NextResponse.json({ error: "Creator role required" }, { status: 403 });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Upload must be a valid multipart form" }, { status: 400 });
    }
    const parsedForm = pdfUploadFormSchema.safeParse({ pdf: form.get("pdf") });
    if (!parsedForm.success) return NextResponse.json({ error: "PDF file is required" }, { status: 400 });
    const file = parsedForm.data.pdf;
    if (file.size === 0) return NextResponse.json({ error: "The selected PDF is empty" }, { status: 400 });
    if (file.size > MAX_PDF_SIZE) return NextResponse.json({ error: "PDF must be 5 MB or smaller" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const signatureIndex = buffer.indexOf(PDF_SIGNATURE);
    if (signatureIndex < 0 || signatureIndex > 1024) {
      return NextResponse.json({ error: "The uploaded file is not a valid PDF" }, { status: 400 });
    }

    let extracted;
    try {
      extracted = await extractPdf(buffer);
    } catch {
      return NextResponse.json({ error: "This PDF could not be read. Upload a valid PDF or enter its details manually." }, { status: 400 });
    }

    const poNumber = extracted.poNumber ? normalizePoNumber(extracted.poNumber) : "";
    if (poNumber) {
      const existing = await prisma.purchaseOrder.findUnique({ where: { poNumberNormalized: poNumber } });
      if (existing) return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    }

    const calculated = extracted.lineItems.reduce<number | null>(
      (sum, item) => sum === null ? null : addPaise(sum, item.lineTotalPaise),
      0
    );
    if (calculated === null) return NextResponse.json({ error: "Line-item total exceeds the supported range" }, { status: 400 });

    const storageKey = `pos/${crypto.randomUUID()}.pdf`;
    await uploadPdf(buffer, storageKey);
    try {
      const storedPoNumber = poNumber || `DRAFT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const po = await prisma.purchaseOrder.create({
        data: {
          poNumber: storedPoNumber,
          poNumberNormalized: storedPoNumber,
          poDate: extracted.poDate,
          vendorName: extracted.vendorName,
          documentTotalPaise: extracted.documentTotalPaise,
          calculatedTotalPaise: calculated,
          totalsMatch: extracted.totalsMatch,
          extractionMethod: extracted.extractionMethod,
          extractionWarnings: extracted.warnings,
          originalFileKey: storageKey,
          originalFileName: file.name.slice(0, 255),
          creatorId: session.uid,
          lineItems: {
            create: extracted.lineItems.map(({ lineMathMatches: _lineMathMatches, ...item }, index) => ({
              ...item,
              sortOrder: index
            }))
          }
        }
      });
      return NextResponse.json({
        id: po.id,
        unreadable: extracted.extractionMethod === "unreadable",
        warnings: extracted.warnings
      });
    } catch (error: unknown) {
      try {
        await deletePdf(storageKey);
      } catch (cleanupError: unknown) {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "UPLOAD_STORAGE_CLEANUP_FAILED",
          eventId,
          errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError"
        }));
      }
      throw error;
    }
  } catch (error: unknown) {
    logError("PO_UPLOAD_ERROR", error, eventId);
    const code = getErrorCode(error);
    if (code === "P2002") return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    return NextResponse.json({ error: "Could not upload the PO", eventId }, { status: 500 });
  }
}
