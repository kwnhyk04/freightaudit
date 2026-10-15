import { microUsd, tokenCost } from '@freightaudit/domain';
import { readFileSync } from 'node:fs';
import type { Usage } from './extract.ts';

type Price = { tier: 'free' | 'paid'; input: string; output: string };

// Date-stamped paid list prices per provider/model (prices.json, beside src and dist alike).
const { models } = JSON.parse(readFileSync(new URL('../prices.json', import.meta.url), 'utf8')) as { models: Record<string, Price> };

// Whether calls to this model can be priced; Ollama runs locally for free.
export const hasPrice = (provider: string, model: string) => provider === 'ollama' || Object.hasOwn(models, `${provider}/${model}`);

// What a call cost in integer micro-dollars: 0 on a free tier, whose paid price prices.json keeps for reference.
export function callCost(provider: string, model: string, { inputTokens, outputTokens }: Usage) {
  const price = Object.hasOwn(models, `${provider}/${model}`) ? models[`${provider}/${model}`] : undefined;
  if (!price || price.tier === 'free') return 0n;
  return tokenCost(BigInt(inputTokens), BigInt(outputTokens), microUsd(price.input), microUsd(price.output));
}
