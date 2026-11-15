CREATE TABLE "OperatorInvitation" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "issuedByUserId" TEXT NOT NULL,
  "consumedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "OperatorInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperatorInvitation_tokenHash_key" ON "OperatorInvitation"("tokenHash");
CREATE INDEX "OperatorInvitation_issuedByUserId_createdAt_idx" ON "OperatorInvitation"("issuedByUserId", "createdAt");
CREATE INDEX "OperatorInvitation_consumedByUserId_idx" ON "OperatorInvitation"("consumedByUserId");
CREATE INDEX "OperatorInvitation_phoneNumber_expiresAt_idx" ON "OperatorInvitation"("phoneNumber", "expiresAt");
ALTER TABLE "OperatorInvitation" ADD CONSTRAINT "OperatorInvitation_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperatorInvitation" ADD CONSTRAINT "OperatorInvitation_consumedByUserId_fkey" FOREIGN KEY ("consumedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OperatorInvitationEvent" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorInvitationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OperatorInvitationEvent_actorId_action_createdAt_idx" ON "OperatorInvitationEvent"("actorId", "action", "createdAt");
ALTER TABLE "OperatorInvitationEvent" ADD CONSTRAINT "OperatorInvitationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
