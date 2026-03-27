/**
 * Strict devnet proof runner.
 *
 * Starts premium API + Aegis proxy, performs a paid request through proxy, and
 * writes evidence to docs/proofs/devnet-proof.json.
 *
 * Requires:
 * - AEGIS_PRIVATE_KEY_BASE58 (funded on devnet)
 * - Devnet-compatible premium API payment requirements
 */
import { spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const premiumEntry = join(root, "packages/aegis-premium-api/server.mjs");
const proxyEntry = join(root, "packages/aegis-proxy/proxy.js");
const proofOut = join(root, "docs/proofs/devnet-proof.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function spawnNode(entry, extraEnv, name) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  return child;
}

async function main() {
  if (!process.env.AEGIS_PRIVATE_KEY_BASE58) {
    throw new Error("Set AEGIS_PRIVATE_KEY_BASE58 to a funded devnet wallet before running.");
  }

  const premiumPort = Number(process.env.STRICT_PREMIUM_PORT || 9090);
  const proxyPort = Number(process.env.STRICT_PROXY_PORT || 8080);
  const procs = [];
  const startedAt = new Date().toISOString();

  try {
    procs.push(
      spawnNode(
        premiumEntry,
        {
          AEGIS_PREMIUM_API_PORT: String(premiumPort),
          AEGIS_PREMIUM_API_HOST: "127.0.0.1",
        },
        "premium",
      ),
    );
    procs.push(
      spawnNode(
        proxyEntry,
        {
          AEGIS_PROXY_PORT: String(proxyPort),
          AEGIS_PROXY_HOST: "127.0.0.1",
          AEGIS_SOLANA_NETWORK: process.env.AEGIS_SOLANA_NETWORK || "devnet",
        },
        "proxy",
      ),
    );

    await sleep(6000);

    const targetUrl = `http://127.0.0.1:${premiumPort}/v1/macro/premium-report`;
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
      headers: { "x-aegis-target": targetUrl },
    });

    const text = await res.text();
    const paymentResponseHeader =
      res.headers.get("PAYMENT-RESPONSE") || res.headers.get("payment-response");

    const evidence = {
      startedAt,
      finishedAt: new Date().toISOString(),
      proxyPort,
      premiumPort,
      targetUrl,
      status: res.status,
      paymentResponseHeader: paymentResponseHeader || null,
      bodyPreview: text.slice(0, 1000),
      notes:
        res.status === 200
          ? "Success path achieved."
          : "Non-200. Ensure wallet has devnet SOL + required SPL asset and facilitator/devnet alignment.",
    };

    await mkdir(join(root, "docs/proofs"), { recursive: true });
    await writeFile(proofOut, JSON.stringify(evidence, null, 2) + "\n", "utf8");

    if (res.status !== 200) {
      throw new Error(
        `Expected 200 for strict devnet proof, got ${res.status}. Evidence written to docs/proofs/devnet-proof.json`,
      );
    }

    console.log("strict-devnet-proof: success, evidence written to docs/proofs/devnet-proof.json");
  } finally {
    for (const p of procs) {
      try {
        p.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    await sleep(400);
  }
}

main().catch((e) => {
  console.error("strict-devnet-proof FAILED:", e.message);
  process.exit(1);
});

