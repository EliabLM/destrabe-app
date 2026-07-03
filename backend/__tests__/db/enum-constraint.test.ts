import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma, resetDb } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('enum constraints (REQ-007)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('rejects an invalid ServiceStatus value', async () => {
    const client = await prisma.clientProfile.create({
      data: { userId: 'u-c' },
    });

    await expect(
      prisma.service.create({
        data: {
          clientProfileId: client.id,
          type: 'BREAKDOWN',
          // @ts-expect-error invalid enum on purpose
          status: 'INVALID',
          originLat: 0,
          originLng: 0,
          expiresAt: new Date(),
        },
      }),
    ).rejects.toThrow(
      Prisma.PrismaClientValidationError ||
        Prisma.PrismaClientKnownRequestError,
    );
  });

  it('rejects an invalid ServiceType value via raw SQL (DB-side constraint)', async () => {
    const client = await prisma.clientProfile.create({
      data: { userId: 'u-c' },
    });

    await expect(
      prisma.$executeRaw`INSERT INTO "Service" (id, "clientProfileId", type, status, "originLat", "originLng", "expiresAt", "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, ${client.id}, 'NOT_A_TYPE'::text, 'PENDING', 0, 0, now(), now(), now())`,
    ).rejects.toThrow();
  });
});
