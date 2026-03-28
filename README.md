# Aegis

**Aegis** is an HTTP gateway for **agent traffic** that combines **x402** (HTTP `402 Payment Required`) with **Solana**-based settlement, **policy enforcement** (URLs, spend caps, recipient rules), and a **Shamir-sharded wallet** so automation can pay for resources under human-defined limits.

The stack is a **monorepo** with **npm workspaces** under `packages/`. Install dependencies once at the repository root.

---

## Why it exists

Autonomous systems need the same web everyone else uses—but **payments and risk** have to be explicit. Aegis treats **machine-readable payment challenges** as part of the HTTP layer: when a service responds with **402** and a **PAYMENT-REQUIRED** payload, the proxy can **authorize and retry** with **x402 `PAYMENT-SIGNATURE`**, subject to policy. **Solana** (e.g. SPL USDC on devnet or mainnet-aligned flows) provides the signing and settlement surface used by the **x402 SVM** integration.

---

## Architecture

| Layer | Role |
| --- | --- |
| **Aegis Proxy** | Local HTTP proxy: forwards requests, intercepts **402**, runs the x402 client flow (`@x402/core`, `@x402/svm`), applies **whitelist / blacklist / keyword / payTo** rules and **spend caps**, retries with **`PAYMENT-SIGNATURE`**. |
| **Premium API** | Reference **x402-protected** Express service (`@x402/express`): a paid route demonstrates **402 → payment → 200** without a separate billing product. |
| **Electron app** | **Wallet provisioning**, **policy editing** (synced to `~/.aegis/proxy-policy.json`), **local stack** control, and **activity** visibility. |
| **Agent Demo** | Optional window to **probe URLs** and **run checks** against the local proxy and premium API (same HTTP paths as any client using `x-aegis-target`). |

**Optional integration:** [`packages/aegis-openclaw/`](packages/aegis-openclaw/) documents routing external agent traffic through the same proxy (`HTTP_PROXY` / `NO_PROXY` patterns).

---

## Repository layout

```
pbchackathon/
  package.json              # workspaces: packages/*
  main.js / index.html      # Electron shell
  agent-demo.html           # optional probe / checks UI
  packages/
    aegis-proxy/            # x402-aware HTTP proxy
    aegis-premium-api/      # x402-protected premium route (:9090)
    aegis-openclaw/         # optional proxy env examples for agents
```

New packages under `packages/` are included automatically via `"workspaces": ["packages/*"]`.

---

## Security model

- **Private keys are not stored whole** in one place. The wallet is implemented with **Shamir secret sharing** (three shares: OS keychain, AES-encrypted file, recovery material).
- The proxy receives signing material **only in memory** when a signature is required; reconstruction follows the app’s provisioning path.
- On **402**, Aegis adds **x402 payment authorization** (`PAYMENT-SIGNATURE`)—not arbitrary third-party API keys injected into unrelated sites.

---

## Quick start

### Prerequisites

- Node.js compatible with the repo’s `package.json`
- For full **402 → paid retry → 200** on devnet: a **funded devnet** wallet (SOL for fees, USDC per the asset in the merchant’s `PAYMENT-REQUIRED` payload)

### Install

```bash
npm install
```

### Run the desktop app (recommended)

```bash
npm start
```

From **Overview**, provision a wallet if needed, configure **Policy**, and **Start** the local stack (proxy + premium API). The proxy loads policy from disk and uses the provisioned signing path when configured.

### Run services from the terminal

**Proxy** (default `127.0.0.1:8080`):

```bash
npm run start:aegis
```

**Premium API** (default `:9090`; set `AEGIS_PRIVATE_KEY_BASE58` / `X402_PAY_TO` as documented in [`packages/aegis-premium-api/README.md`](packages/aegis-premium-api/README.md)):

```bash
npm run start:premium-api
```

You should see the proxy listening, e.g. `[Aegis Proxy] Listening on http://127.0.0.1:8080`.

**Environment:** `PORT`, `HOST`, `AEGIS_PRIVATE_KEY_BASE58`, `AEGIS_SOLANA_NETWORK` (default **devnet**), `AEGIS_SOLANA_RPC_URL`. On startup the proxy logs the Solana RPC in use.

---

## Aegis Proxy (technical summary)

**Aegis Proxy** forwards to the URL given by **`x-aegis-target`** (or an absolute URL path). It strips hop-by-hop headers and does not forward `x-aegis-target` upstream.

On **HTTP 402**, it executes the [x402](https://docs.x402.org/) flow on **Solana**: parse **`PAYMENT-REQUIRED`**, enforce policy from `config.json` / synced policy file, sign via **`@x402/core`** and **`@x402/svm`**, **retry** with **`PAYMENT-SIGNATURE`**, and track spend when the retried request succeeds appropriately.

**Calling the proxy:**

```http
GET / HTTP/1.1
Host: 127.0.0.1:8080
x-aegis-target: https://api.example.com/v1/resource
```

**Configuration:** [`packages/aegis-proxy/config.json`](packages/aegis-proxy/config.json) — whitelist, budgets, etc. The Electron **Policy** tab updates **`~/.aegis/proxy-policy.json`** for enforcement behavior (restart stack after policy saves as documented in-app).

**Dependencies:** express, axios, @solana/web3.js, @solana/kit, @x402/core, @x402/svm, bs58. Solana x402 uses **`@x402/svm`**.

---

## End-to-end verification

**Automated agent flow** (blocked URL → allowed forward → premium x402 route):

```bash
npm run demo:agent-flow
```

Ports: `AEGIS_PROXY_PORT`, `AEGIS_PREMIUM_PORT`, `AEGIS_PROXY_HOST` if needed.

**Smoke test** (policy + HTTP behavior on configurable ports):

```bash
npm run test:smoke
```

**Strict devnet proof** (funded wallet; writes evidence to `docs/proofs/devnet-proof.json`):

```bash
npm run proof:devnet
```

**Full demo walkthrough:** [docs/demo-agent.md](docs/demo-agent.md).

**Example curls:**

```bash
curl -i http://127.0.0.1:9090/v1/macro/premium-report
curl -i -x http://127.0.0.1:8080 http://127.0.0.1:9090/v1/macro/premium-report
```

A **200** after payment requires a wallet funded for the **devnet** asset and facilitator expectations described in the premium API README. Align **merchant network** (e.g. CAIP-2 / devnet) with the payer’s cluster.

---

## NPM scripts (root)

| Script | Purpose |
| --- | --- |
| `npm start` | Electron application |
| `npm run start:aegis` | Aegis proxy only |
| `npm run start:premium-api` | Premium API only |
| `npm test` | Integration test: premium + proxy on ephemeral ports, health, 402 path, guardrails |
| `npm run test:smoke` | Proxy smoke checks |
| `npm run demo:agent-flow` | Multi-step HTTP demo |
| `npm run proof:devnet` | Strict devnet proof runner |
| `npm run demo:stack` | Prints suggested multi-terminal startup order |

---

## Acceptance criteria

- **CI / integration:** `npm test` exercises policy rejection, 402 handling, and proxy forwarding.
- **Strict devnet:** `npm run proof:devnet` produces a **200** and updates `docs/proofs/devnet-proof.json` per [docs/strict-devnet-proof.md](docs/strict-devnet-proof.md) when the wallet and network are configured.
