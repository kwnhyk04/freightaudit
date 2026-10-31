import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import { demoInvoiceFile } from '../lib/demo.ts';
import evalResults from '../lib/eval-results.json';
import { ENGINEERING, REPOSITORY, sourceLink } from '../lib/engineering.ts';
import { findingText, findingTitle, modelName, overcharge, resultBadge, trailRows } from '../lib/labels.ts';
import { START_PAGE } from '../lib/session.ts';
import { Badge } from './ui.tsx';

// The public landing page, from files this server holds (the two official eval runs' results, the engineering evidence
// scripts/evidence.ts copies, and the sample): it calls no api and holds no key. Every claim on it has a source in the
// repository (docs/memory.md, UI round 2).
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });
const clock = new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', timeZone: 'UTC' });

// The runs' results as evals/harness/landing.ts writes them: a run, or its cell in a row, is null until it is measured.
type Cell = { result: string; met: boolean } | null;
type Run = { date: string } | null;
const results: { cases: number; claudeFirst: Run; free: Run; rows: { label: string; target: string; claudeFirst: Cell; free: Cell }[] } = evalResults;
const dateOf = (date: string) => day.format(new Date(`${date}T00:00:00Z`));
const measured = (run: Run) => (run ? `measured ${dateOf(run.date)}` : 'not measured yet');
// A figure keeps each measure whole, so a pair such as "2.4 s / 10.7 s" wraps only after its slash.
const figure = (text: string) => text.replaceAll(' ', ' ').replaceAll('/ ', '/ ');

// One run's result with its badge, which goes under it in a narrow column; a run not measured yet says so. data-run names
// the run where a phone stacks the row and hides the column headers.
function Result({ cell, run }: { cell: Cell; run: string }) {
  if (!cell)
    return (
      <td className="faint" data-run={run}>
        Not measured yet
      </td>
    );
  const badge = resultBadge(cell.met);
  return (
    <td data-run={run}>
      <span className="row">
        <strong className="num">{figure(cell.result)}</strong>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </span>
    </td>
  );
}

function RunHead({ name, run }: { name: string; run: Run }) {
  return (
    <th scope="col">
      {name}
      <span className="run-date">{run ? dateOf(run.date) : 'Not measured yet'}</span>
    </th>
  );
}

// The sample invoice g066 and its one open finding: the hero's figures and the walk through the pipeline.
function sample() {
  const invoice = demoInvoiceFile('g066.pdf');
  const findings = invoice?.discrepancies.edges.map(({ node }) => node) ?? [];
  const finding = findings.find((each) => each.status === 'OPEN');
  const line = finding?.lineItem && invoice?.lineItems.find((each) => each.lineNumber === finding.lineItem!.lineNumber);
  if (!invoice || !finding || !line || finding.expectedCents == null) return null;
  const money = (cents: number | bigint) => formatMoney(cents, invoice.currency);
  return { invoice, findings, finding, line, billed: money(line.amountCents), expected: money(finding.expectedCents), over: money(overcharge(finding)) };
}

