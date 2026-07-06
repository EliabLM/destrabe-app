import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate } from '../src/middleware/validate';
import type { Request, Response, NextFunction } from 'express';

/**
 * T4 — validate middleware (REQ-009)
 *
 * Unit tests for the Zod validation factory.
 * Express-style (req, res, next) mocks without a server.
 */

const testSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  age: z.number().int().positive(),
});

const querySchema = z.object({
  page: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().positive().default(10),
});

function makeReq(body: unknown = {}, query: unknown = {}) {
  return { body, query } as unknown as Request;
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as unknown as Response;
}

function makeNext() {
  return vi.fn() as unknown as NextFunction;
}

describe('validate middleware — body (REQ-009)', () => {
  it('parses valid body, sets req.validated.body, and calls next()', () => {
    const req = makeReq({ name: 'Alice', age: 30 });
    const res = makeRes();
    const next = makeNext();

    const middleware = validate(testSchema, 'body');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect((req as any).validated?.body).toEqual({ name: 'Alice', age: 30 });
  });

  it('responds 400 with VALIDATION_ERROR for invalid body, does not call next', () => {
    const req = makeReq({ name: '', age: -1 });
    const res = makeRes();
    const next = makeNext();

    const middleware = validate(testSchema, 'body');
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(String),
        code: 'VALIDATION_ERROR',
        issues: expect.any(Array),
      }),
    );
    // Verify issues contain field-level errors
    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonArg.issues.length).toBeGreaterThanOrEqual(1);
  });

  it('handles missing body gracefully', () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = makeNext();

    const middleware = validate(testSchema, 'body');
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});

describe('validate middleware — query (REQ-009)', () => {
  it('parses valid query params, sets req.validated.query, and calls next()', () => {
    const req = makeReq({}, { page: '1', limit: '20' });
    const res = makeRes();
    const next = makeNext();

    const middleware = validate(querySchema, 'query');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).validated?.query).toEqual({ page: 1, limit: 20 });
  });

  it('applies default values for optional fields', () => {
    const req = makeReq({}, { page: '2' });
    const res = makeRes();
    const next = makeNext();

    const middleware = validate(querySchema, 'query');
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).validated?.query).toEqual({ page: 2, limit: 10 });
  });

  it('responds 400 for invalid query params', () => {
    const req = makeReq({}, { page: '-1' });
    const res = makeRes();
    const next = makeNext();

    const middleware = validate(querySchema, 'query');
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
