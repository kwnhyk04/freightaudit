// The overview's cards, empty, in the overview's own grid, while the api answers, rather than the list's table. Each card
// keeps about its height, so the page does not jump when the figures arrive.
const CARDS: [area: string, height: number][] = [
  ['hero', 260],
  ['received', 120],
  ['matched', 120],
  ['chart', 420],
  ['processing', 120],
  ['cost', 120],
  ['latest', 380],
  ['carriers', 240],
  ['health', 240],
];

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="page-head">
        <div className="skeleton" style={{ width: 160, height: 18 }} />
      </div>
      <div className="overview">
        {CARDS.map(([area, height]) => (
          <div key={area} className={`tile t-${area}`} style={{ minHeight: height, animation: 'none' }}>
            <div className="skeleton" style={{ width: '40%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
