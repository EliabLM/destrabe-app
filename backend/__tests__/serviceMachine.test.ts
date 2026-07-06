import { describe, it, expect } from 'vitest';
import { ServiceStatus } from '@destrabe/shared';
import {
  canTransition,
  assertTransition,
  ConflictError,
} from '../src/services/serviceMachine';
import type { Actor } from '../src/services/serviceMachine';

/**
 * T3 — serviceMachine FSM pura (REQ-001)
 *
 * Table-driven tests covering ALL legal transitions (true),
 * illegal transitions (ConflictError status=409 code='INVALID_TRANSITION'),
 * and unauthorized actor (false / ConflictError).
 */

type TransitionCase = {
  from: ServiceStatus;
  to: ServiceStatus;
  actor: Actor;
  expected: boolean;
};

const ALL_STATUSES = Object.values(ServiceStatus);
const ALL_ACTORS: Actor[] = ['CLIENT', 'OPERATOR', 'ADMIN', 'system'];

// ─── Legal transitions (from REQ-001) ────────────────────────────────────────

const LEGAL: TransitionCase[] = [
  // PENDING → QUOTED: system
  { from: ServiceStatus.PENDING, to: ServiceStatus.QUOTED, actor: 'system', expected: true },
  // PENDING → CANCELLED: CLIENT, system
  { from: ServiceStatus.PENDING, to: ServiceStatus.CANCELLED, actor: 'CLIENT', expected: true },
  { from: ServiceStatus.PENDING, to: ServiceStatus.CANCELLED, actor: 'system', expected: true },
  // QUOTED → ACTIVE: CLIENT
  { from: ServiceStatus.QUOTED, to: ServiceStatus.ACTIVE, actor: 'CLIENT', expected: true },
  // QUOTED → CANCELLED: CLIENT
  { from: ServiceStatus.QUOTED, to: ServiceStatus.CANCELLED, actor: 'CLIENT', expected: true },
  // ACTIVE → COMPLETED: OPERATOR
  { from: ServiceStatus.ACTIVE, to: ServiceStatus.COMPLETED, actor: 'OPERATOR', expected: true },
];

// ─── AssertTransition should throw for any case where canTransition is false ──

describe('canTransition (REQ-001)', () => {
  describe('legal transitions return true', () => {
    it.each<TransitionCase>(LEGAL)(
      '$from → $to by $actor → $expected',
      ({ from, to, actor, expected }) => {
        expect(canTransition(from, to, actor)).toBe(expected);
      },
    );
  });

  describe('illegal transitions return false', () => {
    // Every (from, to) pair NOT in LEGAL should be false for every actor
    const legalSet = new Set(
      LEGAL.map((c) => `${c.from}→${c.to}→${c.actor}`),
    );

    it.each<{ from: ServiceStatus; to: ServiceStatus; actor: Actor }>(
      ALL_STATUSES.flatMap((from) =>
        ALL_STATUSES.flatMap((to) =>
          ALL_ACTORS
            .filter((actor) => !legalSet.has(`${from}→${to}→${actor}`))
            .map((actor) => ({ from, to, actor })),
        ),
      ),
    )('$from → $to by $actor → false', ({ from, to, actor }) => {
      expect(canTransition(from, to, actor)).toBe(false);
    });
  });
});

describe('assertTransition (REQ-001)', () => {
  describe('legal transitions do not throw', () => {
    it.each<TransitionCase>(LEGAL)(
      '$from → $to by $actor does not throw',
      ({ from, to, actor }) => {
        expect(() => assertTransition(from, to, actor)).not.toThrow();
      },
    );
  });

  describe('illegal transitions throw ConflictError', () => {
    // Terminal states: no outgoing transitions at all
    const TERMINAL: ServiceStatus[] = [
      ServiceStatus.COMPLETED,
      ServiceStatus.CANCELLED,
    ];

    // ACTIVE → CANCELLED is explicitly not permitted per REQ-001
    const EXPLICITLY_ILLEGAL: { from: ServiceStatus; to: ServiceStatus; actor: Actor }[] = [
      { from: ServiceStatus.ACTIVE, to: ServiceStatus.CANCELLED, actor: 'CLIENT' },
      { from: ServiceStatus.ACTIVE, to: ServiceStatus.CANCELLED, actor: 'system' },
    ];

    it.each([
      // Terminal → any
      ...TERMINAL.flatMap((from) =>
        ALL_STATUSES
          .filter((to) => to !== from)
          .flatMap((to) =>
            ALL_ACTORS.map((actor) => ({ from, to, actor })),
          ),
      ),
      // ACTIVE → CANCELLED (explicitly illegal)
      ...EXPLICITLY_ILLEGAL,
    ])(
      '$from → $to by $actor throws ConflictError',
      ({ from, to, actor }) => {
        expect(() => assertTransition(from, to, actor)).toThrow(ConflictError);
        try {
          assertTransition(from, to, actor);
        } catch (e) {
          const err = e as ConflictError;
          expect(err.status).toBe(409);
          expect(err.code).toBe('INVALID_TRANSITION');
        }
      },
    );
  });

  describe('unauthorized actor returns false / throws', () => {
    // PENDING → QUOTED is legal only by system
    it('PENDING → QUOTED by CLIENT throws ConflictError', () => {
      expect(() =>
        assertTransition(ServiceStatus.PENDING, ServiceStatus.QUOTED, 'CLIENT'),
      ).toThrow(ConflictError);
    });

    it('PENDING → QUOTED by OPERATOR throws ConflictError', () => {
      expect(() =>
        assertTransition(ServiceStatus.PENDING, ServiceStatus.QUOTED, 'OPERATOR'),
      ).toThrow(ConflictError);
    });

    // ACTIVE → COMPLETED is legal only by OPERATOR
    it('ACTIVE → COMPLETED by CLIENT throws ConflictError', () => {
      expect(() =>
        assertTransition(ServiceStatus.ACTIVE, ServiceStatus.COMPLETED, 'CLIENT'),
      ).toThrow(ConflictError);
    });
  });
});

describe('ConflictError class', () => {
  it('has status=409, code="INVALID_TRANSITION", and message', () => {
    const err = new ConflictError('Cannot transition from PENDING to COMPLETED');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.message).toContain('PENDING');
  });
});
