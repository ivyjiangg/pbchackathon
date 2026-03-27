import express from "express";
import axios from "axios";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Keypair } from "@solana/web3.js";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
import bs58 from "bs58";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "config.json");
const PORT = Number(process.env.AEGIS_PROXY_PORT || 8080);
const HOST = process.env.AEGIS_PROXY_HOST || "127.0.0.1";

const HOP_BY_HOP_REQ = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "x-aegis-target",
]);

const HOP_BY_HOP_RES = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

let configWriteChain = Promise.resolve();

function withConfigLock(fn) {
  const run = configWriteChain.then(fn);
  configWriteChain = run.catch(() => {});
  return run;
}

let cachedX402HttpClient;
let cachedSignerKeypair;

/**
 * Mock key retrieval: prefers AEGIS_PRIVATE_KEY_BASE58; otherwise a stable dev Keypair.
 * Never log the secret key material.
 */
async function getKey() {
  if (process.env.AEGIS_PRIVATE_KEY_BASE58) {
    const sk = bs58.decode(process.env.AEGIS_PRIVATE_KEY_BASE58);
    return Keypair.fromSecretKey(sk);
  }
  if (!cachedSignerKeypair) {
    cachedSignerKeypair = Keypair.generate();
  }
  return cachedSignerKeypair;
}

async function getX402HttpClient() {
  if (cachedX402HttpClient) return cachedX402HttpClient;
  const kp = await getKey();
  const svmSigner = toClientSvmSigner(await createKeyPairSignerFromBytes(kp.secretKey));
  const core = new x402Client().register("solana:*", new ExactSvmScheme(svmSigner));
  cachedX402HttpClient = new x402HTTPClient(core);
  return cachedX402HttpClient;
}

function resolveTargetUrl(req) {
  const rawHeader = req.headers["x-aegis-target"];
  if (rawHeader) {
    const s = String(rawHeader).trim();
    try {
      return new URL(s).href;
    } catch {
      return null;
    }
  }
  // HTTP proxy clients send absolute-form request-target (e.g. GET http://host/path)
  const rawUrl = req.url || "";
  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      return new URL(rawUrl).href;
    } catch {
      return null;
    }
  }
  const pathname = req.path || req.url.split("?")[0] || "";
  const candidate = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return candidate + q;
  }
  return null;
}

function hostnameMatchesWhitelist(hostname, whitelist) {
  const h = hostname.toLowerCase();
  for (const entry of whitelist) {
    const w = String(entry).toLowerCase();
    if (h === w) return true;
    if (h === `www.${w}` || w === `www.${h}`) return true;
  }
  return false;
}

function maxAmountFromPaymentRequired(pr) {
  if (!pr.accepts?.length) {
    throw new Error("PaymentRequired has no accepts");
  }
  let max = BigInt(0);
  for (const acc of pr.accepts) {
    const a = BigInt(acc.amount);
    if (a > max) max = a;
  }
  return max;
}

async function checkPolicy(paymentRequired, targetUrl) {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const config = JSON.parse(raw);
  const hostname = new URL(targetUrl).hostname;
  if (!hostnameMatchesWhitelist(hostname, config.whitelist ?? [])) {
    return { ok: false, reason: "domain not whitelisted" };
  }
  const amount = maxAmountFromPaymentRequired(paymentRequired);
  const today = new Date().toISOString().slice(0, 10);
  const spent =
    config.last_reset_date === today ? BigInt(config.spent_today ?? "0") : BigInt(0);
  const budget = BigInt(config.daily_budget_lamports);
  if (spent + amount > budget) {
    return { ok: false, reason: "amount exceeds daily budget" };
  }
  return { ok: true, amountLamports: amount };
}

async function persistSpendAfterSuccess(amountLamports) {
  await withConfigLock(async () => {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const config = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (config.last_reset_date !== today) {
      config.spent_today = "0";
      config.last_reset_date = today;
    }
    config.spent_today = (BigInt(config.spent_today ?? "0") + amountLamports).toString();
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  });
}

