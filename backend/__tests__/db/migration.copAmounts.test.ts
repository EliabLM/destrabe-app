import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, resetDb, seedUser } from './helpers';

/**
 * DCC-08 — La migración `cop_integer_amounts` sobre datos previos: importes
 * Float con decimales y cotizaciones duplicadas del mismo operador.
 *
 * Devuelve la BD al estado anterior (columnas double precision, sin índice
 * único y con borrados en cascada), siembra datos y ejecuta el SQL de la
 * migración. Al terminar, la BD queda otra vez en el estado migrado.
 */

const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20261119120000_cop_integer_amounts/migration.sql',
);

const PREVIOUS_STATE = [
  'DROP INDEX IF EXISTS "Quote_serviceId_operatorProfileId_key"',
  'ALTER TABLE "Quote" ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION',
  `ALTER TABLE "Payment"
     ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION,
     ALTER COLUMN "commission" SET DATA TYPE DOUBLE PRECISION,
     ALTER COLUMN "operatorAmount" SET DATA TYPE DOUBLE PRECISION`,
  'ALTER TABLE "Service" DROP CONSTRAINT "Service_clientProfileId_fkey"',
  `ALTER TABLE "Service" ADD CONSTRAINT "Service_clientProfileId_fkey"
     FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id")
     ON DELETE CASCADE ON UPDATE CASCADE`,
  'ALTER TABLE "Quote" DROP CONSTRAINT "Quote_operatorProfileId_fkey"',
  `ALTER TABLE "Quote" ADD CONSTRAINT "Quote_operatorProfileId_fkey"
     FOREIGN KEY ("operatorProfileId") REFERENCES "OperatorProfile"("id")
     ON DELETE CASCADE ON UPDATE CASCADE`,
  'ALTER TABLE "Payment" DROP CONSTRAINT "Payment_serviceId_fkey"',
  `ALTER TABLE "Payment" ADD CONSTRAINT "Payment_serviceId_fkey"
     FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
     ON DELETE CASCADE ON UPDATE CASCADE`,
];

/** Ejecuta la migración sentencia a sentencia (sin comentarios). */
async function runMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((sql) => sql.trim())
    .filter(Boolean);
  for (const sql of statements) await prisma.$executeRawUnsafe(sql);
}

async function insertQuote(
  id: string,
  serviceId: string,
  operatorProfileId: string,
  amount: number,
  createdAt: string,
) {
  await prisma.$executeRaw`
    INSERT INTO "Quote" ("id", "serviceId", "operatorProfileId", "amount", "createdAt")
    VALUES (${id}, ${serviceId}, ${operatorProfileId}, ${amount}::float8, ${createdAt}::timestamp)`;
}

beforeAll(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('Migración cop_integer_amounts con datos previos (DCC-08)', () => {
  it('redondea importes, deja una cotización por operador y restringe borrados', async () => {
    for (const sql of PREVIOUS_STATE) await prisma.$executeRawUnsafe(sql);

    await seedUser('m-client');
    await seedUser('m-op-a');
    await seedUser('m-op-b');
    const client = await prisma.clientProfile.create({
      data: { userId: 'm-client' },
    });
    const [opA, opB] = await Promise.all(
      ['m-op-a', 'm-op-b'].map((userId) =>
        prisma.operatorProfile.create({
          data: { userId, truckType: 'Grua', licensePlate: 'ABC123' },
        }),
      ),
    );
    const svc = (status: 'QUOTED' | 'ACTIVE') =>
      prisma.service.create({
        data: {
          clientProfileId: client.id,
          type: 'BREAKDOWN',
          status,
          originLat: 4.65,
          originLng: -74.1,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    const open = await svc('QUOTED');
    const active = await svc('ACTIVE');

    // Servicio abierto: A cotizó dos veces (se queda la más reciente).
    await insertQuote('q-old', open.id, opA!.id, 12345.5, '2026-11-01 10:00');
    await insertQuote('q-new', open.id, opA!.id, 20000.4, '2026-11-01 10:05');
    await insertQuote('q-b', open.id, opB!.id, 30000.5, '2026-11-01 10:01');
    // Servicio aceptado: se conserva la aceptada aunque haya una más nueva.
    await insertQuote('q-acc', active.id, opA!.id, 50000.5, '2026-11-01 11:00');
    await insertQuote('q-late', active.id, opA!.id, 60000, '2026-11-01 11:05');
    await prisma.$executeRaw`
      UPDATE "Service" SET "acceptedQuoteId" = 'q-acc' WHERE "id" = ${active.id}`;
    await prisma.$executeRaw`
      INSERT INTO "Payment" ("id", "serviceId", "amount", "commission", "operatorAmount", "updatedAt")
      VALUES ('p-1', ${active.id}, 50000.5, 5000.05, 45000.45, NOW())`;

    await runMigration();

    const quotes = await prisma.quote.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, amount: true },
    });
    expect(quotes).toEqual([
      { id: 'q-acc', amount: 50001 },
      { id: 'q-b', amount: 30001 },
      { id: 'q-new', amount: 20000 },
    ]);
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { id: 'p-1' } }),
    ).toMatchObject({ amount: 50001, commission: 5000, operatorAmount: 45001 });
    expect(
      (await prisma.service.findUniqueOrThrow({ where: { id: active.id } }))
        .acceptedQuoteId,
    ).toBe('q-acc');

    // Columnas enteras y restricciones nuevas activas.
    const types = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; data_type: string }>
    >`SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'Quote' AND column_name = 'amount')
          OR (table_name = 'Payment'
              AND column_name IN ('amount', 'commission', 'operatorAmount')))`;
    expect(types).toHaveLength(4);
    for (const t of types) expect(t.data_type).toBe('integer');

    const fks = await prisma.$queryRaw<
      Array<{ conname: string; confdeltype: string }>
    >`SELECT conname, confdeltype::text FROM pg_constraint
      WHERE conname IN ('Service_clientProfileId_fkey',
                        'Quote_operatorProfileId_fkey',
                        'Payment_serviceId_fkey')
      ORDER BY conname`;
    expect(fks).toEqual([
      { conname: 'Payment_serviceId_fkey', confdeltype: 'r' },
      { conname: 'Quote_operatorProfileId_fkey', confdeltype: 'r' },
      { conname: 'Service_clientProfileId_fkey', confdeltype: 'r' },
    ]);

    await expect(
      prisma.quote.create({
        data: { serviceId: open.id, operatorProfileId: opA!.id, amount: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
