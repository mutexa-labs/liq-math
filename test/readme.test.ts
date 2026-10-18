// The README quick start is copied from this file. Keep them in sync.
import { expect, it } from "vitest";
import { liqPrice, loanStats, marginForLiq, runVectors, tiersFor } from "../src/index";
import isolated from "../vectors/hyperliquid-isolated.json" with { type: "json" };

it("README quick start", () => {
  // A market with max leverage 40 and no margin table has one tier.
  const tiers = tiersFor(40);

  // Long 2 coins at 3000 with 600 USD of isolated margin (10x).
  const liq = liqPrice(1, 3000, 2, 600, tiers); // 2734.18

  // The isolated margin that would move the liquidation down to 2500.
  const margin = marginForLiq(1, 3000, 2, 2500, tiers); // 1062.5

  // An Aave loan: 10 ETH at 2500, 15000 USD of debt, liquidation threshold 0.83.
  const loan = loanStats(10, 15_000, 2_500, 0.83); // { hf: 1.383, liq: 1807.23, ... }

  // Check this package against Hyperliquid's own liquidation prices.
  const report = runVectors(isolated as Parameters<typeof runVectors>[0]); // { failed: 0, ... }

  expect(liq).toBeCloseTo(2734.18, 2);
  expect(margin).toBeCloseTo(1062.5, 9);
  expect(loan.hf).toBeCloseTo(1.383, 3);
  expect(loan.liq).toBeCloseTo(1807.23, 2);
  expect(report.failed).toBe(0);
});
