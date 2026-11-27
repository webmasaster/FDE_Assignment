"use client";
import { useState } from "react";

export default function UploadPage() {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setUploading(true);
    const response = await fetch("/api/pos/upload", { method:"POST", body:new FormData(event.currentTarget) });
    const data = await response.json();
    setUploading(false);
    if (!response.ok) setError(data.error || "Upload failed");
    else window.location.href = `/po/${data.id}${data.unreadable ? "?unreadable=1" : ""}`;
  }
  return (
    <main className="main">
      <div className="card" style={{maxWidth:620, margin:"0 auto"}}>
        <h1>Upload a purchase order</h1>
        <p className="muted">Digital PDFs are extracted automatically. Scans or garbled text can be entered manually.</p>
        <form onSubmit={submit} style={{display:"grid", gap:14}}>
          <label>PDF (maximum 5 MB)<input name="pdf" type="file" accept="application/pdf" required /></label>
          {error && <div className="error">{error}</div>}
          <div className="actions">
            <button type="submit" disabled={uploading}>{uploading ? "Reading…" : "Upload and review"}</button>
            <a className="button secondary" href="/dashboard">Cancel</a>
          </div>
        </form>
      </div>
    </main>
  );
}
