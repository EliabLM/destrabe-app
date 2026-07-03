import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

const TABLES = [
  'Review',
  'Payment',
  'Message',
  'Quote',
  'Service',
  'OperatorProfile',
  'ClientProfile',
] as const;

export async function resetDb() {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE;`);
}
