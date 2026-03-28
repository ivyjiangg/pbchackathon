const { Keypair, Connection, Transaction, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, createTransferInstruction } = require('@solana/spl-token');
const secrets = require('secrets.js-grempe');
const { retrieveTwoShares } = require('./wallet-reconstruct');

// Devnet USDC mint address
const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

async function signAndPay(amountUSDC, recipientAddress) {
  // 1. Retrieve both shares from their separate backends
  const { share1, share2 } = await retrieveTwoShares();

  // 2. Reconstruct keypair in memory
  const recoveredHex = secrets.combine([share1, share2]);
  const recoveredBytes = Buffer.from(recoveredHex, 'hex');
  const keypair = Keypair.fromSecretKey(recoveredBytes);

  // 3. Build and send Solana SPL token transfer
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const recipient = new PublicKey(recipientAddress);
  const amountLamports = Math.round(amountUSDC * 1_000_000); // USDC has 6 decimals

  const fromATA = await getOrCreateAssociatedTokenAccount(
    connection, keypair, USDC_MINT, keypair.publicKey
  );
  const toATA = await getOrCreateAssociatedTokenAccount(
    connection, keypair, USDC_MINT, recipient
  );

  const tx = new Transaction().add(
    createTransferInstruction(
      fromATA.address,
      toATA.address,
      keypair.publicKey,
      amountLamports
    )
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);

  // 4. Zero out reconstructed key immediately
  recoveredBytes.fill(0);

  console.log('TX confirmed:', signature);
  console.log('Solscan:', `https://solscan.io/tx/${signature}?cluster=devnet`);
  return signature;
}

module.exports = { signAndPay };
