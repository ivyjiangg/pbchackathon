/**
 * Judge-facing demo narrative: blocked vs allowed vs x402 PAYMENT-SIGNATURE path.
 * Requires local stack already running (Electron "Start" or manual proxy+premium).
 *
 * Usage:
 *   node scripts/demo-agent-flow.mjs
 *   AEGIS_PROXY_PORT=18080 AEGIS_PREMIUM_PORT=19090 node scripts/demo-agent-flow.mjs
 *
 * Env:
 *   AEGIS_PROXY_HOST (default 127.0.0.1)
 *   AEGIS_PROXY_PORT (default 8080)
 *   AEGIS_PREMIUM_PORT (default 9090)
 */

import { execFileSync } from "child_process";
import { unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const host = process.env.AEGIS_PROXY_HOST || "127.0.0.1";
const proxyPort = String(process.env.AEGIS_PROXY_PORT || "8080");
const premiumPort = String(process.env.AEGIS_PREMIUM_PORT || "9090");

const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";

function curl(args, label) {
  try {
    const out = execFileSync("curl", args, {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return out.trim();
  } catch (e) {
    console.error(`\n[${label}] curl failed:`, e.message);
    throw e;
  }
}

function banner(title) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

async function main() {
  console.log("Aegis end-to-end demo (proxy + premium must be running)\n");
  console.log(`Proxy:  http://${host}:${proxyPort}`);
  console.log(`Premium: http://${host}:${premiumPort}`);

  banner("1) Blocked — host not whitelisted (expect 403)");
  const blockedUrl = `http://${host}:${proxyPort}/`;
  const code1 = curl(
    [
      "-sS",
      "-o",
      nullDevice,
      "-w",
      "%{http_code}",
      "-H",
      "x-aegis-target: https://blocked.invalid/",
      blockedUrl,
    ],
    "blocked",
  );
  console.log(`x-aegis-target → https://blocked.invalid/  → HTTP ${code1}`);
  if (code1 !== "403") {
    console.warn("Expected 403 (policy denied / not whitelisted). Check ~/.aegis/proxy-policy.json whitelist.");
  } else {
    console.log("OK — proxy blocked before forward. Check Activity tab: blocked_not_whitelisted.");
  }

  banner("2) Allowed — forward to premium /health (expect 200)");
  const healthTarget = `http://${host}:${premiumPort}/health`;
  const code2 = curl(
    [
      "-sS",
      "-o",
      nullDevice,
      "-w",
      "%{http_code}",
      "-H",
      `x-aegis-target: ${healthTarget}`,
      blockedUrl,
    ],
    "health",
  );
  console.log(`x-aegis-target → ${healthTarget} → HTTP ${code2}`);
  if (code2 === "200") {
    console.log("OK — forwarded. Activity tab: forwarded.");
  } else {
    console.warn(`Expected 200; got ${code2}. Whitelist must include 127.0.0.1 or localhost.`);
  }

  banner("3) x402 — proxy intercepts 402, signs, retries with PAYMENT-SIGNATURE");
  const premiumReport = `http://${host}:${premiumPort}/v1/macro/premium-report`;
  const bodyPath = join(homedir(), `.aegis-demo-body-${Date.now()}.txt`);
  let code3;
  try {
    code3 = curl(
      [
        "-sS",
        "-o",
        bodyPath,
        "-w",
        "%{http_code}",
        "-x",
        `http://${host}:${proxyPort}`,
        premiumReport,
      ],
      "x402",
    );
  } finally {
    try {
      unlinkSync(bodyPath);
    } catch {
      /* ignore */
    }
  }
  console.log(`curl -x proxy ${premiumReport}`);
  console.log(`→ HTTP ${code3}`);
  if (code3 === "200") {
    console.log("OK — paid path succeeded. Activity: paid_success. Overview proxy counts update.");
  } else if (code3 === "402") {
    console.log(
      "Proxy signed and retried; upstream still 402 (common if devnet USDC/facilitator not settled). Activity may show payment_retry_non_200.",
    );
  } else if (code3 === "403") {
    console.log("403 — policy denied (whitelist, per-tx cap, or daily budget). Check Activity: policy_denied.");
  } else {
    console.warn(`Unexpected status ${code3}. See proxy logs in the app.`);
  }

  banner("4) Spend caps — how to show in the UI");
  console.log(
    "Daily / per-tx limits for x402 live in ~/.aegis/proxy-policy.json (sync from Policy tab).",
  );
  console.log(
    "Lower Daily Budget (USDC) or Per-Transaction Limit, Save Policy, then repeat step 3 until you get HTTP 403.",
  );
  console.log(
    "Watch Activity for policy_denied and Overview for proxy activity (today).",
  );
  console.log(
    "\nOn HTTP 402 the proxy injects x402 PAYMENT-SIGNATURE (Solana payment auth), not arbitrary site API keys.",
  );

  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
