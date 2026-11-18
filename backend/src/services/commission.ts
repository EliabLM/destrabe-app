/**
 * Cálculo de la comisión de la plataforma (cambio-006 / DCC-08).
 *
 * Importes en pesos COP enteros. `rate` es un porcentaje entero (0..100):
 *   commission     = round(amount * rate / 100)   (0,5 se redondea hacia arriba)
 *   operatorAmount = amount - commission
 *
 * Es el único sitio donde se calcula la comisión. Se usa al crear el Payment
 * (aceptación de la cotización); después los importes guardados no se
 * recalculan, aunque cambie `PAYMENT_COMMISSION_RATE`.
 */
export function calculateCommission(
  amount: number,
  rate: number,
): { commission: number; operatorAmount: number } {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError('amount must be a non-negative integer (COP)');
  }
  if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
    throw new RangeError('rate must be an integer between 0 and 100');
  }
  const commission = Math.round((amount * rate) / 100);
  const operatorAmount = amount - commission;
  return { commission, operatorAmount };
}