function Hero() {
  const facts = sample();
  if (!facts) return null;
  const { invoice, billed, expected, over } = facts;
  const shipment = invoice.shipment;
  const strip = ['Overcharge recall', 'Overcharge precision', 'Cost per invoice, paid-equivalent (digital / scanned)'];
  return (
    <section className="hero" aria-labelledby="headline">
      <div className="landing-wrap">
        <div className="hero-copy">
          <h1 id="headline">Pay the contract rate, not the invoice.</h1>
          <p className="lead">Every carrier charge checked against your rate card. AI reads the invoice; code does the math; a person approves.</p>
          <div className="actions">
            <Link href={START_PAGE} className="button primary large">
              Try the live demo
            </Link>
            <Link href="/demo/invoices" className="button large">
              See sample invoices, no sign-in
            </Link>
          </div>
        </div>
        <figure className="recon-figure" data-seenry-signature data-seenry-hero-visual>
          <dl className="recon">
            <div>
              <dt>Billed</dt>
              <dd className="num">{billed}</dd>
            </div>
            <div>
              <dt>Contract, rate card v{invoice.rateCardVersion?.version}</dt>
              <dd className="num">{expected}</dd>
            </div>
            <div className="recon-held">
              <dt>Held for review</dt>
              <dd className="num">{over}</dd>
            </div>
          </dl>
          <figcaption>
            Sample invoice from the demo set: Linehaul on {invoice.carrier} #{invoice.number}
            {shipment ? `, ${shipment.origin} to ${shipment.destination}` : ''}. The carrier and places are synthetic.{' '}
            <Link href={`/demo/invoices/${invoice.id}`}>Open it in the sample</Link>
          </figcaption>
        </figure>
        <div className="table-wrap hero-proof" role="region" aria-label={`Evaluation on ${results.cases} synthetic test invoices`} tabIndex={0}>
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">On {results.cases} synthetic test invoices</th>
                <RunHead name="Claude first" run={results.claudeFirst} />
                <RunHead name="Free models only" run={results.free} />
              </tr>
            </thead>
            <tbody>
              {results.rows
                .filter((row) => strip.includes(row.label))
                .map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <Result cell={row.claudeFirst} run="Claude first" />
                    <Result cell={row.free} run="Free models only" />
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// What each stage does for every invoice, under what it did for the sample.
const RULE: Record<string, string> = {
  Upload: 'A PDF, PNG or JPG, or a batch of up to 500. Each file is stored by its content, so a duplicate is never processed twice.',
  Read: 'A text model reads digital PDFs; a vision model reads scans. A bad reading gets one repair, then a backup model. Until November 10, 2026, the live demo reads with Claude Haiku first.',
  Check: "Rules in code compare every line with the shipment's rate card: rate mismatches, charges not on the contract, duplicates.",
  Held: 'Invoices that match wait as Ready to approve; findings wait for a reviewer. Nothing is approved without one.',
};
const STAGE: Record<string, string> = { Received: 'Upload', Read: 'Read', Matched: 'Check' };

// The sample's own audit trail, as its invoice page tells it, one row per stage, then the finding it holds.
function Trail() {
  const facts = sample();
  if (!facts) return null;
  const { invoice, findings, finding, line, over } = facts;
  const rows = trailRows(invoice, findings).filter((row) => STAGE[row.verb]);
  const start = Date.parse(rows[0]?.at ?? invoice.createdAt);
  const elapsed = (at: string) => `+${((Date.parse(at) - start) / 1000).toFixed(1)} s`;
  const checked = rows.at(-1)?.at ?? invoice.createdAt;
  // The sample predates Claude first: say so where it was read, so the model named there does not contradict the rule.
  const model = invoice.extraction?.model;
  const before =
    model && !model.startsWith('anthropic/')
      ? `This sample was recorded on ${day.format(new Date(start))}, before Claude first went live, so ${modelName(model)} read it.`
      : null;
  const stages = [
    ...rows.map((row) => ({
      stage: STAGE[row.verb]!,
      at: row.at,
      what: `${row.verb} ${row.rest}`,
      notes: row.verb === 'Read' && before ? [...row.notes, before] : row.notes,
      amount: '',
    })),
    {
      stage: 'Held',
      at: checked,
      what: `${findingTitle(finding.type, line.description)}, open for a reviewer`,
      notes: [findingText(finding, line, invoice.rateCardVersion?.version, invoice.currency)],
      amount: over,
    },
  ];
  return (
    <section id="how" className="landing-section plain" aria-labelledby="how-title">
      <div className="landing-wrap">
        <h2 id="how-title">How it works: one invoice, start to finish</h2>
        <p className="intro">
          The audit trail of sample invoice {invoice.number}, recorded {day.format(new Date(start))}. Times are UTC; every step is in the trail the reviewer sees.
        </p>
        <div className="table-wrap" role="region" aria-label="Audit trail of the sample invoice" tabIndex={0}>
          <table className="ledger audit-ledger">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Stage</th>
                <th scope="col">What happened</th>
                <th scope="col" className="num">
                  Held
                </th>
              </tr>
            </thead>
            <tbody>
              {stages.map((each) => (
                <tr key={each.stage}>
                  <td className="num trail-time">
                    {clock.format(new Date(each.at))}
                    <span className="faint">{elapsed(each.at)}</span>
                  </td>
                  <th scope="row">{each.stage}</th>
                  <td>
                    <p className="trail-what">{each.what}</p>
                    {each.notes.map((note) => (
                      <p key={note} className="trail-note">
                        {note}
                      </p>
                    ))}
                    <p className="trail-rule">{RULE[each.stage]}</p>
                  </td>
                  <td className="num trail-amount">{each.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Results() {
  return (
    <section id="results" className="landing-section" aria-labelledby="results-title">
      <div className="landing-wrap">
        <h2 id="results-title">Evaluation results</h2>
        <p className="intro">
          {results.cases} synthetic invoices with known ground truth, read two ways. Claude first is Claude Haiku 5.5 reading first, with the free models behind it (
          {measured(results.claudeFirst)}). The free models alone are what CI checks on every change to extraction, and what reads once Claude&apos;s credits end (
          {measured(results.free)}).
        </p>
        <div className="table-wrap" role="region" aria-label="Results by metric" tabIndex={0}>
          <table className="ledger results">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" className="num">
                  Target
                </th>
                <RunHead name="Claude first" run={results.claudeFirst} />
                <RunHead name="Free models only" run={results.free} />
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="num muted" data-run="Target">
                    {figure(row.target)}
                  </td>
                  <Result cell={row.claudeFirst} run="Claude first" />
                  <Result cell={row.free} run="Free models only" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="landing-note">
          Complete results with 95% confidence intervals are published in the <a href={`${REPOSITORY}#eval-results`}>repository README</a>.
        </p>
      </div>
    </section>
  );
}

const STACK = ['TypeScript', 'Fastify', 'GraphQL Yoga', 'BullMQ', 'Redis', 'PostgreSQL', 'Drizzle', 'MinIO', 'Next.js', 'Playwright', 'OpenTelemetry', 'Grafana', 'k6', 'Gemini', 'Groq', 'Claude'];

function Engineering() {
  return (
    <section id="engineering" className="landing-section plain" aria-labelledby="engineering-title">
      <div className="landing-wrap">
        <h2 id="engineering-title">Engineering, with its evidence</h2>
        <p className="intro">Each claim links to the file that proves it.</p>
        <dl className="evidence">
          {ENGINEERING.map(({ claim, proof, paths }) => (
            <div key={claim}>
              <dt>{claim}</dt>
              <dd>
                <p>{proof}</p>
                <p className="evidence-links">
                  {paths.map((path) => (
                    <a key={path} href={sourceLink(path)}>
                      <code>{path.replace(/\/$/, '')}</code>
                    </a>
                  ))}
                </p>
              </dd>
            </div>
          ))}
        </dl>
        <p className="stack-line">Built with {STACK.join(', ')}.</p>
      </div>
    </section>
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
        <Hero />
        <Trail />
        <Results />
        <Engineering />
      </main>
    </>
  );
}
