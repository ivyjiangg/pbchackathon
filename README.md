# pbchackathon

Monorepo for the hackathon: **npm workspaces** under `packages/`. Install once at the repo root; each package keeps its own `package.json`.

### Vision: agentic economy

The broader goal is **agents that pay and operate inside policy**—HTTP traffic through a gateway, machine-readable payments (**x402**), spend caps, and URL guardrails. That is the “agentic economy” story this stack is meant to support.

### Hackathon scope (what we shipped)

We did **not** get an **OpenClaw** (or similar) agent gateway fully running in time for the hackathon, so the **demo and judge path focus on the x402 protocol end-to-end**: premium API → **402** → Aegis proxy → **PAYMENT-SIGNATURE** → policy / caps, plus the Electron shell for wallet + policy + activity. [`packages/aegis-openclaw/`](packages/aegis-openclaw/) remains **optional reference** (proxy env examples) for when an agent *does* sit in front of the same HTTP path.

## Repository layout

```
pbchackathon/
  package.json          # workspaces: packages/*
  packages/
    README.md           # package index
    aegis-proxy/        # Express x402 / Solana proxy (Dev 2)
    aegis-premium-api/     # Premium API :9090 (Dev 3)
    aegis-openclaw/     # Optional: external agent proxy env examples (not required for x402 demo)
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

## x402 demo stack (premium API + Aegis proxy)

**Primary hackathon story:** HTTP **402** from the premium API → Aegis proxy **intercepts**, signs with your Solana key, retries with **`PAYMENT-SIGNATURE`**, policy + spend caps in `~/.aegis/proxy-policy.json`. Prove it with **Electron** (local stack + Policy + Activity), **`npm run demo:agent-flow`**, or **`npm test`**.

### Packages

- **`aegis-premium-api`** — `GET /v1/macro/premium-report` on `127.0.0.1:9090`, protected with `@x402/express` and the **exact** SVM scheme on **Solana devnet** (network id `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`).
- **`aegis-proxy`** — HTTP proxy on `:8080`; x402 client flow, URL policy, daily/per-tx caps (see repo root README above).

### Commands

```bash
npm run start:aegis
export AEGIS_PRIVATE_KEY_BASE58="<same-as-proxy>"   # or set X402_PAY_TO on the premium API only
npm run start:premium-api
```

**Optional (not required for x402):** [`aegis-openclaw`](packages/aegis-openclaw/) has example `HTTP_PROXY` / `NO_PROXY` env and prompts if you later route an external agent through the same proxy.

### End-to-end HTTP check (curl / Electron)

```bash
curl -i http://127.0.0.1:9090/v1/macro/premium-report
curl -i -x http://127.0.0.1:8080 http://127.0.0.1:9090/v1/macro/premium-report
```

The second command should show Aegis logging a 402 intercept and attempting payment. A **200** response after payment requires a **devnet USDC–funded** wallet for the x402 facilitator flow (see [`packages/aegis-premium-api/README.md`](packages/aegis-premium-api/README.md)).

### Judge-ready demo (policy, agent, proxy, caps)

Full walkthrough: **[docs/demo-agent.md](docs/demo-agent.md)**. With the **local stack running** (Electron **Start** or manual processes):

```bash
npm run demo:agent-flow
```

Override ports if needed: `AEGIS_PROXY_PORT`, `AEGIS_PREMIUM_PORT`, `AEGIS_PROXY_HOST`.

**Electron:** When you start the stack from the app, the proxy child receives **`AEGIS_PRIVATE_KEY_BASE58` from your provisioned Shamir wallet** (reconstructed in the main process, not written to disk). If you are not provisioned, the proxy still uses `.env` / its dev fallback.

**Wording:** On HTTP **402**, the proxy injects **x402 `PAYMENT-SIGNATURE`** (Solana payment authorization), not arbitrary third-party API keys.

### Scripts

- `npm run start:premium-api` — premium API only.
- `npm run demo:stack` — prints suggested multi-terminal order for demos.
- **`npm test`** — automated smoke test: starts premium API + proxy on **random ports**, checks `/health`, direct **402** + `PAYMENT-REQUIRED`, **guardrail 403** on blocked host, and `curl -x` through the proxy (200 with premium JSON if devnet settlement succeeds, otherwise 402 is still treated as OK for CI). Override ports with `SMOKE_PREMIUM_PORT` / `SMOKE_PROXY_PORT` if needed.
- **`npm run proof:devnet`** — strict devnet proof runner. Requires funded wallet and writes evidence to `docs/proofs/devnet-proof.json`.
- **`npm run demo:agent-flow`** — narrated curl steps: blocked 403, allowed forward, premium x402 path; see [docs/demo-agent.md](docs/demo-agent.md).

The proxy listens on **`AEGIS_PROXY_PORT`** (default `8080`) and **`AEGIS_PROXY_HOST`** (default `127.0.0.1`).

### Acceptance criteria split

- **Demo-first pass**: `npm test` passes and shows both policy block (403) and payment path handling.
- **Strict devnet pass**: `npm run proof:devnet` returns `200` and writes evidence per [`docs/strict-devnet-proof.md`](docs/strict-devnet-proof.md).
