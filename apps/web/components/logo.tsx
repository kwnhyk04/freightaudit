import { useId } from 'react';

// The FreightAudit mark: a slanted F whose middle bar is the ledger line, its check cut out. Every
// bar is 8 units thick with a 2.5 radius and one skew slants them all; below 24 px the check is left out so it never smudges.
// app/icon.svg draws the same geometry.
const BARS = [
  { x: 10, y: 6, width: 28, height: 8 },
  { x: 10, y: 30, width: 16, height: 8 },
  { x: 10, y: 30, width: 8, height: 12 },
];

// tone 'theme' draws the bars in the text colour and the ledger in --brand; 'mono' draws it all in currentColor.
export function LogoMark({ size = 28, tone = 'theme' }: { size?: number; tone?: 'theme' | 'mono' }) {
  const id = useId();
  const check = size >= 24;
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {check && (
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="white" />
          <polyline points="24.5 22.2 26.8 24.4 30.6 20.2" fill="none" stroke="black" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </mask>
      )}
      <g transform="translate(5.1 0) skewX(-12)" fill="currentColor">
        {BARS.map((bar) => (
          <rect key={`${bar.y}-${bar.width}`} {...bar} rx="2.5" />
        ))}
        <rect x="10" y="18" width="24" height="8" rx="2.5" fill={tone === 'mono' ? 'currentColor' : 'var(--brand)'} mask={check ? `url(#${id})` : undefined} />
      </g>
    </svg>
  );
}
