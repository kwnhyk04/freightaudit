// An invoice's findings in money. reconcileInvoice reports overcharges only, at most one per line.

// A finding's review state, as discrepancies store it. A closed one went undecided with its rejected invoice, or with a
// held invoice's corrected reading; like every state but dismissed, it stands.
export type FindingStatus = 'open' | 'confirmed' | 'dismissed' | 'closed';
export type FindingAmounts = { status: FindingStatus; billedCents: bigint; expectedCents: bigint };

// What a finding bills above the contract.
export const overchargeCents = ({ billedCents, expectedCents }: Pick<FindingAmounts, 'billedCents' | 'expectedCents'>) => billedCents - expectedCents;

// Open findings wait for a decision and confirmed ones are disputed, so both stand; a dismissed one lets the billed amount
// stand. expectedCents is the total once every standing overcharge is taken off.
export function reviewAmounts(totalCents: bigint, findings: readonly FindingAmounts[]) {
  let openCents = 0n;
  let standingCents = 0n;
  for (const finding of findings) {
    if (finding.status === 'dismissed') continue;
    standingCents += overchargeCents(finding);
    if (finding.status === 'open') openCents += overchargeCents(finding);
  }
  return { openCents, standingCents, expectedCents: totalCents - standingCents };
}

// What the contract allows on one line: its finding's expected amount while the finding stands, else what was billed.
export const lineExpectedCents = (amountCents: bigint, finding?: FindingAmounts) =>
  finding && finding.status !== 'dismissed' ? finding.expectedCents : amountCents;
