# pbchackathon

Monorepo for the hackathon: **npm workspaces** under `packages/`. Install once at the repo root; each package keeps its own `package.json`.

## Repository layout

```
pbchackathon/
  package.json          # workspaces: packages/*
  packages/
    README.md           # package index
    aegis-proxy/        # Express x402 / Solana proxy (Dev 2)
    aegis-premium-api/     # Premium API :9090 (Dev 3)
    aegis-openclaw/     # OpenClaw templates + prompts (Dev 3)
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

**Optional:** `AEGIS_PRIVATE_KEY_BASE58` - base58 Solana secret for signing. If unset, a dev keypair is generated.

```bash
export AEGIS_PRIVATE_KEY_BASE58="<your-base58-secret-key>"
npm run start:aegis
```

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

## Person 3 (premium API + OpenClaw)

**Scoped to Track 1 / demo plumbing** — not the full PRD V2 (Squads, HITL, program-ID blocks); those stay with other teammates.

### Packages

- **`aegis-premium-api`** — `GET /v1/macro/premium-report` on `127.0.0.1:9090`, protected with `@x402/express` and the **exact** SVM scheme on **Solana devnet** (network id `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`).
- **`aegis-openclaw`** — Example `network.proxy` → `http://127.0.0.1:8080`, narrow `network.noProxy` for LLM hosts, and a demo prompt under `prompts/`.

### Commands

```bash
npm run start:aegis
export AEGIS_PRIVATE_KEY_BASE58="<same-as-proxy>"   # or set X402_PAY_TO on the premium API only
npm run start:premium-api
```

OpenClaw: merge [`packages/aegis-openclaw/openclaw.json5.example`](packages/aegis-openclaw/openclaw.json5.example) into `~/.openclaw/openclaw.json` and follow [`packages/aegis-openclaw/README.md`](packages/aegis-openclaw/README.md).

### End-to-end HTTP check (no OpenClaw)

```bash
curl -i http://127.0.0.1:9090/v1/macro/premium-report
curl -i -x http://127.0.0.1:8080 http://127.0.0.1:9090/v1/macro/premium-report
```

The second command should show Aegis logging a 402 intercept and attempting payment. A **200** response after payment requires a **devnet USDC–funded** wallet for the x402 facilitator flow (see [`packages/aegis-premium-api/README.md`](packages/aegis-premium-api/README.md)).

### Scripts

- `npm run start:premium-api` — premium API only.
- `npm run demo:stack` — prints suggested multi-terminal order for demos.
- **`npm test`** — automated smoke test: starts premium API + proxy on **random ports**, checks `/health`, direct **402** + `PAYMENT-REQUIRED`, and `curl -x` through the proxy (200 with premium JSON if devnet settlement succeeds, otherwise 402 is still treated as OK for CI). Override ports with `SMOKE_PREMIUM_PORT` / `SMOKE_PROXY_PORT` if needed.

The proxy listens on **`AEGIS_PROXY_PORT`** (default `8080`) and **`AEGIS_PROXY_HOST`** (default `127.0.0.1`).
