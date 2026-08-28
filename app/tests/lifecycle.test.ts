import { describe, expect, it } from 'vitest';
import { enqueueTeardown } from '../src/main/lifecycle';

describe('application teardown queue', () => {
  it('waits for an earlier cleanup before running the next one', async () => {
    const events: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const second = enqueueTeardown(first, async () => { events.push('second'); });
    expect(events).toEqual([]);
    release();
    await second;
    expect(events).toEqual(['second']);
  });

  it('continues after a failed earlier cleanup', async () => {
    const events: string[] = [];
    const second = enqueueTeardown(Promise.reject(new Error('first cleanup failed')), async () => { events.push('second'); });
    await second;
    expect(events).toEqual(['second']);
  });

  it('allows the caller to observe the second cleanup failure', async () => {
    const failure = new Error('second cleanup failed');
    const second = enqueueTeardown(Promise.resolve(), async () => { throw failure; });
    await expect(second).rejects.toBe(failure);
  });
});
