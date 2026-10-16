// How a carrier name read from a document matched a known carrier: as printed, after normalization, or as a known name
// inside a longer reading.
export type CarrierMatchRule = 'exact' | 'normalized' | 'contained';

// Upper case, with words and punctuation marks as tokens one space apart: "tern &Tide  Carriers" becomes
// "TERN & TIDE CARRIERS". Marks stay, so a name never matches across a separator such as a dash.
const normalize = (name: string) => (name.normalize('NFKC').toUpperCase().match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? []).join(' ');

// The one known carrier a reading names: equal to it after normalization, else the only known name the reading holds
// as whole tokens, such as a title line "Quarry Lane Transport — Freight Bill". None, or more than one, is no match.
export function matchCarrier<C extends { name: string }>(reading: string, carriers: readonly C[]): { carrier: C; rule: CarrierMatchRule } | undefined {
  const read = normalize(reading);
  const only = (found: C[]) => (found.length === 1 ? found[0] : undefined);
  const equal = only(carriers.filter((carrier) => normalize(carrier.name) === read));
  if (equal) return { carrier: equal, rule: equal.name === reading ? 'exact' : 'normalized' };
  const inside = only(carriers.filter((carrier) => ` ${read} `.includes(` ${normalize(carrier.name)} `)));
  return inside ? { carrier: inside, rule: 'contained' } : undefined;
}
