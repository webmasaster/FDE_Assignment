import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uploadPdf } from "@/lib/storage";
import { extractPdf } from "@/lib/pdf";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!session.roles.includes("CREATOR")) return NextResponse.json({ error: "Creator role required" }, { status: 403 });

    const form = await request.formData();
    const file = form.get("pdf");
    if (!(file instanceof File)) return NextResponse.json({ error: "PDF file is required" }, { status: 400 });
    if (file.type !== "application/pdf") return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "PDF must be 5 MB or smaller" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await extractPdf(buffer);
    if (extracted.poNumber) {
      const existing = await prisma.purchaseOrder.findUnique({ where: { poNumber: extracted.poNumber } });
      if (existing) return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    }

    const key = `pos/${crypto.randomUUID()}.pdf`;
    await uploadPdf(buffer, key);
    const calculated = extracted.lineItems.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: extracted.poNumber || `DRAFT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        poDate: extracted.poDate,
        vendorName: extracted.vendorName,
        documentTotalPaise: extracted.documentTotalPaise,
        calculatedTotalPaise: calculated,
        totalsMatch: extracted.lineItems.length > 0
          ? Math.abs(calculated - extracted.documentTotalPaise) <= 100
          : false,
        extractionMethod: extracted.extractionMethod,
        originalFileKey: key,
        originalFileName: file.name,
        creatorId: session.uid,
        lineItems: {
          create: extracted.lineItems.map((item, index) => ({ ...item, sortOrder: index }))
        }
      }
    });
    return NextResponse.json({ id: po.id, unreadable: extracted.extractionMethod === "unreadable" });
  } catch (error: any) {
    console.error(new Date().toISOString(), "PO_UPLOAD_ERROR", error);
    if (error?.code === "P2002") return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    return NextResponse.json({ error: "Could not upload the PO" }, { status: 500 });
  }
}
