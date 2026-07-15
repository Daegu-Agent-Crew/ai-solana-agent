import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
  getAccount,
  setAuthority,
  AuthorityType,
} from '@solana/spl-token';
import fs from 'node:fs/promises';

const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
if (!rpcUrl.toLowerCase().includes('devnet')) {
  throw new Error(`Safety stop: only Devnet RPC is allowed. Received: ${rpcUrl}`);
}

const secretText = process.env.DEVNET_AGENT_KEYPAIR;
if (!secretText) throw new Error('DEVNET_AGENT_KEYPAIR is not configured.');

const secret = JSON.parse(secretText);
if (!Array.isArray(secret) || secret.length !== 64) {
  throw new Error('DEVNET_AGENT_KEYPAIR must contain exactly 64 integers.');
}

const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection(rpcUrl, 'confirmed');
const balance = await connection.getBalance(payer.publicKey, 'confirmed');
if (balance < 0.01 * LAMPORTS_PER_SOL) {
  throw new Error(`Insufficient Devnet balance. Wallet ${payer.publicKey.toBase58()} needs at least 0.01 SOL.`);
}

const startedAt = new Date().toISOString();
const mint = await createMint(
  connection,
  payer,
  payer.publicKey,
  payer.publicKey,
  0,
);

const tokenAccount = await getOrCreateAssociatedTokenAccount(
  connection,
  payer,
  mint,
  payer.publicKey,
);

const mintSignature = await mintTo(
  connection,
  payer,
  mint,
  tokenAccount.address,
  payer,
  1,
);

await setAuthority(
  connection,
  payer,
  mint,
  payer,
  AuthorityType.MintTokens,
  null,
);

const mintInfo = await getMint(connection, mint, 'confirmed');
const accountInfo = await getAccount(connection, tokenAccount.address, 'confirmed');

if (mintInfo.decimals !== 0) throw new Error(`Unexpected decimals: ${mintInfo.decimals}`);
if (mintInfo.supply !== 1n) throw new Error(`Unexpected supply: ${mintInfo.supply}`);
if (accountInfo.amount !== 1n) throw new Error(`Unexpected token amount: ${accountInfo.amount}`);
if (mintInfo.mintAuthority !== null) throw new Error('Mint authority was not revoked.');

const report = {
  status: 'pass',
  network: 'devnet',
  startedAt,
  finishedAt: new Date().toISOString(),
  wallet: payer.publicKey.toBase58(),
  balanceSol: balance / LAMPORTS_PER_SOL,
  mint: mint.toBase58(),
  tokenAccount: tokenAccount.address.toBase58(),
  supply: mintInfo.supply.toString(),
  decimals: mintInfo.decimals,
  mintAuthorityRevoked: mintInfo.mintAuthority === null,
  mintSignature,
  explorer: `https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`,
};

await fs.mkdir('reports', { recursive: true });
await fs.writeFile('reports/devnet-mint-report.json', JSON.stringify(report, null, 2));
await fs.writeFile(
  'reports/devnet-mint-report.md',
  `# Devnet SPL Mint Test\n\n- Status: PASS\n- Wallet: \`${report.wallet}\`\n- Mint: \`${report.mint}\`\n- Token account: \`${report.tokenAccount}\`\n- Supply: ${report.supply}\n- Decimals: ${report.decimals}\n- Mint authority revoked: ${report.mintAuthorityRevoked}\n- Transaction: \`${report.mintSignature}\`\n- Explorer: ${report.explorer}\n`,
);

console.log(JSON.stringify(report, null, 2));
