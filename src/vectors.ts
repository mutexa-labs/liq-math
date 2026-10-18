// Golden vectors: venue responses recorded by scripts/record-*.ts, reduced to the numbers a formula needs
// and the venue's own answer. Numbers are kept as the venue's strings so no precision is lost in the file.
//
// runVectors() checks any implementation against a vector file. Other implementations (another
// language, a contract test) can read the same JSON from the `vectors/` folder of this package.

import { loanStats } from "./aave/v3";
import { crossLiqPrice } from "./hyperliquid/cross";
import { liqPriceFromState } from "./hyperliquid/isolated";
import { tiersFor } from "./hyperliquid/tiers";
import { accrueBorrowAssets, morphoLoanStats, oraclePrice, sharesToAssetsUp } from "./morpho/blue";
import type { MarginTableInput, Side } from "./types";

export type VectorTolerance = { relative?: number; absolute?: number };

export type VectorCase<I = Record<string, unknown>> = {
  id: string;
  recordedAt: string;
  block?: number;
  source: { calls: string[] };
  input: I;
  expected: Record<string, string | number>;
  tolerance: VectorTolerance;
};

export type VectorFile<I = Record<string, unknown>> = {
  schema: 1;
  venue: string;
  model: string;
  recordedWith: string;
  description?: string;
  cases: VectorCase<I>[];
};

/** Computes the expected keys of a case from its input, in the same units as `expected`. */
export type VectorEvaluator<I = any> = (input: I) => Record<string, number>;

export type VectorCheck = {
  key: string;
  expected: number;
  actual: number;
  absError: number;
  relError: number;
  pass: boolean;
};
export type VectorResult = { id: string; pass: boolean; checks: VectorCheck[]; error?: string };
export type VectorReport = {
  venue: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  maxRelError: number;
  results: VectorResult[];
};

// ---- input shapes of the shipped vector files

export type HyperliquidIsolatedInput = {
  szi: string;
  positionValue: string;
  marginUsed: string;
  entryPx: string;
  maxLeverage: number;
  marginTable: MarginTableInput | null;
};

export type HyperliquidCrossInput = {
  szi: string;
  positionValue: string;
  crossAccountValue: string;
  crossMaintenanceMarginUsed: string;
  maxLeverage: number;
  marginTable: MarginTableInput | null;
};

export type AaveV3Input = {
  collateralBalance: string; // aToken balance, raw units
  collateralDecimals: number;
  collateralPrice: string; // AaveOracle price, base currency units
  baseCurrencyUnit: string;
  liquidationThreshold: string; // basis points
  totalDebtBase: string; // getUserAccountData, base currency units
};

export type MorphoBlueInput = {
  collateral: string; // raw collateral units
  collateralDecimals: number;
  loanDecimals: number;
  borrowShares: string;
  totalBorrowAssets: string;
  totalBorrowShares: string;
  oraclePrice: string; // 1e36-scaled
  lltv: string; // 1e18-scaled
  borrowRate?: string; // IRM borrowRateView at the block, per second, 1e18-scaled
  lastUpdate?: number; // market lastUpdate, unix seconds
  timestamp?: number; // time to accrue interest to, unix seconds
};

const markOf = (szi: string, positionValue: string) => Number(positionValue) / Math.abs(Number(szi));
const sideOf = (szi: string): Side => (Number(szi) > 0 ? 1 : -1);

/** Evaluators for the vector files shipped in `vectors/`, keyed by `<venue>/<model>`. */
export const evaluators: Record<string, VectorEvaluator> = {
  "hyperliquid/isolated": (x: HyperliquidIsolatedInput) => ({
    liquidationPx: liqPriceFromState(
      sideOf(x.szi),
      markOf(x.szi, x.positionValue),
      Number(x.szi),
      Number(x.marginUsed),
      tiersFor(x.maxLeverage, x.marginTable ?? undefined),
    ),
  }),
  "hyperliquid/cross": (x: HyperliquidCrossInput) => ({
    liquidationPx: crossLiqPrice(
      sideOf(x.szi),
      markOf(x.szi, x.positionValue),
      Number(x.szi),
      Number(x.crossAccountValue),
      Number(x.crossMaintenanceMarginUsed),
      tiersFor(x.maxLeverage, x.marginTable ?? undefined),
    ),
  }),
  "aave-v3/standard": (x: AaveV3Input) => {
    const unit = Number(x.baseCurrencyUnit);
    const collateral = Number(x.collateralBalance) / 10 ** x.collateralDecimals;
    const price = Number(x.collateralPrice) / unit;
    const s = loanStats(collateral, Number(x.totalDebtBase) / unit, price, Number(x.liquidationThreshold) / 1e4);
    // same units as getUserAccountData: base currency units and a 1e18-scaled health factor
    return { totalCollateralBase: s.collateralUsd * unit, healthFactor: s.hf * 1e18 };
  },
  "morpho-blue/standard": (x: MorphoBlueInput) => {
    const elapsed = x.timestamp !== undefined && x.lastUpdate !== undefined ? BigInt(x.timestamp - x.lastUpdate) : 0n;
    const totalBorrow = accrueBorrowAssets(BigInt(x.totalBorrowAssets), BigInt(x.borrowRate ?? 0), elapsed);
    const borrowRaw = sharesToAssetsUp(BigInt(x.borrowShares), totalBorrow, BigInt(x.totalBorrowShares));
    const s = morphoLoanStats(
      Number(x.collateral) / 10 ** x.collateralDecimals,
      Number(borrowRaw) / 10 ** x.loanDecimals,
      oraclePrice(BigInt(x.oraclePrice), x.loanDecimals, x.collateralDecimals),
      Number(x.lltv) / 1e18,
    );
    return { healthFactor: s.hf };
  },
};

function check(key: string, expected: number, actual: number, tol: VectorTolerance): VectorCheck {
  const absError = Math.abs(actual - expected);
  const relError = expected !== 0 ? absError / Math.abs(expected) : absError === 0 ? 0 : Infinity;
  const pass =
    Number.isFinite(actual) &&
    ((tol.relative !== undefined && relError <= tol.relative) ||
      (tol.absolute !== undefined && absError <= tol.absolute));
  return { key, expected, actual, absError, relError, pass };
}

/**
 * Runs every case of a vector file through `fn` (default: this package's evaluator for the file's
 * venue and model) and compares each expected key within the case tolerance.
 */
export function runVectors<I = Record<string, unknown>>(file: VectorFile<I>, fn?: VectorEvaluator<I>): VectorReport {
  const evaluate = fn ?? (evaluators[`${file.venue}/${file.model}`] as VectorEvaluator<I> | undefined);
  if (!evaluate) throw new Error(`runVectors: no evaluator for ${file.venue}/${file.model}`);
  const results: VectorResult[] = file.cases.map((c) => {
    try {
      const out = evaluate(c.input);
      const checks = Object.entries(c.expected).map(([key, e]) => check(key, Number(e), out[key] ?? NaN, c.tolerance));
      return { id: c.id, pass: checks.length > 0 && checks.every((k) => k.pass), checks };
    } catch (e) {
      return { id: c.id, pass: false, checks: [], error: e instanceof Error ? e.message : String(e) };
    }
  });
  const passed = results.filter((r) => r.pass).length;
  const maxRelError = Math.max(0, ...results.flatMap((r) => r.checks.map((k) => k.relError)));
  return {
    venue: file.venue,
    model: file.model,
    total: results.length,
    passed,
    failed: results.length - passed,
    maxRelError,
    results,
  };
}
