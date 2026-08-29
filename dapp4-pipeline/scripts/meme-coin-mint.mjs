// CLE2-25 Phase 0 — Step 1: mint the educational meme coin on Solana devnet.
// 1,000,000,000 supply / 6 decimals / Metaplex metadata / mint+freeze authority revoked.
// DEVNET ONLY.
import {
  AuthorityType,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  getMint,
} from '@solana/spl-token';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, publicKey, signerIdentity } from '@metaplex-foundation/umi';
import {
  createMetadataAccountV3,
  findMetadataPda,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  assertDevnet,
  confirmTx,
  ensureBalance,
  getConnection,
  loadOrCreateWallet,
  logSection,
  RPC,
  saveState,
} from './lib.mjs';

const NAME = 'CLE2 Devnet Meme Coin';
const SYMBOL = 'DMEME';
const DECIMALS = 6;
const SUPPLY = 1_000_000_000n * 10n ** BigInt(DECIMALS); // 1e15 raw
const METADATA_URI =
  'https://raw.githubusercontent.com/Daegu-Agent-Crew/ai-solana-agent/cle2-25-phase0/dapp4-pipeline/metadata/cle2-meme-001.json';

assertDevnet();

const wallet = loadOrCreateWallet();
const connection = getConnection();
console.log(`RPC: ${RPC}`);
console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

// Keep it conservative: only top up enough for mint + rent (~0.05 SOL margin).
const balance = await ensureBalance(
  connection,
  wallet.publicKey,
  0.05 * LAMPORTS_PER_SOL,
  1 * LAMPORTS_PER_SOL,
  'mint-funding',
);
if (balance < 0.05 * LAMPORTS_PER_SOL) {
  throw new Error('Insufficient devnet balance after airdrop attempt; retry later.');
}

logSection('Create SPL mint (6 decimals)');
const mint = await createMint(connection, wallet, wallet.publicKey, wallet.publicKey, DECIMALS);
console.log(`Mint: ${mint.toBase58()}`);

logSection('Attach Metaplex metadata (immutable)');
const umi = createUmi(RPC).use(mplTokenMetadata());
const umiKeypair = umi.eddsa.createKeypairFromSecretKey(wallet.secretKey);
const identity = createSignerFromKeypair(umi, umiKeypair);
umi.use(signerIdentity(identity));

const metadataTx = await createMetadataAccountV3(umi, {
  mint: publicKey(mint.toBase58()),
  mintAuthority: identity,
  data: { name: NAME, symbol: SYMBOL, uri: METADATA_URI },
  isMutable: false,
  collectionDetails: null,
}).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
const metadataSig = Array.isArray(metadataTx) ? metadataTx[0] : metadataTx.signature ?? String(metadataTx);
console.log(`Metadata tx: ${metadataSig}`);
const metadataPda = findMetadataPda(umi, { mint: publicKey(mint.toBase58()) })[0];
console.log(`Metadata PDA: ${metadataPda}`);

logSection('Mint full supply to creator ATA');
const ata = await getOrCreateAssociatedTokenAccount(connection, wallet, mint, wallet.publicKey);
console.log(`Creator ATA: ${ata.address.toBase58()}`);
const mintToSig = await mintTo(connection, wallet, mint, ata.address, wallet.publicKey, SUPPLY);
await confirmTx(connection, mintToSig, 'mintTo');

logSection('Revoke mint authority');
const revokeMintSig = await setAuthority(
  connection, wallet, mint, null, AuthorityType.MintTokens, wallet,
);
await confirmTx(connection, revokeMintSig, 'revoke-mint-authority');

logSection('Revoke freeze authority');
const revokeFreezeSig = await setAuthority(
  connection, wallet, mint, null, AuthorityType.FreezeAccount, wallet,
);
await confirmTx(connection, revokeFreezeSig, 'revoke-freeze-authority');

logSection('On-chain verification');
const mintInfo = await getMint(connection, mint);
if (mintInfo.mintAuthority !== null) throw new Error('Mint authority NOT revoked!');
if (mintInfo.freezeAuthority !== null) throw new Error('Freeze authority NOT revoked!');
if (mintInfo.supply !== SUPPLY) throw new Error(`Unexpected supply: ${mintInfo.supply}`);
console.log(`mintAuthority: null ✓`);
console.log(`freezeAuthority: null ✓`);
console.log(`supply: ${mintInfo.supply} raw = ${mintInfo.supply / 10n ** BigInt(DECIMALS)} DMEME ✓`);

saveState({
  mint: mint.toBase58(),
  metadataPda: String(metadataPda),
  metadataUri: METADATA_URI,
  creatorAta: ata.address.toBase58(),
  txs: {
    metadata: String(metadataSig),
    mintTo: mintToSig,
    revokeMintAuthority: revokeMintSig,
    revokeFreezeAuthority: revokeFreezeSig,
  },
});
console.log('\nSTEP 1 COMPLETE. State saved to dapp4-pipeline/state.json');
