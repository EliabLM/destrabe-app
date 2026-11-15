import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ISSUE_LIMIT = 20;
const REDEEM_LIMIT = 10;

type IssueResult =
  | { status: 'issued'; token: string; tokenHash: string; expiresAt: Date }
  | { status: 'forbidden' }
  | { status: 'limited' }
  | { status: 'unauthorized' };
type RedeemResult =
  'redeemed' | 'invalid' | 'forbidden' | 'limited' | 'unauthorized';

function digest(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Serializa por usuario mediante bloqueo de fila: contador, evento y mutación son una unidad. */
export async function issueInvitation(
  actorId: string,
  phoneNumber: string,
  sessionId: string,
): Promise<IssueResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR UPDATE`;
    const now = new Date();
    const session = await tx.session.findFirst({
      where: { id: sessionId, userId: actorId, expiresAt: { gt: now } },
    });
    if (!session) return { status: 'unauthorized' };
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { role: true },
    });
    if (!actor) return { status: 'forbidden' };
    const event = async (outcome: string, reason: string) =>
      tx.operatorInvitationEvent.create({
        data: { actorId, action: 'issue', outcome, reason, createdAt: now },
      });
    if (actor.role !== 'ADMIN') {
      await event('denied', 'role');
      return { status: 'forbidden' };
    }
    const count = await tx.operatorInvitationEvent.count({
      where: {
        actorId,
        action: 'issue',
        createdAt: { gt: new Date(now.getTime() - DAY) },
      },
    });
    if (count >= ISSUE_LIMIT) {
      await event('denied', 'rate_limit');
      return { status: 'limited' };
    }
    const token = randomBytes(32).toString('hex');
    const tokenHash = digest(token);
    const expiresAt = new Date(now.getTime() + DAY);
    await tx.operatorInvitation.create({
      data: {
        tokenHash,
        phoneNumber,
        issuedByUserId: actorId,
        createdAt: now,
        expiresAt,
      },
    });
    await event('issued', 'ok');
    return { status: 'issued', token, tokenHash, expiresAt };
  });
}

/** Session ID proviene de Better Auth; revalidar sesión + usuario actuales dentro de la transacción. */
export async function redeemInvitation(
  sessionId: string,
  token: string,
): Promise<RedeemResult> {
  return prisma.$transaction(async (tx) => {
    // Primera lectura para localizar actor; el lock de User serializa intentos y cambios de rol.
    const initial = await tx.session.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (!initial) return 'unauthorized';
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${initial.userId} FOR UPDATE`;
    const now = new Date();
    const session = await tx.session.findFirst({
      where: {
        id: sessionId,
        userId: initial.userId,
        expiresAt: { gt: now },
      },
    });
    if (!session) return 'unauthorized';
    const user = await tx.user.findUnique({
      where: { id: session.userId },
      select: {
        role: true,
        phoneNumberVerified: true,
        phoneNumber: true,
      },
    });
    const event = async (outcome: string, reason: string) =>
      tx.operatorInvitationEvent.create({
        data: {
          actorId: session.userId,
          action: 'redeem',
          outcome,
          reason,
          createdAt: now,
        },
      });
    if (!user || user.role !== 'CLIENT' || !user.phoneNumberVerified) {
      await event('denied', 'eligibility');
      return 'forbidden';
    }
    const count = await tx.operatorInvitationEvent.count({
      where: {
        actorId: session.userId,
        action: 'redeem',
        createdAt: { gt: new Date(now.getTime() - HOUR) },
      },
    });
    if (count >= REDEEM_LIMIT) {
      await event('denied', 'rate_limit');
      return 'limited';
    }
    const invitation = await tx.operatorInvitation.findUnique({
      where: { tokenHash: digest(token) },
    });
    if (
      !invitation ||
      invitation.phoneNumber !== user.phoneNumber ||
      invitation.consumedAt ||
      invitation.expiresAt <= now
    ) {
      await event('denied', 'invalid_invitation');
      return 'invalid';
    }
    const consumed = await tx.operatorInvitation.updateMany({
      where: {
        id: invitation.id,
        consumedAt: null,
        expiresAt: { gt: now },
        phoneNumber: user.phoneNumber,
      },
      data: { consumedAt: now, consumedByUserId: session.userId },
    });
    if (consumed.count !== 1) {
      await event('denied', 'invalid_invitation');
      return 'invalid';
    }
    const promoted = await tx.user.updateMany({
      where: {
        id: session.userId,
        role: 'CLIENT',
        phoneNumberVerified: true,
        phoneNumber: invitation.phoneNumber,
      },
      data: { role: 'OPERATOR' },
    });
    // Throw revierte consumo + cualquier escritura. Nunca devolver error después de consumir.
    if (promoted.count !== 1) throw new Error('Invitation promotion failed');
    await event('redeemed', 'ok');
    return 'redeemed';
  });
}
