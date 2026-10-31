import evidence from './evidence.json';

// The landing page's engineering claims, each with its proof from lib/evidence.json and the repository files that hold
// it. A path ending in / is a folder. engineering.test.ts checks every path exists.
export const REPOSITORY = 'https://github.com/kwnhyk04/freightaudit';
export const sourceLink = (path: string) => `${REPOSITORY}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${path.replace(/\/$/, '')}`;

const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });
const count = new Intl.NumberFormat('en-US');
const { load, evals, propertyTests } = evidence;

export const ENGINEERING: { claim: string; proof: string; paths: string[] }[] = [
  {
    claim: 'Exact money',
    proof: `Integer cents in pure functions, with no I/O. ${propertyTests.files} property-based test suites run ${count.format(propertyTests.runs)} cases each on a fixed seed.`,
    paths: ['packages/domain/src/'],
  },
  {
    claim: 'No lost jobs',
    proof: `k6 sent ${count.format(load.offeredPerHour)} uploads an hour, ${load.offeredPerHour / load.normalPerHour}x the design rate: ${count.format(load.accepted)} accepted, ${load.lost} lost, upload p95 ${load.uploadP95Ms} ms (${day.format(new Date(`${load.date}T00:00:00Z`))}). Failed jobs retry, then wait in a replayable dead-letter queue.`,
    paths: ['loadtest/k6.js', 'loadtest/system-results.json'],
  },
  {
    claim: 'Contract-first APIs',
    proof: 'OpenAPI and GraphQL schemas come before the code, with generated clients. Every pull request is checked for breaking REST changes against its base.',
    paths: ['packages/contracts/openapi.yaml', '.github/workflows/ci.yml'],
  },
  {
    claim: 'Continuous evaluation',
    proof: `${evals.ci} of the ${evals.cases} golden invoices run on every pull request that changes extraction, against quality floors; all ${evals.cases} run weekly.`,
    paths: ['evals/golden/v2/manifest.json', '.github/workflows/nightly-eval.yml'],
  },
  {
    claim: 'End-to-end tracing',
    proof: 'OpenTelemetry follows each upload across the API, the queue and every model call, into a Grafana dashboard with alert rules.',
    paths: ['infra/grafana/freightaudit.json', 'infra/prometheus-alerts.yml'],
  },
  {
    claim: 'Secrets stay out',
    proof: 'gitleaks scans every commit, in CI and in the pre-commit hook. The browser never calls the API, and only synthetic data reaches model providers.',
    paths: ['.githooks/pre-commit', '.github/workflows/ci.yml'],
  },
];
