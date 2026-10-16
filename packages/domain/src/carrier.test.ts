import { matchCarrier } from './carrier.ts';

// Fictional carriers, as the seed has them.
const carriers = ['Halcyon Ridge Freight', 'Tern & Tide Carriers', 'Quarry Lane Transport', 'Nimbus Road Lines'].map((name, i) => ({ id: i + 1, name }));
const named = (name: string) => carriers.find((carrier) => carrier.name === name);

test('a reading equal to a known name matches it, as printed or after normalizing case and spacing', () => {
  expect(matchCarrier('Quarry Lane Transport', carriers)).toEqual({ carrier: named('Quarry Lane Transport'), rule: 'exact' });
  expect(matchCarrier('NIMBUS  ROAD LINES', carriers)).toEqual({ carrier: named('Nimbus Road Lines'), rule: 'normalized' });
  expect(matchCarrier('tern &Tide Carriers', carriers)).toEqual({ carrier: named('Tern & Tide Carriers'), rule: 'normalized' });
});

test('a title-line suffix around a known name, as in the remit layout, matches that carrier as contained', () => {
  expect(matchCarrier('Quarry Lane Transport — Freight Bill', carriers)).toEqual({ carrier: named('Quarry Lane Transport'), rule: 'contained' });
  // Whole words only: a longer word is another name.
  expect(matchCarrier('Quarry Lane Transportation — Freight Bill', carriers)).toBeUndefined();
});

test('two carriers sharing words: a reading that holds both names, or only the shared words, matches neither', () => {
  const sharing = [...carriers, { id: 5, name: 'Road Lines' }, { id: 6, name: 'Halcyon Ridge Haulage' }];
  expect(matchCarrier('Nimbus Road Lines — Freight Bill', sharing)).toBeUndefined();
  expect(matchCarrier('Halcyon Ridge Lines', sharing)).toBeUndefined();
  // A name never spans a separator: "Halcyon Ridge" and "Freight Bill" do not make Halcyon Ridge Freight.
  expect(matchCarrier('Halcyon Ridge — Freight Bill', sharing)).toBeUndefined();
  // An exact reading still names one carrier, though it holds another's name.
  expect(matchCarrier('Nimbus Road Lines', sharing)).toEqual({ carrier: named('Nimbus Road Lines'), rule: 'exact' });
});

test('a reading that names no known carrier matches none, which leaves the invoice for needs_review', () => {
  expect(matchCarrier('Bramblewood Express', carriers)).toBeUndefined();
  expect(matchCarrier('Freight Bill', carriers)).toBeUndefined();
  expect(matchCarrier(' ', carriers)).toBeUndefined();
});
