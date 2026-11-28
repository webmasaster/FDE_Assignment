import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { addPaise } from "@/lib/checks";
import { deletePdf, uploadPdf } from "@/lib/storage";
import { extractPdf } from "@/lib/pdf";
import { normalizePoNumber, pdfUploadFormSchema } from "@/lib/validation";
import { getErrorCode, logError } from "@/lib/logger";
import { withUploadedFileRollback } from "@/lib/upload-compensation";

const MAX_PDF_SIZE = 5 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 64 * 1024;
const PDF_SIGNATURE = Buffer.from("%PDF-");

async function readBoundedBody(request: NextRequest): Promise<Buffer | null> {
  const limit = MAX_PDF_SIZE + MAX_MULTIPART_OVERHEAD;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) return null;
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length);
}

export async function POST(request: NextRequest) {
  const eventId = crypto.randomUUID();
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!session.roles.includes("CREATOR")) return NextResponse.json({ error: "Creator role required" }, { status: 403 });

    const bodyBuffer = await readBoundedBody(request);
    if (!bodyBuffer) return NextResponse.json({ error: "Upload must be 5 MB or smaller" }, { status: 413 });

    let form: FormData;
    try {
      const formRequest = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: new Uint8Array(bodyBuffer)
      });
      form = await formRequest.formData();
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
    const storedPoNumber = poNumber || `DRAFT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const po = await withUploadedFileRollback(storageKey, () => prisma.purchaseOrder.create({
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
    }), deletePdf, (cleanupError: unknown) => {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "UPLOAD_STORAGE_CLEANUP_FAILED",
        eventId,
        errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError"
      }));
    });
    return NextResponse.json({
      id: po.id,
      unreadable: extracted.extractionMethod === "unreadable",
      warnings: extracted.warnings
    });
  } catch (error: unknown) {
    logError("PO_UPLOAD_ERROR", error, eventId);
    const code = getErrorCode(error);
    if (code === "P2002") return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    return NextResponse.json({ error: "Could not upload the PO", eventId }, { status: 500 });
  }
}
