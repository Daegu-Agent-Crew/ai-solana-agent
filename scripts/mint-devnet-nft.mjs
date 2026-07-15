import fs from 'node:fs';
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
const METADATA_URI = process.env.NFT_METADATA_URI ||
  'https://daegu-agent-crew.github.io/ai-solana-agent/metadata/doctor-slump-001.json';

if (!RPC.toLowerCase().includes('devnet')) {
  throw new Error(`Safety stop: only Devnet RPC is allowed. Received: ${RPC}`);
}
if (!SECRET) throw new Error('DEVNET_AGENT_KEYPAIR is required.');

const bytes = JSON.parse(SECRET);
if (!Array.isArray(bytes) || bytes.length !== 64) {
  throw new Error('DEVNET_AGENT_KEYPAIR must be a JSON array of 64 integers.');
}

const umi = createUmi(RPC).use(mplTokenMetadata());
const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(bytes));
const identity = createSignerFromKeypair(umi, keypair);
umi.use(signerIdentity(identity));

const mint = generateSigner(umi);
const name = 'AI Solana Agent NFT #001';

console.log(`RPC: ${RPC}`);
console.log(`Agent wallet: ${identity.publicKey}`);
console.log(`Metadata URI: ${METADATA_URI}`);
console.log(`Mint candidate: ${mint.publicKey}`);

const result = await createNft(umi, {
  mint,
  name,
  symbol: 'AISOL',
  uri: METADATA_URI,
  sellerFeeBasisPoints: percentAmount(0),
  isMutable: false,
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
    console.log(`Metadata verification attempt ${attempt}/12 pending: ${verificationWarning}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const explorer = `https://explorer.solana.com/address/${mint.publicKey}?cluster=devnet`;
const report = {
  ok: true,
  network: 'devnet',
  wallet: identity.publicKey.toString(),
  mint: mint.publicKey.toString(),
  metadata: asset?.metadata.publicKey.toString() || metadataPda.toString(),
  name: asset?.metadata.name || name,
  symbol: asset?.metadata.symbol || 'AISOL',
  uri: asset?.metadata.uri || METADATA_URI,
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
    `- URI: ${report.uri}\n` +
    `- Explorer: ${report.explorer}\n` +
    (report.verificationWarning ? `- Verification warning: ${report.verificationWarning}\n` : ''),
);

console.log(JSON.stringify(report, null, 2));
