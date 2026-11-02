import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import { demoDeadLetters, demoDiscrepancies, demoInvoiceFile } from '../lib/demo.ts';
import evalResults from '../lib/eval-results.json';
import { ENGINEERING, REPOSITORY, sourceLink } from '../lib/engineering.ts';
import { decideWords, decisionLabel, findingText, findingTitle, modelName, overcharge, plural, QUEUE, resultBadge, trailRows } from '../lib/labels.ts';
import { START_PAGE } from '../lib/session.ts';
import type { Theme } from '../lib/theme.ts';
import { LandingMenu, ThemeSwitch } from './client.tsx';
import { Icon, type IconName } from './icons.tsx';
import { LogoMark } from './logo.tsx';
import { Badge, Difference, StatusBadge, Table, Td, Th } from './ui.tsx';

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
// the run where a phone stacks the row and hides the column headers; in a card table, label names it on the phone card.
function Result({ cell, run, label }: { cell: Cell; run: string; label?: string }) {
  const card = label ? ('wide' as const) : undefined;
  if (!cell)
    return (
      <Td className="faint" data-run={run} card={card} label={label}>
        Not measured yet
      </Td>
    );
  const badge = resultBadge(cell.met);
  return (
    <Td data-run={run} card={card} label={label}>
      <span className="row">
        <strong className="num">{figure(cell.result)}</strong>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </span>
    </Td>
  );
}

