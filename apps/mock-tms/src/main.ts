import Fastify from 'fastify';

const app = Fastify({ logger: true });
app.get('/healthz', async () => ({ status: 'ok' }));
await app.listen({ port: Number(process.env.PORT ?? 4010), host: process.env.HOST ?? 'localhost' });
