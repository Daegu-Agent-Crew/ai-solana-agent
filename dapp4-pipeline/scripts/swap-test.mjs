// CLE2-25 Phase 0 — Step 3: first swap through the CPMM pool (small WSOL -> DMEME).
// DEVNET ONLY.
import {
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAccount,
} from '@solana/spl-token';
import BN from 'bn.js';
import {
  DEVNET_PROGRAM_ID,
  makeSwapCpmmBaseInInstruction,
  getPdaObservationId,
} from '@raydium-io/raydium-sdk-v2';
import {
  assertDevnet,
  confirmTx,
  getConnection,
  loadOrCreateWallet,
  loadState,
  logSection,
  RPC,
  saveState,
} from './lib.mjs';

const SWAP_SOL = 0.001; // tiny educational swap
const SLIPPAGE_BPS = 500; // 5% — devnet demo tolerance

assertDevnet();
const DEVNET_CPMM = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;

const state = loadState();
if (!state.poolId) throw new Error('Run create-cpmm-pool.mjs first (state.poolId missing).');
const wallet = loadOrCreateWallet();
const connection = getConnection();
console.log(`RPC: ${RPC}`);
console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
console.log(`Pool: ${state.poolId}`);

const poolId = new PublicKey(state.poolId);
const mintRaw = new PublicKey(state.mint);
const wsolAta = new PublicKey(state.wsolAta);
const dmemeAta = new PublicKey(state.dmemeAta);
const resolveVault = async () => {
  const vaultA = new PublicKey(state.vaultA);
  const vaultB = new PublicKey(state.vaultB);
  const a = await getAccount(connection, vaultA);
  return String(a.mint) === NATIVE_MINT.toBase58()
    ? { wsolVault: vaultA, dmemeVault: vaultB }
    : { wsolVault: vaultB, dmemeVault: vaultA };
};
const { wsolVault, dmemeVault } = await resolveVault();

logSection('Pool state before swap');
const wsAcct = await getAccount(connection, wsolVault);
const dmAcct = await getAccount(connection, dmemeVault);
const reserveSOL = Number(wsAcct.amount) / LAMPORTS_PER_SOL;
const reserveDM = Number(dmAcct.amount) / 1e6;
console.log(`Reserves: ${reserveSOL.toFixed(6)} WSOL | ${reserveDM.toFixed(2)} DMEME`);

logSection('Prepare swap input (wrap WSOL if needed)');
const amountInLamports = BigInt(Math.round(SWAP_SOL * LAMPORTS_PER_SOL));
const userWs = await getAccount(connection, wsolAta);
const tx = new Transaction();
if (BigInt(userWs.amount) < amountInLamports + 5000n) {
  tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT));
  tx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wsolAta, lamports: Number(amountInLamports * 2n) }));
  tx.add(createSyncNativeInstruction(wsolAta));
  console.log('Wrapped extra SOL for swap input.');
}

logSection('Compute expected output (constant product, 0.25% fee)');
// out = (reserveIn * in * (1-fee)) / (reserveOut + in * (1-fee))  — fee on input
const inRaw = Number(amountInLamports);
const reserveIn = Number(wsAcct.amount);
const reserveOut = Number(dmAcct.amount);
const feeNum = 0.9975; // devnet config 0 trade fee 2500/1e6
const inAfterFee = inRaw * feeNum;
const expectedOut = Math.floor((inAfterFee * reserveOut) / (reserveIn + inAfterFee));
console.log(`Swapping ${SWAP_SOL} SOL -> expected ~${(expectedOut / 1e6).toFixed(2)} DMEME`);
const minOut = BigInt(Math.floor((expectedOut * (10000 - SLIPPAGE_BPS)) / 10000));

const userDmBefore = BigInt((await getAccount(connection, dmemeAta)).amount);
const observationId = getPdaObservationId(DEVNET_CPMM, poolId).publicKey;

const swapIx = makeSwapCpmmBaseInInstruction(
  DEVNET_CPMM,
  wallet.publicKey,
  new PublicKey(state.authority),
  new PublicKey(state.ammConfig),
  poolId,
  wsolAta,
  dmemeAta,
  wsolVault,
  dmemeVault,
  TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  mintRaw,
  observationId,
  new BN(String(amountInLamports)),
  new BN(String(minOut)),
);
tx.add(swapIx);

logSection('Send swap');
const sig = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: 'confirmed', maxRetries: 5 });
await confirmTx(connection, sig, 'swap-base-in');

logSection('Verify swap result');
let userDmAfter = 0n;
for (let i = 0; i < 10; i++) {
  try {
    userDmAfter = BigInt((await getAccount(connection, dmemeAta)).amount);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const received = userDmAfter - userDmBefore;
console.log(`Received: ${Number(received) / 1e6} DMEME (raw ${received})`);
if (received <= 0n) throw new Error('Swap produced no output token change.');
const wsAcct2 = await getAccount(connection, wsolVault);
const dmAcct2 = await getAccount(connection, dmemeVault);
console.log(`Reserves after: ${Number(wsAcct2.amount) / LAMPORTS_PER_SOL} WSOL | ${Number(dmAcct2.amount) / 1e6} DMEME`);

saveState({
  swap: {
    amountInSOL: SWAP_SOL,
    receivedDMEME: Number(received) / 1e6,
    tx: sig,
  },
  txs: { ...(state.txs || {}), swap: sig },
});
console.log('\nSTEP 3 COMPLETE.');
