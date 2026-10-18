// Aave V3 loan math, standard mode (no E-Mode), one collateral and one debt asset.
//
//   HF = collateral_usd · liquidationThreshold / debt_usd
//
// A loan can be liquidated once HF < 1. Holding the debt price where it is, the collateral price at
// which HF reaches 1 is
//
//   liq_price = debt_usd / (collateral_amount · liquidationThreshold) = price · LTV_now / LT
//
// so the distance to liquidation is 1 − LTV_now / LT.

export type Loan = {
  collateral: number;
  collateralUsd: number;
  debtUsd: number;
  ltv: number;
  hf: number;
  liq: number;
  distance: number;
};

/** Health factor from USD values. Infinity when there is no debt. */
export function healthFactor(collateralUsd: number, liqThreshold: number, debtUsd: number): number {
  return debtUsd > 0 ? (collateralUsd * liqThreshold) / debtUsd : Infinity;
}

/**
 * Stats for one loan: `collateral` in tokens, `debtUsd` in USD, `price` = collateral price in USD,
 * `liqThreshold` as a fraction.
 */
export function loanStats(collateral: number, debtUsd: number, price: number, liqThreshold: number): Loan {
  const collateralUsd = collateral * price;
  const ltv = collateralUsd > 0 ? debtUsd / collateralUsd : Infinity;
  const hf = healthFactor(collateralUsd, liqThreshold, debtUsd);
  const liq = collateral > 0 && liqThreshold > 0 ? debtUsd / (collateral * liqThreshold) : NaN;
  return { collateral, collateralUsd, debtUsd, ltv, hf, liq, distance: price > 0 ? 1 - liq / price : NaN };
}
