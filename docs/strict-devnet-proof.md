# Strict Devnet Proof (Track 1)

This checklist is for the **strict proof** requirement: at least one successful paid request returning `200` after x402 settlement.

## Prerequisites

- `AEGIS_PRIVATE_KEY_BASE58` points to a **funded devnet wallet**.
- Wallet has:
  - enough devnet SOL for fees
  - required SPL asset balance for payment requirements (typically devnet USDC for this setup)
- Premium API and proxy are aligned on devnet requirements.

## Command

From repo root:

```bash
export AEGIS_PRIVATE_KEY_BASE58="<funded-devnet-secret-base58>"
export AEGIS_SOLANA_NETWORK=devnet
npm run proof:devnet
```

Optional ports:

```bash
export STRICT_PROXY_PORT=8080
export STRICT_PREMIUM_PORT=9090
```

## Expected result

- Command exits `0`
- `docs/proofs/devnet-proof.json` is created
- JSON includes:
  - `"status": 200`
  - optional `paymentResponseHeader` (if returned by upstream)
  - response body preview for premium payload

## If status is not 200

- Check wallet funding (SOL + SPL asset).
- Check premium API payment amount and `payTo` configuration.
- Ensure proxy logs show `Intercepted 402` and retry path.
- Ensure devnet alignment on both sides (`AEGIS_SOLANA_NETWORK`/RPC and payment requirement network).
