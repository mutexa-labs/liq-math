// Records Morpho Blue (Ethereum) golden vectors from live public data.
//
//   ETH_RPC=https://ethereum-rpc.publicnode.com node scripts/record-morpho.ts [--cases 6]
//
// Positions are found through Morpho's public API (api.morpho.org, the largest borrow positions on
// Ethereum). Every input is then read on-chain at one block: idToMarketParams (must hash back to the
// market id), market totals, the position, the market oracle price, the IRM borrow rate and token decimals. Interest
// is accrued from the market's last update to the block time, as Morpho Blue does on its next touch. The expected
// health factor is the one Morpho's API reports for the position. The output never contains an
// account address.

import { writeFileSync } from "node:fs";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";

const RPC = process.env.ETH_RPC;
if (!RPC) throw new Error("Set ETH_RPC to an Ethereum JSON-RPC URL, for example https://ethereum-rpc.publicnode.com");

const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const;
const MORPHO_API = "https://api.morpho.org/graphql";

const morphoAbi = parseAbi([
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);
const oracleAbi = parseAbi(["function price() view returns (uint256)"]);
const irmAbi = parseAbi([
  "function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)",
]);
const erc20Abi = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);

const i = process.argv.indexOf("--cases");
const want = i > 0 ? Number(process.argv[i + 1]) : 6;

type ApiPosition = { healthFactor: number | null; user: { address: string }; market: { marketId: string } };
const query = `{ marketPositions(first: 120, orderBy: BorrowShares, orderDirection: Desc, where: { chainId_in: [1] }) { items { healthFactor user { address } market { marketId } } } }`;

async function apiPositions(): Promise<ApiPosition[]> {
  const r = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Morpho API responded ${r.status}`);
  const j = (await r.json()) as { data?: { marketPositions?: { items?: ApiPosition[] } } };
  const items = j.data?.marketPositions?.items;
  if (!Array.isArray(items)) throw new Error("Morpho API format not recognised");
  return items;
}

const marketId = (p: readonly [Address, Address, Address, Address, bigint]) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [...p],
    ),
  );

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC, { timeout: 20_000, retryCount: 2 }),
  batch: { multicall: true },
});
const positions = (await apiPositions()).filter((p) => typeof p.healthFactor === "number" && p.healthFactor > 0.5);
const block = await client.getBlockNumber();
const at = { blockNumber: block };
const { timestamp } = await client.getBlock({ blockNumber: block });

const cases: unknown[] = [];
const seenMarkets = new Set<string>();
for (const p of positions) {
  if (cases.length >= want) break;
  const id = p.market.marketId.toLowerCase() as Hex;
  if (seenMarkets.has(id)) continue;
  const user = p.user.address as Address;
  try {
    const params = await client.readContract({
      address: MORPHO_BLUE,
      abi: morphoAbi,
      functionName: "idToMarketParams",
      args: [id],
      ...at,
    });
    if (marketId(params) !== id) continue;
    const [loanToken, collToken, oracle, irm, lltv] = params;
    const [m, pos, price, loanDec, collDec, loanSym, collSym] = await Promise.all([
      client.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "market", args: [id], ...at }),
      client.readContract({ address: MORPHO_BLUE, abi: morphoAbi, functionName: "position", args: [id, user], ...at }),
      client.readContract({ address: oracle, abi: oracleAbi, functionName: "price", ...at }),
      client.readContract({ address: loanToken, abi: erc20Abi, functionName: "decimals", ...at }),
      client.readContract({ address: collToken, abi: erc20Abi, functionName: "decimals", ...at }),
      client.readContract({ address: loanToken, abi: erc20Abi, functionName: "symbol", ...at }).catch(() => "?"),
      client.readContract({ address: collToken, abi: erc20Abi, functionName: "symbol", ...at }).catch(() => "?"),
    ]);
    if (pos[1] === 0n || pos[2] === 0n || price === 0n) continue;
    const marketParams = { loanToken, collateralToken: collToken, oracle, irm, lltv };
    const marketState = {
      totalSupplyAssets: m[0],
      totalSupplyShares: m[1],
      totalBorrowAssets: m[2],
      totalBorrowShares: m[3],
      lastUpdate: m[4],
      fee: m[5],
    };
    const borrowRate =
      irm === "0x0000000000000000000000000000000000000000"
        ? 0n
        : await client.readContract({
            address: irm,
            abi: irmAbi,
            functionName: "borrowRateView",
            args: [marketParams, marketState],
            ...at,
          });
    seenMarkets.add(id);
    cases.push({
      id: `morpho-eth-${String(cases.length + 1).padStart(4, "0")}`,
      recordedAt: new Date(Number(timestamp) * 1000).toISOString(),
      block: Number(block),
      source: {
        calls: [
          "api.morpho.org marketPositions.healthFactor",
          "Morpho.idToMarketParams",
          "Morpho.market",
          "Morpho.position",
          "Oracle.price",
          "Irm.borrowRateView",
        ],
      },
      pair: `${collSym}/${loanSym}`,
      input: {
        collateral: pos[2].toString(),
        collateralDecimals: Number(collDec),
        loanDecimals: Number(loanDec),
        borrowShares: pos[1].toString(),
        totalBorrowAssets: m[2].toString(),
        totalBorrowShares: m[3].toString(),
        oraclePrice: price.toString(),
        lltv: lltv.toString(),
        borrowRate: borrowRate.toString(),
        lastUpdate: Number(m[4]),
        timestamp: Number(timestamp),
      },
      expected: { healthFactor: p.healthFactor! },
      tolerance: { relative: 1e-5 },
    });
  } catch {
    continue;
  }
}

writeFileSync(
  new URL("../vectors/morpho-blue.json", import.meta.url),
  JSON.stringify(
    {
      schema: 1,
      venue: "morpho-blue",
      model: "standard",
      recordedWith: "scripts/record-morpho.ts",
      description:
        "Morpho Blue on Ethereum (0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb). Inputs are on-chain reads at the recorded block; the expected health factor is the value Morpho's public API reported for the position in the same run.",
      cases,
    },
    null,
    2,
  ) + "\n",
);
console.error(`morpho cases: ${cases.length}`);
