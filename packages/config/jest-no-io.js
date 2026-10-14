/* global afterAll -- Jest's, as setupFilesAfterEnv. */
import childProcess from 'node:child_process';
import net from 'node:net';

// Unit tests do no I/O: opening a socket, starting a server or spawning a process fails the test. Patched before the
// test file loads, so module-level code is covered too.
const guarded = [
  [net.Socket.prototype, 'connect'],
  [net.Server.prototype, 'listen'],
  [childProcess.ChildProcess.prototype, 'spawn'],
];
const originals = guarded.map(([target, method]) => target[method]);
const refuse = () => {
  throw new Error('unit tests do no I/O; a test that needs sockets or processes belongs in *.int.test.ts');
};
for (const [target, method] of guarded) target[method] = refuse;

// Restored after each file, so a worker that later runs an integration file gets real sockets.
afterAll(() => guarded.forEach(([target, method], i) => (target[method] = originals[i])));
