import assert from "node:assert/strict";
import test from "node:test";
import { addPaise, calculateLineTotalPaise, MAX_DB_INT, parseDate, parseMoney, parseQuantity } from "../lib/checks";

test("parses supported rupee formats into integer paise", () => {
  for (const [input, expected] of [
    ["₹1,20,000.00", 12_000_000],
    ["Rs. 124500", 12_450_000],
    ["INR 1,24,500", 12_450_000],
    ["124,500", 12_450_000],
    ["120.50", 12_050]
  ] as const) {
    assert.equal(parseMoney(input), expected, input);
  }
});

test("rejects malformed, negative, non-finite, and out-of-range amounts", () => {
  for (const input of ["1,2,34", "₹-2", "1.234", "Infinity", "", "1.2.3", true, {}, Infinity, -1]) {
    assert.equal(parseMoney(input), null, String(input));
  }
  assert.equal(parseMoney("₹21,474,836.47"), MAX_DB_INT);
  assert.equal(parseMoney("₹21,474,836.48"), null);
  assert.equal(parseMoney(Number.MAX_SAFE_INTEGER), null);
});

test("parses valid dates and rejects invalid calendar dates", () => {
  for (const input of ["15-11-2026", "15/11/2026", "15.11.2026", "15 Nov 2026", "2026-11-15"]) {
    assert.equal(parseDate(input), "2026-11-15", input);
  }
  for (const input of ["31-02-2026", "29-02-2025", "00/11/2026", "15 Foo 2026", "15-11-26"]) {
    assert.equal(parseDate(input), null, input);
  }
});

test("bounds quantities and safely calculates rupee line values", () => {
  assert.equal(parseQuantity(500), 500);
  assert.equal(parseQuantity(0), null);
  assert.equal(parseQuantity(-1), null);
  assert.equal(parseQuantity(1.5), null);
  assert.equal(parseQuantity("500"), null);
  assert.equal(calculateLineTotalPaise(500, 12_000), 6_000_000);
  assert.equal(calculateLineTotalPaise(MAX_DB_INT, MAX_DB_INT), null);
  assert.equal(addPaise(MAX_DB_INT - 1, 2), null);
});
