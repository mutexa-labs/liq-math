import type { MarginTableInput, Tier } from "../types";

/**
 * Builds the tier list for a market.
 *
 * Without a margin table the market has one tier at `maxLeverage`. With one, tiers are sorted by
 * `lowerBound` and each carries Hyperliquid's maintenance deduction:
 *
 *   deduction_k = Σ_{i≤k} lowerBound_i · (l_i − l_{i−1}),  l = 1 / (2 · maxLeverage)
 */
export function tiersFor(maxLeverage: number, table?: MarginTableInput): Tier[] {
  const raw = table?.length
    ? table.map((t) => ({ lowerBound: Number(t.lowerBound), maxLeverage: t.maxLeverage }))
    : [{ lowerBound: 0, maxLeverage }];
  raw.sort((a, b) => a.lowerBound - b.lowerBound);
  const out: Tier[] = [];
  let deduction = 0;
  let prevL = 0;
  for (const t of raw) {
    const l = 1 / (2 * t.maxLeverage);
    deduction += t.lowerBound * (l - prevL);
    out.push({ lowerBound: t.lowerBound, maxLeverage: t.maxLeverage, l, deduction });
    prevL = l;
  }
  return out;
}

/** The tier that applies to a position of `notional` USD: the last tier whose lower bound it reaches. */
export function tierAt(tiers: Tier[], notional: number): Tier {
  let t = tiers[0];
  if (!t) throw new Error("tierAt: empty tier list");
  for (const x of tiers) if (notional >= x.lowerBound) t = x;
  return t;
}
