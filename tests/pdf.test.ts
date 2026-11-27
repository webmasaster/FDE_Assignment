import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { extractPdf, extractPoDate, extractPoNumber, parseLineRow } from "../lib/pdf";

async function sample(name: string) {
  return extractPdf(await readFile(path.join(process.cwd(), name)));
}

test("extracts complete data from the clean digital sample", async () => {
  const result = await sample("sample_1_digital.pdf");
  assert.equal(result.extractionMethod, "text_layer");
  assert.equal(result.poNumber, "PO-2026-001");
  assert.equal(result.poDate, "2026-11-15");
  assert.equal(result.vendorName, "ABC Industries");
  assert.equal(result.lineItems.length, 5);
  assert.deepEqual(result.lineItems.map(({ sku }) => sku), [
    "MC-001", "MC-014", "HY-203", "MC-027", "HY-118"
  ]);
  assert.deepEqual(result.lineItems.map(({ description }) => description), [
    "Body Wash 200ml",
    "Coffee Face Scrub 100g",
    "Sunscreen SPF50 50ml",
    "Coffee Body Scrub with Arabica Extract and Walnut Shell 250g",
    "Vitamin C Face Serum 30ml"
  ]);
  assert.deepEqual(result.lineItems.map(({ quantity, unitPricePaise, lineTotalPaise }) => [
    quantity, unitPricePaise, lineTotalPaise
  ]), [
    [500, 12_000, 6_000_000],
    [300, 9_500, 2_850_000],
    [200, 18_000, 3_600_000],
    [150, 21_000, 3_150_000],
    [400, 24_550, 9_820_000]
  ]);
  assert.match(result.lineItems[0].description, /200ml/);
  assert.match(result.lineItems[3].description, /and Walnut Shell 250g/);
  assert.equal(result.documentTotalPaise, 25_420_000);
  assert.equal(result.calculatedTotalPaise, 25_420_000);
  assert.equal(result.totalsMatch, true);
});

test("extracts mismatch sample values without concealing the printed-total mismatch", async () => {
  const result = await sample("sample_2_mismatch.pdf");
  assert.equal(result.poNumber, "PO-2026-003");
  assert.equal(result.poDate, "2026-11-20");
  assert.equal(result.vendorName, "XYZ Cosmetics LLP");
  assert.equal(result.lineItems.length, 3);
  assert.deepEqual(result.lineItems.map(({ quantity, unitPricePaise, lineTotalPaise }) => [
    quantity, unitPricePaise, lineTotalPaise
  ]), [
    [500, 12_000, 6_000_000],
    [300, 9_500, 2_850_000],
    [200, 18_000, 3_600_000]
  ]);
  assert.equal(result.calculatedTotalPaise, 12_450_000);
  assert.equal(result.documentTotalPaise, 14_250_000);
  assert.equal(result.totalsMatch, false);
});

test("extracts resent sample number for database duplicate detection", async () => {
  const result = await sample("sample_3_resent.pdf");
  assert.equal(result.poNumber, "PO-2026-001");
  assert.equal(result.lineItems.length, 5);
  assert.deepEqual(
    result.lineItems.map(({ sku, quantity, unitPricePaise, lineTotalPaise }) => [sku, quantity, unitPricePaise, lineTotalPaise]),
    (await sample("sample_1_digital.pdf")).lineItems.map(({ sku, quantity, unitPricePaise, lineTotalPaise }) => [sku, quantity, unitPricePaise, lineTotalPaise])
  );
});

test("classifies garbled sample as unreadable rather than guessing values", async () => {
  const result = await sample("sample_4_garbled.pdf");
  assert.equal(result.extractionMethod, "unreadable");
  assert.equal(result.poNumber, "");
  assert.equal(result.lineItems.length, 0);
  assert.match(result.warnings.join(" "), /manually/i);
});

test("parses alternate header labels and date formats", () => {
  assert.equal(extractPoNumber("Order No. : PO-2026-021"), "PO-2026-021");
  assert.equal(extractPoNumber("P.O. # PO-2026-022"), "PO-2026-022");
  assert.equal(extractPoNumber("Purchase Order No. PO-2026-023"), "PO-2026-023");
  for (const date of ["15-11-2026", "15/11/2026", "15.11.2026", "15 Nov 2026"]) {
    assert.equal(extractPoDate(`Order Date : ${date}`), date);
  }
});

test("preserves numeric description text and parses currencies with variable spacing", () => {
  const row = parseLineRow("MC-020\tVitamin B12 500mg bottle 10ml 24\t₹120.50\t₹2,892.00");
  assert.deepEqual(row, {
    sku: "MC-020",
    description: "Vitamin B12 500mg bottle 10ml",
    quantity: 24,
    unitPricePaise: 12_050,
    lineTotalPaise: 289_200
  });
  const unmarked = parseLineRow("MC-031 Bottle 500ml 12 95.00 1,140.00");
  assert.deepEqual(unmarked, {
    sku: "MC-031",
    description: "Bottle 500ml",
    quantity: 12,
    unitPricePaise: 9_500,
    lineTotalPaise: 114_000
  });
});
