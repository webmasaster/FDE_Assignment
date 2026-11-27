import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!session.roles.includes("APPROVER")) return NextResponse.json({ error: "Approver role required" }, { status: 403 });
    const body = await request.json();
    const action = String(body.action || "").toUpperCase();
    if (!["APPROVE", "REJECT"].includes(action)) return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
    const reason = String(body.reason || "").trim();
    if (action === "REJECT" && !reason) return NextResponse.json({ error: "A rejection reason is required" }, { status: 400 });
    const po = await prisma.purchaseOrder.findUnique({ where: { id: params.id } });
    if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (po.status !== "SUBMITTED") return NextResponse.json({ error: "Only submitted purchase orders can be decided" }, { status: 409 });
    if (po.creatorId === session.uid) return NextResponse.json({ error: "You cannot approve or reject your own purchase order" }, { status: 403 });

    const toStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
    const recorded = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.purchaseOrder.updateMany({
        where: { id: po.id, status: "SUBMITTED" },
        data: { status: toStatus }
      });
      if (updated.count !== 1) return false;
      await transaction.actionHistory.create({
        data: {
          poId: po.id,
          actorId: session.uid,
          action,
          fromStatus: "SUBMITTED",
          toStatus,
          remark: action === "REJECT" ? reason : null
        }
      });
      return true;
    });
    if (!recorded) return NextResponse.json({ error: "This purchase order was already decided" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(new Date().toISOString(), "PO_DECISION_ERROR", error);
    return NextResponse.json({ error: "Could not record the decision" }, { status: 500 });
  }
}
