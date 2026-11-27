import { Role, PoStatus } from "@prisma/client";

export type Principal = { uid: string; roles: Role[] };
export type PoAccessRecord = { creatorId: string; status: PoStatus };
export type DecisionAction = "APPROVE" | "REJECT";

export function canViewPo(principal: Principal, po: PoAccessRecord) {
  return po.creatorId === principal.uid ||
    (principal.roles.includes(Role.APPROVER) && po.status === PoStatus.SUBMITTED);
}

export function canEditPo(principal: Principal, po: PoAccessRecord) {
  return principal.roles.includes(Role.CREATOR) &&
    po.creatorId === principal.uid &&
    (po.status === PoStatus.DRAFT || po.status === PoStatus.REJECTED);
}

export function canDecidePo(principal: Principal, po: PoAccessRecord) {
  return principal.roles.includes(Role.APPROVER) &&
    po.status === PoStatus.SUBMITTED &&
    po.creatorId !== principal.uid;
}

export function canSubmitPo(principal: Principal, po: PoAccessRecord) {
  return principal.roles.includes(Role.CREATOR) &&
    po.creatorId === principal.uid &&
    (po.status === PoStatus.DRAFT || po.status === PoStatus.REJECTED);
}

export function getSubmissionTransition(status: PoStatus) {
  if (status === PoStatus.DRAFT) return { fromStatus: PoStatus.DRAFT, toStatus: PoStatus.SUBMITTED, action: "SUBMIT" as const };
  if (status === PoStatus.REJECTED) return { fromStatus: PoStatus.REJECTED, toStatus: PoStatus.SUBMITTED, action: "RESUBMIT" as const };
  return null;
}

export function getDecisionTransition(status: PoStatus, action: DecisionAction) {
  if (status !== PoStatus.SUBMITTED) return null;
  return {
    fromStatus: PoStatus.SUBMITTED,
    toStatus: action === "APPROVE" ? PoStatus.APPROVED : PoStatus.REJECTED
  };
}
