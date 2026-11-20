import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma, resetDb, seedUser } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Borrados (REQ-006 / DCC-08). Los registros financieros (Service, Quote,
 * Payment) no se borran en cascada: borrar un usuario con historial falla y
 * el borrado de cuenta se hará anonimizando (DCC-14).
 */

const isFkViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';

async function seedServiceWithQuote() {
  await seedUser('u-c');
  await seedUser('u-o');
  const client = await prisma.clientProfile.create({
    data: { userId: 'u-c' },
  });
  const operator = await prisma.operatorProfile.create({
    data: { userId: 'u-o', truckType: 'platform', licensePlate: 'PLT' },
  });
  const service = await prisma.service.create({
    data: {
      clientProfileId: client.id,
      type: 'BREAKDOWN',
      originLat: 0,
      originLng: 0,
      expiresAt: new Date(),
    },
  });
  const quote = await prisma.quote.create({
    data: {
      serviceId: service.id,
      operatorProfileId: operator.id,
      amount: 50000,
    },
  });
  return { client, operator, service, quote };
}

describe('borrados y registros financieros (REQ-006 / DCC-08)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('borrar un usuario con pagos falla (Restrict) y no borra nada', async () => {
    const { service } = await seedServiceWithQuote();
    await prisma.payment.create({
      data: {
        serviceId: service.id,
        amount: 50000,
        commission: 5000,
        operatorAmount: 45000,
      },
    });

    const err = await prisma.user
      .delete({ where: { id: 'u-c' } })
      .catch((e: unknown) => e);
    expect(isFkViolation(err)).toBe(true);

    expect(await prisma.user.count({ where: { id: 'u-c' } })).toBe(1);
    expect(await prisma.service.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('borrar un servicio con pago falla (Restrict)', async () => {
    const { service } = await seedServiceWithQuote();
    await prisma.payment.create({
      data: {
        serviceId: service.id,
        amount: 50000,
        commission: 5000,
        operatorAmount: 45000,
      },
    });

    const err = await prisma.service
      .delete({ where: { id: service.id } })
      .catch((e: unknown) => e);
    expect(isFkViolation(err)).toBe(true);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('borrar un cliente con servicios falla aunque no haya pagos', async () => {
    await seedServiceWithQuote();
    const err = await prisma.user
      .delete({ where: { id: 'u-c' } })
      .catch((e: unknown) => e);
    expect(isFkViolation(err)).toBe(true);
    expect(await prisma.service.count()).toBe(1);
  });

  it('borrar un operador con cotizaciones falla y las conserva', async () => {
    const { operator } = await seedServiceWithQuote();
    const err = await prisma.user
      .delete({ where: { id: 'u-o' } })
      .catch((e: unknown) => e);
    expect(isFkViolation(err)).toBe(true);
    expect(
      await prisma.operatorProfile.count({ where: { id: operator.id } }),
    ).toBe(1);
    expect(await prisma.quote.count()).toBe(1);
  });

  it('un servicio sin pago se puede borrar y arrastra cotizaciones, mensajes y reseña', async () => {
    const { service, operator } = await seedServiceWithQuote();
    await prisma.message.create({
      data: { serviceId: service.id, senderId: 'u-c', content: 'hi' },
    });
    await prisma.review.create({
      data: {
        serviceId: service.id,
        operatorProfileId: operator.id,
        rating: 4,
      },
    });

    await prisma.service.delete({ where: { id: service.id } });

    expect(await prisma.quote.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.review.count()).toBe(0);
  });

  it('borrar un usuario sin historial sigue funcionando', async () => {
    await seedUser('u-solo');
    await prisma.clientProfile.create({ data: { userId: 'u-solo' } });
    await prisma.user.delete({ where: { id: 'u-solo' } });
    expect(await prisma.clientProfile.count()).toBe(0);
  });
});
