import assert from "node:assert/strict";
import test from "node:test";
import { PoStatus, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "";

test("concurrent decisions record exactly one transition and history row", { skip: !enabled }, async () => {
  assert.match(databaseUrl, /test/i, "Refusing to run integration test unless DATABASE_URL names a disposable test database");
  const suffix = crypto.randomUUID();
  const creator = await prisma.user.create({
    data: { email: `integration-creator-${suffix}@example.test`, passwordHash: "unused", roles: [Role.CREATOR] }
  });
  const approverA = await prisma.user.create({
    data: { email: `integration-approver-a-${suffix}@example.test`, passwordHash: "unused", roles: [Role.APPROVER] }
  });
  const approverB = await prisma.user.create({
    data: { email: `integration-approver-b-${suffix}@example.test`, passwordHash: "unused", roles: [Role.APPROVER] }
  });

  let poId: string | undefined;
  try {
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `IT-${suffix}`,
        poNumberNormalized: `IT-${suffix}`,
        poDate: "2026-11-28",
        vendorName: "Integration Test Vendor",
        documentTotalPaise: 100,
        calculatedTotalPaise: 100,
        totalsMatch: true,
        extractionMethod: "text_layer",
        originalFileKey: `integration-tests/${suffix}.pdf`,
        originalFileName: "integration.pdf",
        creatorId: creator.id,
        status: PoStatus.SUBMITTED
      }
    });
    poId = po.id;

    const decisions = await Promise.all([approverA, approverB].map(async (approver) =>
      prisma.$transaction(async (transaction) => {
        const updated = await transaction.purchaseOrder.updateMany({
          where: { id: po.id, status: PoStatus.SUBMITTED, updatedAt: po.updatedAt },
          data: { status: PoStatus.APPROVED }
        });
        if (updated.count !== 1) return false;
        await transaction.actionHistory.create({
          data: {
            poId: po.id,
            actorId: approver.id,
            action: "APPROVE",
            fromStatus: PoStatus.SUBMITTED,
            toStatus: PoStatus.APPROVED
          }
        });
        return true;
      })
    ));

    assert.equal(decisions.filter(Boolean).length, 1);
    assert.equal(await prisma.actionHistory.count({ where: { poId: po.id } }), 1);
    assert.equal((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status, PoStatus.APPROVED);
  } finally {
    if (poId) await prisma.purchaseOrder.deleteMany({ where: { id: poId } });
    await prisma.user.deleteMany({ where: { id: { in: [creator.id, approverA.id, approverB.id] } } });
  }
});

test.after(async () => prisma.$disconnect());
