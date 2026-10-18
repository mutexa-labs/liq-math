// Morpho Blue loan math.
//
// A position can be liquidated once
//
//   borrowed > collateral · oraclePrice / 1e36 · LLTV
//
// so HF = collateral · price · LLTV / borrowed, and holding the loan token where it is, the collateral
// price at which HF reaches 1 is borrowed / (collateral · LLTV). Unlike Aave there is no separate max
// LTV for new borrows: a borrow can go up to LLTV. `price` here is the market oracle's price in loan
// tokens per collateral token (see oraclePrice), so amounts are in loan-token units, not USD.

export type MorphoLoan = {
  collateral: number; // collateral tokens
  collateralValue: number; // in loan tokens
  borrow: number; // loan tokens
  ltv: number;
  hf: number;
  liq: number; // collateral price in loan tokens at which HF = 1
  distance: number;
};

export const ORACLE_PRICE_SCALE = 10n ** 36n;
export const VIRTUAL_SHARES = 10n ** 6n;
export const VIRTUAL_ASSETS = 1n;

/** toAssetsUp from Morpho's SharesMathLib: borrow shares to borrowed assets, rounded up. */
export function sharesToAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  const d = totalShares + VIRTUAL_SHARES;
  return (shares * (totalAssets + VIRTUAL_ASSETS) + d - 1n) / d;
}

const WAD = 10n ** 18n;

/** wTaylorCompounded from Morpho's MathLib: e^(rate·elapsed) − 1 to the third Taylor term, WAD-scaled. */
export function wTaylorCompounded(rate: bigint, elapsed: bigint): bigint {
  const first = rate * elapsed;
  const second = (first * first) / (2n * WAD);
  const third = (second * first) / (3n * WAD);
  return first + second + third;
}

/**
 * Total borrow assets after accruing interest for `elapsed` seconds at `borrowRate` (per second, WAD),
 * as Morpho Blue's _accrueInterest does. The market's own totals are as of its last update; this
 * brings them to a later time without a transaction.
 */
export function accrueBorrowAssets(totalBorrowAssets: bigint, borrowRate: bigint, elapsed: bigint): bigint {
  if (elapsed <= 0n || borrowRate === 0n) return totalBorrowAssets;
  return totalBorrowAssets + (totalBorrowAssets * wTaylorCompounded(borrowRate, elapsed)) / WAD;
}

/** Human price (loan tokens per collateral token) from the oracle's 1e36-scaled value. */
export function oraclePrice(raw: bigint, loanDecimals: number, collateralDecimals: number): number {
  return Number(raw) / 10 ** (36 + loanDecimals - collateralDecimals);
}

/** Stats for one Morpho Blue position. `lltv` as a fraction (0.86, not 860000000000000000). */
export function morphoLoanStats(collateral: number, borrow: number, price: number, lltv: number): MorphoLoan {
  const collateralValue = collateral * price;
  const hf = borrow > 0 ? (collateralValue * lltv) / borrow : Infinity;
  const liq = collateral > 0 && lltv > 0 ? borrow / (collateral * lltv) : NaN;
  const ltv = collateralValue > 0 ? borrow / collateralValue : Infinity;
  return { collateral, collateralValue, borrow, ltv, hf, liq, distance: price > 0 ? 1 - liq / price : NaN };
}
