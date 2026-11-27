BEGIN;

ALTER TABLE "PurchaseOrder"
ADD COLUMN "poNumberNormalized" TEXT;

ALTER TABLE "PurchaseOrder"
ADD COLUMN "extractionWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "PurchaseOrder"
SET "poNumberNormalized" = UPPER(BTRIM("poNumber"));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PurchaseOrder"
    GROUP BY "poNumberNormalized"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize PO numbers: existing case/whitespace duplicates need manual review';
  END IF;
END $$;

UPDATE "PurchaseOrder"
SET "poNumber" = "poNumberNormalized";

ALTER TABLE "PurchaseOrder"
ALTER COLUMN "poNumberNormalized" SET NOT NULL;

CREATE UNIQUE INDEX "PurchaseOrder_poNumberNormalized_key"
ON "PurchaseOrder"("poNumberNormalized");

CREATE INDEX "PurchaseOrder_creatorId_status_updatedAt_idx"
ON "PurchaseOrder"("creatorId", "status", "updatedAt");

CREATE INDEX "PurchaseOrder_status_updatedAt_idx"
ON "PurchaseOrder"("status", "updatedAt");

CREATE INDEX "LineItem_poId_sortOrder_idx"
ON "LineItem"("poId", "sortOrder");

CREATE INDEX "ActionHistory_poId_createdAt_idx"
ON "ActionHistory"("poId", "createdAt");

COMMIT;
