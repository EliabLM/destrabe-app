import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler';
import { createRequestLogger } from '../src/middleware/requestLogger';
import { captureLogs } from './helpers/logCapture';

function appThrowing(err: unknown) {
  const logs = captureLogs();
  const app = express();
  app.use(createRequestLogger(logs.logger));
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return { app, logs };
}

describe('errorHandler middleware (DCC-17)', () => {
  it('hides internal details of a Prisma error and returns the requestId', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Invalid `prisma.user.create()` invocation: Unique constraint failed on the fields: (`phoneNumber`)',
      { code: 'P2002', clientVersion: Prisma.prismaVersion.client },
    );
    const { app, logs } = appThrowing(prismaError);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      requestId: expect.any(String),
    });
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
    expect(res.text).not.toMatch(/prisma|P2002|phoneNumber|Unique/i);

    const errorLines = logs.entries().filter((entry) => entry.level === 50);
    expect(errorLines).toHaveLength(1);
    const [logged] = errorLines;
    expect(logged).toMatchObject({
      req: { id: res.body.requestId },
      res: { statusCode: 500 },
      err: { type: 'PrismaClientKnownRequestError', code: 'P2002' },
    });
    expect(JSON.stringify(logged)).toContain('Unique constraint failed');
  });

  it('responds 500 with a generic message when a route throws', async () => {
    const { app } = appThrowing(new Error('boom'));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.text).not.toContain('boom');
  });

  it('keeps the code of a 5xx domain error but not its message', async () => {
    const err = Object.assign(
      new Error('SDK said: token APP_USR-123 invalid'),
      {
        status: 502,
        code: 'MERCADOPAGO_ERROR',
      },
    );
    const { app } = appThrowing(err);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('MERCADOPAGO_ERROR');
    expect(res.text).not.toContain('APP_USR');
  });

  it('keeps the 4xx contract unchanged', async () => {
    const err = Object.assign(new Error('Quote already accepted'), {
      status: 409,
      code: 'ALREADY_ACCEPTED',
    });
    const { app } = appThrowing(err);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Quote already accepted',
      code: 'ALREADY_ACCEPTED',
    });
  });

  it('works without the request logger (falls back to the process logger)', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('boom');
    });
    app.use(errorHandler);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    });
  });
});
