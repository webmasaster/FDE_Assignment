import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canDecidePo, canEditPo, canViewPo } from "@/lib/po-access";
import PoReview from "./PoReview";

export default async function PoPage({ params }: { params:{id:string} }) {
  const session=await getSession();
  if(!session) redirect("/login");
  const po=await prisma.purchaseOrder.findUnique({
    where:{id:params.id},
    include:{lineItems:{orderBy:{sortOrder:"asc"}},actions:{include:{actor:{select:{email:true}}},orderBy:{createdAt:"asc"}}}
  });
  if(!po) notFound();
  if(!canViewPo(session, po)) notFound();
  const editable=canEditPo(session, po);
  const approverCanDecide=canDecidePo(session, po);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span>PEP</span> BRANDS · PO Portal</div>
        <div className="actions"><Link className="button secondary" href="/dashboard">Back</Link><a className="button" href={`/api/pdf/${po.id}`} target="_blank" rel="noreferrer">Open original PDF</a></div>
      </header>
      <main className="main">
        <h1>{po.poNumber}<span className={`status ${po.status}`} style={{marginLeft:10}}>{po.status}</span></h1>
        <PoReview
          id={po.id} poNumber={po.poNumber} poDate={po.poDate} vendorName={po.vendorName}
          documentTotalPaise={po.documentTotalPaise} extractionMethod={po.extractionMethod}
          extractionWarnings={po.extractionWarnings}
          status={po.status} lineItems={po.lineItems} editable={editable} approverCanDecide={approverCanDecide}
        />
        <div className="card">
          <h2>Action history</h2>
          {po.actions.length===0?<p className="muted">No actions recorded.</p>:(
            <table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Remark</th></tr></thead><tbody>
              {po.actions.map(action=><tr key={action.id}><td>{action.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td>{action.actor.email}</td><td>{action.action}: {action.fromStatus} → {action.toStatus}</td><td>{action.remark||"—"}</td></tr>)}
            </tbody></table>
          )}
        </div>
      </main>
    </div>
  );
}
