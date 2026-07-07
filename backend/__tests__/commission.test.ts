import { describe, it, expect } from 'vitest';
import { calculateCommission } from '../src/services/commission';

/**
 * T3 — calculateCommission pura (REQ-003)
 *
 * Cobertura: 10% sobre 5000 → 500/4500; 0% → 0/5000; 100% → 5000/0;
 * round: amount*rate/100 where rate is integer 0..100.
 */
describe('calculateCommission (REQ-003)', () => {
  it('calculates 10% commission on 5000 → 500/4500', () => {
    const result = calculateCommission(5000, 10);
    expect(result.commission).toBe(500);
    expect(result.operatorAmount).toBe(4500);
  });

  it('calculates 0% commission on 5000 → 0/5000', () => {
    const result = calculateCommission(5000, 0);
    expect(result.commission).toBe(0);
    expect(result.operatorAmount).toBe(5000);
  });

  it('calculates 100% commission on 5000 → 5000/0', () => {
    const result = calculateCommission(5000, 100);
    expect(result.commission).toBe(5000);
    expect(result.operatorAmount).toBe(0);
  });

  it('rounds fractional commission correctly', () => {
    // 33% of 100 = 33 → commission=33, operatorAmount=67
    const result = calculateCommission(100, 33);
    expect(result.commission).toBe(33);
    expect(result.operatorAmount).toBe(67);
  });

  it('rounds .5 up correctly', () => {
    // 25% of 10 = 2.5 → round(2.5) = 3 (Math.round rounds .5 up)
    const result = calculateCommission(10, 25);
    expect(result.commission).toBe(3);
    expect(result.operatorAmount).toBe(7);
  });
});
