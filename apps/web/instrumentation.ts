// Runs once when a server starts (never during next build). The work is Node-only, so it lives in lib/server.ts and is
// loaded only on the Node runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') (await import('./lib/server.ts')).startup();
}
