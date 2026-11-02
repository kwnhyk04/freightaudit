import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { demoDeadLetters, demoDiscrepancies, demoInvoiceFile } from '../lib/demo.ts';
import evalResults from '../lib/eval-results.json';
import { ENGINEERING, MASKED_LOG, RATE_CHECK, REPOSITORY, sourceLink } from '../lib/engineering.ts';
import { decideWords, decisionLabel, findingText, findingTitle, modelName, overcharge, plural, QUEUE, resultBadge, STEPS as PROGRESS, trailRows } from '../lib/labels.ts';
import { START_PAGE } from '../lib/session.ts';
import type { Theme } from '../lib/theme.ts';
import { LandingMenu, ThemeSwitch } from './client.tsx';
import { Icon, type IconName } from './icons.tsx';
import { LogoMark } from './logo.tsx';
import { Badge, Difference, StatusBadge, Table, Td, Th } from './ui.tsx';

// The public landing page, from files this server holds (the two official eval runs' results, the engineering evidence
// scripts/evidence.ts copies, and the sample): it calls no api and holds no key. Every claim on it has a source in the
// repository.
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });

// The runs' results as evals/harness/landing.ts writes them: a run, or its cell in a row, is null until it is measured.
type Cell = { result: string; met: boolean } | null;
type Run = { date: string; report: string } | null;
const results: { cases: number; claudeFirst: Run; free: Run; rows: { label: string; target: string; claudeFirst: Cell; free: Cell }[]; notes: string[] } = evalResults;
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
      <Marquee />
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
          Until November 10, 2026, the live demo reads with Claude Sonnet first. <a href="#features">See one sample invoice take each step.</a>
        </p>
      </div>
    </section>
  );
}

// The sample's own audit trail as a waterfall, in seconds from receipt (public/demo/invoice-details.json, g066): its
// receipt, the read (Reading started to Read), the check (Checking started to Matched), and the finding it holds.
function waterfall() {
  const facts = sample();
  if (!facts) return null;
  const { invoice, findings, finding, line, over } = facts;
  const rows = trailRows(invoice, findings);
  const at = (verb: string) => rows.find((row) => row.verb === verb)?.at;
  const start = Date.parse(rows[0]?.at ?? invoice.createdAt);
  const seconds = (iso?: string) => (iso ? (Date.parse(iso) - start) / 1000 : 0);
  const spans = [
    { label: 'Received', from: 0, to: 0 },
    { label: 'Read', from: seconds(at('Reading started')), to: seconds(at('Read')), slow: true },
    { label: 'Matched', from: seconds(at('Checking started')), to: seconds(at('Matched')) },
    { label: 'Held', from: seconds(at('Matched')), to: seconds(at('Matched')), tag: { long: `${findingTitle(finding.type, line.description)}, +${over}`, short: `+${over}` } },
  ];
  const total = Math.max(1, Math.ceil(Math.max(...spans.map((span) => span.to))));
  // The sample predates Claude first: say so, so the model that read it does not contradict the note under How it works.
  const model = invoice.extraction?.model;
  const before = model && !model.startsWith('anthropic/') ? `Recorded before Claude first went live, so ${modelName(model)} read it.` : '';
  return { invoice, start, spans, total, before };
}

// One bento card: a piece of the app on top, its title and one line below. size is its width on the six-column grid.
function Feature({ id, size, title, line, children }: { id: string; size: 'sm' | 'md' | 'lg'; title: string; line: string; children: ReactNode }) {
  return (
    <li className={`bento-${size}`}>
      <article className="feature" aria-labelledby={id}>
        <div className="feature-visual">{children}</div>
        <div className="feature-text">
          <h3 id={id}>{title}</h3>
          <p className="muted">{line}</p>
        </div>
      </article>
    </li>
  );
}

