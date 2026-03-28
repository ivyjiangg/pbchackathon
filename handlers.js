const { Keypair } = require('@solana/web3.js');
const secrets = require('secrets.js-grempe');
const keytar = require('keytar');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── File paths ───────────────────────────────────────────────────────────────
const PASSPHRASE    = 'aegis-local-enc-key';
const AEGIS_DIR     = path.join(os.homedir(), '.aegis');
const SHARE2_PATH   = path.join(AEGIS_DIR, 'share2.enc');
const CONFIG_PATH   = path.join(AEGIS_DIR, 'config.json');
const ACTIVITY_PATH = path.join(AEGIS_DIR, 'activity.json');
const PENDING_PATH  = path.join(AEGIS_DIR, 'pending.json');
const SPEND_PATH    = path.join(AEGIS_DIR, 'spend.json');
const RECOVERY_PATH = path.join(AEGIS_DIR, 'share3-RECOVERY.txt');
const PROXY_POLICY_PATH = path.join(AEGIS_DIR, 'proxy-policy.json');
const PROXY_ACTIVITY_JSONL = path.join(AEGIS_DIR, 'proxy-activity.jsonl');
const PACKAGE_PROXY_CONFIG = path.join(__dirname, 'packages', 'aegis-proxy', 'config.json');

const USDC_DECIMALS = 6;
function usdcToMicroUnits(usdc) {
  const n = Number(usdc);
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(BigInt(Math.floor(n * 10 ** USDC_DECIMALS)));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ensureDir() {
  fs.mkdirSync(AEGIS_DIR, { recursive: true });
}

function readJSON(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, data) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/** Map UI URL lines to hostnames for aegis-proxy whitelist (see packages/aegis-proxy/proxy.js). */
function parseHostnameFromLine(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** If localhost or 127.0.0.1 is present, ensure both are allowed for local dev. */
function expandLoopbackHosts(hostSet) {
  if (hostSet.has('localhost') || hostSet.has('127.0.0.1')) {
    hostSet.add('localhost');
    hostSet.add('127.0.0.1');
  }
}

function collectHostnamesFromUrlList(raw) {
  const lines = Array.isArray(raw) ? raw : [String(raw)];
  const hosts = new Set();
  for (const entry of lines) {
    for (const part of String(entry).split(/[\n,]/)) {
      const h = parseHostnameFromLine(part.trim());
      if (h) hosts.add(h);
    }
  }
  return hosts;
}

/** Writes ~/.aegis/proxy-policy.json: URL firewall, keywords, and x402 budget caps (micro-USDC, same units as payment amounts). */
function syncProxyPolicyFromPolicy(policy) {
  const whiteHosts = collectHostnamesFromUrlList(policy.whitelistedURLs || []);
  const blackHosts = collectHostnamesFromUrlList(policy.blacklistedURLs || []);
  expandLoopbackHosts(whiteHosts);
  expandLoopbackHosts(blackHosts);
  // Local premium API runs on 127.0.0.1/localhost — always allow unless explicitly blacklisted
  if (!blackHosts.has('127.0.0.1')) whiteHosts.add('127.0.0.1');
  if (!blackHosts.has('localhost')) whiteHosts.add('localhost');

  const kwRaw = policy.keywordBlocklist || [];
  const kwLines = Array.isArray(kwRaw) ? kwRaw : [String(kwRaw)];
  const keywordBlocklist = [];
  for (const entry of kwLines) {
    for (const part of String(entry).split(/[\n,]/)) {
      const k = part.trim().toLowerCase();
      if (k) keywordBlocklist.push(k);
    }
  }

  let existing = {};
  if (fs.existsSync(PROXY_POLICY_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(PROXY_POLICY_PATH, 'utf8'));
    } catch (_) {}
  } else if (fs.existsSync(PACKAGE_PROXY_CONFIG)) {
    existing = JSON.parse(fs.readFileSync(PACKAGE_PROXY_CONFIG, 'utf8'));
  }

  const dailyMicro = usdcToMicroUnits(
    policy.dailyBudget !== undefined ? policy.dailyBudget : policy.dailyBudgetUSDC ?? 2
  );
  const perTxMicro = usdcToMicroUnits(
    policy.perTxLimit !== undefined ? policy.perTxLimit : policy.perTransactionLimitUSDC ?? 0.5
  );

  existing.whitelist = [...whiteHosts].sort();
  existing.blacklist = [...blackHosts].sort();
  existing.keyword_blocklist = [...new Set(keywordBlocklist)].sort();
  existing.daily_budget_lamports = dailyMicro;
  existing.per_tx_limit_micro_usdc = perTxMicro;

  ensureDir();
  fs.writeFileSync(PROXY_POLICY_PATH, JSON.stringify(existing, null, 2));
}

function syncProxyWhitelistFromPolicy(policy) {
  syncProxyPolicyFromPolicy(policy);
}

function buildDefaultSpend() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    spentTodayUSDC: 0,
    spentWeekUSDC: 0,
    spentMonthUSDC: 0,
    transactionCount: 0,
    lastResetDaily: today,
    lastResetWeekly: today,
    lastResetMonthly: today
  };
}

