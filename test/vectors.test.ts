import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runVectors, type VectorFile } from "../src/index";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8")) as VectorFile;

const files = [
  { name: "hyperliquid-isolated.json", min: 10 },
  { name: "hyperliquid-cross.json", min: 5 },
  { name: "aave-v3-ethereum.json", min: 5 },
  { name: "morpho-blue.json", min: 3 },
];

describe.each(files)("golden vectors: $name", ({ name, min }) => {
  const file = load(name);
  const report = runVectors(file);

  it(`has at least ${min} recorded cases`, () => {
    expect(file.schema).toBe(1);
    expect(file.cases.length).toBeGreaterThanOrEqual(min);
  });

  it("every case matches the venue within its tolerance", () => {
    const failed = report.results.filter((r) => !r.pass);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    console.log(`${name}: ${report.passed}/${report.total}, max relative error ${report.maxRelError.toExponential(2)}`);
  });

  it("contains no account addresses", () => {
    const raw = readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8");
    const addresses = raw.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? [];
    // the only 20-byte hex allowed is the venue contract named in the description
    const allowed = new Set([
      "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
      "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
    ]);
    expect(addresses.filter((a) => !allowed.has(a.toLowerCase()))).toEqual([]);
  });
});
