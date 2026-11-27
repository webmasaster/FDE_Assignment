"use client";
import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      const data = await response.json();
      if (!response.ok) setError(data.error || "Sign in failed");
      else window.location.href = "/dashboard";
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <main className="login card">
      <h1>PEP Brands PO Portal</h1>
      <p className="muted">Sign in to raise or approve purchase orders.</p>
      <form onSubmit={submit} style={{ display:"grid", gap:12 }}>
        <label>Email<input name="email" type="email" required defaultValue="creator1@pep.local" /></label>
        <label>Password<input name="password" type="password" required /></label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
