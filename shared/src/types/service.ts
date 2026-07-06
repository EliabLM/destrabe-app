export enum ServiceStatus {
  PENDING = 'PENDING',
  QUOTED = 'QUOTED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ServiceType {
  BREAKDOWN = 'BREAKDOWN',
  TRANSFER = 'TRANSFER',
}

// `z.infer` inferred types from Zod schemas (source of truth in schemas/)
export type { CreateServiceInput, NearbyServicesQuery, UpdateServiceStatusInput } from '../schemas/service.schema';
