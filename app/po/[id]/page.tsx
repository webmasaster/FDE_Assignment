import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canDecidePo, canEditPo, canViewPo } from "@/lib/po-access";
import { isTemporaryPoNumber } from "@/lib/po-number";
import PoReview from "./PoReview";

export default async function PoPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: { lineItems: { orderBy: { sortOrder: "asc" } }, actions: { include: { actor: { select: { email: true } } }, orderBy: { createdAt: "asc" } } }
  });
  if (!po) notFound();
  if (!canViewPo(session, po)) notFound();
  const editable = canEditPo(session, po);
  const approverCanDecide = canDecidePo(session, po);
  const displayPoNumber = isTemporaryPoNumber(po.poNumber) ? "PO number needed" : po.poNumber;

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/dashboard"><span className="brand-mark">PB</span><span>PEP Brands <span className="brand-sub">/ Purchase orders</span></span></Link>
        <Link className="button secondary" href="/dashboard">Back to orders</Link>
      </header>
      <main className="main">
        <div className="page-heading">
          <div><p className="eyebrow">Order review</p><div className="po-title"><h1>{displayPoNumber}</h1><span className={`status ${po.status}`}>{po.status}</span></div><p>{po.vendorName || "Vendor details needed"}</p></div>
          <a className="button secondary" href={`/api/pdf/${po.id}`} target="_blank" rel="noreferrer">View source PDF <span aria-hidden="true">↗</span></a>
        </div>
        <PoReview
          id={po.id} poNumber={po.poNumber} poDate={po.poDate} vendorName={po.vendorName}
          documentTotalPaise={po.documentTotalPaise} extractionMethod={po.extractionMethod}
          extractionWarnings={po.extractionWarnings}
          status={po.status} lineItems={po.lineItems} editable={editable} approverCanDecide={approverCanDecide}
        />
        <section className="card">
          <div className="table-title" style={{ padding: "0 0 17px", marginBottom: 4 }}><h2>Activity history</h2><span>{po.actions.length} {po.actions.length === 1 ? "event" : "events"}</span></div>
          {po.actions.length === 0 ? <p className="muted">No actions recorded yet. Submissions and decisions will appear here.</p> : (
            <div className="table-wrap">
              <table><thead><tr><th>Date and time</th><th>Actor</th><th>Action</th><th>Remark</th></tr></thead><tbody>
                {po.actions.map((action) => <tr key={action.id}>
                  <td>{action.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td>{action.actor.email}</td>
                  <td><strong>{action.action}</strong><div className="muted">{action.fromStatus} → {action.toStatus}</div></td>
                  <td>{action.remark || <span className="muted">—</span>}</td>
                </tr>)}
              </tbody></table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
