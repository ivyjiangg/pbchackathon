# aegis-openclaw

Templates for running [OpenClaw](https://github.com/openclaw/openclaw) with HTTP(S) traffic routed through **Aegis** (`127.0.0.1:8080`). Nothing here installs OpenClaw; use the official CLI (`openclaw onboard`, `openclaw gateway run`).

## Files

| File | Purpose |
| --- | --- |
| [openclaw.json5.example](./openclaw.json5.example) | Merge into `~/.openclaw/openclaw.json`: `network.proxy` and a **narrow** `network.noProxy` list. |
| [prompts/premium-report.md](./prompts/premium-report.md) | Demo user prompt to fetch the premium report. |

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

1. `npm run start:aegis` (repo root)
2. `export AEGIS_PRIVATE_KEY_BASE58=...` and `npm run start:premium-api`
3. `openclaw gateway run` (or your team’s documented command)
