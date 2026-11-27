import assert from "node:assert/strict";
import test from "node:test";
import { getSafeErrorMessage } from "../lib/logger";

test("logs useful error messages while redacting credentials and limiting length", () => {
  const message = getSafeErrorMessage(new Error(
    "Database failed at postgresql://alice:pass@example.com/db with password=hunter2 and Bearer abc123"
  ));
  assert.match(message, /Database failed/);
  assert.doesNotMatch(message, /alice|pass@example|hunter2|abc123/);
  assert.ok(message.length <= 300);
});

test("provides a safe message for non-Error failures", () => {
  assert.equal(getSafeErrorMessage("secret"), "Unknown error");
});
