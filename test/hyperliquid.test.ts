import { describe, expect, it } from "vitest";
import {
  crossLiqPrice,
  liqPrice,
  liqPriceFromState,
  marginForLiq,
  roundSize,
  tierAt,
  tiersFor,
  type Side,
} from "../src/index";

// A two-tier table in Hyperliquid's shape (lowerBound as a string). Values are arbitrary test inputs.
const table = [
  { lowerBound: "0.0", maxLeverage: 40 },
  { lowerBound: "150000000.0", maxLeverage: 20 },
];

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe("tiersFor / tierAt", () => {
  it("uses one tier at maxLeverage without a table", () => {
    expect(tiersFor(25)).toEqual([{ lowerBound: 0, maxLeverage: 25, l: 1 / 50, deduction: 0 }]);
    expect(tiersFor(25, [])).toHaveLength(1);
  });

  it("sorts tiers and accumulates the maintenance deduction", () => {
    const tiers = tiersFor(40, [...table].reverse());
    expect(tiers.map((t) => t.maxLeverage)).toEqual([40, 20]);
    expect(tiers[1]!.deduction).toBeCloseTo(150_000_000 * (1 / 40 - 1 / 80), 6);
  });

  it("keeps maintenance margin continuous at a tier boundary", () => {
    const tiers = tiersFor(40, table);
    const [a, b] = tiers as [(typeof tiers)[0], (typeof tiers)[0]];
    const n = b.lowerBound;
    expect(n * a.l - a.deduction).toBeCloseTo(n * b.l - b.deduction, 6);
  });

  it("picks the last tier whose lower bound is reached", () => {
    const tiers = tiersFor(40, table);
    expect(tierAt(tiers, 0).maxLeverage).toBe(40);
    expect(tierAt(tiers, 149_999_999).maxLeverage).toBe(40);
    expect(tierAt(tiers, 150_000_000).maxLeverage).toBe(20);
    expect(() => tierAt([], 1)).toThrow();
  });
});

describe("isolated liquidation price", () => {
  const tiers = tiersFor(40, table);

  it("returns NaN for empty size or price", () => {
    expect(liqPrice(1, 100, 0, 10, tiers)).toBeNaN();
    expect(liqPrice(1, 0, 1, 10, tiers)).toBeNaN();
    expect(liqPriceFromState(1, 100, 0, 10, tiers)).toBeNaN();
  });

  it("matches the documented state form at entry", () => {
    const r = seeded(7);
    for (let i = 0; i < 200; i++) {
      const side: Side = r() > 0.5 ? 1 : -1;
      const entry = 1 + r() * 100_000;
      const size = (1 + r() * 300_000_000) / entry;
      const margin = (size * entry) / (1 + r() * 39);
      expect(liqPrice(side, entry, size, margin, tiers)).toBeCloseTo(
        liqPriceFromState(side, entry, size, margin, tiers),
        6,
      );
    }
  });

  it("marginForLiq inverts liqPrice", () => {
    const r = seeded(11);
    for (let i = 0; i < 200; i++) {
      const side: Side = r() > 0.5 ? 1 : -1;
      const entry = 1 + r() * 100_000;
      const size = (1 + r() * 300_000_000) / entry;
      const margin = (size * entry) / (1.2 + r() * 38);
      const liq = liqPrice(side, entry, size, margin, tiers);
      if (liq <= 0) continue;
      expect(marginForLiq(side, entry, size, liq, tiers) / margin).toBeCloseTo(1, 9);
    }
  });

  it("moves the liquidation price away from entry as margin grows", () => {
    for (const side of [1, -1] as Side[]) {
      let prev = 0;
      for (const lev of [40, 20, 10, 5, 2]) {
        const d = Math.abs(liqPrice(side, 100, 10, 1000 / lev, tiers) - 100);
        expect(d).toBeGreaterThan(prev);
        prev = d;
      }
    }
  });

  it("never returns a negative price", () => {
    expect(liqPrice(1, 100, 1, 1000, tiers)).toBe(0);
  });

  it("rounds sizes down to the size step", () => {
    expect(roundSize(1.23456, 3)).toBe(1.234);
    expect(roundSize(0.99999, 0)).toBe(0);
  });
});

describe("cross liquidation price", () => {
  it("equals the isolated state form when the account holds one position", () => {
    const tiers = tiersFor(20);
    const mark = 2500;
    const size = 4;
    const accountValue = 1200;
    const t = tierAt(tiers, size * mark);
    const mm = size * mark * t.l - t.deduction;
    for (const side of [1, -1] as Side[]) {
      expect(crossLiqPrice(side, mark, size, accountValue, mm, tiers)).toBeCloseTo(
        liqPriceFromState(side, mark, size, accountValue, tiers),
        9,
      );
    }
    expect(crossLiqPrice(1, mark, 0, accountValue, mm, tiers)).toBeNaN();
  });
});
