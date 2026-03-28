# packages

This directory holds **npm workspace packages** for the hackathon. Each subfolder is an independent Node project with its own `package.json`.

| Package | Description |
| --- | --- |
| [aegis-proxy](./aegis-proxy/) | Express proxy for x402 / Solana HTTP 402 flows |
| [aegis-premium-api](./aegis-premium-api/) | Mock “Premium Data” API on `:9090` (`@x402/express` + devnet exact scheme) |
| [aegis-openclaw](./aegis-openclaw/) | **Optional** — example `HTTP_PROXY` / `NO_PROXY` for external agents (not required for the x402 + Electron demo) |

Teammates can add new packages as sibling folders (for example `packages/other-service/`) and register them in the root [package.json](../package.json) workspace list (`packages/*` already includes them).
