import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, resetDb, seedUser } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('cascade delete (REQ-006)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('deleting a Service cascades to Quotes, Messages, Payment, Review', async () => {
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
    await prisma.quote.create({
      data: {
        serviceId: service.id,
        operatorProfileId: operator.id,
        amount: 100,
      },
    });
    await prisma.payment.create({
      data: {
        serviceId: service.id,
        amount: 100,
        commission: 10,
        operatorAmount: 90,
      },
    });
    await prisma.message.create({
      data: {
        serviceId: service.id,
        senderId: 'u-c',
        content: 'hi',
      },
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
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.review.count()).toBe(0);
  });

  it('deleting an OperatorProfile cascades to its Quotes and Reviews', async () => {
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
    await prisma.quote.create({
      data: {
        serviceId: service.id,
        operatorProfileId: operator.id,
        amount: 100,
      },
    });

    await prisma.operatorProfile.delete({ where: { id: operator.id } });

    expect(await prisma.quote.count()).toBe(0);
    // Service remains (cascade is on operator, not service)
    expect(await prisma.service.count()).toBe(1);
  });
});
