/** 1 for long, -1 for short. */
export type Side = 1 | -1;

/**
 * One margin tier of a perp market.
 * `l` = 1 / maintenance leverage = 1 / (2 · maxLeverage).
 * `deduction` keeps maintenance margin continuous across tiers: MM = notional · l − deduction.
 */
export type Tier = { lowerBound: number; maxLeverage: number; l: number; deduction: number };

/** A venue margin table in plain numbers (Hyperliquid sends `lowerBound` as a string). */
export type MarginTableInput = { lowerBound: number | string; maxLeverage: number }[];

/** An isolated perp position: `size` in coins (sign ignored), `margin` in USD. */
export type PerpPosition = { side: Side; size: number; entry: number; margin: number };

/** A single-collateral, single-debt loan. `liqThreshold` is a fraction (0.83, not 8300). */
export type LoanPosition = { collateral: number; debtUsd: number; price: number; liqThreshold: number };
