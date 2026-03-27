const { Keypair } = require('@solana/web3.js');
const secrets = require('secrets.js-grempe');
const keytar = require('keytar');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASSPHRASE = 'aegis-local-enc-key';
const SHARE2_PATH = path.join(os.homedir(), '.aegis', 'share2.enc');

async function storeShares(shares) {
  // Share 1 → OS Keychain (Windows Credential Manager)
  await keytar.setPassword('aegis-wallet', 'share1', shares[0]);
  console.log('Share 1 stored in OS keychain');

  // Share 2 → AES-256 encrypted local file
  const encKey = crypto.scryptSync(PASSPHRASE, 'aegis-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(shares[1], 'utf8'),
    cipher.final()
  ]);
  fs.mkdirSync(path.dirname(SHARE2_PATH), { recursive: true });
  fs.writeFileSync(SHARE2_PATH, JSON.stringify({
    iv: iv.toString('hex'),
    data: encrypted.toString('hex')
  }));
  console.log('Share 2 stored at', SHARE2_PATH);
}

async function retrieveShares() {
  const share1 = await keytar.getPassword('aegis-wallet', 'share1');
  if (!share1) throw new Error('Share 1 not found in keychain');

  const raw = JSON.parse(fs.readFileSync(SHARE2_PATH, 'utf8'));
  const encKey = crypto.scryptSync(PASSPHRASE, 'aegis-salt', 32);
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    encKey,
    Buffer.from(raw.iv, 'hex')
  );
  const share2 = Buffer.concat([
    decipher.update(Buffer.from(raw.data, 'hex')),
    decipher.final()
  ]).toString('utf8');

  return { share1, share2 };
}

async function main() {
  const keypair = Keypair.generate();
  const privateKeyHex = Buffer.from(keypair.secretKey).toString('hex');
  const shares = secrets.share(privateKeyHex, 3, 2);

  await storeShares(shares);

  const { share1, share2 } = await retrieveShares();
  const recovered = secrets.combine([share1, share2]);

  if (recovered !== privateKeyHex) throw new Error('RECONSTRUCTION FAILED');
  console.log('Reconstruction match: true');
  console.log('Public key:', keypair.publicKey.toBase58());
  console.log('Stage C: OK');

  writeConfig(keypair.publicKey.toBase58());
}

function writeConfig(publicKey) {
  const configPath = path.join(os.homedir(), '.aegis', 'config.json');
  const config = {
    dailyBudgetUSDC: 2.00,
    perTransactionLimitUSDC: 0.50,
    autoApproveThresholdUSDC: 1.00,
    whitelistedURLs: ['localhost:9090'],
    blacklistedURLs: [],
    whitelistedProgramIDs: [],
    blacklistedProgramIDs: [],
    keywordBlocklist: [],
    walletPublicKey: publicKey
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('config.json written to', configPath);
}

main().catch(console.error);
