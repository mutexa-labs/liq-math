import { describe, expect, it } from "vitest";
import { evaluators, runVectors, type VectorFile } from "../src/index";

const file: VectorFile<{ x: string }> = {
  schema: 1,
  venue: "example",
  model: "double",
  recordedWith: "test",
  cases: [
    {
      id: "a",
      recordedAt: "2026-01-01T00:00:00.000Z",
      source: { calls: [] },
      input: { x: "2" },
      expected: { y: "4" },
      tolerance: { relative: 1e-9 },
    },
    {
      id: "b",
      recordedAt: "2026-01-01T00:00:00.000Z",
      source: { calls: [] },
      input: { x: "0" },
      expected: { y: "0.00000001" },
      tolerance: { absolute: 1e-6 },
    },
  ],
};

describe("runVectors", () => {
  it("checks a custom implementation", () => {
    const r = runVectors(file, (i) => ({ y: Number(i.x) * 2 }));
    expect(r).toMatchObject({ total: 2, passed: 2, failed: 0 });
  });

  it("reports failures, missing keys and thrown errors", () => {
    expect(runVectors(file, (i) => ({ y: Number(i.x) * 3 })).failed).toBe(1);
    expect(runVectors(file, () => ({})).failed).toBe(2);
    const thrown = runVectors(file, () => {
      throw new Error("boom");
    });
    expect(thrown.results[0]).toMatchObject({ pass: false, error: "boom" });
  });

  it("refuses a file without an evaluator", () => {
    expect(() => runVectors(file)).toThrow(/no evaluator/);
  });

  it("ships evaluators for every vector file", () => {
    expect(Object.keys(evaluators).sort()).toEqual([
      "aave-v3/standard",
      "hyperliquid/cross",
      "hyperliquid/isolated",
      "morpho-blue/standard",
    ]);
  });
});
