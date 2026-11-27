import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { addPaise, calculateLineTotalPaise, parseDate, parseMoney } from "@/lib/checks";
import { canEditPo } from "@/lib/po-access";
import { normalizePoNumber, poIdSchema, poUpdateBodySchema } from "@/lib/validation";
import { getErrorCode, logError } from "@/lib/logger";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!poIdSchema.safeParse(params.id).success) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

    const po = await prisma.purchaseOrder.findUnique({ where: { id: params.id } });
    if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (!session.roles.includes("CREATOR")) return NextResponse.json({ error: "Creator role required" }, { status: 403 });
    if (po.creatorId !== session.uid) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (!canEditPo(session, po)) return NextResponse.json({ error: "Purchase order is locked" }, { status: 409 });

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    const parsedBody = poUpdateBodySchema.safeParse(input);
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Invalid PO details or line items", issues: parsedBody.error.flatten() }, { status: 400 });
    }
    const body = parsedBody.data;
    const poNumber = normalizePoNumber(body.poNumber);
    const poDate = parseDate(body.poDate);
    const documentTotal = parseMoney(body.documentTotal);
    if (!poDate) return NextResponse.json({ error: "Enter a valid PO date" }, { status: 400 });
    if (documentTotal === null || documentTotal <= 0) {
      return NextResponse.json({ error: "Enter a positive PO total" }, { status: 400 });
    }

    const normalized: Array<{
      sku: string;
      description: string;
      quantity: number;
      unitPricePaise: number;
      lineTotalPaise: number;
    }> = [];
    for (const item of body.lineItems) {
      const unitPricePaise = parseMoney(item.unitPrice);
      const lineTotalPaise = parseMoney(item.lineTotal);
      if (unitPricePaise === null || unitPricePaise <= 0 || lineTotalPaise === null || lineTotalPaise <= 0) {
        return NextResponse.json({ error: "Line-item prices must be positive valid currency amounts" }, { status: 400 });
      }
      normalized.push({
        sku: item.sku,
        description: item.description,
        quantity: item.quantity,
        unitPricePaise,
        lineTotalPaise
      });
    }

    const calculated = normalized.reduce<number | null>(
      (sum, item) => sum === null ? null : addPaise(sum, item.lineTotalPaise),
      0
    );
    if (calculated === null) return NextResponse.json({ error: "Line-item total exceeds the supported range" }, { status: 400 });
    const lineMathMatches = normalized.every((item) => {
      const expectedLineTotal = calculateLineTotalPaise(item.quantity, item.unitPricePaise);
      return expectedLineTotal !== null && Math.abs(expectedLineTotal - item.lineTotalPaise) <= 100;
    });
    const totalsMatch = normalized.length > 0 && lineMathMatches && Math.abs(calculated - documentTotal) <= 100;

    const saved = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.purchaseOrder.updateMany({
        where: {
          id: po.id,
          creatorId: session.uid,
          status: po.status,
          updatedAt: po.updatedAt
        },
        data: {
          poNumber,
          poNumberNormalized: poNumber,
          poDate,
          vendorName: body.vendorName,
          documentTotalPaise: documentTotal,
          calculatedTotalPaise: calculated,
          totalsMatch
        }
      });
      if (updated.count !== 1) return false;
      await transaction.lineItem.deleteMany({ where: { poId: po.id } });
      if (normalized.length) {
        await transaction.lineItem.createMany({
          data: normalized.map((item, index) => ({
            poId: po.id,
            ...item,
            sortOrder: index
          }))
        });
      }
      return true;
    });
    if (!saved) return NextResponse.json({ error: "Purchase order changed while you were editing; reload and try again" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const eventId = logError("PO_UPDATE_ERROR", error);
    const code = getErrorCode(error);
    if (code === "P2002") return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    return NextResponse.json({ error: "Could not save the purchase order", eventId }, { status: 500 });
  }
}
