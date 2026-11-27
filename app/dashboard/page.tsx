import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  const isCreator = session.roles.includes("CREATOR");
  const isApprover = session.roles.includes("APPROVER");

  const pos = await prisma.purchaseOrder.findMany({
    where: isApprover
      ? { OR: [{ status: "SUBMITTED" }, ...(isCreator ? [{ creatorId: session.uid }] : [])] }
      : { creatorId: session.uid },
    include: { creator: { select: { email: true } } },
    orderBy: { updatedAt: "desc" }
  });

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span>PEP</span> BRANDS · PO Portal</div>
        <div className="actions">
          {isCreator && <Link className="button" href="/upload">Upload PO</Link>}
          <form action="/api/auth/logout" method="post"><button className="secondary" type="submit">Sign out</button></form>
        </div>
      </header>
      <main className="main">
        <h1>Purchase orders</h1>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>PO</th><th>Vendor</th><th>Status</th><th>Creator</th><th>Updated</th><th></th></tr></thead>
            <tbody>
              {pos.map((po) => (
                <tr key={po.id}>
                  <td><strong>{po.poNumber}</strong></td>
                  <td>{po.vendorName || <span className="muted">Not extracted</span>}</td>
                  <td><span className={`status ${po.status}`}>{po.status}</span></td>
                  <td>{po.creator.email}</td>
                  <td>{po.updatedAt.toLocaleString("en-IN")}</td>
                  <td><Link href={`/po/${po.id}`}>Open</Link></td>
                </tr>
              ))}
              {pos.length === 0 && <tr><td colSpan={6} className="muted">No purchase orders available.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
