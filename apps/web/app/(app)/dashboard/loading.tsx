// The overview's cards, empty, while the api answers, rather than the list's table.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="page-head">
        <div className="skeleton" style={{ width: 160, height: 18 }} />
      </div>
      <div className="overview-top">
        <div className="panel" style={{ height: 140, margin: 0 }} />
        <div className="panel" style={{ height: 140, margin: 0 }} />
      </div>
      <div className="overview-grid">
        <div className="panel" style={{ height: 300 }} />
        <div className="panel" style={{ height: 300 }} />
      </div>
    </div>
  );
}
