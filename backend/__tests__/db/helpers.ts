import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Tablas del dominio (cambio-002) + identidad (cambio-003 / Better Auth).
// TRUNCATE ... CASCADE resuelve dependencias entre tablas sin importar el orden.
const TABLES = [
  'Review',
  'Payment',
  'Message',
  'Quote',
  'Service',
  'OperatorProfile',
  'ClientProfile',
  'Verification',
  'Account',
  'Session',
  'User',
] as const;

export async function resetDb() {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE;`);
}

/**
 * Siembra un `User` con `id` y `phoneNumber` únicos y devuelve ese id, listo
 * para usarlo como `userId` de ClientProfile/OperatorProfile o `senderId` de
 * Message.
 *
 * Cambio-003 convirtió `ClientProfile.userId`, `OperatorProfile.userId` y
 * `Message.senderId` en FKs reales a `User.id` (`onDelete: Cascade`), así que
 * todo db test del dominio debe sembrar el User padre antes de crear perfiles
 * o mensajes.
 */
export async function seedUser(
  id: string,
  phoneNumber = `+57300${id.slice(-6).padStart(6, '0')}`,
): Promise<string> {
  await prisma.user.create({ data: { id, phoneNumber } });
  return id;
}
