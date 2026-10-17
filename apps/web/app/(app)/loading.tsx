import { SkeletonRows } from '../../components/ui.tsx';

export default function Loading() {
  return (
    <>
      <div className="page-head">
        <div className="skeleton" style={{ width: 160, height: 18 }} />
      </div>
      <SkeletonRows columns={7} />
    </>
  );
}
