import { Router } from 'express';
import {
  issueOperatorInvitationSchema,
  redeemOperatorInvitationSchema,
} from '@destrabe/shared';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import {
  issueInvitation,
  redeemInvitation,
} from '../services/operatorInvitation';

export const invitationRouter = Router();
invitationRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
invitationRouter.use(requireAuth);

const unauth = { error: 'Unauthorized', code: 'UNAUTHORIZED' };
const forbidden = { error: 'Forbidden', code: 'FORBIDDEN' };
const invalid = { error: 'Invitación no válida', code: 'INVALID_INVITATION' };

invitationRouter.post('/admin/operator-invitations', async (req, res) => {
  const actor = (req as AuthedRequest).user!;
  if (!actor.sessionId) return res.status(401).json(unauth);
  const parsed = issueOperatorInvitationSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: 'Solicitud inválida', code: 'BAD_REQUEST' });
  try {
    const result = await issueInvitation(
      actor.id,
      parsed.data.phoneNumber,
      actor.sessionId,
    );
    if (result.status === 'unauthorized') return res.status(401).json(unauth);
    if (result.status === 'forbidden') return res.status(403).json(forbidden);
    if (result.status === 'limited')
      return res
        .status(429)
        .json({ error: 'Inténtalo más tarde', code: 'RATE_LIMITED' });
    // Única exposición del secreto; nunca incluir digest, teléfono ni metadata de DB.
    return res
      .status(201)
      .json({ token: result.token, expiresAt: result.expiresAt });
  } catch {
    return res
      .status(500)
      .json({ error: 'Error interno', code: 'INTERNAL_ERROR' });
  }
});

invitationRouter.post('/operator/invitations/redeem', async (req, res) => {
  const actor = (req as AuthedRequest).user!;
  if (!actor.sessionId) return res.status(401).json(unauth);
  const parsed = redeemOperatorInvitationSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: 'Solicitud inválida', code: 'BAD_REQUEST' });
  try {
    const result = await redeemInvitation(actor.sessionId, parsed.data.token);
    if (result === 'unauthorized') return res.status(401).json(unauth);
    if (result === 'forbidden') return res.status(403).json(forbidden);
    if (result === 'limited')
      return res
        .status(429)
        .json({ error: 'Inténtalo más tarde', code: 'RATE_LIMITED' });
    if (result === 'invalid') return res.status(400).json(invalid);
    return res.status(200).json({ redeemed: true });
  } catch {
    return res
      .status(500)
      .json({ error: 'Error interno', code: 'INTERNAL_ERROR' });
  }
});