// The Features cards are pieces of the app filled from the demo set (public/demo/*.json) and the eval results; their
// buttons are shown only, since the landing page decides nothing.
function Features() {
  const trail = waterfall();
  const pct = (part: number, whole: number) => `${(part / whole) * 100}%`;
  // One finding of each kind from the demo set (public/demo/discrepancies.json), none of them the hero's g066: a
  // duplicate (the Linehaul one: Tern & Tide Carriers #96079756, +$5,522.06), a rate mismatch and an uncontracted
  // charge. The first is the alert on top; the others wait behind it.
  const all = demoDiscrepancies().discrepancies.edges.map(({ node }) => node).filter((each) => each.invoice.number !== sample()?.invoice.number);
  const kinds = (['DUPLICATE_CHARGE', 'RATE_MISMATCH', 'UNCONTRACTED_CHARGE'] as const).flatMap((type) => {
    const ofType = all.filter((each) => each.type === type && each.lineItem);
    const found = ofType.find((each) => each.lineItem?.description === 'Linehaul') ?? ofType[0];
    return found ? [found] : [];
  });
  // Cost per invoice at paid rates, digital and scanned, for both official runs, from lib/eval-results.json
  // (evals/reports/2026-11-02-v2-full-claude-first.md and 2026-10-27-v2.md); Claude first's scanned cost leads.
  const costRow = results.rows.find((row) => row.label === 'Cost per invoice, paid-equivalent (digital / scanned)');
  const dollars = (text?: string) => Number(text?.replace(/[^0-9.]/g, ''));
  const runs = (
    [
      ['Claude first', costRow?.claudeFirst],
      ['Free models only', costRow?.free],
    ] as const
  ).flatMap(([name, cell]) => (cell ? [{ name, costs: cell.result.split(' / ') }] : []));
  const scanned = runs[0]?.name === 'Claude first' ? runs[0].costs[1] : undefined;
  const highest = Math.max(...runs.flatMap((run) => run.costs.map(dollars)));
  // The demo set's one dead letter (public/demo/dead-letters.json) on the upload page's progress steps, at the step its
  // queue runs.
  const dead = demoDeadLetters('OPEN').deadLetters.edges[0]?.node;
  const failedAt = dead ? PROGRESS.indexOf(dead.queue === 'extract' ? 'Reading' : 'Checking') : -1;
  const words = decideWords('RATE_MISMATCH');
  const top = kinds[0];
  return (
    <section id="features" className="landing-section" aria-labelledby="features-title">
      <div className="landing-wrap">
        <div className="bento-head">
          <h2 id="features-title">Features, as the app shows them</h2>
          <div>
            <p className="intro">Each card is a piece of the app, filled from the demo set&apos;s synthetic invoices.</p>
            {trail && (
              <Link className="button" href={`/demo/invoices/${trail.invoice.id}`}>
                Open the sample invoice
                <Icon name="next" size={16} />
              </Link>
            )}
          </div>
        </div>
        <ul className="bento">
          {trail && (
            <Feature
              id="feature-trail"
              size="lg"
              title="Every step on the record"
              line={`Sample invoice ${trail.invoice.number}, ${day.format(new Date(trail.start))}, in seconds from receipt. ${trail.before}`}
            >
              <div className="waterfall">
                <div className="waterfall-axis" aria-hidden="true">
                  {Array.from({ length: trail.total + 1 }, (_, tick) => (
                    <span key={tick} style={{ left: pct(tick, trail.total) }}>
                      {tick} s
                    </span>
                  ))}
                </div>
                <ol aria-label="Audit trail of the sample invoice" style={{ '--ticks': trail.total } as CSSProperties}>
                  {trail.spans.map((span) => (
                    <li key={span.label} data-slow={span.slow || undefined}>
                      <span className="waterfall-label">{span.label}</span>
                      <span className="waterfall-track">
                        <span className="waterfall-bar" style={{ left: pct(span.from, trail.total), width: pct(span.to - span.from, trail.total) }} />
                        {span.slow && (
                          <span className="waterfall-tag inside num" style={{ right: pct(trail.total - span.to, trail.total) }}>
                            {(span.to - span.from).toFixed(1)} s
                          </span>
                        )}
                        {span.tag && (
                          <span className="waterfall-tag before" style={{ right: pct(trail.total - span.from, trail.total) }}>
                            <span className="long">{span.tag.long}</span>
                            <span className="short">{span.tag.short}</span>
                          </span>
                        )}
                        <span className="visually-hidden">
                          , at {span.from.toFixed(1)} s{span.to > span.from ? ` to ${span.to.toFixed(1)} s` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </Feature>
          )}
          {dead && (
            <Feature id="feature-replay" size="sm" title="Failed jobs wait to be replayed" line="A job that uses up its retries waits with its error, ready to replay once the cause is fixed.">
              <div className="scrubber">
                <div className="scrubber-head">
                  <span className="replay-pill" aria-hidden="true">
                    <span className="play" />
                    Replay
                  </span>
                  <span className="muted num">
                    Invoice {dead.invoice?.number}, {plural(dead.attempts, 'attempt')}
                  </span>
                </div>
                <div className="scrubber-track">
                  <span className="track-line" aria-hidden="true" />
                  <span className="track-line done" style={{ width: pct(failedAt, PROGRESS.length - 1) }} aria-hidden="true" />
                  {PROGRESS.map((step, index) => (
                    <span key={step} className="track-dot" data-done={index <= failedAt || undefined} style={{ left: pct(index, PROGRESS.length - 1) }} aria-hidden="true" />
                  ))}
                  <span className="playhead" style={{ left: pct(failedAt, PROGRESS.length - 1) }}>
                    <span className="playhead-label">{QUEUE[dead.queue] ?? dead.queue} failed</span>
                  </span>
                </div>
                <ol className="scrubber-steps" aria-label="Pipeline steps">
                  {PROGRESS.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="scrubber-error">{dead.error}</p>
              </div>
            </Feature>
          )}
          {top && (
            <Feature id="feature-alert" size="sm" title="Findings that name the amount" line="Each finding names its line and what it costs, before anyone pays.">
              <div className="alert-stack">
                {kinds.map((finding, depth) =>
                  depth === 0 ? (
                    <article key={finding.id} className="alert" aria-label="Finding" style={{ '--depth': depth } as CSSProperties}>
                      <span>
                        <strong>{findingTitle(finding.type, finding.lineItem!.description)}</strong>
                        <span className="muted">
                          {finding.invoice.carrier} #{finding.invoice.number}, {decisionLabel(finding.status, finding.type).label.toLowerCase()}
                        </span>
                      </span>
                      <Difference cents={overcharge(finding)} currency={finding.invoice.currency} />
                    </article>
                  ) : (
                    <div key={finding.id} className="alert" aria-hidden="true" style={{ '--depth': depth } as CSSProperties}>
                      <span>
                        <strong>{findingTitle(finding.type, finding.lineItem!.description)}</strong>
                        <span className="muted">
                          {finding.invoice.carrier} #{finding.invoice.number}
                        </span>
                      </span>
                      <Difference cents={overcharge(finding)} currency={finding.invoice.currency} />
                    </div>
                  ),
                )}
              </div>
            </Feature>
          )}
          {scanned && costRow && (
            <Feature
              id="feature-cost"
              size="sm"
              title="Reading costs a fraction of a cent"
              line={`Per invoice at paid rates on ${results.cases} test invoices; the targets are ${costRow.target.replace(/^[^$]*/, '')}.`}
            >
              <div className="cost">
                <p className="cost-figure num">{scanned}</p>
                <p className="muted">per scanned invoice, Claude first, {measured(results.claudeFirst)}</p>
                <div className="cost-chart">
                  {runs.map((run) => (
                    <figure key={run.name}>
                      <ul aria-label={`${run.name}, cost per invoice`}>
                        {run.costs.map((cost, index) => (
                          <li key={index} data-highlight={(run.name === 'Claude first' && index === 1) || undefined}>
                            <span className="num">{cost}</span>
                            <span className="cost-bar" style={{ '--h': dollars(cost) / highest } as CSSProperties} aria-hidden="true" />
                            <span>{index === 0 ? 'Digital' : 'Scanned'}</span>
                          </li>
                        ))}
                      </ul>
                      <figcaption>{run.name}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            </Feature>
          )}
          <Feature id="feature-code" size="sm" title="Rules in code, not in the model" line="The model only reads the invoice; plain code checks each charge against the rate card.">
            <div className="code-window">
              <a className="code-head" href={`${sourceLink(RATE_CHECK.path)}#L${RATE_CHECK.first}-L${RATE_CHECK.first + RATE_CHECK.lines.length - 1}`}>
                {RATE_CHECK.path}
              </a>
              {/* A long line wraps inside the window, under its own text, so nothing is cut off or needs scrolling. */}
              <pre>
                <code>
                  {RATE_CHECK.lines.map((code, index) => (
                    <span key={index} className="code-line" data-mark={code.includes('amountCents > finding.expectedCents') || undefined}>
                      <span className="code-number" aria-hidden="true">
                        {RATE_CHECK.first + index}
                      </span>
                      {code.slice(4)}
                    </span>
                  ))}
                </code>
              </pre>
            </div>
          </Feature>
          <Feature id="feature-decide" size="md" title="A person decides each finding" line="Each decision goes into the audit trail with its note, and an invoice is approved only once every finding is decided.">
            {/* The review queue's two decisions, drawn as keys; the landing page decides nothing. */}
            <ul className="keys" aria-label="The two decisions on a finding">
              <li>
                <span>Let the billed amount stand</span>
                <span className="keycap">{words.dismiss}</span>
              </li>
              <li>
                <span>Dispute the overcharge</span>
                <span className="keycap danger">{words.confirm}</span>
              </li>
            </ul>
          </Feature>
          <Feature
            id="feature-private"
            size="md"
            title="Keys stay out of the logs"
            line="The demo holds only generated invoices from fictional carriers, and every service redacts keys and cookies from what it logs."
          >
            <div className="log-panel">
              <div className="log-head">
                <span>A redacted request header</span>
                <Badge tone="neutral">Synthetic data only</Badge>
              </div>
              <pre>
                {'{ "headers": { '}
                {MASKED_LOG.masked.map((each, index) => (
                  <span key={each.field}>
                    {index > 0 && ', '}&quot;{each.field}&quot;: <span className="masked">{MASKED_LOG.censor}</span>
                  </span>
                ))}
                {' } }'}
              </pre>
            </div>
          </Feature>
        </ul>
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
          {results.cases} synthetic invoices with known ground truth, read two ways. Claude first is Claude Sonnet 5.5 reading first, with the free models behind it (
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
        {/* Written from the same two reports (evals/harness/landing.ts): whether a miss is within the margin of error, and
            where each run is ahead. */}
        {results.notes.map((note) => (
          <p key={note} className="landing-note">
            {note}
          </p>
        ))}
        <p className="landing-note">
          Complete results with 95% confidence intervals are in the eval reports:{' '}
          {results.claudeFirst && <a href={`${REPOSITORY}/blob/main/${results.claudeFirst.report}`}>Claude first</a>}
          {results.claudeFirst && results.free && ' and '}
          {results.free && <a href={`${REPOSITORY}/blob/main/${results.free.report}`}>free models only</a>}.
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

// The name scrolling large and faint across the middle of the hero, behind everything in it: the page's one moving band. The loop is two identical
// halves slid by half their width, so each half repeats the name enough to stay wider than the widest screen.
const MARQUEE = 'FreightAudit · '.repeat(4);
const Marquee = () => (
  <div className="marquee" aria-hidden="true">
    <div className="marquee-track">
      <span>{MARQUEE}</span>
      <span>{MARQUEE}</span>
    </div>
  </div>
);

// The close: one line and the demo, on a plain tinted band.
function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-title">
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
