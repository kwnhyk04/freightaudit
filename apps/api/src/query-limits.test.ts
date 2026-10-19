import { typeDefs } from '@freightaudit/contracts';
import { buildSchema, type DocumentNode, Kind, type OperationDefinitionNode, parse, print, specifiedRules, validate } from 'graphql';
import { readdirSync, readFileSync } from 'node:fs';
import { MAX_COST, MAX_DEPTH, measure, queryLimits } from './query-limits.ts';
import { deepQuery } from './testing.ts';

const schema = buildSchema(typeDefs);
const dir = new URL('../../../packages/contracts/operations/', import.meta.url);
const operations = readdirSync(dir)
  .filter((name) => name.endsWith('.graphql'))
  .map((name) => ({ name, document: parse(readFileSync(new URL(name, dir), 'utf8')) }));
const errors = (document: DocumentNode | string) =>
  validate(schema, typeof document === 'string' ? parse(document) : document, [...specifiedRules, queryLimits]).map((error) => error.message);
const size = (document: DocumentNode) => {
  const operation = document.definitions.find((definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION)!;
  return measure(operation.selectionSet, () => undefined);
};

test('every client operation passes, and the limits are the smallest that let them all through', () => {
  expect(operations.length).toBeGreaterThan(10);
  for (const { name, document } of operations) expect([name, errors(document)]).toEqual([name, []]);
  const sizes = operations.map(({ document }) => size(document));
  expect({ depth: MAX_DEPTH, cost: MAX_COST }).toEqual({ depth: Math.max(...sizes.map((each) => each.depth)), cost: Math.max(...sizes.map((each) => each.cost)) });
});

test('a query one field deeper than the limit is refused; one at the limit passes', () => {
  expect(errors(deepQuery(MAX_DEPTH))).toEqual([]);
  expect(errors(deepQuery(MAX_DEPTH + 1))).toEqual([`The query nests ${MAX_DEPTH + 1} fields deep; the limit is ${MAX_DEPTH}.`]);
});

test('the largest client operation with one field more is refused', () => {
  const largest = operations.reduce((top, each) => (size(each.document).cost > size(top.document).cost ? each : top));
  // The first brace opens the operation's selection: no client operation has an object in its variables.
  expect(errors(print(largest.document).replace('{', '{ __typename'))).toEqual([`The query selects ${MAX_COST + 1} fields; the limit is ${MAX_COST}.`]);
});

test('aliases are refused, since no client operation uses one', () => {
  expect(errors('{ status: health }')).toEqual(['Aliases are not accepted: status.']);
});

test('fragments count where they are spread; one that spreads itself, or a chain that doubles, still ends at once', () => {
  expect(errors(`query { ...nested } fragment nested on Query { ${deepQuery(MAX_DEPTH + 1).slice(1, -1)} }`)).toEqual([
    `The query nests ${MAX_DEPTH + 1} fields deep; the limit is ${MAX_DEPTH}.`,
  ]);
  const cycle = 'query { invoice(id: "x") { ...again } } fragment again on Invoice { discrepancies { edges { node { invoice { ...again } } } } }';
  expect(errors(cycle)).toContain('Cannot spread fragment "again" within itself.');
  // Each fragment spreads the next twice: 2^30 fields if every spread were expanded again.
  const chain = Array.from({ length: 30 }, (_, i) => `fragment f${i} on Query { ${i === 29 ? 'health' : `...f${i + 1} ...f${i + 1}`} }`).join(' ');
  expect(errors(`query { ...f0 } ${chain}`)).toEqual([`The query selects ${2 ** 29} fields; the limit is ${MAX_COST}.`]);
});
