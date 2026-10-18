// Records Hyperliquid golden vectors from live public data.
//
//   node scripts/record-hyperliquid.ts [--isolated 24] [--cross 12] [address ...]
//
// Accounts come from the arguments, from HL_ADDRESSES (comma separated), or, when neither is given, from
// the counterparties in Hyperliquid's public recentTrades feed of the most traded markets. Addresses are only used to make the
// requests: the output keeps the numbers the formula needs and Hyperliquid's own liquidationPx, never
// an address. Nothing is sent anywhere except the public info API reads.

import { writeFileSync } from "node:fs";

const API = "https://api.hyperliquid.xyz/info";
const SOURCE_COIN_COUNT = 40; // most traded markets by 24h notional volume
const MAX_PER_COIN = 2;

type MarginTier = { lowerBound: string; maxLeverage: number };
type Asset = { name: string; maxLeverage: number; marginTableId?: number };
type Position = {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  marginUsed: string;
  liquidationPx: string | null;
  leverage: { type: "isolated" | "cross"; value: number };
};
type State = {
  crossMarginSummary: { accountValue: string };
  crossMaintenanceMarginUsed: string;
  assetPositions: { position: Position }[];
  time: number;
};
type SpotState = { balances: { coin: string; total: string }[] };

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const wantIsolated = arg("isolated", 24);
const wantCross = arg("cross", 12);
const given = [
  ...process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)),
  ...(process.env.HL_ADDRESSES ?? "").split(",").filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a.trim())),
].map((a) => a.trim().toLowerCase());

async function info<T>(body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) return (await r.json()) as T;
    if (r.status !== 429 || attempt >= 4)
      throw new Error(`info ${JSON.stringify(body).slice(0, 60)}: HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
}

const [meta, ctxs] = await info<
  [{ universe: Asset[]; marginTables?: [number, { marginTiers: MarginTier[] }][] }, { dayNtlVlm: string }[]]
>({ type: "metaAndAssetCtxs" });
const tables = new Map(meta.marginTables ?? []);
const assets = new Map(meta.universe.map((a) => [a.name, a]));
const tableFor = (a: Asset) =>
  a.marginTableId !== undefined && tables.get(a.marginTableId)?.marginTiers?.length
    ? tables.get(a.marginTableId)!.marginTiers.map((t) => ({ lowerBound: t.lowerBound, maxLeverage: t.maxLeverage }))
    : null;

let accounts = given;
if (!accounts.length) {
  const seen = new Set<string>();
  const coins = meta.universe
    .map((a, i) => ({ name: a.name, volume: Number(ctxs[i]?.dayNtlVlm ?? 0) }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, SOURCE_COIN_COUNT)
    .map((c) => c.name);
  for (const coin of coins) {
    const trades = await info<{ users: [string, string] }[]>({ type: "recentTrades", coin }).catch(() => []);
    for (const t of trades) for (const u of t.users) seen.add(u.toLowerCase());
  }
  accounts = [...seen];
}
console.error(`reading ${accounts.length} accounts`);

const isolated: unknown[] = [];
const cross: unknown[] = [];
const perCoinIso = new Map<string, number>();
const perCoinCross = new Map<string, number>();

for (const user of accounts) {
  if (isolated.length >= wantIsolated && cross.length >= wantCross) break;
  let state: State;
  try {
    state = await info<State>({ type: "clearinghouseState", user });
  } catch {
    continue;
  }
  const recordedAt = new Date(state.time).toISOString();
  const positions = state.assetPositions.map((p) => p.position);

  for (const p of positions) {
    if (p.leverage.type !== "isolated" || p.liquidationPx === null || isolated.length >= wantIsolated) continue;
    const a = assets.get(p.coin);
    if (!a || (perCoinIso.get(p.coin) ?? 0) >= MAX_PER_COIN) continue;
    perCoinIso.set(p.coin, (perCoinIso.get(p.coin) ?? 0) + 1);
    isolated.push({
      id: `hl-iso-${String(isolated.length + 1).padStart(4, "0")}`,
      recordedAt,
      source: { calls: ["metaAndAssetCtxs", "clearinghouseState"] },
      coin: p.coin,
      input: {
        szi: p.szi,
        positionValue: p.positionValue,
        marginUsed: p.marginUsed,
        entryPx: p.entryPx,
        maxLeverage: a.maxLeverage,
        marginTable: tableFor(a),
      },
      expected: { liquidationPx: p.liquidationPx },
      tolerance: { relative: 1e-6, absolute: 1e-10 },
    });
  }

  // cross: covered scope is one open cross position and no spot balances
  const crossPositions = positions.filter((p) => p.leverage.type === "cross");
  const only = crossPositions[0];
  if (cross.length < wantCross && crossPositions.length === 1 && only && only.liquidationPx !== null) {
    const a = assets.get(only.coin);
    if (!a || (perCoinCross.get(only.coin) ?? 0) >= MAX_PER_COIN) continue;
    let spot: SpotState;
    try {
      spot = await info<SpotState>({ type: "spotClearinghouseState", user });
    } catch {
      continue;
    }
    if (spot.balances.some((b) => Number(b.total) > 0)) continue;
    perCoinCross.set(only.coin, (perCoinCross.get(only.coin) ?? 0) + 1);
    cross.push({
      id: `hl-cross-${String(cross.length + 1).padStart(4, "0")}`,
      recordedAt,
      source: { calls: ["metaAndAssetCtxs", "clearinghouseState", "spotClearinghouseState"] },
      coin: only.coin,
      input: {
        szi: only.szi,
        positionValue: only.positionValue,
        crossAccountValue: state.crossMarginSummary.accountValue,
        crossMaintenanceMarginUsed: state.crossMaintenanceMarginUsed,
        maxLeverage: a.maxLeverage,
        marginTable: tableFor(a),
      },
      expected: { liquidationPx: only.liquidationPx },
      tolerance: { relative: 1e-6, absolute: 1e-10 },
    });
  }
}

const header = (model: string, description: string) => ({
  schema: 1,
  venue: "hyperliquid",
  model,
  recordedWith: "scripts/record-hyperliquid.ts",
  description,
});
writeFileSync(
  new URL("../vectors/hyperliquid-isolated.json", import.meta.url),
  JSON.stringify(
    {
      ...header(
        "isolated",
        "Open isolated positions read from clearinghouseState, with the margin table from metaAndAssetCtxs of the same run. markPx = positionValue / |szi|.",
      ),
      cases: isolated,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  new URL("../vectors/hyperliquid-cross.json", import.meta.url),
  JSON.stringify(
    {
      ...header(
        "cross",
        "Accounts whose only open cross position is this one and that hold no spot balances. markPx = positionValue / |szi|.",
      ),
      cases: cross,
    },
    null,
    2,
  ) + "\n",
);
console.error(`isolated: ${isolated.length}, cross: ${cross.length}`);
