import { z } from 'zod';

export const issueOperatorInvitationSchema = z
  .object({
    phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/),
  })
  .strict();

export const redeemOperatorInvitationSchema = z
  .object({
    token: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
