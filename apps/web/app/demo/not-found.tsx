import { NotFound } from '../../components/ui.tsx';

// notFound() in a sample page; it renders inside the sample's shell, under its banner.
export default function SampleNotFound() {
  return <NotFound text="The sample holds only its own invoices, and none lives at this address." href="/demo/invoices" back="Back to the sample invoices" />;
}
