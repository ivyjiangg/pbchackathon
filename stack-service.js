'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const MAX_LOG_LINES = 500;

const DEFAULT_PROXY_POLICY = path.join(os.homedir(), '.aegis', 'proxy-policy.json');
const PACKAGE_PROXY_CONFIG = path.join(ROOT, 'packages', 'aegis-proxy', 'config.json');

let proxyChild = null;
let premiumChild = null;
let logLines = [];
let lastPorts = { proxyPort: 8080, premiumPort: 9090, host: '127.0.0.1' };

function pushLog(source, chunk) {
  const s = chunk.toString();
  for (const line of s.split(/\r?\n/)) {
    if (line === '') continue;
    logLines.push({ t: Date.now(), source, line });
    while (logLines.length > MAX_LOG_LINES) logLines.shift();
  }
}

function getNodeCmd() {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

/**
 * Ensure ~/.aegis/proxy-policy.json exists (copy from package default once).
 */
function ensureProxyPolicyFile() {
  const dir = path.join(os.homedir(), '.aegis');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DEFAULT_PROXY_POLICY) && fs.existsSync(PACKAGE_PROXY_CONFIG)) {
    fs.copyFileSync(PACKAGE_PROXY_CONFIG, DEFAULT_PROXY_POLICY);
  }
  return DEFAULT_PROXY_POLICY;
}

function getProxyPolicyPath() {
  return DEFAULT_PROXY_POLICY;
}

function startStack(opts = {}) {
  if (proxyChild || premiumChild) {
    return { ok: false, error: 'Stack already running' };
  }

  const proxyPort = Number(opts.proxyPort) || 8080;
  const premiumPort = Number(opts.premiumPort) || 9090;
  const host = opts.host || '127.0.0.1';

  ensureProxyPolicyFile();

  const policyPath = getProxyPolicyPath();
  const env = {
    ...process.env,
    AEGIS_PROXY_PORT: String(proxyPort),
    AEGIS_PROXY_HOST: host,
    AEGIS_PREMIUM_API_PORT: String(premiumPort),
    AEGIS_PREMIUM_API_HOST: host,
    AEGIS_PROXY_CONFIG_PATH: policyPath,
  };

  const node = getNodeCmd();
  const premiumEntry = path.join(ROOT, 'packages', 'aegis-premium-api', 'server.mjs');
  const proxyEntry = path.join(ROOT, 'packages', 'aegis-proxy', 'proxy.js');

  const spawnOpts = {
    env,
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  premiumChild = spawn(node, [premiumEntry], spawnOpts);
  proxyChild = spawn(node, [proxyEntry], spawnOpts);

  const attach = (child, name) => {
    child.stdout.on('data', (d) => pushLog(name, d));
    child.stderr.on('data', (d) => pushLog(name, d));
    child.on('exit', (code, signal) => {
      pushLog(name, Buffer.from(`process exited code=${code} signal=${signal || 'none'}`));
      if (name === 'premium') premiumChild = null;
      if (name === 'proxy') proxyChild = null;
    });
  };
  attach(premiumChild, 'premium');
  attach(proxyChild, 'proxy');

  lastPorts = { proxyPort, premiumPort, host };
  return { ok: true, proxyPort, premiumPort, host, proxyPolicyPath: policyPath };
}

function stopStack() {
  const kill = (child) => {
    if (!child || child.killed) return;
    try {
      child.kill('SIGTERM');
    } catch (_) {}
  };
  kill(premiumChild);
  kill(proxyChild);
  premiumChild = null;
  proxyChild = null;
  return { ok: true };
}

function getStatus() {
  return {
    proxyRunning: !!proxyChild,
    premiumRunning: !!premiumChild,
    proxyPid: proxyChild ? proxyChild.pid : null,
    premiumPid: premiumChild ? premiumChild.pid : null,
    ...lastPorts,
    proxyPolicyPath: getProxyPolicyPath(),
  };
}

function getLogs() {
  return logLines.slice();
}

function clearLogs() {
  logLines = [];
}

module.exports = {
  startStack,
  stopStack,
  getStatus,
  getLogs,
  clearLogs,
  ensureProxyPolicyFile,
  getProxyPolicyPath,
  ROOT,
};
