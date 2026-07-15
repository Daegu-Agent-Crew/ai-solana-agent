import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from '@solana/web3.js';

const mode = process.argv.includes('--transact') ? 'transact' : 'check';
const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');

if (!rpcUrl.toLowerCase().includes('devnet')) {
  throw new Error(`Safety stop: only Devnet RPC is allowed. Received: ${rpcUrl}`);
}

const connection = new Connection(rpcUrl, 'confirmed');
const version = await connection.getVersion();
const blockHeight = await connection.getBlockHeight('confirmed');

console.log(`RPC: ${rpcUrl}`);
console.log(`Solana core: ${version['solana-core']}`);
console.log(`Block height: ${blockHeight}`);

const secretText = process.env.DEVNET_AGENT_KEYPAIR;
if (!secretText) {
  console.log('DEVNET_AGENT_KEYPAIR is not configured. Network check passed; transaction test skipped.');
  process.exit(0);
}

let secret;
try {
  secret = JSON.parse(secretText);
} catch {
  throw new Error('DEVNET_AGENT_KEYPAIR must be a JSON array of 64 integers.');
}

if (!Array.isArray(secret) || secret.length !== 64) {
  throw new Error('DEVNET_AGENT_KEYPAIR must contain exactly 64 integers.');
}

const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
const address = payer.publicKey.toBase58();
const balance = await connection.getBalance(payer.publicKey, 'confirmed');

console.log(`Agent wallet: ${address}`);
console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

if (mode !== 'transact') {
  console.log('Wallet and balance check passed.');
  process.exit(0);
}

const minimumBalance = 0.005 * LAMPORTS_PER_SOL;
if (balance < minimumBalance) {
  throw new Error(`Insufficient Devnet balance. Fund ${address} with at least 0.005 SOL.`);
}

// Safety policy: only a zero-lamport self-transfer is permitted.
const latest = await connection.getLatestBlockhash('confirmed');
const transaction = new Transaction({
  feePayer: payer.publicKey,
  recentBlockhash: latest.blockhash,
}).add(
  SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: payer.publicKey,
    lamports: 0,
  }),
);

transaction.sign(payer);
const signature = await connection.sendRawTransaction(transaction.serialize(), {
  skipPreflight: false,
  maxRetries: 5,
});

const confirmation = await connection.confirmTransaction(
  {
    signature,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  },
  'confirmed',
);

if (confirmation.value.err) {
  throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
}

console.log(`Transaction passed: ${signature}`);
console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
