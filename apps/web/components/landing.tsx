import { holdOf } from '@freightaudit/contracts/hold';
import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import { demoInvoiceFile } from '../lib/demo.ts';
import evalResults from '../lib/eval-results.json';
import { findingText, findingTitle, invoiceAmounts, overcharge, plural, resultBadge } from '../lib/labels.ts';
import { START_PAGE } from '../lib/session.ts';
import { Badge, Difference, StatusBadge } from './ui.tsx';

// The public landing page, from files this server holds (the two official eval runs' results and the sample): it calls no
// api and holds no key. Every claim on it has a source in the repository (docs/memory.md, UI round 2).
const REPOSITORY = 'https://github.com/kwnhyk04/freightaudit';
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });

// The runs' results as evals/harness/landing.ts writes them: a run, or its cell in a row, is null until it is measured.
type Cell = { result: string; met: boolean } | null;
type Run = { date: string } | null;
const results: { cases: number; claudeFirst: Run; free: Run; rows: { label: string; target: string; claudeFirst: Cell; free: Cell }[] } = evalResults;
const measured = (run: Run) => (run ? `measured ${day.format(new Date(`${run.date}T00:00:00Z`))}` : 'not measured yet');
// A figure keeps each measure whole, so a pair such as "2.4 s / 10.7 s" wraps only after its slash.
const figure = (text: string) => text.replaceAll(' ', ' ').replaceAll('/ ', '/ ');

// One run's result with its badge, which goes under it in a narrow column; a run not measured yet says so.
function Result({ cell }: { cell: Cell }) {
  if (!cell) return <td className="faint">Not measured yet</td>;
  const badge = resultBadge(cell.met);
  return (
    <td>
      <span className="row">
        <strong>{figure(cell.result)}</strong>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </span>
    </td>
  );
}

const STEPS = [
  ['Upload', 'A PDF, PNG or JPG, or a batch of up to 500. Each file is stored by its content, so a duplicate never gets processed twice.'],
  ['Read', 'A text model reads digital PDFs; a vision model reads scans. A bad reading gets one repair, then a backup model. Until November 10, 2026, the live demo reads with Claude Haiku first.'],
  ['Check', "Rules in code compare every line with the shipment's rate card: rate mismatches, charges not on the contract, duplicates."],
  ['Decide', 'Invoices that match the rate card wait as Ready to approve; findings wait for a reviewer. Nothing is approved without a reviewer, and every step lands in the audit trail.'],
];
const ENGINEERING = [
  ['Reliable job processing', 'Jobs retry with backoff, and persistent failures move to a replayable dead-letter queue. No jobs were lost under a 3x load test.'],
  ['Contract-first APIs', 'OpenAPI and GraphQL schemas are defined before implementation, with generated clients, and breaking-change detection for the REST API on every pull request.'],
  ['Continuous evaluation', `Pull requests that change extraction are evaluated on 20 reference invoices against quality floors; a weekly run covers all ${results.cases}.`],
  ['End-to-end tracing', 'OpenTelemetry traces each upload across the API, the queue and every model call, with dashboards and alerting in Grafana.'],
  ['Exact monetary arithmetic', 'Amounts are stored as integer cents and computed in pure functions, with property-based tests of 1,000 cases each.'],
  ['Secure by default', 'The browser never calls the API directly, every commit is scanned for secrets, and only synthetic data reaches model providers.'],
];
const STACK = ['TypeScript', 'Fastify', 'GraphQL Yoga', 'BullMQ', 'Redis', 'PostgreSQL', 'Drizzle', 'MinIO', 'Next.js', 'Playwright', 'OpenTelemetry', 'Grafana', 'k6', 'Gemini', 'Groq', 'Claude'];

