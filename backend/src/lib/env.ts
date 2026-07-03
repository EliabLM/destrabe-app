import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(
  input: Record<string, string | undefined> = process.env,
): Env {
  return envSchema.parse(input);
}
