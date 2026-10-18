# @mutexa/liq-math

Liquidation price math for perps and loans, checked against the venues' own numbers.

- **Hyperliquid perps:** margin tiers with the maintenance deduction, isolated liquidation price for a new
  position and for a live one, the inverse (margin for a chosen liquidation price), size rounding, and cross
  margin for single-position accounts.
- **Aave V3:** health factor, LTV, liquidation price and distance for one collateral and one debt asset.
- **Morpho Blue:** the same for an LLTV market, plus Morpho's share and interest math.

Pure functions, no I/O, no runtime dependencies. Runs in Node, browsers and Cloudflare Workers.

Every formula ships with **golden vectors**: real venue responses, recorded by the scripts in `scripts/`,
reduced to the numbers the formula needs and the venue's own answer. The test suite fails if any computed
value leaves its tolerance. Another implementation can check itself against the same files with
`runVectors`.

## Install

```sh
pnpm add github:mutexa-labs/liq-math#v0.1.0
```

Node 22 or later. ESM only.

## Quick start

From [`test/readme.test.ts`](test/readme.test.ts):

```ts
import { liqPrice, loanStats, marginForLiq, runVectors, tiersFor } from "@mutexa/liq-math";
import isolated from "@mutexa/liq-math/vectors/hyperliquid-isolated.json" with { type: "json" };

// A market with max leverage 40 and no margin table has one tier.
const tiers = tiersFor(40);

// Long 2 coins at 3000 with 600 USD of isolated margin (10x).
const liq = liqPrice(1, 3000, 2, 600, tiers); // 2734.18

// The isolated margin that would move the liquidation down to 2500.
const margin = marginForLiq(1, 3000, 2, 2500, tiers); // 1062.5

// An Aave loan: 10 ETH at 2500, 15000 USD of debt, liquidation threshold 0.83.
const loan = loanStats(10, 15_000, 2_500, 0.83); // { hf: 1.383, liq: 1807.23, ... }

// Check this package against Hyperliquid's own liquidation prices.
const report = runVectors(isolated); // { failed: 0, ... }
```

For a Hyperliquid market with a margin table, pass the table from `metaAndAssetCtxs`:

```ts
const tiers = tiersFor(asset.maxLeverage, marginTables.get(asset.marginTableId)?.marginTiers);
```

## API

| Export | What it does |
|---|---|
| `tiersFor(maxLeverage, table?)` | Tier list for a market. One tier without a table; with one, sorted tiers carrying `l = 1/(2·maxLeverage)` and the maintenance deduction. |
| `tierAt(tiers, notional)` | The tier that applies to a position of `notional` USD. |
| `liqPrice(side, entry, size, margin, tiers)` | Isolated liquidation price of a position opened at `entry` with `margin` USD. `side` is `1` long, `-1` short. |
| `liqPriceFromState(side, markPx, size, isolatedMargin, tiers)` | The same in Hyperliquid's documented form, from a live position (`markPx = positionValue / abs(szi)`, `isolatedMargin = marginUsed`). |
| `marginForLiq(side, entry, size, liq, tiers)` | Inverse of `liqPrice`: the isolated margin that puts the liquidation at `liq`. |
| `roundSize(size, szDecimals)` | Rounds a size down to the market's size step. |
| `crossLiqPrice(side, markPx, size, crossAccountValue, crossMaintenanceMarginUsed, tiers)` | Cross-margin liquidation price. Checked for accounts with one cross position and no spot balances (see below). |
| `loanStats(collateral, debtUsd, price, liqThreshold)` | Aave V3 standard mode: `{ collateralUsd, ltv, hf, liq, distance }`. |
| `healthFactor(collateralUsd, liqThreshold, debtUsd)` | Aave health factor from USD values. |
| `morphoLoanStats(collateral, borrow, price, lltv)` | Morpho Blue: `{ collateralValue, ltv, hf, liq, distance }` in loan-token units. |
| `sharesToAssetsUp`, `accrueBorrowAssets`, `wTaylorCompounded`, `oraclePrice` | Morpho Blue share, interest and oracle-scale math (bigint), as in its contracts. |
| `runVectors(file, fn?)` | Runs a vector file through `fn` (default: this package) and reports every case. |
| `evaluators` | The built-in evaluators, keyed by `<venue>/<model>`. |
| Types | `Side`, `Tier`, `MarginTableInput`, `PerpPosition`, `LoanPosition`, `Loan`, `MorphoLoan`, `VectorFile`, `VectorCase`, `VectorReport`, … |

Numbers are `number` (float64). Liquidation prices are clamped at 0; empty sizes or prices return `NaN`.

## The formulas

**Hyperliquid isolated.** Hyperliquid documents
`liq_price = price − side · margin_available / position_size / (1 − l · side)` with `l = 1 / (2 · max_leverage)`
and `margin_available = isolated_margin − maintenance_margin`. Tiered markets use
`maintenance_margin = notional · l_tier − deduction`, with
`deduction_k = Σ lowerBound_i · (l_i − l_{i−1})` so margin is continuous across tiers. For a new position
opened at `P` with margin `M` this gives `liq = (side·P − (M + deduction)/|s|) / (side − l_tier)`.

**Hyperliquid cross.** The same documented form with
`margin_available = crossMarginSummary.accountValue − crossMaintenanceMarginUsed`.

