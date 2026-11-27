import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseDate, parseMoney } from "@/lib/checks";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const po = await prisma.purchaseOrder.findUnique({ where: { id: params.id }, include: { lineItems: true } });
    if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (!session.roles.includes("CREATOR")) return NextResponse.json({ error: "Creator role required" }, { status: 403 });
    if (po.creatorId !== session.uid) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (!["DRAFT", "REJECTED"].includes(po.status)) return NextResponse.json({ error: "Purchase order is locked" }, { status: 409 });

    const body = await request.json();
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const poNumber = String(body.poNumber || "").trim();
    const vendorName = String(body.vendorName || "").trim();
    const poDate = parseDate(String(body.poDate || ""));
    const documentTotal = parseMoney(body.documentTotal);
    if (!poNumber || !poDate || !vendorName || documentTotal === null || documentTotal <= 0) {
      return NextResponse.json({ error: "PO number, date, vendor and total are required" }, { status: 400 });
    }
    if (!Array.isArray(body.lineItems)) {
      return NextResponse.json({ error: "Line items must be provided as a list" }, { status: 400 });
    }
    type ValidLineItem = {
      sku: string;
      description: string;
      quantity: number;
      unitPricePaise: number;
      lineTotalPaise: number;
    };
    const rawLineItems: unknown[] = body.lineItems;
    const parsedLineItems: Array<ValidLineItem | null> = rawLineItems.map((raw: unknown): ValidLineItem | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const sku = String(item.sku || "").trim();
      const description = String(item.description || "").trim();
      const quantity = Number(item.quantity);
      const unitPricePaise = parseMoney(item.unitPrice);
      const lineTotalPaise = parseMoney(item.lineTotal);
      if (
        !sku ||
        !description ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        unitPricePaise === null ||
        unitPricePaise <= 0 ||
        lineTotalPaise === null ||
        lineTotalPaise <= 0
      ) return null;
      return { sku, description, quantity, unitPricePaise, lineTotalPaise };
    });
    if (parsedLineItems.some((item) => item === null)) {
      return NextResponse.json({ error: "Each line needs a SKU, description, positive whole quantity and positive prices" }, { status: 400 });
    }
    const normalized = parsedLineItems.filter((item): item is ValidLineItem => item !== null);
    const calculated = normalized.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    const totalsMatch = normalized.length > 0 && Math.abs(calculated - documentTotal) <= 100;

    const saved = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.purchaseOrder.updateMany({
        where: { id: po.id, creatorId: session.uid, status: { in: ["DRAFT", "REJECTED"] } },
        data: {
          poNumber,
          poDate,
          vendorName,
          documentTotalPaise: documentTotal,
          calculatedTotalPaise: calculated,
          totalsMatch
        }
      });
      if (updated.count !== 1) return false;
      await transaction.lineItem.deleteMany({ where: { poId: po.id } });
      await transaction.lineItem.createMany({
        data: normalized.map((item, index) => ({
          poId: po.id,
          sku: item.sku,
          description: item.description,
          quantity: item.quantity,
          unitPricePaise: item.unitPricePaise,
          lineTotalPaise: item.lineTotalPaise,
          sortOrder: index
        }))
      });
      return true;
    });
    if (!saved) return NextResponse.json({ error: "Purchase order is locked" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error(new Date().toISOString(), "PO_UPDATE_ERROR", error);
    if (error?.code === "P2002") return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    return NextResponse.json({ error: "Could not save the purchase order" }, { status: 500 });
  }
}
