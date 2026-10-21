import { type ASTVisitor, type FragmentDefinitionNode, GraphQLError, Kind, type SelectionSetNode, type ValidationContext } from 'graphql';

// Only the web's server-only key reaches /graphql, so these bound what a leaked key could ask for. Each is the smallest
// value every client operation in packages/contracts/operations passes; query-limits.test.ts pins both edges.
export const MAX_DEPTH = 8;
export const MAX_COST = 88;

type Size = { depth: number; cost: number };

// How deep a selection nests and how many fields it selects (its cost), each fragment counted where it is spread but
// measured once. A fragment spread within itself counts as empty there; graphql-js's own rule refuses it.
export function measure(selectionSet: SelectionSetNode, fragment: (name: string) => FragmentDefinitionNode | undefined, sizes = new Map<string, Size>()): Size {
  let depth = 0;
  let cost = 0;
  for (const selection of selectionSet.selections) {
    let inner: Size;
    if (selection.kind === Kind.FIELD) {
      const below = selection.selectionSet ? measure(selection.selectionSet, fragment, sizes) : { depth: 0, cost: 0 };
      inner = { depth: below.depth + 1, cost: below.cost + 1 };
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      inner = measure(selection.selectionSet, fragment, sizes);
    } else {
      const name = selection.name.value;
      if (!sizes.has(name)) {
        sizes.set(name, { depth: 0, cost: 0 });
        const definition = fragment(name);
        if (definition) sizes.set(name, measure(definition.selectionSet, fragment, sizes));
      }
      inner = sizes.get(name)!;
    }
    depth = Math.max(depth, inner.depth);
    cost += inner.cost;
  }
  return { depth, cost };
}

// Refuses at validation, so before any resolver runs, an alias anywhere (no client operation uses one) and an operation
// over either limit.
export function queryLimits(context: ValidationContext): ASTVisitor {
  return {
    Field(node) {
      if (node.alias) context.reportError(new GraphQLError(`Aliases are not accepted: ${node.alias.value}.`, { nodes: node }));
    },
    OperationDefinition(operation) {
      const { depth, cost } = measure(operation.selectionSet, (name) => context.getFragment(name) ?? undefined);
      if (depth > MAX_DEPTH) context.reportError(new GraphQLError(`The query nests ${depth} fields deep; the limit is ${MAX_DEPTH}.`, { nodes: operation }));
      if (cost > MAX_COST) context.reportError(new GraphQLError(`The query selects ${cost} fields; the limit is ${MAX_COST}.`, { nodes: operation }));
    },
  };
}
