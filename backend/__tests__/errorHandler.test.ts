import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middleware/errorHandler';

describe('errorHandler middleware', () => {
  it('responds 500 with { error, code: "INTERNAL_ERROR" } when a route throws', async () => {
    const app = express();
    app.get('/boom', () => {
      throw new Error('boom');
    });
    app.use(errorHandler);

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom', code: 'INTERNAL_ERROR' });
  });
});
