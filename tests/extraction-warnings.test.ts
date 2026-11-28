import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowLineExtractionWarning } from "../lib/extraction-warnings";

test("hides a row math extraction note after its matching line is corrected", () => {
  const warning = "Line maths do not match for DP-001.";
  assert.equal(shouldShowLineExtractionWarning(warning, [
    { sku: "DP-001", complete: true, lineMathMatches: true }
  ]), false);
  assert.equal(shouldShowLineExtractionWarning(warning, [
    { sku: "DP-001", complete: false, lineMathMatches: false }
  ]), true);
});

test("hides an unsafe parse note when the same line is manually completed", () => {
  const warning = "Could not safely parse line item DP-001; review its quantity, unit price and line total manually.";
  assert.equal(shouldShowLineExtractionWarning(warning, [
    { sku: "DP-001", complete: true, lineMathMatches: true }
  ]), false);
  assert.equal(shouldShowLineExtractionWarning(warning, [
    { sku: "DP-001", complete: false, lineMathMatches: false }
  ]), true);
});
