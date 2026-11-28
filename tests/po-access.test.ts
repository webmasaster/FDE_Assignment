import assert from "node:assert/strict";
import test from "node:test";
import { PoStatus, Role } from "@prisma/client";
import { canDecidePo, canEditPo, canSubmitPo, canViewPo, getDecisionTransition, getSubmissionTransition } from "../lib/po-access";

const creator1 = { uid: "creator-1", roles: [Role.CREATOR] };
const creator2 = { uid: "creator-2", roles: [Role.CREATOR] };
const approver1 = { uid: "approver-1", roles: [Role.APPROVER] };
const lead1 = { uid: "lead-1", roles: [Role.CREATOR, Role.APPROVER] };

const creator1Draft = { creatorId: creator1.uid, status: PoStatus.DRAFT };
const creator1Submitted = { creatorId: creator1.uid, status: PoStatus.SUBMITTED };
const creator1Rejected = { creatorId: creator1.uid, status: PoStatus.REJECTED };
const creator2Submitted = { creatorId: creator2.uid, status: PoStatus.SUBMITTED };

test("creators are restricted to their own POs and editable states", () => {
  assert.equal(canViewPo(creator1, creator1Draft), true);
  assert.equal(canViewPo(creator2, creator1Draft), false);
  assert.equal(canViewPo(creator1, creator2Submitted), false);
  assert.equal(canEditPo(creator1, creator1Draft), true);
  assert.equal(canEditPo(creator1, creator1Rejected), true);
  assert.equal(canEditPo(creator1, creator1Submitted), false);
  assert.equal(canSubmitPo(creator1, creator1Draft), true);
  assert.equal(canSubmitPo(creator1, creator1Rejected), true);
  assert.equal(canDecidePo(creator1, creator2Submitted), false);
});

test("approvers view submitted POs but cannot edit them", () => {
  const creator1Approved = { creatorId: creator1.uid, status: PoStatus.APPROVED };
  const creator1Rejected = { creatorId: creator1.uid, status: PoStatus.REJECTED };
  assert.equal(canViewPo(approver1, creator1Submitted), true);
  assert.equal(canViewPo(approver1, creator1Approved), true);
  assert.equal(canViewPo(approver1, creator1Rejected), true);
  assert.equal(canViewPo(approver1, creator1Draft), false);
  assert.equal(canEditPo(approver1, creator1Submitted), false);
  assert.equal(canEditPo(approver1, creator1Approved), false);
  assert.equal(canEditPo(approver1, creator1Rejected), false);
  assert.equal(canDecidePo(approver1, creator1Submitted), true);
  assert.equal(canDecidePo(approver1, creator1Approved), false);
  assert.equal(canDecidePo(approver1, creator1Rejected), false);
});

test("lead can decide another creator's PO but not their own", () => {
  const ownSubmitted = { creatorId: lead1.uid, status: PoStatus.SUBMITTED };
  assert.equal(canDecidePo(lead1, creator2Submitted), true);
  assert.equal(canDecidePo(lead1, ownSubmitted), false);
});

test("only the prescribed workflow transitions are valid", () => {
  assert.deepEqual(getSubmissionTransition(PoStatus.DRAFT), {
    fromStatus: PoStatus.DRAFT,
    toStatus: PoStatus.SUBMITTED,
    action: "SUBMIT"
  });
  assert.deepEqual(getSubmissionTransition(PoStatus.REJECTED), {
    fromStatus: PoStatus.REJECTED,
    toStatus: PoStatus.SUBMITTED,
    action: "RESUBMIT"
  });
  assert.equal(getSubmissionTransition(PoStatus.APPROVED), null);
  assert.deepEqual(getDecisionTransition(PoStatus.SUBMITTED, "APPROVE"), {
    fromStatus: PoStatus.SUBMITTED,
    toStatus: PoStatus.APPROVED
  });
  assert.deepEqual(getDecisionTransition(PoStatus.SUBMITTED, "REJECT"), {
    fromStatus: PoStatus.SUBMITTED,
    toStatus: PoStatus.REJECTED
  });
  assert.equal(getDecisionTransition(PoStatus.APPROVED, "APPROVE"), null);
});
