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
    <main className="login-page">
      <section className="login-aside">
        <div className="brand"><span className="brand-mark">PB</span><span>PEP Brands <span className="brand-sub">/ Operations</span></span></div>
        <div className="login-copy">
          <p className="eyebrow" style={{ color: "#bce2c8" }}>Purchase order workspace</p>
          <h1>Good decisions start with clear details.</h1>
          <p>Prepare, review and approve purchase orders in one shared workspace.</p>
        </div>
        <div className="login-foot">PEP Brands · Purchase order portal</div>
      </section>
      <section className="login-form-side">
        <div className="login-panel">
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in to continue</h2>
          <p>Use your assigned PEP Brands account.</p>
          <form onSubmit={submit}>
            <label>Email address<input name="email" type="email" autoComplete="username" placeholder="you@company.com" required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></label>
            {error && <div className="error" role="alert" aria-live="polite">{error}</div>}
            <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
