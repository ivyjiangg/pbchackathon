const path = require('path');
// Load repo .env so child processes (stack, smoke, proof) see AEGIS_PRIVATE_KEY_BASE58 / X402_PAY_TO
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { app, BrowserWindow, ipcMain } = require('electron');
const h = require('./handlers');
const stack = require('./stack-service');
const scripts = require('./script-runner');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  stack.stopStack();
});

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

ipcMain.handle('aegis-stack-start', (_, opts) => stack.startStack(opts || {}));
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
