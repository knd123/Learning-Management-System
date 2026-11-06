/** Canadian dollars per US dollar, rounded up so estimates err on the high side. */
export const CAD_PER_USD = 1.45;

/** Gemini's Batch mode (results within 24 hours) costs half the standard price. */
export const BATCH_DISCOUNT = 0.5;

/**
 * Gemini list prices in US$ per million tokens (output includes thinking), on the high side on purpose:
 * Flash uses the prices Google set from January 1, 2027 (double November's), and any model that isn't
 * Flash or Flash-Lite is priced like Pro.
 */
export const AI_PRICES: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /flash-lite/, input: 0.3, output: 2.5 },
  { match: /flash/, input: 1.5, output: 7.5 },
  { match: /./, input: 4, output: 20 },
];

export function aiCostUsd(model: string, inputTokens: number, outputTokens: number, batch = false): number {
  const price = AI_PRICES.find((p) => p.match.test(model))!;
  return ((inputTokens * price.input + outputTokens * price.output) / 1e6) * (batch ? BATCH_DISCOUNT : 1);
}
