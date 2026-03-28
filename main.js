const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Keypair } = require('@solana/web3.js');
const secrets = require('secrets.js-grempe');
const keytar = require('keytar');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const PASSPHRASE = 'aegis-local-enc-key';
const SHARE2_PATH = path.join(os.homedir(), '.aegis', 'share2.enc');
const CONFIG_PATH = path.join(os.homedir(), '.aegis', 'config.json');
const ACTIVITY_PATH = path.join(os.homedir(), '.aegis', 'activity.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// Provision wallet: generate keypair, shard key, write config
ipcMain.handle('provision-wallet', async (event, policy) => {
  const keypair = Keypair.generate();
  const privateKeyHex = Buffer.from(keypair.secretKey).toString('hex');
  const shares = secrets.share(privateKeyHex, 3, 2);

  // Share 1 → OS Keychain
  await keytar.setPassword('aegis-wallet', 'share1', shares[0]);

  // Share 2 → AES-256 encrypted file
  const encKey = crypto.scryptSync(PASSPHRASE, 'aegis-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  const encrypted = Buffer.concat([cipher.update(shares[1], 'utf8'), cipher.final()]);
  fs.mkdirSync(path.dirname(SHARE2_PATH), { recursive: true });
  fs.writeFileSync(SHARE2_PATH, JSON.stringify({
    iv: iv.toString('hex'),
    data: encrypted.toString('hex')
  }));

  // Write config with user-defined policy
  const config = {
    dailyBudgetUSDC: policy.dailyBudget,
    perTransactionLimitUSDC: policy.perTxLimit,
    autoApproveThresholdUSDC: policy.autoApproveThreshold,
    whitelistedURLs: policy.whitelistedURLs,
    blacklistedURLs: [],
    whitelistedProgramIDs: [],
    blacklistedProgramIDs: policy.blacklistedProgramIDs || [],
    keywordBlocklist: policy.keywordBlocklist || [],
    walletPublicKey: keypair.publicKey.toBase58()
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  // Export Share 3 as recovery file
  const recoveryPath = path.join(os.homedir(), '.aegis', 'share3-RECOVERY.txt');
  fs.writeFileSync(recoveryPath, shares[2]);

  console.log('Wallet provisioned:', keypair.publicKey.toBase58());
  return { success: true, publicKey: keypair.publicKey.toBase58() };
});

// Save policy only (without re-provisioning the wallet)
ipcMain.handle('save-policy', async (event, policy) => {
  const existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const config = {
    ...existing,
    dailyBudgetUSDC: policy.dailyBudget,
    perTransactionLimitUSDC: policy.perTxLimit,
    autoApproveThresholdUSDC: policy.autoApproveThreshold,
    whitelistedURLs: policy.whitelistedURLs,
    blacklistedProgramIDs: policy.blacklistedProgramIDs || [],
    keywordBlocklist: policy.keywordBlocklist || []
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return { success: true };
});

// Sign and pay: called by Dev 2's proxy via IPC
ipcMain.handle('sign-and-pay', async (event, { amount, recipient }) => {
  const { signAndPay } = require('./signer');
  return await signAndPay(amount, recipient);
});

// Approve a pending transaction
ipcMain.handle('approve-transaction', async (event, id) => {
  const activity = fs.existsSync(ACTIVITY_PATH)
    ? JSON.parse(fs.readFileSync(ACTIVITY_PATH, 'utf8'))
    : [];
  const entry = activity.find(a => a.id === id);
  if (entry) entry.status = 'APPROVED';
  fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(activity, null, 2));
  return { success: true };
});

// Deny a pending transaction
ipcMain.handle('deny-transaction', async (event, id) => {
  const activity = fs.existsSync(ACTIVITY_PATH)
    ? JSON.parse(fs.readFileSync(ACTIVITY_PATH, 'utf8'))
    : [];
  const entry = activity.find(a => a.id === id);
  if (entry) entry.status = 'DENIED';
  fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(activity, null, 2));
  return { success: true };
});

// Get activity log for the UI to poll
ipcMain.handle('get-activity', async () => {
  if (!fs.existsSync(ACTIVITY_PATH)) return [];
  return JSON.parse(fs.readFileSync(ACTIVITY_PATH, 'utf8'));
});
