// CLE2-25 Phase 0 — Step 4: burn ALL LP tokens held by the creator wallet.
// This proves the "no-rug" structure: liquidity can never be withdrawn by the creator.
// DEVNET ONLY.
import { PublicKey } from '@solana/web3.js';
import { burn, getAccount, getMint } from '@solana/spl-token';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
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

assertDevnet();
const state = loadState();
if (!state.userLpAccount) throw new Error('Run create-cpmm-pool.mjs first (state.userLpAccount missing).');

const wallet = loadOrCreateWallet();
const connection = getConnection();
console.log(`RPC: ${RPC}`);
console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

logSection('LP position before burn');
const lpAccount = await getAccount(connection, new PublicKey(state.userLpAccount));
const lpBalance = BigInt(lpAccount.amount);
console.log(`Creator LP balance: ${Number(lpBalance) / 1e6} LP (${lpBalance} raw)`);
if (lpBalance <= 0n) throw new Error('No LP tokens left to burn.');

logSection('Burn all LP tokens');
const sig = await burn(
  connection,
  wallet, // payer
  new PublicKey(state.userLpAccount), // account
  wallet, // owner (authority)
  lpBalance,
);
await confirmTx(connection, sig, 'burn-lp');

logSection('On-chain verification');
let after = null;
for (let i = 0; i < 10; i++) {
  try {
    const acct = await getAccount(connection, new PublicKey(state.userLpAccount));
    after = BigInt(acct.amount);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 2000));
  }
}
console.log(`Creator LP balance after burn: ${Number(after ?? -1n) / 1e6} LP`);
if (after !== 0n) throw new Error('LP was not fully burned!');

const lpMintInfo = await getMint(connection, new PublicKey(state.lpMint));
console.log(`LP total supply remaining (burned share gone forever): ${Number(lpMintInfo.supply) / 1e6}`);

// Reserves stay locked inside the pool — creator can no longer withdraw them.
const vaultA = await getAccount(connection, new PublicKey(state.vaultA));
const vaultB = await getAccount(connection, new PublicKey(state.vaultB));
console.log(`Reserves still providing liquidity:`);
console.log(`  vaultA: ${vaultA.mint.toBase58()} -> ${Number(vaultA.amount) / LAMPORTS_PER_SOL}`);
console.log(`  vaultB: ${vaultB.mint.toBase58()} -> ${Number(vaultB.amount) / 1e6}`);
console.log(`=> Creator holds 0 LP: liquidity withdrawal (rug pull) is now impossible.`);

saveState({
  lpBurn: {
    burnedRaw: String(lpBalance),
    remainingLpSupply: String(lpMintInfo.supply),
    tx: sig,
  },
  txs: { ...(state.txs || {}), burnLp: sig },
});
console.log('\nSTEP 4 COMPLETE.');
