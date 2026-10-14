/* global expect, test -- Jest's. */
import { OWNER, staleTestContainers } from './jest-orphans.js';

// Containers as Docker lists them on this host: the other projects', this project's dev infra, and test runs.
const listed = [
  { Id: 'filinglens-postgres', Labels: { 'com.docker.compose.project': 'filinglens', 'com.docker.compose.service': 'postgres' } },
  { Id: 'triagecopilot-toxiproxy', Labels: { 'com.docker.compose.project': 'triagecopilot', 'com.docker.compose.service': 'toxiproxy' } },
  { Id: 'freightaudit-postgres', Labels: { 'com.docker.compose.project': 'freightaudit', 'com.docker.compose.service': 'postgres' } },
  { Id: 'other-testcontainers', Labels: { 'org.testcontainers': 'true', 'org.testcontainers.session-id': 'b7f1c2' } },
  { Id: 'lookalike', Labels: { 'freightaudit.test-run.pid': '4242', 'com.example.freightaudit.test-run': '4242' } },
  { Id: 'unlabelled', Labels: {} },
  { Id: 'no-labels', Labels: null },
  { Id: 'malformed', Labels: { [OWNER]: 'pid-4242' } },
  { Id: 'live-run', Labels: { [OWNER]: '1234' } },
  { Id: 'dead-run', Labels: { [OWNER]: '4242' } },
];

test('a run removes only FreightAudit test containers whose run died', () => {
  expect(staleTestContainers(listed, (pid) => pid === 1234).map((container) => container.Id)).toEqual(['dead-run']);
});

test('a container without the FreightAudit label is never removed, even if every process were dead', () => {
  const foreign = listed.filter((container) => !container.Labels?.[OWNER]);
  expect(foreign.map((container) => container.Id)).toContain('filinglens-postgres');
  expect(staleTestContainers(foreign, () => false)).toEqual([]);
});
