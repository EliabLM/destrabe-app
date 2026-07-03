import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, resetDb, seedUser } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('relations (REQ-003, REQ-006)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates clientProfile -> service -> quote -> payment -> message -> review', async () => {
    await seedUser('user-client-1');
    await seedUser('user-operator-1');
    const client = await prisma.clientProfile.create({
      data: { userId: 'user-client-1' },
    });

    const operator = await prisma.operatorProfile.create({
      data: {
        userId: 'user-operator-1',
        truckType: 'grua_plataforma',
        licensePlate: 'ABC123',
      },
    });

    const service = await prisma.service.create({
      data: {
        clientProfileId: client.id,
        type: 'BREAKDOWN',
        status: 'PENDING',
        originLat: 10.391,
        originLng: -75.479,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const quote = await prisma.quote.create({
      data: {
        serviceId: service.id,
        operatorProfileId: operator.id,
        amount: 50000,
      },
    });

    const payment = await prisma.payment.create({
      data: {
        serviceId: service.id,
        amount: 50000,
        commission: 5000,
        operatorAmount: 45000,
      },
    });

    const message = await prisma.message.create({
      data: {
        serviceId: service.id,
        senderId: 'user-client-1',
        content: 'Hello, on my way?',
      },
    });

    const review = await prisma.review.create({
      data: {
        serviceId: service.id,
        operatorProfileId: operator.id,
        rating: 5,
      },
    });

    expect(client.id).toMatch(/^c/);
    expect(quote.operatorProfileId).toBe(operator.id);
    expect(payment.serviceId).toBe(service.id);
    expect(message.serviceId).toBe(service.id);
    expect(review.rating).toBe(5);

    const fetched = await prisma.service.findUnique({
      where: { id: service.id },
      include: {
        client: true,
        quotes: true,
        payment: true,
        messages: true,
        review: true,
      },
    });
    expect(fetched?.quotes).toHaveLength(1);
    expect(fetched?.payment?.id).toBe(payment.id);
    expect(fetched?.messages).toHaveLength(1);
    expect(fetched?.review?.id).toBe(review.id);
  });

  it('acceptedQuote 1:1 relation works', async () => {
    await seedUser('u-c');
    await seedUser('u-o');
    const client = await prisma.clientProfile.create({
      data: { userId: 'u-c' },
    });
    const operator = await prisma.operatorProfile.create({
      data: { userId: 'u-o', truckType: 'platform', licensePlate: 'XYZ' },
    });
    const service = await prisma.service.create({
      data: {
        clientProfileId: client.id,
        type: 'TRANSFER',
        originLat: 0,
        originLng: 0,
        expiresAt: new Date(),
      },
    });
    const quote = await prisma.quote.create({
      data: {
        serviceId: service.id,
        operatorProfileId: operator.id,
        amount: 1000,
      },
    });

    const updated = await prisma.service.update({
      where: { id: service.id },
      data: { acceptedQuoteId: quote.id, status: 'ACTIVE' },
      include: { acceptedQuote: true },
    });

    expect(updated.acceptedQuote?.id).toBe(quote.id);
    expect(updated.status).toBe('ACTIVE');
  });
});
