# pbchackathon

Monorepo for the hackathon: **npm workspaces** under `packages/`. Install once at the repo root; each package keeps its own `package.json`.

## Repository layout

```
pbchackathon/
  package.json          # workspaces: packages/*
  packages/
    README.md           # package index
    aegis-proxy/        # Express x402 / Solana proxy (this contributor)
      package.json
      proxy.js
      config.json
```

Teammates can add new folders under `packages/`; they are picked up automatically by `"workspaces": ["packages/*"]`.

## My contribution

**Aegis Proxy** (`packages/aegis-proxy`) - Express HTTP proxy for HTTP 402 x402 payment challenges on Solana (challenge-response, policy, `PAYMENT-SIGNATURE` retry).

## Aegis Proxy (x402 / Solana)

**Aegis Proxy** forwards requests to a target URL. When the upstream returns **HTTP 402 Payment Required**, it runs the [x402](https://docs.x402.org/) challenge-response flow on **Solana**: `PAYMENT-REQUIRED` parsing, `config.json` policy, signing via `@x402/core` and `@x402/svm`, retry with `PAYMENT-SIGNATURE`, and spend tracking only after a **200** on the retry.

### What it does

- Listens on **localhost:8080** (`127.0.0.1:8080`).
- Target URL from **`x-aegis-target`** or a path starting with `http://` or `https://`.
- Strips hop-by-hop headers; does not forward `x-aegis-target` upstream.
- On 402: logs `[Aegis Proxy] Intercepted 402 from <URL> | Cost: <Amount> | Status: Signing...` (no private keys).

### Getting the Aegis proxy running

From the **repository root**:

```bash
npm install
npm run start:aegis
```

Or from the package directory:

```bash
cd packages/aegis-proxy
npm install
npm start
```

(Installing at the root hoists dependencies for all workspaces.)

You should see: `[Aegis Proxy] Listening on http://127.0.0.1:8080`.

**Listen address:** set `PORT` (default `8080`) and `HOST` (default `127.0.0.1`) if you need a different bind address or to avoid port conflicts.

**Optional:** `AEGIS_PRIVATE_KEY_BASE58` - base58 Solana secret for signing. If unset, a dev keypair is generated.

```bash
export AEGIS_PRIVATE_KEY_BASE58="<your-base58-secret-key>"
npm run start:aegis
```

### Devnet (local proxy)

Run the proxy on your machine while using **Solana devnet** for RPC and signing:

| Variable | Purpose |
| --- | --- |
| `AEGIS_SOLANA_NETWORK` | Cluster preset for the default RPC URL. **`devnet`** if unset (good for local hackathon work). Also accepts `mainnet-beta`, `testnet`. |
| `AEGIS_SOLANA_RPC_URL` | Optional full RPC URL; **overrides** `AEGIS_SOLANA_NETWORK` when set (e.g. Helius/QuickNode devnet). |

On startup the proxy logs `Solana RPC: <url>` so you can confirm devnet (default `https://api.devnet.solana.com`).

**Wallet funding (devnet)**

1. Set `AEGIS_PRIVATE_KEY_BASE58` to a **devnet** payer keypair (or accept the auto-generated key for throwaway tests and fund that pubkey).
2. Airdrop **devnet SOL** (faucet) so the wallet can pay fees.
3. Hold **devnet USDC** (or whatever SPL asset the merchant requests) for the **mint** in the upstream `PAYMENT-REQUIRED` response. Mint addresses differ by network; use the merchant or x402 docs for devnet USDC.

**Upstream must match devnet**

The **target API** behind `x-aegis-target` must return a 402 whose payment requirements use **devnet** (network field / CAIP-2 for devnet). If the server advertises **mainnet**, the client flow targets mainnet even if your RPC URL is devnet. Align merchant and payer on the same cluster.

**Whitelist**

Add that API's **hostname** to [`packages/aegis-proxy/config.json`](packages/aegis-proxy/config.json) `whitelist`.

### Smoke tests

From the repo root:

```bash
npm run test:smoke
```

(equivalent: `npm run test:smoke -w aegis-proxy`.)

This verifies syntax, rejects invalid `AEGIS_SOLANA_NETWORK`, returns **400** without a target, forwards to a **local HTTP** stub when whitelisted, returns **403** for a non-whitelisted host, and starts with an explicit `AEGIS_SOLANA_RPC_URL`. It does **not** run a full **HTTP 402** x402 payment (that needs a funded devnet wallet and a merchant that returns `PAYMENT-REQUIRED` on devnet).

### Configuration

Edit [`packages/aegis-proxy/config.json`](packages/aegis-proxy/config.json): `whitelist`, `daily_budget_lamports`, `spent_today`, `last_reset_date` (see package folder for semantics).

### Calling the proxy

```http
GET / HTTP/1.1
Host: 127.0.0.1:8080
x-aegis-target: https://api.example.com/v1/resource
```

### Stack (aegis-proxy)

express, axios, @solana/web3.js, @solana/kit, @x402/core, @x402/svm, bs58. Solana x402 uses **`@x402/svm`**, not `@x402/solana`.
