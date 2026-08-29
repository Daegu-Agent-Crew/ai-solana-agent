// CLE2-25 Phase 0 — Step 2: create a Raydium CPMM pool on devnet (WSOL + DMEME).
// Manual instruction build using @raydium-io/raydium-sdk-v2 helpers (devnet program).
// DEVNET ONLY.
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import BN from 'bn.js';
import {
  CpmmConfigInfoLayout,
  CpmmPoolInfoLayout,
  DEVNET_PROGRAM_ID,
  getCpmmPdaAmmConfigId,
  getCreatePoolKeys,
  makeCreateCpmmPoolInInstruction,
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

// ── Parameters ────────────────────────────────────────────────────────────────
const CONFIG_INDEX = 0; // devnet amm config 0: tradeFeeRate 0.25%
const SEED_SOL = 0.5; // devnet SOL of initial liquidity (fee 0.15 SOL paid on top, in WSOL)
const PRICE_DMEME_PER_SOL = 10_000_000; // 1 SOL = 10,000,000 DMEME
// ─────────────────────────────────────────────────────────────────────────────

assertDevnet();
const DEVNET_CPMM = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
const CREATE_POOL_FEE_ACC = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC;

const state = loadState();
if (!state.mint) throw new Error('Run meme-coin-mint.mjs first (state.mint missing).');

const wallet = loadOrCreateWallet();
const connection = getConnection();
console.log(`RPC: ${RPC}`);
console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
console.log(`Mint: ${state.mint} (DMEME)`);
console.log(`CPMM program (devnet): ${DEVNET_CPMM.toBase58()}`);

logSection('Resolve amm config');
const configId = getCpmmPdaAmmConfigId(DEVNET_CPMM, CONFIG_INDEX).publicKey;
const configInfo = await connection.getAccountInfo(configId);
if (!configInfo) throw new Error(`Amm config ${CONFIG_INDEX} not found on devnet.`);
const config = CpmmConfigInfoLayout.decode(Buffer.from(configInfo.data));
console.log(
  `config ${String(config.index)}: tradeFeeRate=${String(config.tradeFeeRate) / 1e4}% createPoolFee=${Number(config.createPoolFee) / LAMPORTS_PER_SOL} SOL disableCreatePool=${config.disableCreatePool}`,
);
if (config.disableCreatePool) throw new Error('This config has pool creation disabled.');

logSection('Derive pool keys');
const mintRaw = new PublicKey(state.mint);
const [mintA, mintB] = [new PublicKey(NATIVE_MINT.toBuffer()), new PublicKey(mintRaw.toBuffer())]
  .sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer())); // SDK isFront ordering
console.log(`mintA: ${mintA.toBase58()} ${mintA.equals(NATIVE_MINT) ? '(WSOL)' : '(DMEME)'}`);
console.log(`mintB: ${mintB.toBase58()} ${mintB.equals(NATIVE_MINT) ? '(WSOL)' : '(DMEME)'}`);

const keys = getCreatePoolKeys({ programId: DEVNET_CPMM, configId, mintA, mintB });
console.log(`poolId: ${keys.poolId.toBase58()}`);
console.log(`lpMint: ${keys.lpMint.toBase58()}`);
console.log(`authority: ${keys.authority.toBase58()}`);

const existing = await connection.getAccountInfo(keys.poolId);
if (existing) throw new Error('Pool already exists for this pair + config. Re-run with another config index or skip.');

logSection('Prepare token accounts');
const dmemeAta = await getAssociatedTokenAddress(mintRaw, wallet.publicKey);
const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);
const dmemeAcct = await getAccount(connection, dmemeAta);
console.log(`DMEME ATA: ${dmemeAta.toBase58()} (${Number(dmemeAcct.amount) / 1e6} DMEME)`);
const neededWsolLamports =
  Math.ceil(SEED_SOL * LAMPORTS_PER_SOL) + Number(config.createPoolFee) + 10_000_000; // liquidity + fee + buffer
