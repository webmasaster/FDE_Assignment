import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canDecidePo, getDecisionTransition } from "@/lib/po-access";
import { isTemporaryPoNumber } from "@/lib/po-number";
import { decisionBodySchema } from "@/lib/validation";
import { logError } from "@/lib/logger";
import { poIdSchema } from "@/lib/validation";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!poIdSchema.safeParse(params.id).success) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (!session.roles.includes("APPROVER")) return NextResponse.json({ error: "Approver role required" }, { status: 403 });
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    const parsedBody = decisionBodySchema.safeParse(input);
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Invalid decision" }, { status: 400 });
    }
    const { action } = parsedBody.data;
    const reason = parsedBody.data.reason?.trim() ?? "";
    const po = await prisma.purchaseOrder.findUnique({ where: { id: params.id } });
    if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    if (po.status !== "SUBMITTED") return NextResponse.json({ error: "Only submitted purchase orders can be decided" }, { status: 409 });
    if (!canDecidePo(session, po)) return NextResponse.json({ error: "You cannot decide your own purchase order" }, { status: 403 });
    if (parsedBody.data.action === "APPROVE" && isTemporaryPoNumber(po.poNumber)) {
      return NextResponse.json({ error: "The creator must enter the actual PO number before approval" }, { status: 409 });
    }

    const transition = getDecisionTransition(po.status, action);
    if (!transition) return NextResponse.json({ error: "Only submitted purchase orders can be decided" }, { status: 409 });
    const recorded = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.purchaseOrder.updateMany({
        where: { id: po.id, status: "SUBMITTED", updatedAt: po.updatedAt },
        data: { status: transition.toStatus }
      });
      if (updated.count !== 1) return false;
      await transaction.actionHistory.create({
        data: {
          poId: po.id,
          actorId: session.uid,
          action,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          remark: action === "REJECT" ? reason : null
        }
      });
      return true;
    });
    if (!recorded) return NextResponse.json({ error: "This purchase order was already decided" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const eventId = logError("PO_DECISION_ERROR", error);
    return NextResponse.json({ error: "Could not record the decision", eventId }, { status: 500 });
  }
}
