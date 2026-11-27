import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseDate } from "@/lib/checks";

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const po = await prisma.purchaseOrder.findUnique({ where: { id: params.id }, include: { lineItems: true } });
    if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (!session.roles.includes("CREATOR")) return NextResponse.json({ error: "Creator role required" }, { status: 403 });
    if (po.creatorId !== session.uid) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (!["DRAFT", "REJECTED"].includes(po.status)) return NextResponse.json({ error: "Purchase order is locked" }, { status: 409 });
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
      if (Math.abs(item.quantity * item.unitPricePaise - item.lineTotalPaise) > 100) {
        return NextResponse.json({ error: "Line maths do not add up" }, { status: 400 });
      }
    }
    const calculated = po.lineItems.reduce((sum, item) => sum + item.lineTotalPaise, 0);
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
          action: po.status === "REJECTED" ? "RESUBMIT" : "SUBMIT",
          fromStatus: po.status,
          toStatus: "SUBMITTED"
        }
      });
      return true;
    });
    if (!recorded) return NextResponse.json({ error: "Purchase order changed while you were submitting; reload and try again" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error(new Date().toISOString(), "PO_SUBMIT_ERROR", error);
    if (error?.code === "P2002") return NextResponse.json({ error: "This PO number already exists", duplicate: true }, { status: 409 });
    return NextResponse.json({ error: "Could not submit the purchase order" }, { status: 500 });
  }
}