// A sample invoice with an open finding, drawn as the invoice page draws it, and a link to it in the sample.
function SampleInvoice() {
  const invoice = demoInvoiceFile('g066.pdf');
  if (!invoice) return null;
  const findings = invoice.discrepancies.edges.map(({ node }) => node);
  const open = findings.filter((finding) => finding.status === 'OPEN');
  const { openCents } = invoiceAmounts(invoice.totalCents ?? 0, findings);
  return (
    <aside className="sample-card" aria-label="A sample invoice">
      <div className="sample-head">
        <p className="row">
          <span className="id">{invoice.number}</span>
          <span className="muted">{invoice.carrier}</span>
          <StatusBadge status={invoice.status} open={invoice.openDiscrepancyCount} hold={holdOf(invoice.status, findings)} matched={invoice.shipment !== null} />
        </p>
        <p className="muted">
          {plural(open.length, 'open finding')} · billed <strong className="text-bad">{formatMoney(openCents, invoice.currency)} over the rate card</strong>
        </p>
      </div>
      <ul className="sample-findings">
        {open.map((finding) => {
          const line = finding.lineItem && invoice.lineItems.find((each) => each.lineNumber === finding.lineItem!.lineNumber);
          return (
            <li key={finding.id}>
              <Difference cents={overcharge(finding)} currency={invoice.currency} />
              <div>
                <p className="sample-title">{findingTitle(finding.type, line?.description)}</p>
                <p className="faint">{findingText(finding, line, invoice.rateCardVersion?.version, invoice.currency)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="sample-foot">
        <Link href={`/demo/invoices/${invoice.id}`}>Open it in the sample</Link>
      </p>
    </aside>
  );
}

export function Landing() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="landing-top">
        <div className="landing-wrap">
          <Link href="/" className="landing-name">
            FreightAudit
          </Link>
          <nav className="landing-nav" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#results">Results</a>
            <a href="#engineering">Engineering</a>
            <a href={REPOSITORY}>GitHub</a>
          </nav>
          <Link href={START_PAGE} className="button primary">
            Open the demo
          </Link>
        </div>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="headline">
          <div className="landing-wrap">
            <div>
              <p className="eyebrow">Freight invoice audit</p>
              <h1 id="headline">Catch freight overbilling before you pay it.</h1>
              <p className="lead">
                FreightAudit reads carrier invoices, digital or scanned, matches each one to its shipment and checks every charge against the contract rate card. AI only reads the invoice;
                code decides what&apos;s wrong, and a person approves.
              </p>
              <div className="actions">
                <Link href={START_PAGE} className="button primary large">
                  Try the live demo
                </Link>
                <Link href="/demo/invoices" className="button large">
                  See sample invoices, no sign-in
                </Link>
              </div>
              <p className="faint">The demo runs on synthetic invoices only. When the live backend is offline, the site shows recorded sample data.</p>
            </div>
            <SampleInvoice />
          </div>
        </section>
        <section id="how" className="landing-section plain" aria-labelledby="how-title">
          <div className="landing-wrap">
            <h2 id="how-title">How it works</h2>
            <ol className="steps-grid">
              {STEPS.map(([title, text], i) => (
                <li key={title}>
                  <span className="step-number">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section id="results" className="landing-section" aria-labelledby="results-title">
          <div className="landing-wrap">
            <h2 id="results-title">Evaluation results</h2>
            <p className="intro">
              Evaluated on {results.cases} synthetic invoices with known ground truth, read two ways. Claude first is Claude Haiku 5.5 reading first, with the free models behind it (
              {measured(results.claudeFirst)}). The free models alone are what CI checks on every change to extraction, and what reads once Claude&apos;s credits end (
              {measured(results.free)}). On the free models, a 20-invoice subset runs on pull requests that change extraction, and the full set runs weekly.
            </p>
            <div className="table-wrap" role="region" aria-label="Evaluation results" tabIndex={0}>
              <table className="results">
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col" className="num">
                      Target
                    </th>
                    <th scope="col">Claude first</th>
                    <th scope="col">Free models only</th>
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="num muted">{figure(row.target)}</td>
                      <Result cell={row.claudeFirst} />
                      <Result cell={row.free} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint landing-note">
              Complete results with 95% confidence intervals are published in the <a href={`${REPOSITORY}#eval-results`}>repository README</a>.
            </p>
          </div>
        </section>
        <section id="engineering" className="landing-section plain" aria-labelledby="engineering-title">
          <div className="landing-wrap">
            <h2 id="engineering-title">Engineering</h2>
            <div className="engineering">
              {ENGINEERING.map(([title, text]) => (
                <div key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <ul className="chips" aria-label="Built with">
              {STACK.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
