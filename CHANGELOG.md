# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses semantic versioning.

## [0.1.0] - 2026-10-18

### Added

- Hyperliquid margin tiers with the maintenance deduction: `tiersFor`, `tierAt`.
- Hyperliquid isolated liquidation price: `liqPrice`, `liqPriceFromState`, the inverse `marginForLiq`, and
  `roundSize`.
- Hyperliquid cross-margin liquidation price `crossLiqPrice`, checked for single-position accounts without
  spot balances.
- Aave V3 standard mode: `loanStats`, `healthFactor`.
- Morpho Blue: `morphoLoanStats`, `sharesToAssetsUp`, `accrueBorrowAssets`, `wTaylorCompounded`,
  `oraclePrice`.
- Golden vectors recorded from live venue data on 2026-10-18: 24 Hyperliquid isolated, 7 Hyperliquid cross,
  8 Aave V3 Ethereum, 6 Morpho Blue Ethereum. Recorders in `scripts/`.
- `runVectors` and `evaluators` for checking any implementation against the vector files.
