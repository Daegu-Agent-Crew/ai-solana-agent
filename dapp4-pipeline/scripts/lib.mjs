// Shared helpers for CLE2-25 Phase 0 devnet rehearsal scripts.
// DEVNET ONLY — every script refuses to run against a non-devnet RPC.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair } from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PIPELINE_DIR = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(PIPELINE_DIR, '..');
export const WALLET_PATH = path.join(PIPELINE_DIR, '.devnet-wallet.json');
export const STATE_PATH = path.join(PIPELINE_DIR, 'state.json');

export const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export function assertDevnet(rpc = RPC) {
  if (!rpc.toLowerCase().includes('devnet')) {
    throw new Error(`Safety stop: only Devnet RPC is allowed. Received: ${rpc}`);
  }
}

export function loadOrCreateWallet() {
  if (fs.existsSync(WALLET_PATH)) {
    const bytes = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error('dapp4-pipeline/.devnet-wallet.json is malformed.');
    }
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  const keypair = Keypair.generate();
  fs.writeFileSync(WALLET_PATH, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`New devnet wallet created: ${keypair.publicKey.toBase58()}`);
  console.log(`Stored (gitignored) at: ${WALLET_PATH}`);
  return keypair;
}

export function getConnection() {
  assertDevnet();
  return new Connection(RPC, 'confirmed');
}

export function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

export function saveState(patch) {
  const state = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

export async function confirmTx(connection, signature, label = 'tx') {
  const latest = await connection.getLatestBlockhash('confirmed');
  const result = await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    'confirmed',
  );
  if (result.value.err) {
    throw new Error(`${label} failed on-chain: ${JSON.stringify(result.value.err)} (${signature})`);
  }
  console.log(`${label} confirmed: ${signature}`);
  return signature;
}

export async function ensureBalance(connection, pubkey, minLamports, requestLamports, label = 'airdrop') {
  let balance = await connection.getBalance(pubkey, 'confirmed');
  if (balance >= minLamports) {
    console.log(`Balance OK: ${(balance / 1e9).toFixed(6)} SOL`);
    return balance;
  }
  console.log(`Balance low (${(balance / 1e9).toFixed(6)} SOL). Requesting ${(requestLamports / 1e9).toFixed(2)} SOL devnet airdrop...`);
  try {
    const sig = await connection.requestAirdrop(pubkey, requestLamports);
    await confirmTx(connection, sig, label);
  } catch (error) {
    console.warn(`Airdrop unavailable (likely rate limit): ${error instanceof Error ? error.message : String(error)}`);
    console.warn('Wait ~60s+ before retrying. Devnet airdrop is rate-limited per IP/wallet.');
  }
  balance = await connection.getBalance(pubkey, 'confirmed');
  console.log(`Balance now: ${(balance / 1e9).toFixed(6)} SOL`);
  return balance;
}

export function logSection(title) {
  console.log(`\n=== ${title} ===`);
}
