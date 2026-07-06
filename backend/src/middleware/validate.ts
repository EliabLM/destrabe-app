import type { Request, RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';

/**
 * Extends Express Request with a `validated` property for parsed data.
 * Exported so route handlers can cast `req` and access `req.validated`.
 */
export interface ValidatedRequest extends Request {
  validated?: Record<string, unknown>;
}

/**
 * Validation middleware factory (REQ-009 / design §D5).
 *
 * Parses `req[source]` against the given Zod schema and:
 * - On success: sets `req.validated[source] = parsed` and calls `next()`.
 * - On failure: responds 400 `{ error, code: 'VALIDATION_ERROR', issues }`.
 *
 * Usage:
 *   router.post('/services', validate(createServiceSchema, 'body'), handler);
 *   router.get('/nearby', validate(nearbyServicesQuerySchema, 'query'), handler);
 */
export function validate<T extends ZodSchema>(
  schema: T,
  source: 'body' | 'query' | 'params',
): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const error = result.error as ZodError;
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        issues: error.issues,
      });
    }

    const vReq = req as ValidatedRequest;
    if (!vReq.validated) vReq.validated = {};
    vReq.validated[source] = result.data;

    next();
  };
}