function buildConfig(policy, publicKey) {
  return {
    // Spend controls
    dailyBudgetUSDC:          policy.dailyBudget          ?? 2.00,
    weeklyBudgetUSDC:         policy.weeklyBudget          ?? 10.00,
    monthlyBudgetUSDC:        policy.monthlyBudget         ?? 50.00,
    perTransactionLimitUSDC:  policy.perTxLimit            ?? 0.50,
    autoApproveThresholdUSDC: policy.autoApproveThreshold  ?? 1.00,

    // Token restrictions
    allowedTokenMints:        policy.allowedTokenMints     || [],
    blockedTokenMints:        policy.blockedTokenMints     || [],

    // URL firewall
    whitelistedURLs:          policy.whitelistedURLs       || ['localhost:9090'],
    blacklistedURLs:          policy.blacklistedURLs       || [],

    // Address controls
    whitelistedAddresses:     policy.whitelistedAddresses  || [],
    blacklistedAddresses:     policy.blacklistedAddresses  || [],

    // On-chain program controls
    whitelistedProgramIDs:    policy.whitelistedProgramIDs || [],
    blacklistedProgramIDs:    policy.blacklistedProgramIDs || [],

    // Behavioral guardrails
    keywordBlocklist:         policy.keywordBlocklist      || [],
    forbiddenActions:         policy.forbiddenActions      || [],
    priorityInstructions:     policy.priorityInstructions  || '',

    // Wallet
    walletPublicKey:          publicKey
  };
}

// ─── Share storage / retrieval ─────────────────────────────────────────────────
async function storeShare1(share) {
  await keytar.setPassword('aegis-wallet', 'share1', share);
}

