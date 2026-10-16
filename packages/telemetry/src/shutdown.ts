// The SDK registers its shutdown here when it starts (sdk.ts); without an SDK, shutting down does nothing.
let shutdown = async () => {};

export const onShutdown = (fn: () => Promise<void>) => {
  shutdown = fn;
};

// Flushes pending spans and metrics; apps call it on SIGTERM while their Redis connection is still open, since the
// final metric export reads the queue gauges.
export const shutdownTelemetry = () => shutdown();
