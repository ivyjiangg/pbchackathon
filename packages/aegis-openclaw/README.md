# aegis-openclaw

**Optional / auxiliary.** The **agentic-economy** arc assumes an agent’s outbound HTTP eventually goes through Aegis (same as this folder describes for OpenClaw). For the **hackathon demo** we did not ship a running OpenClaw gateway; the **x402 + proxy + Electron** path in the repo root README is what we validated end-to-end. Use this package when you **do** attach an agent—**OpenClaw** or otherwise—to the same proxy.

Templates for running [OpenClaw](https://github.com/openclaw/openclaw) with HTTP(S) traffic routed through **Aegis** (`127.0.0.1:8080`). Nothing here installs OpenClaw; use the official CLI (`openclaw onboard`, `openclaw gateway run`).

**Full demo runbook (x402-focused):** [docs/demo-agent.md](../../docs/demo-agent.md).

## Files

| File | Purpose |
| --- | --- |
| [openclaw.json5.example](./openclaw.json5.example) | Merge into `~/.openclaw/openclaw.json`: `network.proxy` and a **narrow** `network.noProxy` list. |
| [prompts/premium-report.md](./prompts/premium-report.md) | Demo user prompt to fetch the premium report. |
| [prompts/policy-block.md](./prompts/policy-block.md) | Demo guardrail prompt expecting proxy policy denial (403). |

## Merge steps

1. Install the OpenClaw CLI and complete onboarding if needed.
2. Copy the `network` block from `openclaw.json5.example` into your real config (or use the Raw JSON editor in the Control UI at `http://127.0.0.1:18789`).
3. Edit `network.noProxy` to list every **model provider host** you use (Anthropic, OpenAI, OpenRouter, Groq, etc.). Do **not** use a blanket `127.0.0.1` / `localhost` entry there, or traffic to the premium API on `:9090` will bypass Aegis.

## If the gateway ignores `network.proxy`

OpenClaw also loads env from `~/.openclaw/.env` and the process environment. You can try (non-destructive precedence applies):

```bash
export HTTP_PROXY=http://127.0.0.1:8080
export HTTPS_PROXY=http://127.0.0.1:8080
export NO_PROXY=api.anthropic.com,api.openai.com,127.0.0.1:18789
```

See [Environment](https://docs.openclaw.ai/help/environment) for precedence.

## Start order for demos

Check CLI install first:

```bash
openclaw --version
```

If that fails, install OpenClaw CLI before running the flow.

1. `npm run start:aegis` (repo root)
2. `export AEGIS_PRIVATE_KEY_BASE58=...` and `npm run start:premium-api`
3. `openclaw gateway run` (or your team’s documented command)

## E2E runbook (success + guardrail)

1. Merge [`openclaw.json5.example`](./openclaw.json5.example) into `~/.openclaw/openclaw.json`.
2. Start proxy + premium API using the order above.
3. Run prompt [`prompts/premium-report.md`](./prompts/premium-report.md) and expect premium JSON (or 402 if wallet is unfunded).
4. Run prompt [`prompts/policy-block.md`](./prompts/policy-block.md) and expect 403 policy denial.
