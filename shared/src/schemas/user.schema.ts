import { z } from 'zod';
import { UserRole } from '../types/user';

export const userRoleSchema = z.nativeEnum(UserRole);