function storeShare2(share) {
  const encKey = crypto.scryptSync(PASSPHRASE, 'aegis-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  const encrypted = Buffer.concat([cipher.update(share, 'utf8'), cipher.final()]);
  ensureDir();
  writeJSON(SHARE2_PATH, { iv: iv.toString('hex'), data: encrypted.toString('hex') });
}

async function retrieveShares() {
  const share1 = await keytar.getPassword('aegis-wallet', 'share1');
  if (!share1) throw new Error('Share 1 not found in keychain');

  const raw = readJSON(SHARE2_PATH, null);
  if (!raw) throw new Error('Share 2 file not found');

  const encKey = crypto.scryptSync(PASSPHRASE, 'aegis-salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, Buffer.from(raw.iv, 'hex'));
  const share2 = Buffer.concat([
    decipher.update(Buffer.from(raw.data, 'hex')),
    decipher.final()
  ]).toString('utf8');

  return { share1, share2 };
}

// ─── Handler: provisionWallet ──────────────────────────────────────────────────
async function provisionWallet(policy) {
  const keypair = Keypair.generate();
  const privateKeyHex = Buffer.from(keypair.secretKey).toString('hex');
  const shares = secrets.share(privateKeyHex, 3, 2);

  await storeShare1(shares[0]);
  storeShare2(shares[1]);

  // Share 3 → offline recovery file
  ensureDir();
  fs.writeFileSync(RECOVERY_PATH, shares[2]);

  // Write config
  const config = buildConfig(policy, keypair.publicKey.toBase58());
  writeJSON(CONFIG_PATH, config);
  syncProxyWhitelistFromPolicy(policy);

  // Initialize spend tracker
  writeJSON(SPEND_PATH, buildDefaultSpend());

  console.log('Wallet provisioned:', keypair.publicKey.toBase58());
  return { success: true, publicKey: keypair.publicKey.toBase58() };
}

// ─── Handler: savePolicy ──────────────────────────────────────────────────────
function savePolicy(policy) {
  const existing = readJSON(CONFIG_PATH, {});
  const publicKey = existing.walletPublicKey || '';
  const config = buildConfig(policy, publicKey);
  writeJSON(CONFIG_PATH, config);
  syncProxyWhitelistFromPolicy(policy);
  return { success: true };
}

// ─── Handler: getConfig ───────────────────────────────────────────────────────
function getConfig() {
  return readJSON(CONFIG_PATH, null);
}

// ─── Handler: getWalletStatus ─────────────────────────────────────────────────
function getWalletStatus() {
  const config = readJSON(CONFIG_PATH, null);
  const provisioned = !!(config && config.walletPublicKey);
  return {
    provisioned,
    publicKey: config ? config.walletPublicKey : null,
    share2Exists: fs.existsSync(SHARE2_PATH),
    recoveryExists: fs.existsSync(RECOVERY_PATH)
  };
}

// ─── Handler: getSpendStats ───────────────────────────────────────────────────
function getSpendStats() {
  const spend = readJSON(SPEND_PATH, buildDefaultSpend());
  const config = readJSON(CONFIG_PATH, {});

  // Auto-reset daily counter if day has changed
  const today = new Date().toISOString().slice(0, 10);
  if (spend.lastResetDaily !== today) {
    spend.spentTodayUSDC = 0;
    spend.lastResetDaily = today;
    writeJSON(SPEND_PATH, spend);
  }

  return {
    ...spend,
    dailyBudgetUSDC:   config.dailyBudgetUSDC   || 0,
    weeklyBudgetUSDC:  config.weeklyBudgetUSDC  || 0,
    monthlyBudgetUSDC: config.monthlyBudgetUSDC || 0,
    dailyRemaining:    Math.max(0, (config.dailyBudgetUSDC   || 0) - spend.spentTodayUSDC),
    weeklyRemaining:   Math.max(0, (config.weeklyBudgetUSDC  || 0) - spend.spentWeekUSDC),
    monthlyRemaining:  Math.max(0, (config.monthlyBudgetUSDC || 0) - spend.spentMonthUSDC)
  };
}

// ─── Handler: resetSpendCounters ──────────────────────────────────────────────
function resetSpendCounters(period) {
  const spend = readJSON(SPEND_PATH, buildDefaultSpend());
  const today = new Date().toISOString().slice(0, 10);

  if (period === 'daily' || period === 'all') {
    spend.spentTodayUSDC = 0;
    spend.lastResetDaily = today;
  }
  if (period === 'weekly' || period === 'all') {
    spend.spentWeekUSDC = 0;
    spend.lastResetWeekly = today;
  }
  if (period === 'monthly' || period === 'all') {
    spend.spentMonthUSDC = 0;
    spend.lastResetMonthly = today;
  }

  writeJSON(SPEND_PATH, spend);

  // Keep x402 proxy caps in sync: spent_today lives in proxy-policy.json (not spend.json)
  if (period === 'daily' || period === 'all') {
    if (fs.existsSync(PROXY_POLICY_PATH)) {
      try {
        const pj = JSON.parse(fs.readFileSync(PROXY_POLICY_PATH, 'utf8'));
        const today = new Date().toISOString().slice(0, 10);
        pj.spent_today = '0';
        pj.last_reset_date = today;
        fs.writeFileSync(PROXY_POLICY_PATH, JSON.stringify(pj, null, 2));
      } catch (_) {
        /* ignore */
      }
    }
  }

  return { success: true, spend };
}

// ─── Handler: exportRecoveryShare ─────────────────────────────────────────────
async function exportRecoveryShare() {
  if (!fs.existsSync(RECOVERY_PATH)) {
    throw new Error('Recovery share file not found. Wallet may not be provisioned.');
  }
  const share3 = fs.readFileSync(RECOVERY_PATH, 'utf8');
  return { success: true, share3, path: RECOVERY_PATH };
}

// ─── Handler: getPendingApprovals ─────────────────────────────────────────────
function getPendingApprovals() {
  const pending = readJSON(PENDING_PATH, []);
  return pending.filter(p => p.status === 'PENDING');
}

// ─── Handler: approveTransaction ──────────────────────────────────────────────
async function approveTransaction(id) {
  const pending = readJSON(PENDING_PATH, []);
  const entry = pending.find(p => p.id === id);
  if (!entry) throw new Error(`Pending transaction ${id} not found`);
  if (entry.status !== 'PENDING') throw new Error(`Transaction ${id} already resolved`);

  // Call signAndPay
  const { signAndPay } = require('./signer');
  const signature = await signAndPay(entry.amount, entry.recipient);

  // Mark as approved in pending.json
  entry.status = 'APPROVED';
  entry.signature = signature;
  entry.resolvedAt = new Date().toISOString();
  writeJSON(PENDING_PATH, pending);

  // Append to activity log
  const activity = readJSON(ACTIVITY_PATH, []);
  activity.push({
    id: entry.id,
    status: 'APPROVED',
    url: entry.url,
    amount: entry.amount,
    signature,
    timestamp: new Date().toISOString()
  });
  writeJSON(ACTIVITY_PATH, activity);

  // Update spend counters
  const spend = readJSON(SPEND_PATH, buildDefaultSpend());
  spend.spentTodayUSDC  = +(spend.spentTodayUSDC  + entry.amount).toFixed(6);
  spend.spentWeekUSDC   = +(spend.spentWeekUSDC   + entry.amount).toFixed(6);
  spend.spentMonthUSDC  = +(spend.spentMonthUSDC  + entry.amount).toFixed(6);
  spend.transactionCount++;
  writeJSON(SPEND_PATH, spend);

  return { success: true, signature };
}

// ─── Handler: denyTransaction ─────────────────────────────────────────────────
function denyTransaction(id) {
  const pending = readJSON(PENDING_PATH, []);
  const entry = pending.find(p => p.id === id);
  if (!entry) throw new Error(`Pending transaction ${id} not found`);

  entry.status = 'DENIED';
  entry.resolvedAt = new Date().toISOString();
  writeJSON(PENDING_PATH, pending);

  // Append to activity log
  const activity = readJSON(ACTIVITY_PATH, []);
  activity.push({
    id: entry.id,
    status: 'DENIED',
    url: entry.url,
    amount: entry.amount,
    timestamp: new Date().toISOString()
  });
  writeJSON(ACTIVITY_PATH, activity);

  return { success: true };
}

// ─── Handler: getActivity ─────────────────────────────────────────────────────
function getActivity() {
  return readJSON(ACTIVITY_PATH, []);
}

// ─── Handler: airdropSOL ──────────────────────────────────────────────────────
async function airdropSOL() {
  const config = readJSON(CONFIG_PATH, null);
  if (!config || !config.walletPublicKey) throw new Error('No wallet provisioned');

  const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const pubkey = new PublicKey(config.walletPublicKey);

  const sig = await connection.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
  console.log('SOL airdrop confirmed:', sig);
  return { success: true, signature: sig, amount: '1 SOL' };
}

// ─── Handler: getSOLBalance ───────────────────────────────────────────────────
async function getSOLBalance() {
  const config = readJSON(CONFIG_PATH, null);
  if (!config || !config.walletPublicKey) return { balance: 0 };

  const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const pubkey = new PublicKey(config.walletPublicKey);
  const lamports = await connection.getBalance(pubkey);
  return { balance: lamports / LAMPORTS_PER_SOL };
}

function getProxyPolicy() {
  if (!fs.existsSync(PROXY_POLICY_PATH)) {
    return {
      path: PROXY_POLICY_PATH,
      exists: false,
      whitelist: [],
      blacklist: [],
      keyword_blocklist: []
    };
  }
  try {
    const j = JSON.parse(fs.readFileSync(PROXY_POLICY_PATH, 'utf8'));
    return {
      path: PROXY_POLICY_PATH,
      exists: true,
      whitelist: j.whitelist || [],
      blacklist: j.blacklist || [],
      keyword_blocklist: j.keyword_blocklist || [],
      daily_budget_micro_usdc: j.daily_budget_lamports,
      per_tx_limit_micro_usdc: j.per_tx_limit_micro_usdc,
      spent_today_micro_usdc: j.spent_today,
      last_reset_date: j.last_reset_date
    };
  } catch (e) {
    return { path: PROXY_POLICY_PATH, exists: false, error: String(e.message) };
  }
}

function getProxyActivity(limit) {
  const n = Number(limit) > 0 ? Number(limit) : 200;
  if (!fs.existsSync(PROXY_ACTIVITY_JSONL)) return { events: [] };
  const raw = fs.readFileSync(PROXY_ACTIVITY_JSONL, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-n);
  const events = [];
  for (const line of slice) {
    try {
      events.push(JSON.parse(line));
    } catch (_) {}
  }
  return { events };
}

function getProxyOverviewStats() {
  const today = new Date().toISOString().slice(0, 10);
  const { events } = getProxyActivity(800);
  let blocked = 0;
  let paid = 0;
  let forwarded = 0;
  for (const ev of events) {
    const ts = ev.ts || '';
    if (!ts.startsWith(today)) continue;
    const o = ev.outcome || '';
    if (o === 'blocked_blacklist' || o === 'blocked_keyword' || o === 'blocked_not_whitelisted' || o === 'policy_denied') {
      blocked++;
    } else if (o === 'paid_success') {
      paid++;
    } else if (o === 'forwarded') {
      forwarded++;
    }
  }
  return { today, blockedCount: blocked, paidCount: paid, forwardedCount: forwarded };
}

module.exports = {
  provisionWallet,
  savePolicy,
  getConfig,
  getWalletStatus,
  getSpendStats,
  resetSpendCounters,
  exportRecoveryShare,
  getPendingApprovals,
  approveTransaction,
  denyTransaction,
  getActivity,
  airdropSOL,
  getSOLBalance,
  getProxyPolicy,
  getProxyActivity,
  getProxyOverviewStats
};
