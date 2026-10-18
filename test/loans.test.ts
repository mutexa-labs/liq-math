import { describe, expect, it } from "vitest";
import {
  accrueBorrowAssets,
  healthFactor,
  loanStats,
  morphoLoanStats,
  oraclePrice,
  sharesToAssetsUp,
  wTaylorCompounded,
} from "../src/index";

describe("Aave V3 loanStats", () => {
  it("puts the health factor at 1 exactly at the liquidation price", () => {
    const s = loanStats(10, 15_000, 2_500, 0.83);
    expect(loanStats(10, 15_000, s.liq, 0.83).hf).toBeCloseTo(1, 12);
  });

  it("reports distance as 1 − LTV / LT", () => {
    const s = loanStats(3, 4_000, 3_000, 0.8);
    expect(s.distance).toBeCloseTo(1 - s.ltv / 0.8, 12);
    expect(s.hf).toBeCloseTo(healthFactor(9_000, 0.8, 4_000), 12);
  });

  it("handles no debt and no collateral", () => {
    expect(loanStats(1, 0, 100, 0.8).hf).toBe(Infinity);
    expect(loanStats(0, 10, 100, 0.8).liq).toBeNaN();
    expect(loanStats(0, 10, 100, 0.8).ltv).toBe(Infinity);
  });
});

describe("Morpho Blue", () => {
  it("rounds shares to assets up, with virtual shares", () => {
    expect(sharesToAssetsUp(0n, 100n, 100n)).toBe(0n);
    // 1 share of (1000 + 1) assets over (1000 + 1e6) shares rounds up to 1
    expect(sharesToAssetsUp(1n, 1000n, 1000n)).toBe(1n);
    // (1e18 + 1e12) / (1e12 + 1e6) is exactly 1e6, so nothing to round
    expect(sharesToAssetsUp(10n ** 12n, 10n ** 6n, 10n ** 12n)).toBe(10n ** 6n);
  });

  it("scales the oracle price by 36 + loan decimals − collateral decimals", () => {
    // 1 collateral token (18 decimals) = 2000 loan tokens (6 decimals)
    expect(oraclePrice(2000n * 10n ** 24n, 6, 18)).toBeCloseTo(2000, 9);
  });

  it("puts the health factor at 1 exactly at the liquidation price", () => {
    const s = morphoLoanStats(2, 3_000, 2_400, 0.86);
    expect(morphoLoanStats(2, 3_000, s.liq, 0.86).hf).toBeCloseTo(1, 12);
    expect(s.distance).toBeCloseTo(1 - s.ltv / 0.86, 12);
  });

  it("accrues interest like Morpho Blue and is a no-op with no elapsed time", () => {
    expect(accrueBorrowAssets(10n ** 18n, 10n ** 9n, 0n)).toBe(10n ** 18n);
    expect(wTaylorCompounded(0n, 1000n)).toBe(0n);
    const rate = 1_585_489_599n; // ~5% a year per second, WAD
    const year = 365n * 24n * 3600n;
    const grown = accrueBorrowAssets(10n ** 18n, rate, year);
    expect(Number(grown) / 1e18).toBeGreaterThan(1.05);
    expect(Number(grown) / 1e18).toBeLessThan(Math.exp(0.05) + 1e-6);
  });
});
