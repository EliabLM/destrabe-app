-- DCC-08: importes en pesos COP enteros, una cotización por operador y
-- servicio, y borrados que no eliminan registros financieros.
--
-- Datos existentes:
-- 1. Cotizaciones duplicadas del mismo operador en el mismo servicio: se
--    conserva una sola. Primero la aceptada (si la hay); si no, la más
--    reciente. Nunca se borra una cotización aceptada.
-- 2. Importes: se redondean al peso entero más cercano con ROUND(numeric),
--    que lleva 0,5 lejos de cero (1500,5 -> 1501). En Payment,
--    operatorAmount se recalcula como amount - commission ya redondeados,
--    para que la suma cuadre. Un importe fuera del rango de INTEGER hace
--    fallar la migración en vez de truncarlo.
-- 3. Las comisiones guardadas no se recalculan con la tasa nueva.

DELETE FROM "Quote" AS q
USING (
  SELECT
    q2."id",
    ROW_NUMBER() OVER (
      PARTITION BY q2."serviceId", q2."operatorProfileId"
      ORDER BY (s."id" IS NOT NULL) DESC, q2."createdAt" DESC, q2."id" DESC
    ) AS rn
  FROM "Quote" AS q2
  LEFT JOIN "Service" AS s ON s."acceptedQuoteId" = q2."id"
) AS ranked
WHERE q."id" = ranked."id"
  AND ranked.rn > 1;

ALTER TABLE "Quote"
  ALTER COLUMN "amount" SET DATA TYPE INTEGER USING ROUND("amount"::numeric)::integer;

ALTER TABLE "Payment"
  ALTER COLUMN "amount" SET DATA TYPE INTEGER USING ROUND("amount"::numeric)::integer,
  ALTER COLUMN "commission" SET DATA TYPE INTEGER USING ROUND("commission"::numeric)::integer,
  ALTER COLUMN "operatorAmount" SET DATA TYPE INTEGER
    USING (ROUND("amount"::numeric) - ROUND("commission"::numeric))::integer;

CREATE UNIQUE INDEX "Quote_serviceId_operatorProfileId_key"
  ON "Quote"("serviceId", "operatorProfileId");

-- Borrar un usuario ya no arrastra sus servicios, cotizaciones ni pagos: el
-- borrado de cuenta se hará anonimizando (DCC-14).
ALTER TABLE "Service" DROP CONSTRAINT "Service_clientProfileId_fkey";
ALTER TABLE "Service" ADD CONSTRAINT "Service_clientProfileId_fkey"
  FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Quote" DROP CONSTRAINT "Quote_operatorProfileId_fkey";
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_operatorProfileId_fkey"
  FOREIGN KEY ("operatorProfileId") REFERENCES "OperatorProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_serviceId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
