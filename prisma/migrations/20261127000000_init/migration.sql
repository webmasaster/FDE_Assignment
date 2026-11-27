CREATE TYPE "Role" AS ENUM ('CREATOR', 'APPROVER');
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "roles" "Role"[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "poNumber" TEXT NOT NULL,
  "poDate" TEXT NOT NULL,
  "vendorName" TEXT NOT NULL,
  "documentTotalPaise" INTEGER NOT NULL,
  "calculatedTotalPaise" INTEGER NOT NULL,
  "totalsMatch" BOOLEAN NOT NULL,
  "extractionMethod" TEXT NOT NULL,
  "status" "PoStatus" NOT NULL DEFAULT 'DRAFT',
  "originalFileKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineItem" (
  "id" TEXT NOT NULL,
  "poId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPricePaise" INTEGER NOT NULL,
  "lineTotalPaise" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "LineItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionHistory" (
  "id" TEXT NOT NULL,
  "poId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" "PoStatus" NOT NULL,
  "toStatus" "PoStatus" NOT NULL,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActionHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LineItem"
ADD CONSTRAINT "LineItem_poId_fkey"
FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActionHistory"
ADD CONSTRAINT "ActionHistory_poId_fkey"
FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActionHistory"
ADD CONSTRAINT "ActionHistory_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
