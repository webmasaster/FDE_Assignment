import assert from "node:assert/strict";
import test from "node:test";
import { decisionBodySchema, loginBodySchema, normalizePoNumber, poUpdateBodySchema } from "../lib/validation";

test("validates and normalizes login input", () => {
  const parsed = loginBodySchema.safeParse({ email: " Creator1@pep.local ", password: "example-password" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.email, "creator1@pep.local");
  assert.equal(loginBodySchema.safeParse({ email: true, password: "x" }).success, false);
  assert.equal(loginBodySchema.safeParse({ email: "user@example.com", password: "", extra: true }).success, false);
});

test("requires a non-empty reason for rejection", () => {
  assert.equal(decisionBodySchema.safeParse({ action: "APPROVE" }).success, true);
  assert.equal(decisionBodySchema.safeParse({ action: "REJECT", reason: "   " }).success, false);
  assert.equal(decisionBodySchema.safeParse({ action: "REJECT", reason: "Incorrect total" }).success, true);
  assert.equal(decisionBodySchema.safeParse({ action: "APPROVE", reason: {}, extra: true }).success, false);
});

test("rejects malformed or coerced PO update fields", () => {
  const base = {
    poNumber: " PO-2026-001 ",
    poDate: "15-11-2026",
    vendorName: "ABC Industries",
    documentTotal: "₹1,24,500.00",
    lineItems: [{
      sku: "MC-001",
      description: "Body Wash 200ml",
      quantity: 500,
      unitPrice: "120.00",
      lineTotal: "60,000.00"
    }]
  };
  assert.equal(poUpdateBodySchema.safeParse(base).success, true);
  assert.equal(poUpdateBodySchema.safeParse({ ...base, documentTotal: true }).success, false);
  assert.equal(poUpdateBodySchema.safeParse({
    ...base,
    lineItems: [{ ...base.lineItems[0], quantity: "500" }]
  }).success, false);
  assert.equal(poUpdateBodySchema.safeParse({ ...base, extra: "unexpected" }).success, false);
});

test("normalizes PO number case and whitespace consistently", () => {
  assert.equal(normalizePoNumber(" po-2026-001 "), "PO-2026-001");
  assert.equal(poUpdateBodySchema.safeParse({
    poNumber: "PO-2026-001; DROP TABLE User",
    poDate: "15-11-2026",
    vendorName: "ABC Industries",
    documentTotal: "1",
    lineItems: []
  }).success, false);
});
