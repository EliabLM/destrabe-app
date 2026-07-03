import { z } from 'zod';
import { ServiceStatus, ServiceType } from '../types/service';

export const serviceStatusSchema = z.nativeEnum(ServiceStatus);
export const serviceTypeSchema = z.nativeEnum(ServiceType);
