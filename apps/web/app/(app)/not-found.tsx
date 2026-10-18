import { NotFound } from '../../components/ui.tsx';

// notFound() in a live page, such as an invoice id the api does not hold; it renders inside the live shell.
export default function LiveNotFound() {
  return <NotFound text="No invoice or page lives at this address. The link may be old, or the id typed wrong." href="/invoices" back="Back to the invoices" />;
}
