import fs from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createSignerFromKeypair,
  generateSigner,
  percentAmount,
  signerIdentity,
} from '@metaplex-foundation/umi';
import {
  createNft,
  fetchDigitalAsset,
  findMetadataPda,
  mplTokenMetadata,
} from '@metaplex-foundation/mpl-token-metadata';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const SECRET = process.env.DEVNET_AGENT_KEYPAIR;
const defaultName = `AI Agent #${Date.now().toString().slice(-10)}`;
const name = (process.env.NFT_NAME || defaultName).trim();
const symbol = (process.env.NFT_SYMBOL || 'AISOL').trim().toUpperCase();
const metadataUri = (process.env.NFT_METADATA_URI ||
  'https://daegu-agent-crew.github.io/ai-solana-agent/metadata/doctor-slump-001.json').trim();
const isMutable = String(process.env.NFT_IS_MUTABLE || 'false').toLowerCase() === 'true';

if (!RPC.toLowerCase().includes('devnet')) {
  throw new Error(`Safety stop: only Devnet RPC is allowed. Received: ${RPC}`);
}
if (!SECRET) throw new Error('DEVNET_AGENT_KEYPAIR is required.');
if (!name) throw new Error('NFT_NAME cannot be empty.');
if (Buffer.byteLength(name, 'utf8') > 32) {
  throw new Error(`NFT name exceeds Metaplex 32-byte limit: ${name}`);
}
if (!symbol) throw new Error('NFT_SYMBOL cannot be empty.');
if (Buffer.byteLength(symbol, 'utf8') > 10) {
  throw new Error(`NFT symbol exceeds Metaplex 10-byte limit: ${symbol}`);
}
if (!metadataUri.startsWith('https://')) {
  throw new Error('NFT_METADATA_URI must use HTTPS.');
}
if (Buffer.byteLength(metadataUri, 'utf8') > 200) {
  throw new Error('NFT_METADATA_URI exceeds the 200-byte limit.');
}

const bytes = JSON.parse(SECRET);
if (!Array.isArray(bytes) || bytes.length !== 64) {
  throw new Error('DEVNET_AGENT_KEYPAIR must be a JSON array of 64 integers.');
}

const secretBytes = Uint8Array.from(bytes);
const web3Keypair = Keypair.fromSecretKey(secretBytes);
const connection = new Connection(RPC, 'confirmed');
let balance = await connection.getBalance(web3Keypair.publicKey, 'confirmed');

if (balance < 0.03 * LAMPORTS_PER_SOL) {
  console.log(`Low Devnet balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL. Requesting airdrop.`);
  try {
    const airdropSignature = await connection.requestAirdrop(web3Keypair.publicKey, LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({
      signature: airdropSignature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed');
    balance = await connection.getBalance(web3Keypair.publicKey, 'confirmed');
  } catch (error) {
    console.warn(`Devnet airdrop unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (balance < 0.015 * LAMPORTS_PER_SOL) {
  throw new Error(`Insufficient Devnet balance for NFT mint: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL.`);
}

const umi = createUmi(RPC).use(mplTokenMetadata());
const keypair = umi.eddsa.createKeypairFromSecretKey(secretBytes);
const identity = createSignerFromKeypair(umi, keypair);
umi.use(signerIdentity(identity));
const mint = generateSigner(umi);

console.log(`RPC: ${RPC}`);
console.log(`Agent wallet: ${identity.publicKey}`);
console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
console.log(`NFT name: ${name}`);
console.log(`NFT symbol: ${symbol}`);
console.log(`Metadata URI: ${metadataUri}`);
console.log(`Mutable: ${isMutable}`);
console.log(`Mint candidate: ${mint.publicKey}`);

const result = await createNft(umi, {
  mint,
  name,
  symbol,
  uri: metadataUri,
  sellerFeeBasisPoints: percentAmount(0),
  isMutable,
}).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

const metadataPda = findMetadataPda(umi, { mint: mint.publicKey })[0];
let asset = null;
let verificationWarning = '';

for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    asset = await fetchDigitalAsset(umi, mint.publicKey);
    break;
  } catch (error) {
    verificationWarning = error instanceof Error ? error.message : String(error);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const explorer = `https://explorer.solana.com/address/${mint.publicKey}?cluster=devnet`;
const report = {
  ok: true,
  network: 'devnet',
  wallet: identity.publicKey.toString(),
  balanceSolBeforeMint: balance / LAMPORTS_PER_SOL,
  mint: mint.publicKey.toString(),
  metadata: asset?.metadata.publicKey.toString() || metadataPda.toString(),
  name: asset?.metadata.name || name,
  symbol: asset?.metadata.symbol || symbol,
  uri: asset?.metadata.uri || metadataUri,
  isMutable,
  verifiedByFetch: Boolean(asset),
  verificationWarning: asset ? '' : verificationWarning,
  signatureBytes: Array.from(result.signature),
  explorer,
  createdAt: new Date().toISOString(),
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/devnet-nft-report.json', JSON.stringify(report, null, 2));
fs.writeFileSync(
  'reports/devnet-nft-report.md',
  `# Devnet NFT Mint Report\n\n` +
    `- Status: PASS\n` +
    `- Wallet: \`${report.wallet}\`\n` +
    `- Mint: \`${report.mint}\`\n` +
    `- Metadata: \`${report.metadata}\`\n` +
    `- Metadata fetch verified: ${report.verifiedByFetch}\n` +
    `- Name: ${report.name}\n` +
    `- Symbol: ${report.symbol}\n` +
    `- Mutable: ${report.isMutable}\n` +
    `- URI: ${report.uri}\n` +
    `- Explorer: ${report.explorer}\n` +
    (report.verificationWarning ? `- Verification warning: ${report.verificationWarning}\n` : ''),
);

console.log(JSON.stringify(report, null, 2));