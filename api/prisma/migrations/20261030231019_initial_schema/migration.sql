-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('BALANCE_SNAPSHOT', 'DELTA_APPLIED', 'DELTA_REVERTED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "webhook_events" (
    "event_id" UUID NOT NULL,
    "type" "WebhookEventType" NOT NULL,
    "status" "WebhookEventStatus" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_code" VARCHAR(64),
    "payload" JSONB NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "account_balances" (
    "id" UUID NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "resource_key" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(28,8) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "snapshot_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "account_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_transactions" (
    "id" UUID NOT NULL,
    "balance_id" UUID NOT NULL,
    "transaction_id" VARCHAR(128) NOT NULL,
    "amount_delta" DECIMAL(28,8) NOT NULL,
    "effective_date" DATE NOT NULL,
    "applied_event_id" UUID NOT NULL,
    "reversed_event_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot_version" INTEGER NOT NULL,

    CONSTRAINT "balance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_balances_account_id_resource_key_key" ON "account_balances"("account_id", "resource_key");

-- CreateIndex
CREATE UNIQUE INDEX "balance_transactions_applied_event_id_key" ON "balance_transactions"("applied_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "balance_transactions_reversed_event_id_key" ON "balance_transactions"("reversed_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "balance_transactions_balance_id_transaction_id_key" ON "balance_transactions"("balance_id", "transaction_id");

-- AddForeignKey
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_balance_id_fkey" FOREIGN KEY ("balance_id") REFERENCES "account_balances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_applied_event_id_fkey" FOREIGN KEY ("applied_event_id") REFERENCES "webhook_events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_transactions" ADD CONSTRAINT "balance_transactions_reversed_event_id_fkey" FOREIGN KEY ("reversed_event_id") REFERENCES "webhook_events"("event_id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Impede que um saldo consolidado seja negativo.
ALTER TABLE "account_balances"
ADD CONSTRAINT "account_balances_amount_nonnegative"
CHECK ("amount" >= 0);