**Aave V3.** `HF = collateral_usd · LT / debt_usd`; holding the debt price, the collateral price at which HF
reaches 1 is `debt_usd / (collateral · LT)`, so the distance to liquidation is `1 − LTV / LT`.

**Morpho Blue.** A position is liquidatable once `borrowed > collateral · price · LLTV`, so
`HF = collateral · price · LLTV / borrowed` and `liq = borrowed / (collateral · LLTV)`. Borrowed assets come
from borrow shares with `toAssetsUp`, after accruing interest from the market's last update.

## Golden vectors

| File | Venue answer checked | Cases | Tolerance | Why that tolerance |
|---|---|---|---|---|
| `vectors/hyperliquid-isolated.json` | `liquidationPx` from `clearinghouseState` | 24 (17 long, 7 short, 19 markets) | relative 1e-6 or absolute 1e-10 | Hyperliquid reports `liquidationPx` with 10 decimals; for low-priced coins that rounding is the largest error. Max observed relative error 9.8e-9. |
| `vectors/hyperliquid-cross.json` | `liquidationPx` from `clearinghouseState` | 7 | relative 1e-6 or absolute 1e-10 | Same rounding. Max observed 2.6e-11. |
| `vectors/aave-v3-ethereum.json` | `getUserAccountData` `healthFactor` and `totalCollateralBase` | 8 (6 collateral/debt pairs) | relative 1e-9 | Aave works in integer base units and ray/wad math; float error is far below this. Max observed 4.5e-11. |
| `vectors/morpho-blue.json` | `healthFactor` from Morpho's public API | 6 markets | relative 1e-5 | The API value is indexed a few seconds away from the on-chain block read, so interest over that gap shows up. Max observed 2.6e-6. |

All cases were recorded on 2026-10-18 from live public data:

- **Hyperliquid:** `metaAndAssetCtxs` and `clearinghouseState` (plus `spotClearinghouseState` for cross) on
  `api.hyperliquid.xyz/info`, for counterparties in the public `recentTrades` feed of the 40 most traded
  markets. At most two cases per market.
- **Aave V3 Ethereum:** Pool `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`, resolved through the
  PoolAddressesProvider, all reads at one block. Accounts from recent `Borrow` events, kept only when in
  standard mode (E-Mode 0) with exactly one collateral and one debt reserve.
- **Morpho Blue Ethereum:** `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`. Positions found through
  `api.morpho.org`; every input read on-chain at one block, the market id checked against
  `idToMarketParams`.

Vectors never contain an account address: the recorders use addresses only to make requests. Numbers stay as
the venue's strings. Each case carries the time of the read, because funding changes isolated margin and the
liquidation price drifts.

Re-record (overwrites the files; CI never records):

```sh
pnpm record:hyperliquid                      # optional: HL_ADDRESSES=0x…,0x…
ETH_RPC=<ethereum rpc url> pnpm record:aave  # optional: AAVE_ADDRESSES=0x…,0x…
ETH_RPC=<ethereum rpc url> pnpm record:morpho
```

`https://ethereum-rpc.publicnode.com` is one public endpoint that works. The recorders need Node 22.18 or later
(they run as TypeScript through Node's type stripping).

### Using the vectors from another implementation

The files are plain JSON with `schema: 1`. Each case has `input`, `expected` and `tolerance`; a case passes when
every expected key is within the relative or the absolute tolerance. In TypeScript:

```ts
import { runVectors } from "@mutexa/liq-math";
const report = runVectors(file, (input) => ({ liquidationPx: myLiqPrice(input) }));
```

## How Mutexa uses it

Every liquidation price in the Mutexa app comes from this package: the slice planner, the tracker view that
re-plans any public address into a band, the liquidation map, the paper book and the lending pages. The slice
planner itself is [`@mutexa/ladder`](https://github.com/mutexa-labs/liquidation-ladder), built on top of it.

## Limitations

- **Cross margin scope.** `crossLiqPrice` is checked only for accounts whose single open cross position is the
  one being priced and that hold no spot balances. With several cross positions, or spot balances that count as
  collateral, Hyperliquid's reported value can differ; use the venue's `liquidationPx` there.
- **Tier boundaries.** No recorded case sits above a market's first tier bound yet. The deduction is covered by
  unit tests (margin is continuous at every boundary), not by a venue vector.
- **Funding drift.** A plan made with `liqPrice` at entry drifts as funding changes isolated margin. Use
  `liqPriceFromState` for live positions.
- **Aave** standard mode only, one collateral and one debt asset, debt price held constant.
- **Morpho** prices are in loan-token units from the market oracle; turning them into USD is up to the caller.
- **Floats.** Values are float64. Expect differences in the last digits against venues that work in integers.

Not in this release: Aave E-Mode and multi-collateral accounts, Hyperliquid portfolio margin and multi-position
cross accounts, Jupiter Perps, GMX, Kamino. Each is added with its own vectors.

What Mutexa as a whole does not hide (whitepaper §5.2): venues still see their own accounts; clustering by timing
is still possible; very large positions still move markets; splitting and privacy rails cost extra; fills
routed with an integrator code are marked as Mutexa fills. This package is math only and hides nothing by
itself.

## Stability

0.x: a change in any vector's expected value or in a public type is a minor version with a changelog entry.

## License

MIT © 2026 Mutexa
