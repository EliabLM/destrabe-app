import { useEffect, useRef, useCallback } from 'react';
import { useIsFocused } from '@react-navigation/native';

/**
 * Poll a fetcher function at a given interval.
 *
 * - Cleans up the interval on unmount
 * - Pauses when the screen loses focus (useIsFocused)
 * - Concurrency-safe: only one fetch in flight at a time
 *
 * @param fetcher  Async function to call on each tick
 * @param intervalMs  Interval in milliseconds
 * @param enabled  Optional flag to enable/disable polling (default: true)
 */
export function usePolling(
  fetcher: () => Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const isFocused = useIsFocused();
  const busyRef = useRef(false);
  const savedFetcher = useRef(fetcher);

  // Keep the fetcher ref current to avoid stale closures
  useEffect(() => {
    savedFetcher.current = fetcher;
  }, [fetcher]);

  const tick = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await savedFetcher.current();
    } catch {
      // errors are the caller's responsibility
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !isFocused) return;

    // Fire immediately on mount/focus
    tick();

    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [enabled, isFocused, intervalMs, tick]);
}
