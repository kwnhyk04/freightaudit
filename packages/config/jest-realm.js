// Jest injects the host realm's structuredClone; rebuild plain data in the test realm, as in production.
const hostClone = globalThis.structuredClone;

function toTestRealm(value, seen) {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(toTestRealm(item, seen));
    return copy;
  }
  if (Object.prototype.toString.call(value) !== '[object Object]') return value;
  const copy = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(copy, key, { value: toTestRealm(item, seen), enumerable: true, writable: true, configurable: true });
  }
  return copy;
}

globalThis.structuredClone = (value, options) => toTestRealm(hostClone(value, options), new Map());
