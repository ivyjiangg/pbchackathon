'use strict';

/**
 * Shamir share retrieval + optional base58 secret for proxy child env.
 * Never log secret material.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const keytar = require('keytar');
const secrets = require('secrets.js-grempe');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const PASSPHRASE = 'aegis-local-enc-key';
const SHARE2_PATH = path.join(os.homedir(), '.aegis', 'share2.enc');
const CONFIG_PATH = path.join(os.homedir(), '.aegis', 'config.json');

async function retrieveTwoShares() {
  const share1 = await keytar.getPassword('aegis-wallet', 'share1');
  if (!share1) throw new Error('Share 1 not found in keychain');

  const raw = JSON.parse(fs.readFileSync(SHARE2_PATH, 'utf8'));
  const encKey = crypto.scryptSync(PASSPHRASE, 'aegis-salt', 32);
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    encKey,
    Buffer.from(raw.iv, 'hex'),
  );
  const share2 = Buffer.concat([
    decipher.update(Buffer.from(raw.data, 'hex')),
    decipher.final(),
  ]).toString('utf8');

  return { share1, share2 };
}

/**
 * @returns {Promise<string|null>} base58-encoded secret key for x402 proxy, or null if not provisioned
 */
async function getProvisionedSecretKeyBase58() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
  if (!config.walletPublicKey) return null;
  if (!fs.existsSync(SHARE2_PATH)) return null;

  const { share1, share2 } = await retrieveTwoShares();
  const recoveredHex = secrets.combine([share1, share2]);
  const recoveredBytes = Buffer.from(recoveredHex, 'hex');
  try {
    const keypair = Keypair.fromSecretKey(recoveredBytes);
    if (keypair.publicKey.toBase58() !== config.walletPublicKey) {
      return null;
    }
    return bs58.encode(keypair.secretKey);
  } finally {
    recoveredBytes.fill(0);
  }
}

module.exports = {
  retrieveTwoShares,
  getProvisionedSecretKeyBase58,
};
