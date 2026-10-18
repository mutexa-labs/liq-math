// Records Aave V3 Ethereum golden vectors from live public data.
//
//   ETH_RPC=https://ethereum-rpc.publicnode.com node scripts/record-aave.ts [--cases 8] [address ...]
//
// Accounts come from the arguments, from AAVE_ADDRESSES (comma separated), or, when neither is given,
// from recent Borrow events of the Aave V3 Pool. Only standard-mode (E-Mode 0) accounts with exactly one
// collateral and one debt reserve are recorded. Everything is read at one block: getUserAccountData
// (the venue's health factor), the reserve's liquidation threshold, the aToken balance and the oracle
// price. The output never contains an account address.

import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, parseAbiItem, type Address } from "viem";
import { mainnet } from "viem/chains";

const RPC = process.env.ETH_RPC;
if (!RPC) throw new Error("Set ETH_RPC to an Ethereum JSON-RPC URL, for example https://ethereum-rpc.publicnode.com");

// Aave V3 Ethereum, verified on-chain: PoolAddressesProvider.getPool() returns POOL.
const ADDRESSES_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e" as const;
const POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as const;

const providerAbi = parseAbi([
  "function getPool() view returns (address)",
  "function getPriceOracle() view returns (address)",
  "function getPoolDataProvider() view returns (address)",
]);
const poolAbi = parseAbi([
  "function getReservesList() view returns (address[])",
  "function getUserEMode(address user) view returns (uint256)",
  "function getUserConfiguration(address user) view returns ((uint256 data))",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);
const dataAbi = parseAbi([
  "function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
  "function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
]);
const oracleAbi = parseAbi([
  "function getAssetPrice(address asset) view returns (uint256)",
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
]);
const erc20Abi = parseAbi(["function symbol() view returns (string)"]);
const borrowEvent = parseAbiItem(
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
);

const i = process.argv.indexOf("--cases");
const want = i > 0 ? Number(process.argv[i + 1]) : 8;
const given = [
  ...process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)),
  ...(process.env.AAVE_ADDRESSES ?? "").split(",").filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a.trim())),
].map((a) => a.trim() as Address);

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC, { timeout: 20_000, retryCount: 2 }),
  batch: { multicall: true },
});
const block = await client.getBlockNumber();
const at = { blockNumber: block };
const { timestamp } = await client.getBlock({ blockNumber: block });

const pool = await client.readContract({
  address: ADDRESSES_PROVIDER,
  abi: providerAbi,
  functionName: "getPool",
  ...at,
});
if (pool.toLowerCase() !== POOL.toLowerCase())
  throw new Error(`PoolAddressesProvider returned an unexpected pool ${pool}`);
const [oracle, dataProvider, reserves] = await Promise.all([
  client.readContract({ address: ADDRESSES_PROVIDER, abi: providerAbi, functionName: "getPriceOracle", ...at }),
  client.readContract({ address: ADDRESSES_PROVIDER, abi: providerAbi, functionName: "getPoolDataProvider", ...at }),
  client.readContract({ address: POOL, abi: poolAbi, functionName: "getReservesList", ...at }),
]);
const unit = await client.readContract({ address: oracle, abi: oracleAbi, functionName: "BASE_CURRENCY_UNIT", ...at });

let users = given;
if (!users.length) {
  const seen = new Set<Address>();
  for (let to = block, step = 0; step < 20 && seen.size < 400; step++) {
    const from = to - 999n;
    const logs = await client
      .getLogs({ address: POOL, event: borrowEvent, fromBlock: from, toBlock: to })
      .catch(() => []);
    for (const l of logs) if (l.args.onBehalfOf) seen.add(l.args.onBehalfOf);
    to = from - 1n;
  }
  users = [...seen];
}
console.error(`block ${block}, ${users.length} accounts`);

