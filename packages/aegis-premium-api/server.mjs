import express from "express";
import { Keypair } from "@solana/web3.js";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer } from "@x402/core/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import bs58 from "bs58";

/** Devnet CAIP-2 id (matches @x402/svm + x402 facilitator `supported` for SVM / exact). */
const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const PORT = Number(process.env.PORT || 9090);
const HOST = process.env.HOST || "127.0.0.1";

/**
 * Recipient for USDC (exact scheme). Defaults to the public key of AEGIS_PRIVATE_KEY_BASE58
 * so local demos can "pay yourself" on devnet with the same wallet as the proxy.
 */
function resolvePayTo() {
  if (process.env.X402_PAY_TO) return process.env.X402_PAY_TO.trim();
  if (process.env.AEGIS_PRIVATE_KEY_BASE58) {
    const sk = bs58.decode(process.env.AEGIS_PRIVATE_KEY_BASE58);
    return Keypair.fromSecretKey(sk).publicKey.toBase58();
  }
  throw new Error(
    "[aegis-premium-api] Set X402_PAY_TO (Solana address) or AEGIS_PRIVATE_KEY_BASE58 so payTo is defined.",
  );
}

const price = process.env.PREMIUM_REPORT_PRICE || "$0.50";

const routes = {
  "GET /v1/macro/premium-report": {
    accepts: [
      {
        scheme: "exact",
        network: SOLANA_DEVNET,
        price,
        payTo: resolvePayTo(),
        maxTimeoutSeconds: 600,
      },
    ],
  },
};

const resourceServer = new x402ResourceServer();
registerExactSvmScheme(resourceServer, { networks: [SOLANA_DEVNET] });

const app = express();
app.set("trust proxy", true);
app.use(express.json());

app.use(paymentMiddleware(routes, resourceServer));

app.get("/v1/macro/premium-report", (req, res) => {
  res.json({
    title: "Premium macroeconomic outlook",
    period: "2026-Q1",
    summary: "Report snapshot: growth stable, inflation cooling in demo scenario.",
    source: "aegis-premium-api",
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aegis-premium-api" });
});

app.listen(PORT, HOST, () => {
  console.log(`[aegis-premium-api] Listening on http://${HOST}:${PORT}`);
  console.log(`[aegis-premium-api] Protected: GET /v1/macro/premium-report | price=${price}`);
});
