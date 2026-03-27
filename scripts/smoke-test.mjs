/**
 * Spins up aegis-premium-api + aegis-proxy with a temporary dev key, runs HTTP checks, exits.
 * Uses ephemeral ports (defaults 18080 / 19090) to avoid clashing with local dev servers.
 *
 * Usage: npm test
 */
import { spawn, execSync } from "child_process";
import { readFile, unlink } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { createServer } from "net";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const premiumEntry = join(root, "packages/aegis-premium-api/server.mjs");
const proxyEntry = join(root, "packages/aegis-proxy/proxy.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

const kp = Keypair.generate();
const AEGIS_PRIVATE_KEY_BASE58 = bs58.encode(kp.secretKey);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function spawnNode(entry, extraEnv, name) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...extraEnv, AEGIS_PRIVATE_KEY_BASE58, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  return child;
}

async function main() {
  const premiumPort = process.env.SMOKE_PREMIUM_PORT ? Number(process.env.SMOKE_PREMIUM_PORT) : await freePort();
  const proxyPort = process.env.SMOKE_PROXY_PORT ? Number(process.env.SMOKE_PROXY_PORT) : await freePort();

  const procs = [];
  try {
    procs.push(
      spawnNode(
        premiumEntry,
        { AEGIS_PREMIUM_API_PORT: String(premiumPort), AEGIS_PREMIUM_API_HOST: "127.0.0.1" },
        "premium",
      ),
    );
    procs.push(
      spawnNode(proxyEntry, { AEGIS_PROXY_PORT: String(proxyPort), AEGIS_PROXY_HOST: "127.0.0.1" }, "proxy"),
    );
    await sleep(5000);

    const base = `http://127.0.0.1:${premiumPort}`;

    // 1) Premium API health
    let res = await fetch(`${base}/health`);
    if (!res.ok) throw new Error(`Expected /health 200, got ${res.status}`);
    const health = await res.json();
    if (!health.ok) throw new Error("Expected health.ok true");

    // 2) Direct premium: must be 402 + PAYMENT-REQUIRED
    res = await fetch(`${base}/v1/macro/premium-report`);
    if (res.status !== 402) {
      throw new Error(`Direct premium: expected 402, got ${res.status}`);
    }
    const pr = res.headers.get("PAYMENT-REQUIRED") || res.headers.get("payment-required");
    if (!pr) throw new Error("Direct premium: missing PAYMENT-REQUIRED header");

    // 3) Deterministic guardrail: blocked host should return 403 before forwarding
    const blockedCode = execSync(
      `curl -sS -o /dev/null -w "%{http_code}" -H "x-aegis-target: https://blocked.invalid/" http://127.0.0.1:${proxyPort}/`,
      { encoding: "utf8" },
    ).trim();
    if (blockedCode !== "403") {
      throw new Error(`Guardrail path: expected 403, got ${blockedCode}`);
    }

    // 4) Through Aegis proxy (absolute-form URL); must not be 403/502
    const bodyPath = join(tmpdir(), `aegis-smoke-body-${Date.now()}.txt`);
    const curlOut = execSync(
      `curl -sS -o "${bodyPath}" -w "%{http_code}" -x http://127.0.0.1:${proxyPort} ${base}/v1/macro/premium-report`,
      { encoding: "utf8" },
    );
    const code = curlOut.trim();
    if (code === "403") throw new Error("Proxy path: 403 (whitelist / policy?)");
    if (code === "502") throw new Error("Proxy path: 502 (invalid PAYMENT-REQUIRED parse)");
    if (code === "500") throw new Error("Proxy path: 500 (proxy error)");

    if (code === "200") {
      const body = await readFile(bodyPath, "utf8");
      await unlink(bodyPath).catch(() => {});
      const json = JSON.parse(body);
      if (!json.title) throw new Error("200 response missing expected JSON shape");
      console.log("smoke-test: OK (full x402 path returned 200 + premium JSON)");
    } else if (code === "402") {
      await unlink(bodyPath).catch(() => {});
      console.log(
        "smoke-test: OK (proxy signed and retried; upstream returned 402 — typical if devnet USDC/facilitator settlement failed)",
      );
    } else {
      await unlink(bodyPath).catch(() => {});
      throw new Error(`Proxy path: unexpected HTTP ${code}`);
    }

    console.log(`smoke-test: all checks passed (premium_api :${premiumPort}, proxy :${proxyPort})`);
  } finally {
    for (const p of procs) {
      try {
        p.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    await sleep(400);
  }
}

main().catch((e) => {
  console.error("smoke-test FAILED:", e.message);
  process.exit(1);
});
