# aegis-premium-api

Express server on **port 9090** that protects `GET /v1/macro/premium-report` with the **x402** flow (`@x402/express` + `@x402/svm` exact scheme on **solana-devnet**).

## Prerequisites

- **X402_PAY_TO** — Solana address (base58) that should receive USDC for the resource, **or**
- **AEGIS_PRIVATE_KEY_BASE58** — if set, `payTo` defaults to that wallet’s public key (same as Aegis proxy; useful for local “pay yourself” demos).

Optional:

- **AEGIS_PREMIUM_REPORT_PRICE** — default `"$0.50"` (legacy alias: `PREMIUM_REPORT_PRICE`).
- **AEGIS_PREMIUM_API_PORT** (default `9090`) and **AEGIS_PREMIUM_API_HOST** (default `127.0.0.1`)  
  (legacy aliases: `PORT`, `HOST`).

## Run

From repo root (after `npm install`):

```bash
npm run start:premium-api
```

Or from this package:

```bash
npm start
```

## Manual checks

1. **402 without payment** (`GET` must reach the server directly; no `PAYMENT-SIGNATURE`):

```bash
curl -i http://127.0.0.1:9090/v1/macro/premium-report
```

Expect `402` and a `PAYMENT-REQUIRED` header.

2. **Through Aegis** (proxy on 8080 must be running and `config.json` must whitelist `127.0.0.1`):

```bash
curl -i -x http://127.0.0.1:8080 http://127.0.0.1:9090/v1/macro/premium-report
```

Expect `200` and JSON after the proxy signs and retries.

## Notes

- Settlement uses the facilitator configured by `@x402/core` (default HTTP facilitator). The signing wallet must have **enough devnet USDC** for the payment amount; otherwise verification/settlement can fail and you may see **402** with an empty JSON body on the paid retry.
- The Aegis proxy uses the **amount** in `accepts` (USDC base units, 6 decimals) for policy checks; keep `packages/aegis-proxy/config.json` daily budget above that amount. The field is still named `daily_budget_lamports` historically—treat it as the same numeric units as x402 `accepts[].amount`.
- Use **GET** for tests (`curl` without `-I`). `curl -I` sends **HEAD**, which is not configured as a paid route on the premium API server.
