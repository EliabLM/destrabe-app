import { z } from 'zod';
import { ServiceStatus } from '../types/service';

export const serviceStatusSchema = z.nativeEnum(ServiceStatus);
