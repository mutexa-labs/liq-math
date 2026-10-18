// Hyperliquid cross-margin liquidation price, in the documented form
//
//   liq_price = price − side · margin_available / position_size / (1 − l · side)
//
// with margin_available = cross account value − cross maintenance margin used, both read from the
// account's clearinghouseState (crossMarginSummary.accountValue and crossMaintenanceMarginUsed).
//
// Covered and checked by golden vectors: an account whose only open cross position is this one and
// that holds no spot balances. Accounts with several cross positions or with spot balances (which can
// count as collateral) can differ from Hyperliquid's reported value; use the venue's liquidationPx there.

import type { Side, Tier } from "../types";
import { tierAt } from "./tiers";

export function crossLiqPrice(
  side: Side,
  markPx: number,
  size: number,
  crossAccountValue: number,
  crossMaintenanceMarginUsed: number,
  tiers: Tier[],
): number {
  const sz = Math.abs(size);
  if (!(sz > 0) || !(markPx > 0)) return NaN;
  const t = tierAt(tiers, sz * markPx);
  const available = crossAccountValue - crossMaintenanceMarginUsed;
  return Math.max(markPx - (side * available) / sz / (1 - t.l * side), 0);
}
