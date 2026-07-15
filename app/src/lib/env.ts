import { z } from 'zod';

const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z
    .string()
    .url('EXPO_PUBLIC_API_URL must be a valid URL'),
  EXPO_PUBLIC_MAPBOX_TOKEN: z
    .string()
    .min(1, 'EXPO_PUBLIC_MAPBOX_TOKEN is required'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function loadEnv():
  { ok: true; env: AppEnv } | { ok: false; missing: string } {
  if (cached) return { ok: true, env: cached };

  const parsed = envSchema.safeParse({
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_MAPBOX_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_TOKEN,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues[0]?.message ?? 'Unknown env error';
    return { ok: false, missing };
  }

  cached = parsed.data;
  return { ok: true, env: cached };
}
