import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma, resetDb } from './helpers';
import {
  issueInvitation,
  redeemInvitation,
} from '../../src/services/operatorInvitation';

const phone = '+56912345678';
beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

async function users() {
  const admin = await prisma.user.create({
    data: {
      phoneNumber: '+56911111111',
      role: 'ADMIN',
      phoneNumberVerified: true,
    },
  });
  const client = await prisma.user.create({
    data: { phoneNumber: phone, phoneNumberVerified: true },
  });
  const session = await prisma.session.create({
    data: {
      userId: client.id,
      token: `session-${client.id}`,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const adminSession = await prisma.session.create({
    data: {
      userId: admin.id,
      token: `session-${admin.id}`,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return { admin, client, session, adminSession };
}

describe('invitación y canje en DB aislada', () => {
  it('persiste digest único, FK y vence en 24 horas; canje cambia rol y consume una vez', async () => {
    const { admin, client, session, adminSession } = await users();
    const issued = await issueInvitation(admin.id, phone, adminSession.id);
    expect(issued.status).toBe('issued');
    if (issued.status !== 'issued') return;
    const record = await prisma.operatorInvitation.findUniqueOrThrow({
      where: { tokenHash: issued.tokenHash },
    });
    expect(record.issuedByUserId).toBe(admin.id);
    expect(record.phoneNumber).toBe(phone);
    expect(record.expiresAt.getTime() - record.createdAt.getTime()).toBe(
      86400000,
    );
    expect(JSON.stringify(record)).not.toContain(issued.token);
    expect(await redeemInvitation(session.id, issued.token)).toBe('redeemed');
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: client.id } }),
    ).toMatchObject({ role: 'OPERATOR' });
    expect(await redeemInvitation(session.id, issued.token)).toBe('forbidden');
    expect(
      await prisma.operatorInvitation.findUniqueOrThrow({
        where: { id: record.id },
      }),
    ).toMatchObject({ consumedByUserId: client.id });
  });
  it('deniega vencimiento, destinatario ajeno, no verificado y sesiones revocadas', async () => {
    const { admin, client, session, adminSession } = await users();
    const issued = await issueInvitation(admin.id, phone, adminSession.id);
    if (issued.status !== 'issued') throw new Error('fixture');
    await prisma.user.update({
      where: { id: client.id },
      data: { phoneNumberVerified: false },
    });
    expect(await redeemInvitation(session.id, issued.token)).toBe('forbidden');
    await prisma.user.update({
      where: { id: client.id },
      data: { phoneNumberVerified: true, phoneNumber: '+56922222222' },
    });
    expect(await redeemInvitation(session.id, issued.token)).toBe('invalid');
    await prisma.user.update({
      where: { id: client.id },
      data: { phoneNumber: phone },
    });
    await prisma.operatorInvitation.update({
      where: { tokenHash: issued.tokenHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await redeemInvitation(session.id, issued.token)).toBe('invalid');
    await prisma.session.delete({ where: { id: session.id } });
    expect(await redeemInvitation(session.id, issued.token)).toBe(
      'unauthorized',
    );
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).role,
    ).toBe('CLIENT');
  });
  it('deniega issuer no ADMIN y roles OPERATOR/ADMIN al canjear', async () => {
    const { admin, client, session, adminSession } = await users();
    expect((await issueInvitation(client.id, phone, session.id)).status).toBe(
      'forbidden',
    );
    const issued = await issueInvitation(admin.id, phone, adminSession.id);
    if (issued.status !== 'issued') throw new Error('fixture');
    await prisma.user.update({
      where: { id: client.id },
      data: { role: 'OPERATOR' },
    });
    expect(await redeemInvitation(session.id, issued.token)).toBe('forbidden');
    await prisma.user.update({
      where: { id: client.id },
      data: { role: 'ADMIN' },
    });
    expect(await redeemInvitation(session.id, issued.token)).toBe('forbidden');
  });
  it('solo un canje concurrente gana y ninguno parcial tras fallo de actualización', async () => {
    const { admin, client, session, adminSession } = await users();
    const issued = await issueInvitation(admin.id, phone, adminSession.id);
    if (issued.status !== 'issued') throw new Error('fixture');
    const results = await Promise.all([
      redeemInvitation(session.id, issued.token),
      redeemInvitation(session.id, issued.token),
    ]);
    expect(results.sort()).toEqual(['forbidden', 'redeemed']);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).role,
    ).toBe('OPERATOR');
  });
  it('revierte consumo si el update de User falla dentro de la transacción', async () => {
    const { admin, session, adminSession } = await users();
    const issued = await issueInvitation(admin.id, phone, adminSession.id);
    if (issued.status !== 'issued') throw new Error('fixture');
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION fail_invitation_promotion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."role" = 'OPERATOR' THEN RAISE EXCEPTION 'test promotion failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_invitation_promotion BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION fail_invitation_promotion()`,
    );
    try {
      await expect(
        redeemInvitation(session.id, issued.token),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER fail_invitation_promotion ON "User"`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION fail_invitation_promotion()`,
      );
    }
    expect(
      (
        await prisma.operatorInvitation.findUniqueOrThrow({
          where: { tokenHash: issued.tokenHash },
        })
      ).consumedAt,
    ).toBeNull();
  });
  it('migración desplegada: FK e índices; rollback SQL elimina tablas dentro de transacción y permite ROLLBACK', async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ indexname: string }>
    >`SELECT indexname FROM pg_indexes WHERE tablename IN ('OperatorInvitation', 'OperatorInvitationEvent')`;
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'OperatorInvitation_tokenHash_key',
        'OperatorInvitation_issuedByUserId_createdAt_idx',
        'OperatorInvitation_consumedByUserId_idx',
        'OperatorInvitation_phoneNumber_expiresAt_idx',
        'OperatorInvitationEvent_actorId_action_createdAt_idx',
      ]),
    );
    const fks = await prisma.$queryRaw<
      Array<{ conname: string }>
    >`SELECT conname FROM pg_constraint WHERE conrelid IN ('"OperatorInvitation"'::regclass, '"OperatorInvitationEvent"'::regclass) AND contype = 'f'`;
    expect(fks.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        'OperatorInvitation_issuedByUserId_fkey',
        'OperatorInvitation_consumedByUserId_fkey',
        'OperatorInvitationEvent_actorId_fkey',
      ]),
    );
    const sql = readFileSync(
      resolve('docs/runbooks/DES-02b-rollback.sql'),
      'utf8',
    );
    await expect(
      prisma.$transaction(async (tx) => {
        for (const statement of sql
          .replace(/^--.*$/gm, '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)) {
          await tx.$executeRawUnsafe(statement);
        }
        const rows = await tx.$queryRaw<
          Array<{ present: string | null }>
        >`SELECT to_regclass('"OperatorInvitation"')::text AS present`;
        expect(rows[0].present).toBeNull();
        throw new Error('rollback de prueba, preservar esquema');
      }),
    ).rejects.toThrow('rollback de prueba');
    const rows = await prisma.$queryRaw<
      Array<{ present: string | null }>
    >`SELECT to_regclass('"OperatorInvitation"')::text AS present`;
    expect(rows[0].present).toBe('"OperatorInvitation"');
  });
  it('límites persistentes por actor, con auditoría saneada', async () => {
    const { admin, session, adminSession } = await users();
    for (let i = 0; i < 10; i++)
      expect(await redeemInvitation(session.id, '0'.repeat(64))).toBe(
        'invalid',
      );
    expect(await redeemInvitation(session.id, '0'.repeat(64))).toBe('limited');
    for (let i = 0; i < 20; i++)
      expect(
        (await issueInvitation(admin.id, phone, adminSession.id)).status,
      ).toBe('issued');
    expect(
      (await issueInvitation(admin.id, phone, adminSession.id)).status,
    ).toBe('limited');
    const events = await prisma.operatorInvitationEvent.findMany();
    expect(events.length).toBe(32);
    expect(JSON.stringify(events)).not.toContain(phone);
    expect(JSON.stringify(events)).not.toContain('0'.repeat(64));
  });
});
