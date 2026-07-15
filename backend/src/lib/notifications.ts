/**
 * Notification stub (REQ-007 / design §D6).
 *
 * `notifyClient(service, event)` logs a structured event to console.
 * Log-only for MVP — no FCM installed. Interface stable for future
 * push notification integration without changing the worker.
 *
 * Usage:
 *   notifyClient(service, 'expired');
 *   // → console.log({ event: 'expired', serviceId: '...', userId: '...' })
 */

interface ServiceInfo {
  id: string;
  clientProfileId: string;
}

/**
 * Log a notification event for a service.
 *
 * @param service  - Service object (must have `id` and `clientProfileId`)
 * @param event    - Event name (e.g. 'expired', 'status_change')
 */
export function notifyClient(service: ServiceInfo, event: string): void {
  console.log({
    event,
    serviceId: service.id,
    userId: service.clientProfileId,
  });
}
