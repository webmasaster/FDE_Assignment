import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getPdfUrl } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const po = await prisma.purchaseOrder.findUnique({ where: { id: params.id } });
  if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  const own = po.creatorId === session.uid;
  const approverCanView = session.roles.includes("APPROVER") && po.status === "SUBMITTED";
  if (!own && !approverCanView) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  try {
    const url = await getPdfUrl(po.originalFileKey);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error(new Date().toISOString(), "PDF_LINK_ERROR", error);
    return NextResponse.json({ error: "Could not open the PDF" }, { status: 500 });
  }
}
