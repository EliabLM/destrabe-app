/**
 * Cálculo puro de comisión (cambio-006 / REQ-003).
 *
 * `rate` es porcentaje entero (0..100). Fórmula:
 *   commission = round(amount * rate / 100)
 *   operatorAmount = amount - commission
 */
export function calculateCommission(
  amount: number,
  rate: number,
): { commission: number; operatorAmount: number } {
  const commission = Math.round((amount * rate) / 100);
  const operatorAmount = amount - commission;
  return { commission, operatorAmount };
}
