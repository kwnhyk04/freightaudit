import Fastify from 'fastify';

// Health endpoint for the worker process; queue processors are not built yet.
const app = Fastify({ logger: true });
app.get('/healthz', async () => ({ status: 'ok' }));
await app.listen({ port: Number(process.env.PORT ?? 4001), host: process.env.HOST ?? 'localhost' });
