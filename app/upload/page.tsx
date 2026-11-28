"use client";
import Link from "next/link";
import { useState } from "react";

export default function UploadPage() {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setUploading(true);
    try {
      const response = await fetch("/api/pos/upload", { method: "POST", body: new FormData(event.currentTarget) });
      const data = await response.json();
      if (!response.ok) setError(data.error || "Upload failed");
      else window.location.href = `/po/${data.id}`;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/dashboard"><span className="brand-mark">PB</span><span>PEP Brands <span className="brand-sub">/ Purchase orders</span></span></Link>
        <Link className="button secondary" href="/dashboard">Back to orders</Link>
      </header>
      <main className="main">
        <div className="page-heading"><div><p className="eyebrow">New request</p><h1>Upload a purchase order</h1><p>Start with the original document. You can review and correct extracted details next.</p></div></div>
        <section className="card upload-card">
          <p className="eyebrow">Step 1 of 2</p>
          <h2>Select your PDF</h2>
          <p className="upload-intro">Digital PDFs are extracted automatically. Scans or garbled documents open in manual-entry mode.</p>
          <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
            <label>Purchase order PDF
              <input
                name="pdf"
                type="file"
                accept="application/pdf,.pdf"
                required
                onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? "")}
              />
              <span className="muted">PDF only · Maximum file size 5 MB</span>
            </label>
            {fileName && <p className="muted" role="status">Selected: <strong>{fileName}</strong></p>}
            {error && <div className="error" role="alert" aria-live="polite">{error}</div>}
            <div className="actions">
              <button type="submit" disabled={uploading}>{uploading ? "Reading document…" : "Upload and review"}</button>
              <Link className="button secondary" href="/dashboard">Cancel</Link>
            </div>
          </form>
          <div className="upload-note">You’ll be able to check the extracted details and totals before submitting for approval.</div>
        </section>
      </main>
    </div>
  );
}