function buildForwardHeaders(req, targetUrl) {
  const u = new URL(targetUrl);
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (HOP_BY_HOP_REQ.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  out.host = u.host;
  return out;
}

function applyResponseHeaders(res, headers) {
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    if (HOP_BY_HOP_RES.has(k.toLowerCase())) continue;
    if (k.toLowerCase() === "content-length") continue;
    if (Array.isArray(v)) {
      for (const item of v) res.append(k, item);
    } else {
      res.setHeader(k, v);
    }
  }
}

function sendAxiosResponse(res, axiosRes) {
  res.status(axiosRes.status);
  applyResponseHeaders(res, axiosRes.headers);
  const body = axiosRes.data;
  if (Buffer.isBuffer(body)) {
    res.end(body);
  } else if (body instanceof ArrayBuffer) {
    res.end(Buffer.from(body));
  } else if (typeof body === "string") {
    res.end(body);
  } else {
    res.end(Buffer.from(JSON.stringify(body)));
  }
}

async function forwardOnce(targetUrl, req) {
  return axios({
    url: targetUrl,
    method: req.method,
    headers: buildForwardHeaders(req, targetUrl),
    data:
      req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS"
        ? undefined
        : req.bodyBuffer,
    validateStatus: () => true,
    responseType: "arraybuffer",
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
}

const app = express();

app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    req.bodyBuffer = Buffer.alloc(0);
    return next();
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    req.bodyBuffer = Buffer.concat(chunks);
    next();
  });
  req.on("error", next);
});

app.use(async (req, res) => {
  try {
    const targetUrl = resolveTargetUrl(req);
    if (!targetUrl) {
      return res.status(400).json({
        error:
          "Missing target: set x-aegis-target to a full URL, or use a path starting with http:// or https://",
      });
    }

    let hostname;
    try {
      hostname = new URL(targetUrl).hostname;
    } catch {
      return res.status(400).json({ error: "Invalid target URL" });
    }

    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const cfg = JSON.parse(raw);
    if (!hostnameMatchesWhitelist(hostname, cfg.whitelist ?? [])) {
      return res.status(403).json({ error: "target host not whitelisted" });
    }

    const first = await forwardOnce(targetUrl, req);

    if (first.status !== 402) {
      return sendAxiosResponse(res, first);
    }

    const httpClient = await getX402HttpClient();
    const getHeader = (name) => {
      const k = Object.keys(first.headers).find((h) => h.toLowerCase() === name.toLowerCase());
      return k ? first.headers[k] : undefined;
    };

    let paymentRequired;
    try {
      paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, undefined);
    } catch (e) {
      return res.status(502).json({
        error: "Invalid 402: could not parse PAYMENT-REQUIRED",
        detail: String(e?.message ?? e),
      });
    }

    const costStr = maxAmountFromPaymentRequired(paymentRequired).toString();
    console.log(
      `[Aegis Proxy] Intercepted 402 from ${targetUrl} | Cost: ${costStr} | Status: Signing...`,
    );

    const policy = await checkPolicy(paymentRequired, targetUrl);
    if (!policy.ok) {
      return res.status(403).json({ error: "policy denied", reason: policy.reason });
    }

    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    const payHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    const retryHeaders = { ...buildForwardHeaders(req, targetUrl), ...payHeaders };

    const retry = await axios({
      url: targetUrl,
      method: req.method,
      headers: retryHeaders,
      data:
        req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS"
          ? undefined
          : req.bodyBuffer,
      validateStatus: () => true,
      responseType: "arraybuffer",
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (retry.status === 200) {
      await persistSpendAfterSuccess(policy.amountLamports);
    }

    return sendAxiosResponse(res, retry);
  } catch (err) {
    console.error("[Aegis Proxy] Error:", err?.message ?? err);
    return res.status(500).json({ error: "proxy error" });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[Aegis Proxy] Listening on http://${HOST}:${PORT}`);
});
