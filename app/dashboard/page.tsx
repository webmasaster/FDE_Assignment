import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isTemporaryPoNumber } from "@/lib/po-number";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.uid;
  const isCreator = session.roles.includes("CREATOR");
  const isApprover = session.roles.includes("APPROVER");

  const pos = await prisma.purchaseOrder.findMany({
    where: isApprover
      ? { OR: [
          { status: "SUBMITTED" },
          { status: "APPROVED" },
          { status: "REJECTED" },
          ...(isCreator ? [{ creatorId: userId }] : [])
        ] }
      : { creatorId: userId },
    include: { creator: { select: { email: true } } },
    orderBy: { updatedAt: "desc" }
  });

  const submitted = pos.filter((po) => po.status === "SUBMITTED");
  const awaitingDecision = isApprover ? submitted.filter((po) => po.creatorId !== userId) : [];
  const ownSubmitted = isCreator ? submitted.filter((po) => po.creatorId === userId) : [];
  const needsAttention = isCreator
    ? pos.filter((po) => po.creatorId === userId && (po.status === "DRAFT" || po.status === "REJECTED"))
    : [];
  const approved = pos.filter((po) => po.status === "APPROVED");
  const rejectedHistory = isApprover
    ? pos.filter((po) => po.status === "REJECTED" && po.creatorId !== userId)
    : [];
  const waitingCount = isApprover ? awaitingDecision.length : ownSubmitted.length;

  function orderSection(title: string, description: string, orders: typeof pos, emptyMessage: string, sectionClass = "") {
    return (
      <section className={`card table-wrap order-section ${sectionClass}`}>
        <div className="table-title"><div><h2>{title}</h2><p>{description}</p></div><span>{orders.length} {orders.length === 1 ? "order" : "orders"}</span></div>
        {orders.length === 0 ? <div className="empty-state"><strong>All clear</strong><p>{emptyMessage}</p></div> : (
          <table>
            <thead><tr><th>PO number</th><th>Vendor</th><th>Status</th><th>Creator</th><th>Last updated</th><th></th></tr></thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id}>
                  <td>{isTemporaryPoNumber(po.poNumber) ? <span className="muted">PO number needed</span> : <strong>{po.poNumber}</strong>}</td>
                  <td>{po.vendorName || <span className="muted">Not extracted</span>}</td>
                  <td><span className={`status ${po.status}`}>{po.status}</span></td>
                  <td>{po.creator.email}</td>
                  <td>{po.updatedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td><Link href={`/po/${po.id}`}>{po.status === "SUBMITTED" && isApprover && po.creatorId !== userId ? "Review" : "Open"} <span aria-hidden="true">→</span></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">PB</span><span>PEP Brands <span className="brand-sub">/ Purchase orders</span></span></div>
        <div className="actions">
          {isCreator && <Link className="button" href="/upload">Upload PO <span aria-hidden="true">＋</span></Link>}
          <form action="/api/auth/logout" method="post"><button className="secondary" type="submit">Sign out</button></form>
        </div>
      </header>
      <main className="main">
        <div className="page-heading">
          <div><p className="eyebrow">Workspace overview</p><h1>Purchase orders</h1><p>Track requests and move each order forward.</p></div>
          {isApprover && <span className="status SUBMITTED">APPROVER</span>}
        </div>
        <section className="metric-grid" aria-label="Purchase order summary">
          <div className="metric"><span className="metric-label">{isApprover ? "Awaiting your review" : "Waiting for approval"}</span><strong className="metric-value">{waitingCount}</strong></div>
          <div className="metric"><span className="metric-label">{isCreator ? "Needs your attention" : "Rejected"}</span><strong className="metric-value">{isCreator ? needsAttention.length : rejectedHistory.length}</strong></div>
          <div className="metric"><span className="metric-label">Approved</span><strong className="metric-value">{approved.length}</strong></div>
        </section>

        {isApprover && orderSection("Awaiting your review", "Submitted orders that need a finance decision.", awaitingDecision, "No purchase orders are waiting for your decision.", "section-review")}
        {isCreator && orderSection("Waiting for approval", "Your submitted orders are in the finance queue.", ownSubmitted, "You have no orders waiting for approval.", "section-submitted")}
        {isCreator && orderSection("Needs your attention", "Drafts and returned orders you can update.", needsAttention, "You have no drafts or returned orders to update.", "section-attention")}
        {orderSection("Approved", "Orders that have completed the approval workflow.", approved, "Approved orders will appear here.", "section-approved")}
        {isApprover && orderSection("Rejected", "Read-only history of returned orders.", rejectedHistory, "No rejected orders to show.", "section-rejected")}
      </main>
    </div>
  );
}
