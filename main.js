const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const h = require('./handlers');

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
