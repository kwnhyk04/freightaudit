import { notFound, redirect } from 'next/navigation';
import { InvoiceDetail } from '../../../components/detail.tsx';
import { DeadLetterList, DiscrepancyList, InvoiceList } from '../../../components/views.tsx';
import { demoDeadLetters, demoDiscrepancies, demoInvoice, demoInvoices, demoSummary } from '../../../lib/demo.ts';
import { statusParam } from '../../../lib/labels.ts';

// Every sample page: the same views as the live ones, from the snapshot files only, with no actions.
export default async function DemoPage({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<{ status?: string; q?: string }> }) {
  const [{ path = [] }, { status: raw, q }] = await Promise.all([params, searchParams]);
  const [section, id] = path;
  const head = (title: string) => (
    <div className="page-head">
      <h1>{title}</h1>
    </div>
  );
  if (!section) redirect('/demo/invoices');
  if (section === 'invoices' && !id) {
    const status = statusParam(raw);
    const search = q?.trim().slice(0, 100) || undefined;
    return <InvoiceList data={demoInvoices(status, search)} summary={demoSummary()} status={status} search={search} base="/demo" readOnly />;
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
        <DiscrepancyList data={demoDiscrepancies(status)} status={status} base="/demo" readOnly />
      </>
    );
  }
  if (section === 'dead-letters') {
    const replayed = raw === 'replayed';
    return (
      <>
        {head('Dead letters')}
        <DeadLetterList data={demoDeadLetters(replayed ? 'REPLAYED' : 'OPEN')} replayed={replayed} base="/demo" readOnly />
      </>
    );
  }
  notFound();
}
