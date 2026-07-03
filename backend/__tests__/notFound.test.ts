import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('notFound middleware', () => {
  it('responds 404 with { error, code: "NOT_FOUND" } for unknown routes', async () => {
    const res = await request(app).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
