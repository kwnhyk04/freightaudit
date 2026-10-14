import process from 'node:process';

// Which containers a test run may remove. Three projects share this Docker host, so only containers labelled as
// FreightAudit test containers qualify, and of those only the ones whose run has died; every other container stays.
export const OWNER = 'freightaudit.test-run';

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// The label must hold a pid; a missing or malformed one keeps the container.
export const staleTestContainers = (containers, alive = isAlive) =>
  containers.filter((container) => {
    const owner = container.Labels?.[OWNER];
    return /^[1-9][0-9]*$/.test(owner ?? '') && !alive(Number(owner));
  });
