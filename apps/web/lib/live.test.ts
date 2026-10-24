import { createLiveCheck } from './live.ts';

// A live check on a hand-moved clock, whose /readyz gives the listed answers in turn and records each wait it was given.
function probed(...answers: boolean[]) {
  const clock = { now: 0 };
  const waits: number[] = [];
  const live = createLiveCheck(async (timeoutMs) => {
    waits.push(timeoutMs);
    return answers.shift() ?? false;
  }, () => clock.now);
  return { live, waits, clock };
}

test('the probe waits up to 8 s for /readyz, above the slowest public answer measured (5.7 s)', async () => {
  const { live, waits } = probed(true);
  expect(await live.check()).toBe(true);
  expect(waits).toEqual([8_000]);
});

test('a live answer is kept 30 s, then /readyz is asked again', async () => {
  const { live, waits, clock } = probed(true, false);
  expect(await live.check()).toBe(true);
  clock.now = 29_999;
  expect(await live.check()).toBe(true);
  expect(waits).toHaveLength(1);
  clock.now = 30_000;
  expect(await live.check()).toBe(false);
  expect(waits).toHaveLength(2);
});

test('a failed answer is kept 5 s, then /readyz is asked again', async () => {
  const { live, waits, clock } = probed(false, true);
  expect(await live.check()).toBe(false);
  clock.now = 4_999;
  expect(await live.check()).toBe(false);
  expect(waits).toHaveLength(1);
  clock.now = 5_000;
  expect(await live.check()).toBe(true);
  expect(waits).toHaveLength(2);
});

test('a failed api call marks the backend offline at once, inside a live answer\'s 30 s, and for 5 s', async () => {
  const { live, waits, clock } = probed(true, true);
  expect(await live.check()).toBe(true);
  clock.now = 1_000;
  live.markOffline();
  expect(await live.check()).toBe(false);
  clock.now = 5_999;
  expect(await live.check()).toBe(false);
  expect(waits).toHaveLength(1);
  clock.now = 6_000;
  expect(await live.check()).toBe(true);
  expect(waits).toHaveLength(2);
});

test('a probe still waiting when an api call fails does not undo the offline mark', async () => {
  const clock = { now: 0 };
  const waits: number[] = [];
  let answer: (live: boolean) => void = () => undefined;
  const live = createLiveCheck((timeoutMs) => {
    waits.push(timeoutMs);
    return waits.length === 1 ? new Promise<boolean>((resolve) => (answer = resolve)) : Promise.resolve(true);
  }, () => clock.now);
  const waiting = live.check();
  clock.now = 3_000;
  live.markOffline();
  clock.now = 6_000;
  answer(true);
  expect(await waiting).toBe(false);
  clock.now = 7_999;
  expect(await live.check()).toBe(false);
  expect(waits).toHaveLength(1);
});
