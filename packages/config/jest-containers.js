import process from 'node:process';
import { GenericContainer, getContainerRuntimeClient, Wait } from 'testcontainers';
import { OWNER, staleTestContainers } from './jest-orphans.js';

// globalSetup of the integration and contract projects: Postgres, Redis, MinIO and Toxiproxy for one run, from the
// images infra/docker-compose.yml pins. Tests read the URLs below from the env and isolate themselves (throwaway
// databases, random Redis prefixes, their own buckets), so they never touch dev data.

// Ryuk, the Testcontainers reaper, publishes its port on every interface, and any client can make it remove containers
// by label. This project binds to 127.0.0.1 only, so each run instead removes what runs that died left behind.
process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';

// Testcontainers publishes ports on every interface; these bind to 127.0.0.1 and carry the pid of the run.
class LocalContainer extends GenericContainer {
  withLocalPorts(...ports) {
    this.withExposedPorts(...ports);
    for (const port of ports) this.hostConfig.PortBindings[`${port}/tcp`] = [{ HostIp: '127.0.0.1', HostPort: '0' }];
    return this.withLabels({ [OWNER]: String(process.pid) });
  }
}

// Docker lists only containers carrying the FreightAudit label, stopped ones too; staleTestContainers checks the label
// again and keeps those of live runs. Containers of other projects never reach the remove call.
async function removeOrphans() {
  const client = await getContainerRuntimeClient();
  const labelled = await client.container.dockerode.listContainers({ all: true, filters: { label: [OWNER] } });
  await Promise.all(staleTestContainers(labelled).map((info) => client.container.getById(info.Id).remove({ force: true, v: true })));
}

export default async function startContainers() {
  await removeOrphans();
  const [postgres, redis, minio, toxiproxy] = await Promise.all([
    new LocalContainer('postgres:18.6-alpine')
      .withLocalPorts(5432)
      .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
      // Throwaway data: no durability, in memory, and connections for every test worker's pools.
      .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'max_connections=300'])
      .withTmpFs({ '/var/lib/postgresql': 'rw' })
      // The server logs this once for the init scripts and once when it accepts TCP connections.
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start(),
    new LocalContainer('redis:8.10.2-alpine').withLocalPorts(6379).withWaitStrategy(Wait.forLogMessage('Ready to accept connections')).start(),
    new LocalContainer('pgsty/minio:RELEASE.2026-08-04T00-00-00Z')
      .withLocalPorts(9000)
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: 'test', MINIO_ROOT_PASSWORD: 'test-secret' })
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start(),
    // Chaos tests proxy a fake server on the host, which is host.docker.internal inside the container.
    new LocalContainer('ghcr.io/shopify/toxiproxy:2.12.0')
      .withLocalPorts(8474, 8666)
      .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
      .withWaitStrategy(Wait.forHttp('/version', 8474))
      .start(),
  ]);
  const local = (container, port) => `127.0.0.1:${container.getMappedPort(port)}`;
  Object.assign(process.env, {
    DATABASE_URL: `postgres://test:test@${local(postgres, 5432)}/test`,
    REDIS_URL: `redis://${local(redis, 6379)}`,
    S3_ENDPOINT: `http://${local(minio, 9000)}`,
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test-secret',
    TOXIPROXY_URL: `http://${local(toxiproxy, 8474)}`,
    // A proxy that listens on TOXIPROXY_LISTEN is reachable from the host at TOXIPROXY_LISTEN_URL.
    TOXIPROXY_LISTEN: '0.0.0.0:8666',
    TOXIPROXY_LISTEN_URL: `http://${local(toxiproxy, 8666)}`,
  });
  globalThis.testContainers = [postgres, redis, minio, toxiproxy];
}
