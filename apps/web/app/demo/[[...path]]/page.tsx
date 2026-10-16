import type { InvoiceStatus } from '@freightaudit/contracts/graphql';
import { notFound, redirect } from 'next/navigation';
import { DeadLetterList, DiscrepancyList, InvoiceDetail, InvoiceList } from '../../../components/views.tsx';
import { demoDeadLetters, demoDiscrepancies, demoInvoice, demoInvoices } from '../../../lib/demo.ts';
import { STATUS } from '../../../lib/labels.ts';

// Every sample page: the same views as the live ones, from the snapshot files only, with no actions.
export default async function DemoPage({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<{ status?: string }> }) {
  const [{ path = [] }, { status: raw }] = await Promise.all([params, searchParams]);
  const [section, id] = path;
  const head = (title: string) => (
    <div className="page-head">
      <h1>{title}</h1>
    </div>
  );
  if (!section) redirect('/demo/invoices');
  if (section === 'invoices' && !id) {
    const upper = raw?.toUpperCase();
    const status = upper && upper in STATUS ? (upper as InvoiceStatus) : undefined;
    return (
      <>
        {head('Invoices')}
        <InvoiceList data={demoInvoices(status)} status={status} base="/demo" readOnly />
      </>
    );
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
