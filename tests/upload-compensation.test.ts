import assert from "node:assert/strict";
import test from "node:test";
import { withUploadedFileRollback } from "../lib/upload-compensation";

test("removes the uploaded object when the database write fails", async () => {
  const removed: string[] = [];
  await assert.rejects(
    withUploadedFileRollback("pos/test.pdf", async () => { throw new Error("database unavailable"); }, async key => { removed.push(key); }),
    /database unavailable/
  );
  assert.deepEqual(removed, ["pos/test.pdf"]);
});

test("preserves the database error and reports a failed storage cleanup", async () => {
  const primaryError = new Error("database unavailable");
  const cleanupError = new Error("storage unavailable");
  let reported: unknown;
  await assert.rejects(
    withUploadedFileRollback("pos/test.pdf", async () => { throw primaryError; }, async () => { throw cleanupError; }, error => { reported = error; }),
    error => error === primaryError
  );
  assert.equal(reported, cleanupError);
});
