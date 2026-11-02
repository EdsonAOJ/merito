-- CreateTable
CREATE TABLE "BalanceReconciliation" (
    "id" UUID NOT NULL,
    "accountId" VARCHAR(64) NOT NULL,
    "resourceKey" VARCHAR(64) NOT NULL,
    "referenceDate" DATE NOT NULL,
    "expectedAmount" DECIMAL(28,8) NOT NULL,
    "actualAmount" DECIMAL(28,8),
    "status" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceReconciliation_accountId_resourceKey_idx" ON "BalanceReconciliation"("accountId", "resourceKey");