const bits = (data: bigint) => {
  const collateral: number[] = [];
  const borrowing: number[] = [];
  for (let r = 0; r < reserves.length; r++) {
    if ((data >> BigInt(2 * r)) & 1n) borrowing.push(r);
    if ((data >> BigInt(2 * r + 1)) & 1n) collateral.push(r);
  }
  return { collateral, borrowing };
};

const cases: unknown[] = [];
const perPair = new Map<string, number>();
for (const user of users) {
  if (cases.length >= want) break;
  const [emode, config] = await Promise.all([
    client.readContract({ address: POOL, abi: poolAbi, functionName: "getUserEMode", args: [user], ...at }),
    client.readContract({ address: POOL, abi: poolAbi, functionName: "getUserConfiguration", args: [user], ...at }),
  ]);
  if (emode !== 0n) continue;
  const b = bits(config.data);
  if (b.collateral.length !== 1 || b.borrowing.length !== 1 || b.collateral[0] === b.borrowing[0]) continue;
  const collAsset = reserves[b.collateral[0]!]!;
  const debtAsset = reserves[b.borrowing[0]!]!;
  const [account, conf, reserveData, price, collSymbol, debtSymbol] = await Promise.all([
    client.readContract({ address: POOL, abi: poolAbi, functionName: "getUserAccountData", args: [user], ...at }),
    client.readContract({
      address: dataProvider,
      abi: dataAbi,
      functionName: "getReserveConfigurationData",
      args: [collAsset],
      ...at,
    }),
    client.readContract({
      address: dataProvider,
      abi: dataAbi,
      functionName: "getUserReserveData",
      args: [collAsset, user],
      ...at,
    }),
    client.readContract({ address: oracle, abi: oracleAbi, functionName: "getAssetPrice", args: [collAsset], ...at }),
    client.readContract({ address: collAsset, abi: erc20Abi, functionName: "symbol", ...at }).catch(() => "?"),
    client.readContract({ address: debtAsset, abi: erc20Abi, functionName: "symbol", ...at }).catch(() => "?"),
  ]);
  const [totalCollateralBase, totalDebtBase, , , , healthFactor] = account;
  if (totalDebtBase === 0n || reserveData[0] === 0n) continue;
  const pair = `${collSymbol}/${debtSymbol}`;
  if ((perPair.get(pair) ?? 0) >= 2) continue;
  perPair.set(pair, (perPair.get(pair) ?? 0) + 1);
  cases.push({
    id: `aave-eth-${String(cases.length + 1).padStart(4, "0")}`,
    recordedAt: new Date(Number(timestamp) * 1000).toISOString(),
    block: Number(block),
    source: {
      calls: [
        "Pool.getUserAccountData",
        "PoolDataProvider.getReserveConfigurationData",
        "PoolDataProvider.getUserReserveData",
        "AaveOracle.getAssetPrice",
      ],
    },
    pair,
    input: {
      collateralBalance: reserveData[0].toString(),
      collateralDecimals: Number(conf[0]),
      collateralPrice: price.toString(),
      baseCurrencyUnit: unit.toString(),
      liquidationThreshold: conf[2].toString(),
      totalDebtBase: totalDebtBase.toString(),
    },
    expected: { totalCollateralBase: totalCollateralBase.toString(), healthFactor: healthFactor.toString() },
    tolerance: { relative: 1e-9 },
  });
}

writeFileSync(
  new URL("../vectors/aave-v3-ethereum.json", import.meta.url),
  JSON.stringify(
    {
      schema: 1,
      venue: "aave-v3",
      model: "standard",
      recordedWith: "scripts/record-aave.ts",
      description:
        "Aave V3 Ethereum (Pool 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2), standard mode, one collateral and one debt reserve. Expected values are getUserAccountData at the recorded block: totalCollateralBase in base currency units, healthFactor scaled by 1e18.",
      cases,
    },
    null,
    2,
  ) + "\n",
);
console.error(`aave cases: ${cases.length}`);
