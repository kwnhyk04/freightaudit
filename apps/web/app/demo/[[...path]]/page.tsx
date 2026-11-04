import { notFound, redirect } from 'next/navigation';
import { InvoiceDetail } from '../../../components/detail.tsx';
import { Overview } from '../../../components/overview.tsx';
import { DeadLetterList, DiscrepancyList, InvoiceList } from '../../../components/views.tsx';
import { DEMO_OVERVIEW_NOTE, demoDashboard, demoDeadLetters, demoDiscrepancies, demoInvoice, demoInvoices, demoSummary } from '../../../lib/demo.ts';
import { firstParams, listFilter } from '../../../lib/labels.ts';
import { rangeOf } from '../../../lib/overview.ts';
import { pageParams } from '../../../lib/paging.ts';

// Every sample page: the same views as the live ones, from the snapshot files only, with no actions. /demo itself opens
// the invoices, since the sample fills one week of the overview's eight.
export default async function DemoPage({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ path = [] }, query] = await Promise.all([params, firstParams(searchParams)]);
  const { status: raw, q, range } = query;
  const { page, size, offset } = pageParams(query);
  const paging = { page, size, sized: query.size !== undefined };
  const [section, id] = path;
  const head = (title: string) => (
    <div className="page-head">
      <h1>{title}</h1>
    </div>
  );
  if (!section) redirect('/demo/invoices');
  if (section === 'dashboard' && !id) {
    const chosen = rangeOf(range);
    // The five newest, as the live overview asks the api for them.
    const latest = demoInvoices({}, undefined, { offset: 0, size: 5 }).invoices;
    return <Overview data={{ dashboard: demoDashboard(chosen), invoices: latest }} range={chosen} base="/demo" note={DEMO_OVERVIEW_NOTE} />;
  }
  if (section === 'invoices' && !id) {
    const filter = listFilter(raw);
    const search = q?.trim().slice(0, 100) || undefined;
    return <InvoiceList data={demoInvoices(filter, search, { offset, size })} summary={demoSummary()} filter={filter} search={search} paging={paging} base="/demo" readOnly />;
  }
  if (section === 'invoices' && id) {
    const data = demoInvoice(id);
    if (!data?.invoice) notFound();
    return <InvoiceDetail data={data} base="/demo" readOnly documentSrc={`/demo/${id}.pdf`} />;
  }
  if (section === 'discrepancies') {
    const status = (['OPEN', 'CONFIRMED', 'DISMISSED'] as const).find((value) => value.toLowerCase() === raw) ?? 'OPEN';
    return (
      <>
        {head('Review queue')}
        <DiscrepancyList data={demoDiscrepancies(status, { offset, size })} status={status} paging={paging} base="/demo" readOnly />
      </>
    );
  }
  if (section === 'dead-letters') {
    const replayed = raw === 'replayed';
    return (
      <>
        {head('Dead letters')}
        <DeadLetterList data={demoDeadLetters(replayed ? 'REPLAYED' : 'OPEN', { offset, size })} replayed={replayed} paging={paging} base="/demo" readOnly />
      </>
    );
  }
  notFound();
}
