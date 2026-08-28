/**
 * Serialize process-owned teardown work. A failed earlier cleanup must not
 * prevent the next cleanup from running; callers can still attach their own
 * logging/exit handling to the returned promise.
 */
export function enqueueTeardown(previous: Promise<void>, task: () => Promise<void>): Promise<void> {
  return previous.catch(() => undefined).then(task);
}
