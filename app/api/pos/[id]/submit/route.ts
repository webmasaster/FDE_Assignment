import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { addPaise, calculateLineTotalPaise, parseDate } from "@/lib/checks";
import { canSubmitPo, getSubmissionTransition } from "@/lib/po-access";
import { getErrorCode, logError } from "@/lib/logger";
import { poIdSchema } from "@/lib/validation";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!poIdSchema.safeParse(params.id).success) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    const po = await prisma.purchaseOrder.findUnique({ where: { id: params.id }, include: { lineItems: true } });
    if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (!session.roles.includes("CREATOR")) return NextResponse.json({ error: "Creator role required" }, { status: 403 });
    if (po.creatorId !== session.uid) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    const transition = getSubmissionTransition(po.status);
    if (!canSubmitPo(session, po) || !transition) return NextResponse.json({ error: "Purchase order is locked" }, { status: 409 });
    if (!po.poNumber.trim() || !parseDate(po.poDate) || !po.vendorName.trim() || po.documentTotalPaise <= 0) {
      return NextResponse.json({ error: "Required fields are missing" }, { status: 400 });
    }
    if (po.lineItems.length === 0) {
      return NextResponse.json({ error: "Line items not checked: add at least one line item before submit" }, { status: 400 });
    }
    for (const item of po.lineItems) {
      if (
        !item.sku.trim() ||
        !item.description.trim() ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        item.unitPricePaise <= 0
      ) return NextResponse.json({ error: "Each line needs a SKU, description, positive whole quantity and positive prices" }, { status: 400 });
      const expectedLineTotal = calculateLineTotalPaise(item.quantity, item.unitPricePaise);
      if (expectedLineTotal === null) return NextResponse.json({ error: "Line-item amount exceeds the supported range" }, { status: 400 });
      if (Math.abs(expectedLineTotal - item.lineTotalPaise) > 100) {
        return NextResponse.json({ error: "Line maths do not add up" }, { status: 400 });
      }
    }
    const calculated = po.lineItems.reduce<number | null>(
      (sum, item) => sum === null ? null : addPaise(sum, item.lineTotalPaise),
      0
    );
    if (calculated === null) return NextResponse.json({ error: "PO total exceeds the supported range" }, { status: 400 });
    if (Math.abs(calculated - po.documentTotalPaise) > 100) {
      return NextResponse.json({ error: "PO total does not match line totals" }, { status: 400 });
    }
    const recorded = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.purchaseOrder.updateMany({
        where: {
          id: po.id,
          creatorId: session.uid,
          status: po.status,
          updatedAt: po.updatedAt
        },
        data: { status: "SUBMITTED", calculatedTotalPaise: calculated, totalsMatch: true }
      });
      if (updated.count !== 1) return false;
      await transaction.actionHistory.create({
        data: {
          poId: po.id,
          actorId: session.uid,
          action: transition.action,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus
        }
      });
      return true;
    });
    if (!recorded) return NextResponse.json({ error: "Purchase order changed while you were submitting; reload and try again" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const eventId = logError("PO_SUBMIT_ERROR", error);
    if (getErrorCode(error) === "P2002") return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    return NextResponse.json({ error: "Could not submit the purchase order", eventId }, { status: 500 });
  }
}