function RunHead({ name, run }: { name: string; run: Run }) {
  return (
    <Th>
      {name}
      <span className="run-date">{run ? dateOf(run.date) : 'Not measured yet'}</span>
    </Th>
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

// The hero's one figure: overcharge recall from lib/eval-results.json (written by evals/harness/landing.ts), Claude
// first's run when it is measured, else the free models'.
function recall() {
  const row = results.rows.find((each) => each.label === 'Overcharge recall');
  const [name, cell, run] = row?.claudeFirst ? ['Claude first', row.claudeFirst, results.claudeFirst] : ['free models only', row?.free, results.free];
  return cell && run ? { result: cell.result, note: `${name}, ${measured(run)}` } : null;
}

function Hero() {
  const facts = sample();
  if (!facts) return null;
  // Every figure in the card is g066's, from public/demo/invoice-details.json through sample().
  const { invoice, finding, line, billed, expected, over } = facts;
  const shipment = invoice.shipment;
  const decision = decisionLabel(finding.status, finding.type);
  const words = decideWords(finding.type);
  const stat = recall();
  const strip = ['Overcharge recall', 'Overcharge precision', 'Cost per invoice, paid-equivalent (digital / scanned)'];
  return (
    <section className="hero" aria-labelledby="headline">
      <div className="landing-wrap">
        <div className="hero-copy">
          <p className="hero-pill">
            <span className="live-dot" data-seenry-dot aria-hidden="true" />
            Live demo
          </p>
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
          {stat && (
            <p className="hero-stat">
              <strong className="num">{stat.result}</strong> overcharge recall on {results.cases} synthetic test invoices
              <span className="hero-stat-note">{stat.note}</span>
            </p>
          )}
        </div>
        <figure className="invoice-figure" data-seenry-signature data-seenry-hero-visual>
          <div className="invoice-stack">
            <div className="invoice-card">
              <div className="invoice-card-head">
                <div>
                  <p className="invoice-card-title">
                    Sample invoice <span className="num">{invoice.number}</span>
                  </p>
                  <p className="muted">{invoice.carrier}</p>
                </div>
                <StatusBadge status={invoice.status} open={invoice.openDiscrepancyCount} />
              </div>
              <dl className="recon">
                <div>
                  <dt>{line.description} billed</dt>
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
              <div className="findings">
                <article aria-label="Finding">
                  <div className="finding-body">
                    <div className="row">
                      <h3>{findingTitle(finding.type, line.description)}</h3>
                      <Badge tone={decision.tone}>{decision.label}</Badge>
                    </div>
                    <p className="muted">{findingText(finding, line, invoice.rateCardVersion?.version, invoice.currency)}</p>
                  </div>
                  <Difference cents={overcharge(finding)} currency={invoice.currency} />
                  {/* The app's own two decision buttons, shown only: the landing page decides nothing. */}
                  <div className="row decide-preview" aria-hidden="true">
                    <span className="button small">{words.dismiss}</span>
                    <span className="button small danger">{words.confirm}</span>
                  </div>
                </article>
              </div>
            </div>
          </div>
          <figcaption>
            Sample invoice from the demo set: Linehaul on {invoice.carrier} #{invoice.number}
            {shipment ? `, ${shipment.origin} to ${shipment.destination}` : ''}. The carrier and places are synthetic.{' '}
            <Link href={`/demo/invoices/${invoice.id}`}>Open it in the sample</Link>
          </figcaption>
        </figure>
        <Table look="ledger" wrapClassName="hero-proof" label={`Evaluation on ${results.cases} synthetic test invoices`}>
            <thead>
              <tr>
                <Th>On {results.cases} synthetic test invoices</Th>
                <RunHead name="Claude first" run={results.claudeFirst} />
                <RunHead name="Free models only" run={results.free} />
              </tr>
            </thead>
            <tbody>
              {results.rows
                .filter((row) => strip.includes(row.label))
                .map((row) => (
                  <tr key={row.label}>
                    <Td>{row.label}</Td>
                    <Result cell={row.claudeFirst} run="Claude first" />
                    <Result cell={row.free} run="Free models only" />
                  </tr>
                ))}
            </tbody>
          </Table>
      </div>
    </section>
  );
}

// The three steps every invoice takes, in the words the audit-trail section used before landing round 2, so nothing it
// said is lost; the sample's own times are the Features timeline.
const STEPS: { icon: IconName; title: string; line: string; points: string[] }[] = [
  {
    icon: 'upload',
    title: 'Upload',
    line: 'The invoice arrives, and the model reads it into structured lines.',
    points: [
      'A PDF, PNG or JPG, or a batch of up to 500.',
      'Each file is stored by its content, so a duplicate is never processed twice.',
      'A text model reads digital PDFs; a vision model reads scans. A bad reading gets one repair, then a backup model.',
    ],
  },
  {
    icon: 'invoices',
    title: 'Check',
    line: 'Each line is matched to its shipment and checked against the rate card.',
    points: ["Rules in code compare every line with the shipment's rate card.", 'They flag rate mismatches, charges not on the contract, and duplicates.'],
  },
  {
    icon: 'queue',
    title: 'Decide',
    line: 'A reviewer approves or disputes each finding.',
    points: ['Invoices that match wait as Ready to approve; findings wait for a reviewer.', 'Nothing is approved without one.', 'A job that fails its retries goes to dead letters, to be replayed.'],
  },
];

function HowItWorks() {
  return (
    <section id="how" className="landing-section plain" aria-labelledby="how-title">
      <div className="landing-wrap">
        <h2 id="how-title">How it works: one invoice, start to finish</h2>
        <p className="intro">Three steps, each one recorded in the audit trail the reviewer sees.</p>
        <ol className="how-steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="step-number num" aria-hidden="true">
                {index + 1}
              </span>
              <span className="step-icon">
                <Icon name={step.icon} />
              </span>
              <h3>{step.title}</h3>
              <p className="step-line">{step.line}</p>
              <ul>
                {step.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {/* The demo's Claude-first window ends on LLM_CLAUDE_FIRST_UNTIL (2026-11-10), as the section said before. */}
        <p className="landing-note muted">
          Until November 10, 2026, the live demo reads with Claude Haiku first. <a href="#features">See one sample invoice take each step.</a>
        </p>
      </div>
    </section>
  );
}

// The sample's own audit trail, as its invoice page tells it: received, read, then matched and checked, then the finding it holds.
const STAGE = new Set(['Received', 'Read', 'Matched']);
function timeline() {
  const facts = sample();
  if (!facts) return null;
  const { invoice, findings, finding, line } = facts;
  const rows = trailRows(invoice, findings).filter((row) => STAGE.has(row.verb));
  const start = Date.parse(rows[0]?.at ?? invoice.createdAt);
  // The sample predates Claude first: say so where it was read, so the model named there does not contradict the note above.
  const model = invoice.extraction?.model;
  const before = model && !model.startsWith('anthropic/') ? `Recorded before Claude first went live, so ${modelName(model)} read it.` : null;
  const steps = [
    ...rows.map((row) => ({ at: row.at, what: `${row.verb} ${row.rest}`, notes: row.verb === 'Read' && before ? [...row.notes, before] : row.notes })),
    {
      at: rows.at(-1)?.at ?? invoice.createdAt,
      what: `Held: ${findingTitle(finding.type, line.description)}`,
      notes: [findingText(finding, line, invoice.rateCardVersion?.version, invoice.currency)],
    },
  ];
  return { invoice, start, steps, elapsed: (at: string) => `+${((Date.parse(at) - start) / 1000).toFixed(1)} s` };
}

// The Features cards are pieces of the app filled from the demo set (public/demo/*.json) and the eval results; their
// buttons are shown only, since the landing page decides nothing.
function Features() {
  const trail = timeline();
  // One finding of each kind from the demo set (public/demo/discrepancies.json), none of them the hero's g066: a
  // duplicate (the Linehaul one when there is one), a rate mismatch and an uncontracted charge, each in its own state.
  const all = demoDiscrepancies().discrepancies.edges.map(({ node }) => node).filter((each) => each.invoice.number !== sample()?.invoice.number);
  const kinds = (['DUPLICATE_CHARGE', 'RATE_MISMATCH', 'UNCONTRACTED_CHARGE'] as const).flatMap((type) => {
    const ofType = all.filter((each) => each.type === type && each.lineItem);
    const found = ofType.find((each) => each.lineItem?.description === 'Linehaul') ?? ofType[0];
    return found ? [found] : [];
  });
  // Cost per invoice, Claude first at paid rates, against its target, from lib/eval-results.json
  // (evals/reports/2026-10-31-v2-full-claude-first.md); each bar's track is its target.
  const costRow = results.rows.find((row) => row.label === 'Cost per invoice, paid-equivalent (digital / scanned)');
  const [digital, scanned] = costRow?.claudeFirst?.result.split(' / ') ?? [];
  const targets = costRow?.target.replace(/^[^$]*/, '').split(' / ') ?? [];
  const dollars = (text?: string) => Number(text?.replace(/[^0-9.]/g, ''));
  const bars = [
    { name: 'Digital', cost: digital, target: targets[0] },
    { name: 'Scanned', cost: scanned, target: targets[1] },
  ].filter((bar) => dollars(bar.cost) > 0 && dollars(bar.target) > 0);
  // The demo set's one dead letter (public/demo/dead-letters.json).
  const dead = demoDeadLetters('OPEN').deadLetters.edges[0]?.node;
  const words = decideWords('RATE_MISMATCH');
  // A decision the demo set holds, as its invoice's trail records it: the first decided finding above (g054's disputed fuel).
  const decided = kinds.find((each) => each.resolvedAt);
  const decidedInvoice = decided && demoInvoiceFile(decided.invoice.filename);
  const record =
    decided && decidedInvoice
      ? trailRows(decidedInvoice, decidedInvoice.discrepancies.edges.map(({ node }) => node)).find((row) => row.at === decided.resolvedAt)
      : undefined;
  return (
    <section id="features" className="landing-section" aria-labelledby="features-title">
      <div className="landing-wrap">
        <h2 id="features-title">Features, as the app shows them</h2>
        <p className="intro">Each card is a piece of the app, filled from the demo set&apos;s synthetic invoices.</p>
        <div className="bento">
          {trail && (
            <article className="feature f-trail" aria-labelledby="feature-trail">
              <h3 id="feature-trail">Every step on the record</h3>
              <p className="muted">
                Sample invoice {trail.invoice.number}&apos;s audit trail, {day.format(new Date(trail.start))}. Times are UTC.
              </p>
              <ol className="timeline feature-shot" aria-label="Audit trail of the sample invoice">
                {trail.steps.map((step) => (
                  <li key={step.what}>
                    <span className="timeline-time num">
                      {clock.format(new Date(step.at))}
                      <span>{trail.elapsed(step.at)}</span>
                    </span>
                    <span className="timeline-body">
                      <strong>{step.what}</strong>
                      {step.notes.map((note) => (
                        <span key={note} className="muted">
                          {note}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          )}
          <article className="feature f-decide" aria-labelledby="feature-decide">
            <h3 id="feature-decide">A person decides each finding</h3>
            <p className="muted">Approve the charge or dispute it, with a note the audit trail keeps.</p>
            {/* The review queue's own decision row, shown only. */}
            <div className="feature-shot row decide decide-preview" aria-hidden="true">
              <input placeholder="Note (optional)" disabled tabIndex={-1} />
              <span className="button">{words.dismiss}</span>
              <span className="button danger">{words.confirm}</span>
            </div>
            {decided && record && (
              <div className="feature-shot decided">
                <p className="muted">
                  In the trail of invoice <span className="num">{decided.invoice.number}</span>, {clock.format(new Date(record.at))} UTC
                </p>
                <p>
                  <strong>
                    {record.verb} {record.rest}
                  </strong>
                </p>
                {record.notes.map((note) => (
                  <p key={note} className="muted">
                    {note}
                  </p>
                ))}
              </div>
            )}
          </article>
          {kinds.length > 0 && (
            <article className="feature f-find" aria-labelledby="feature-alert">
              <h3 id="feature-alert">Findings that name the amount</h3>
              <p className="muted">Each finding names its line and what it costs, before anyone pays.</p>
              <div className="feature-shot findings">
                {kinds.map((finding) => {
                  const decision = decisionLabel(finding.status, finding.type);
                  return (
                    <article key={finding.id} aria-label="Finding">
                      <div className="finding-body">
                        <div className="row">
                          <h4>{findingTitle(finding.type, finding.lineItem!.description)}</h4>
                          <Badge tone={decision.tone}>{decision.label}</Badge>
                        </div>
                        <p className="muted">
                          {findingText(finding, finding.lineItem, undefined, finding.invoice.currency)} {finding.invoice.carrier} #{finding.invoice.number}.
                        </p>
                      </div>
                      <Difference cents={overcharge(finding)} currency={finding.invoice.currency} />
                    </article>
                  );
                })}
              </div>
            </article>
          )}
          {bars.length > 0 && (
            <article className="feature f-cost" aria-labelledby="feature-cost">
              <h3 id="feature-cost">Reading costs a fraction of a cent</h3>
              <p className="muted">
                Claude first at paid rates on {results.cases} test invoices, {measured(results.claudeFirst)}. Each bar is the cost per invoice against its target.
              </p>
              <dl className="feature-shot cost-bars">
                {bars.map((bar) => (
                  <div key={bar.name}>
                    <dt>{bar.name}</dt>
                    <dd>
                      <span className="cost-track" title={`${bar.name}: ${bar.cost} per invoice; target ${bar.target}`}>
                        <span className="cost-fill" style={{ width: `${Math.max((dollars(bar.cost) / dollars(bar.target)) * 100, 1)}%` }} />
                      </span>
                      <span className="cost-value">
                        <strong className="num">{bar.cost}</strong> <span className="muted">of a {bar.target} target</span>
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          )}
          {dead && (
            <article className="feature f-replay" aria-labelledby="feature-replay">
              <h3 id="feature-replay">Failed jobs wait to be replayed</h3>
              <p className="muted">A job that uses up its retries lands in dead letters with its error, ready to replay once the cause is fixed.</p>
              <div className="feature-shot dead-letter">
                <p>
                  <strong>{QUEUE[dead.queue] ?? dead.queue}</strong>, invoice <span className="num">{dead.invoice?.number}</span>
                </p>
                <p className="dead-letter-error">{dead.error}</p>
                <p className="muted">{plural(dead.attempts, 'attempt')}</p>
                <span className="decide-preview" aria-hidden="true">
                  <span className="button small">Replay</span>
                </span>
              </div>
            </article>
          )}
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
        {/* The app's list table, as on Invoices; on a phone each metric is a card with its target and both runs, each named and dated. */}
        <Table cards cols={['34%', '9rem', '', '']} label="Results by metric">
          <thead>
            <tr>
              <Th>Metric</Th>
              <Th num>Target</Th>
              <RunHead name="Claude first" run={results.claudeFirst} />
              <RunHead name="Free models only" run={results.free} />
            </tr>
          </thead>
          <tbody>
            {results.rows.map((row) => (
              <tr key={row.label}>
                <Td card="title">{row.label}</Td>
                <Td num card="aside" label="Target" className="muted">
                  {figure(row.target)}
                </Td>
                <Result cell={row.claudeFirst} run="Claude first" label={`Claude first, ${results.claudeFirst ? dateOf(results.claudeFirst.date) : 'not measured yet'}`} />
                <Result cell={row.free} run="Free models only" label={`Free models only, ${results.free ? dateOf(results.free.date) : 'not measured yet'}`} />
              </tr>
            ))}
          </tbody>
        </Table>
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

// The close: one line and the demo, over the name set large and faint.
function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <p className="closing-word" aria-hidden="true">
        FreightAudit
      </p>
      <div className="landing-wrap">
        <h2 id="closing-title">Check the next invoice against the contract.</h2>
        <p className="lead">Open the live demo and decide a finding yourself.</p>
        <Link href={START_PAGE} className="button primary large">
          Open the demo
        </Link>
      </div>
    </section>
  );
}

const SECTIONS = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#results', label: 'Results' },
  { href: '#engineering', label: 'Engineering' },
  { href: REPOSITORY, label: 'GitHub' },
];

// The header: the mark and name, the section links, the theme switch, sign-in and the demo. On a phone the links, sign-in
// and the demo fold into the menu.
function Header({ theme }: { theme: Theme }) {
  const links = SECTIONS.map(({ href, label }) => (
    <a key={label} href={href}>
      {label}
    </a>
  ));
  return (
    <header className="landing-top">
      <div className="landing-wrap">
        <Link href="/" className="landing-name">
          <LogoMark />
          FreightAudit
        </Link>
        <nav className="landing-nav" aria-label="Sections">
          {links}
        </nav>
        <div className="landing-actions">
          <ThemeSwitch initial={theme} compact />
          <Link href="/login" className="landing-signin">
            Sign in
          </Link>
          <Link href={START_PAGE} className="button primary">
            Open the demo
          </Link>
          <LandingMenu>
            <nav aria-label="Sections">{links}</nav>
            <Link href="/login">Sign in</Link>
            <Link href={START_PAGE} className="button primary">
              Open the demo
            </Link>
          </LandingMenu>
        </div>
      </div>
    </header>
  );
}

export function Landing({ theme }: { theme: Theme }) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header theme={theme} />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Features />
        <Results />
        <Engineering />
        <Closing />
      </main>
    </>
  );
}
