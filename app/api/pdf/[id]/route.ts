import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getPdfUrl } from "@/lib/storage";
import { canViewPo } from "@/lib/po-access";
import { poIdSchema } from "@/lib/validation";
import { logError } from "@/lib/logger";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const eventId = crypto.randomUUID();
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!poIdSchema.safeParse(params.id).success) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    const po = await prisma.purchaseOrder.findUnique({ where: { id: params.id } });
    if (!po || !canViewPo(session, po)) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    const url = await getPdfUrl(po.originalFileKey);
    return NextResponse.redirect(url);
  } catch (error: unknown) {
    logError("PDF_LINK_ERROR", error, eventId);
    return NextResponse.json({ error: "Could not open the PDF", eventId }, { status: 500 });
  }
}
