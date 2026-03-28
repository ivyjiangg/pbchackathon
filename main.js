const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { parseProxyErrorBody } = require('./proxy-http-detail');
// Load repo .env so child processes (stack, smoke, proof) see AEGIS_PRIVATE_KEY_BASE58 / X402_PAY_TO
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { app, BrowserWindow, ipcMain } = require('electron');

let agentDemoWindow = null;
const h = require('./handlers');
const stack = require('./stack-service');
const scripts = require('./script-runner');

function registerIpcHandlers() {
  ipcMain.handle('get-proxy-policy', () => h.getProxyPolicy());
  ipcMain.handle('get-proxy-activity', (_, limit) => h.getProxyActivity(limit));
  ipcMain.handle('get-proxy-overview-stats', () => h.getProxyOverviewStats());

  ipcMain.handle('provision-wallet',     (_, policy)     => h.provisionWallet(policy));
  ipcMain.handle('save-policy',          (_, policy)     => h.savePolicy(policy));
  ipcMain.handle('get-config',           ()              => h.getConfig());
  ipcMain.handle('get-wallet-status',    ()              => h.getWalletStatus());
  ipcMain.handle('get-spend-stats',      ()              => h.getSpendStats());
  ipcMain.handle('reset-spend-counters', (_, period)     => h.resetSpendCounters(period));
  ipcMain.handle('export-recovery',      ()              => h.exportRecoveryShare());
  ipcMain.handle('get-pending',          ()              => h.getPendingApprovals());
  ipcMain.handle('approve-transaction',  (_, id)         => h.approveTransaction(id));
  ipcMain.handle('deny-transaction',     (_, id)         => h.denyTransaction(id));
  ipcMain.handle('get-activity',         ()              => h.getActivity());
  ipcMain.handle('sign-and-pay',         (_, { amount, recipient }) => {
    const { signAndPay } = require('./signer');
    return signAndPay(amount, recipient);
  });
  ipcMain.handle('airdrop-sol',          ()              => h.airdropSOL());
  ipcMain.handle('get-sol-balance',      ()              => h.getSOLBalance());

  ipcMain.handle('aegis-stack-start', async (_, opts) => {
    const o = { ...(opts || {}) };
    try {
      const { getProvisionedSecretKeyBase58 } = require('./wallet-reconstruct');
      const b58 = await getProvisionedSecretKeyBase58();
      if (b58) o.aegisPrivateKeyBase58 = b58;
    } catch {
      /* use .env / proxy dev key */
    }
    return stack.startStack(o);
  });
  ipcMain.handle('aegis-stack-stop', () => stack.stopStack());
  ipcMain.handle('aegis-stack-status', () => stack.getStatus());
  ipcMain.handle('aegis-stack-logs', () => stack.getLogs());
  ipcMain.handle('aegis-stack-clear-logs', () => {
    stack.clearLogs();
    return { ok: true };
  });

  ipcMain.handle('aegis-script-start-smoke', () => scripts.startSmoke());
  ipcMain.handle('aegis-script-start-proof', () => scripts.startProof());
  ipcMain.handle('aegis-script-status', () => scripts.getScriptStatus());
  ipcMain.handle('aegis-read-proof', async () => scripts.readProofJson());

  ipcMain.handle('open-agent-demo-window', () => {
    if (agentDemoWindow && !agentDemoWindow.isDestroyed()) {
      agentDemoWindow.focus();
      return { ok: true };
    }
    agentDemoWindow = new BrowserWindow({
      width: 440,
      height: 760,
      title: 'Aegis — Agent Demo',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    agentDemoWindow.loadFile(path.join(__dirname, 'agent-demo.html'));
    agentDemoWindow.on('closed', () => {
      agentDemoWindow = null;
    });
    return { ok: true };
  });

  ipcMain.handle('agent-demo-live-check', () => {
    const st = stack.getStatus();
    if (!st.proxyRunning || !st.premiumRunning) {
      return {
        ok: false,
        error: 'Start the local stack first (proxy + premium).',
      };
    }
    const host = st.host || '127.0.0.1';
    const pxy = String(st.proxyPort);
    const prm = String(st.premiumPort);
    const proxyUrl = `http://${host}:${pxy}/`;
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const steps = [];

    const curlCode = (args) =>
      execFileSync('curl', args, { encoding: 'utf8' }).trim();

    const curlCodeAndBody = (args) => {
      const tmp = path.join(
        os.tmpdir(),
        `aegis-live-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
      );
      try {
        const code = execFileSync('curl', [...args, '-o', tmp, '-w', '%{http_code}'], {
          encoding: 'utf8',
        }).trim();
        let body = '';
        try {
          body = fs.readFileSync(tmp, 'utf8');
        } catch (_) {
          /* ignore */
        }
        return { httpCode: code, body };
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch (_) {
          /* ignore */
        }
      }
    };

    try {
      const r1 = curlCodeAndBody([
        '-sS',
        '-H',
        'x-aegis-target: https://blocked.invalid/',
        proxyUrl,
      ]);
      const d1 =
        r1.httpCode === '403' && r1.body
          ? parseProxyErrorBody(r1.body) || 'policy denied (see Activity)'
          : 'Expect 403 — policy denied before forward.';
      steps.push({
        label: 'Blocked host (blocked.invalid)',
        httpCode: r1.httpCode,
        detail: d1,
      });
    } catch (e) {
      steps.push({
        label: 'Blocked host',
        httpCode: 'error',
        detail: String(e.message),
      });
    }

    try {
      const healthTarget = `http://${host}:${prm}/health`;
      const code2 = curlCode([
        '-sS',
        '-o',
        nullDevice,
        '-w',
        '%{http_code}',
        '-H',
        `x-aegis-target: ${healthTarget}`,
        proxyUrl,
      ]);
      steps.push({
        label: 'Allowed /health via proxy',
        httpCode: code2,
        detail: 'Expect 200 — forwarded (non-402).',
      });
    } catch (e) {
      steps.push({
        label: 'Health check',
        httpCode: 'error',
        detail: String(e.message),
      });
    }

    try {
      const premiumReport = `http://${host}:${prm}/v1/macro/premium-report`;
      const r3 = curlCodeAndBody(['-sS', '-x', `http://${host}:${pxy}/`, premiumReport]);
      let d3 =
        '200 = paid; 402 = signed retry but upstream unsettled; 403 = see reason below.';
      if (r3.httpCode === '403' && r3.body) {
        const parsed = parseProxyErrorBody(r3.body);
        if (parsed) {
          d3 = `403 — ${parsed}. If this is budget-related, use Overview → reset spend or raise Daily Budget (USDC) on Policy and Save.`;
        }
      } else if (r3.httpCode === '200') {
        d3 = 'Paid / forwarded — JSON report body from premium API.';
      } else if (r3.httpCode === '402') {
        d3 = 'Upstream still 402 after proxy retry (settlement / facilitator / funds on devnet).';
      }
      steps.push({
        label: 'Premium route via proxy (x402)',
        httpCode: r3.httpCode,
        detail: d3,
      });
    } catch (e) {
      steps.push({
        label: 'Premium x402',
        httpCode: 'error',
        detail: String(e.message),
      });
    }

    return {
      ok: true,
      host,
      proxyPort: pxy,
      premiumPort: prm,
      steps,
    };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  stack.stopStack();
});
