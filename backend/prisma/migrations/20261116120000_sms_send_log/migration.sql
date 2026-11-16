-- DCC-05: registro de envíos de OTP por SMS (límites persistentes).
-- CreateTable
CREATE TABLE "SmsSendLog" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsSendLog_phoneHash_createdAt_idx" ON "SmsSendLog"("phoneHash", "createdAt");

-- CreateIndex
CREATE INDEX "SmsSendLog_ipHash_createdAt_idx" ON "SmsSendLog"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "SmsSendLog_createdAt_idx" ON "SmsSendLog"("createdAt");

