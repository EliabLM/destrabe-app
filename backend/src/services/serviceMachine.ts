import { ServiceStatus } from '@destrabe/shared';

// ─── Actor type ──────────────────────────────────────────────────────────────

/**
 * Actors that can perform transitions: user roles or `system` (internal worker).
 * Defined as string union (not depending on Prisma enum) for ergonomic use
 * in transition tables and tests.
 */
export type Actor = 'CLIENT' | 'OPERATOR' | 'ADMIN' | 'system';

// ─── ConflictError ───────────────────────────────────────────────────────────

/**
 * Error thrown by `assertTransition` when a status transition is illegal.
 * Matches the error shape expected by `errorHandler` (`status`, `code`).
 */
export class ConflictError extends Error {
  status = 409;
  code = 'INVALID_TRANSITION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// ─── Transition table ────────────────────────────────────────────────────────

/**
 * Static transition table (FSM).
 * Key = from → to → Actor[], meaning those actors CAN perform the transition.
 * Any (from, to, actor) NOT in this table is illegal.
 *
 * Per REQ-001 / design §D1:
 *   PENDING → QUOTED        : system
 *   PENDING → CANCELLED     : CLIENT, system
 *   QUOTED  → ACTIVE        : CLIENT
 *   QUOTED  → CANCELLED     : CLIENT
 *   ACTIVE  → COMPLETED     : OPERATOR
 *   ACTIVE  → CANCELLED     : (not permitted — absent from table)
 *
 * Quoted/Active transitions are covered here (unit); they may be unreachable
 * at runtime until quotes are implemented (cambio-005).
 */
const TRANSITIONS: Record<
  ServiceStatus,
  Partial<Record<ServiceStatus, Actor[]>>
> = {
  [ServiceStatus.PENDING]: {
    [ServiceStatus.QUOTED]: ['system'],
    [ServiceStatus.CANCELLED]: ['CLIENT', 'system'],
  },
  [ServiceStatus.QUOTED]: {
    [ServiceStatus.ACTIVE]: ['CLIENT'],
    [ServiceStatus.CANCELLED]: ['CLIENT'],
  },
  [ServiceStatus.ACTIVE]: {
    [ServiceStatus.COMPLETED]: ['OPERATOR'],
  },
  [ServiceStatus.COMPLETED]: {},
  [ServiceStatus.CANCELLED]: {},
};

// ─── Pure functions ──────────────────────────────────────────────────────────

/**
 * Returns `true` if `actor` is allowed to transition `from → to`.
 * Pure function, no IO, no side effects.
 */
export function canTransition(
  from: ServiceStatus,
  to: ServiceStatus,
  actor: Actor,
): boolean {
  const allowedActors = TRANSITIONS[from]?.[to];
  if (!allowedActors) return false;
  return allowedActors.includes(actor);
}

/**
 * Asserts that `actor` can transition `from → to`.
 * Throws `ConflictError` (status=409, code='INVALID_TRANSITION') if not allowed.
 */
export function assertTransition(
  from: ServiceStatus,
  to: ServiceStatus,
  actor: Actor,
): void {
  if (!canTransition(from, to, actor)) {
    throw new ConflictError(
      `Cannot transition from ${from} to ${to} as ${actor}`,
    );
  }
}
