# Demo runbook: x402 first (proxy + premium API)

**Agentic economy context:** The product direction is **agents operating under policy** with **machine-readable payments** (HTTP 402 / x402), not just static APIs. This hackathon build **emphasizes that payment and policy layer** even though a full **OpenClaw**-style agent was not brought up in time—so judges should treat **x402 + proxy + caps** as the shipped vertical slice, with a live agent as a natural follow-on over the same HTTP proxy.

**Focus:** Prove **HTTP 402 → PAYMENT-SIGNATURE retry → 200/402** through **Aegis proxy**, plus URL policy and spend caps.

The **Electron app** (`npm start`), **`npm run demo-agent-flow`**, and **`npm test`** all exercise the same proxy + premium stack.

## Agent demo chat window (optional UI)

From the main app top bar: **Agent demo chat** — a small scripted UI + **Probe URL** / **Run live checks** (real `curl` against the local stack). It is **not** required for the x402 story; use it if you want a chat-shaped demo without extra tooling.

## Prerequisites

1. **Electron app**: Provision a wallet (Policy tab can set whitelist/blacklist and budgets). **Starting the local stack from the app** passes the **provisioned** wallet secret to the proxy process only (in memory); you can still set `AEGIS_PRIVATE_KEY_BASE58` in `.env` if you are not provisioned. The app **always allowlists `127.0.0.1` and `localhost`** for the proxy (unless you blacklist them) so the local premium API on `:9090` is not accidentally blocked by an empty URL list.
2. **Devnet**: Fund the same pubkey with **SOL** (fees) and **devnet USDC** if you want a full **200** on the premium x402 route.
3. **Local stack running**: Overview → **Start** (proxy + premium API), or start both packages manually.

## Terminal demo script

From the repo root (same ports as the app, default **8080** / **9090**):

```bash
npm run demo:agent-flow
```

Custom ports:

```bash
AEGIS_PROXY_PORT=8080 AEGIS_PREMIUM_PORT=9090 npm run demo:agent-flow
```

The script runs: blocked URL (403) → allowed `/health` (200) → premium report through the proxy (200 or 402). It prints how to demo **spend caps** via Policy tab + repeats.

## Optional: routing another agent through the proxy

If you integrate a **separate** agent or gateway later, point its outbound HTTP at the Aegis proxy so the same **whitelist / x402 / caps** apply. [`packages/aegis-openclaw/proxies-env.example`](../packages/aegis-openclaw/proxies-env.example) is an example `HTTP_PROXY` / `NO_PROXY` pattern — **not** part of the core x402 demo.

## What “inject keys” means here

On **HTTP 402** with a valid **PAYMENT-REQUIRED** header, [`packages/aegis-proxy/proxy.js`](../packages/aegis-proxy/proxy.js) builds an x402 payment payload, signs with the configured Solana key, and **retries the request with payment authorization headers** (`PAYMENT-SIGNATURE`). It does **not** inject third-party API keys into arbitrary websites.

## Spend caps

Daily and per-transaction limits for that payment path are read from **`~/.aegis/proxy-policy.json`**, which the **Policy** tab updates when you save. After lowering the budget, repeat the premium request until the proxy returns **403** with `policy_denied`; confirm in **Activity** and **Overview** (proxy activity today).
