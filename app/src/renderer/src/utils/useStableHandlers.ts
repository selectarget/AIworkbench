import { useMemo, useRef } from 'react';

type Handlers = Record<string, (...args: never[]) => unknown>;

/**
 * Returns functions with a stable identity that always call the latest
 * handler passed in. Memoized panels receive these instead of inline
 * closures, so they re-render only when their data props change. The set of
 * keys must stay the same between renders.
 */
export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers);
  latest.current = handlers;
  return useMemo(() => {
    const stable: Record<string, (...args: unknown[]) => unknown> = {};
    for (const key of Object.keys(handlers)) {
      stable[key] = (...args: unknown[]) =>
        (latest.current[key] as unknown as (...values: unknown[]) => unknown)(...args);
    }
    return stable as unknown as T;
  }, []);
}
