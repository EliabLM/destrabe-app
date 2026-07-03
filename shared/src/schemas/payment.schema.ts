import { z } from 'zod';
import { PaymentStatus } from '../types/payment';

export const paymentStatusSchema = z.nativeEnum(PaymentStatus);