const wrapIx = createSyncNativeInstruction(wsolAta);
const tx = new Transaction();

if (!(await connection.getAccountInfo(wsolAta))) {
  tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT));
}
tx.add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wsolAta, lamports: neededWsolLamports }));
tx.add(wrapIx);
console.log(`Wrapping ${(neededWsolLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (liquidity ${SEED_SOL} + fee ${Number(config.createPoolFee) / LAMPORTS_PER_SOL} + buffer)`);

const seedDmemeRaw = BigInt(Math.round(SEED_SOL * PRICE_DMEME_PER_SOL)) * 1_000_000n;
console.log(`Seeding ${SEED_SOL} WSOL + ${Number(seedDmemeRaw) / 1e6} DMEME (1 SOL = ${PRICE_DMEME_PER_SOL / 1e6}M DMEME)`);
if (BigInt(dmemeAcct.amount) < seedDmemeRaw) throw new Error('Not enough DMEME balance in creator ATA.');

logSection('Build initializePool instruction');
const amountA = mintA.equals(NATIVE_MINT) ? neededWsolLamports : seedDmemeRaw;
const amountB = mintB.equals(NATIVE_MINT) ? neededWsolLamports : seedDmemeRaw;
const userVaultA = mintA.equals(NATIVE_MINT) ? wsolAta : dmemeAta;
const userVaultB = mintB.equals(NATIVE_MINT) ? wsolAta : dmemeAta;
const userLpAccount = await getAssociatedTokenAddress(keys.lpMint, wallet.publicKey);
tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, userLpAccount, wallet.publicKey, keys.lpMint));

const initPoolIx = makeCreateCpmmPoolInInstruction(
  DEVNET_CPMM,
  wallet.publicKey,
  configId,
  keys.authority,
  keys.poolId,
  mintA,
  mintB,
  keys.lpMint,
  userVaultA,
  userVaultB,
  userLpAccount,
  keys.vaultA,
  keys.vaultB,
  CREATE_POOL_FEE_ACC,
  TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  keys.observationId,
  new BN(amountA.toString()),
  new BN(amountB.toString()),
  new BN(Math.floor(Date.now() / 1000)),
);
tx.add(initPoolIx);

logSection('Send transaction');
const sig = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: 'confirmed', maxRetries: 5 });
await confirmTx(connection, sig, 'create-cpmm-pool');

logSection('Verify pool on-chain');
const poolInfo = await connection.getAccountInfo(keys.poolId);
if (!poolInfo) throw new Error('Pool account missing after creation!');
const pool = CpmmPoolInfoLayout.decode(Buffer.from(poolInfo.data));
console.log(`pool id: ${keys.poolId.toBase58()}`);
console.log(`vaultA: ${pool.vaultA.toBase58()} (mint ${pool.mintA.toBase58()})`);
console.log(`vaultB: ${pool.vaultB.toBase58()} (mint ${pool.mintB.toBase58()})`);
console.log(`lpMint: ${pool.mintLp.toBase58()}`);
const lpAcct = await getAccount(connection, userLpAccount);
console.log(`LP minted to owner: ${Number(lpAcct.amount) / 1e6}`);

saveState({
  poolId: keys.poolId.toBase58(),
  cpmmProgram: DEVNET_CPMM.toBase58(),
  ammConfig: configId.toBase58(),
  authority: keys.authority.toBase58(),
  lpMint: keys.lpMint.toBase58(),
  userLpAccount: userLpAccount.toBase58(),
  vaultA: pool.vaultA.toBase58(),
  vaultB: pool.vaultB.toBase58(),
  wsolAta: wsolAta.toBase58(),
  dmemeAta: dmemeAta.toBase58(),
  txs: { ...(state.txs || {}), createPool: sig },
});
console.log('\nSTEP 2 COMPLETE. State saved.');
