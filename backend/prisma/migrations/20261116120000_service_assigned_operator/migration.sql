-- Aditiva: operador asignado al servicio (nullable, FK + índice).
ALTER TABLE "Service" ADD COLUMN "assignedOperatorProfileId" TEXT;

CREATE INDEX "Service_assignedOperatorProfileId_idx" ON "Service"("assignedOperatorProfileId");

ALTER TABLE "Service" ADD CONSTRAINT "Service_assignedOperatorProfileId_fkey" FOREIGN KEY ("assignedOperatorProfileId") REFERENCES "OperatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: servicios existentes con cotización aceptada.
UPDATE "Service" AS s
SET "assignedOperatorProfileId" = q."operatorProfileId"
FROM "Quote" AS q
WHERE s."acceptedQuoteId" = q."id"
  AND s."assignedOperatorProfileId" IS NULL;
