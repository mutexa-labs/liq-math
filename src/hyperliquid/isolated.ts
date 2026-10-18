// Hyperliquid isolated-margin liquidation price.
//
// Hyperliquid documents the liquidation price as
//
//   liq_price = price − side · margin_available / position_size / (1 − l · side)
//
// where side = 1 for long and −1 for short, position_size is the absolute size in coins,
// l = 1 / maintenance_leverage and maintenance_leverage = 2 · max_leverage. For an isolated position,
// margin_available = isolated_margin − maintenance_margin_required, with the maintenance margin valued
// at `price`. Tiered markets apply a maintenance deduction so margin is continuous across tiers:
// MM = notional · l_tier − deduction. Substituting gives the closed form for a fresh position opened at
// entry price P with isolated margin M:
//
//   liq = (side·P − (M + deduction)/|s|) / (side − l_tier)
//
// Funding paid or received after opening changes isolated margin, so a live position's liquidation
// price drifts from the one planned at entry. Use liqPriceFromState for live positions.

import type { Side, Tier } from "../types";
import { tierAt } from "./tiers";

/** Liquidation price of an isolated position opened at `entry` with `margin` USD and `size` coins. */
export function liqPrice(side: Side, entry: number, size: number, margin: number, tiers: Tier[]): number {
  const sz = Math.abs(size);
  if (!(sz > 0) || !(entry > 0)) return NaN;
  const t = tierAt(tiers, sz * entry);
  const px = (side * entry - (margin + t.deduction) / sz) / (side - t.l);
  return Math.max(px, 0);
}

/**
 * The same formula in Hyperliquid's documented form, from a live position's current state:
 * `markPx` (positionValue / |szi|), `size` and `isolatedMargin` (the position's `marginUsed`).
 */
export function liqPriceFromState(
  side: Side,
  markPx: number,
  size: number,
  isolatedMargin: number,
  tiers: Tier[],
): number {
  const sz = Math.abs(size);
  if (!(sz > 0) || !(markPx > 0)) return NaN;
  const t = tierAt(tiers, sz * markPx);
  const maintenance = sz * markPx * t.l - t.deduction;
  const available = isolatedMargin - maintenance;
  return Math.max(markPx - (side * available) / sz / (1 - t.l * side), 0);
}

/** Inverse of liqPrice: the isolated margin that puts the liquidation price at `liq`. */
export function marginForLiq(side: Side, entry: number, size: number, liq: number, tiers: Tier[]): number {
  const sz = Math.abs(size);
  const t = tierAt(tiers, sz * entry);
  return sz * (side * entry - liq * (side - t.l)) - t.deduction;
}

/** Rounds a size down to the market's size step (`szDecimals` from the market meta). */
export function roundSize(size: number, szDecimals: number): number {
  const f = 10 ** szDecimals;
  return Math.floor(size * f) / f;
}
