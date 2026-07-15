import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from '@solana/web3.js';
import { mkdir, writeFile } from 'node:fs/promises';

const startedAt = new Date();
const mode = process.argv.includes('--transact') ? 'transact' : 'check';
const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const report = {
  schemaVersion: 1,
  startedAt: startedAt.toISOString(),
  finishedAt: null,
  mode,
  rpcUrl,
  network: 'devnet',
  status: 'running',
  checks: [],
  wallet: null,
  transaction: null,
  error: null,
};

function addCheck(name, status, details = {}) {
  report.checks.push({ name, status, ...details });
}

async function saveReport() {
  report.finishedAt = new Date().toISOString();
  await mkdir('reports', { recursive: true });
  await writeFile('reports/devnet-agent-report.json', `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    '# Devnet Agent Test Report',
    '',
    `- Status: **${report.status.toUpperCase()}**`,
    `- Mode: \`${report.mode}\``,
    `- RPC: \`${report.rpcUrl}\``,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    '',
    '## Checks',
    '',
    ...report.checks.map((check) => `- ${check.status === 'pass' ? '✅' : check.status === 'skip' ? '⏭️' : '❌'} **${check.name}**${check.message ? ` — ${check.message}` : ''}`),
  ];

  if (report.wallet) {
    lines.push('', '## Wallet', '', `- Address: \`${report.wallet.address}\``, `- Balance: ${report.wallet.balanceSol} SOL`);
  }
  if (report.transaction) {
    lines.push('', '## Transaction', '', `- Signature: \`${report.transaction.signature}\``, `- Explorer: ${report.transaction.explorer}`);
  }
  if (report.error) {
    lines.push('', '## Error', '', `\`${report.error.message}\``);
  }

  await writeFile('reports/devnet-agent-report.md', `${lines.join('\n')}\n`);
}

try {
  if (!rpcUrl.toLowerCase().includes('devnet')) {
    throw new Error(`Safety stop: only Devnet RPC is allowed. Received: ${rpcUrl}`);
  }
  addCheck('Devnet-only RPC policy', 'pass');

  const connection = new Connection(rpcUrl, 'confirmed');
  const version = await connection.getVersion();
  const blockHeight = await connection.getBlockHeight('confirmed');
  addCheck('RPC connectivity', 'pass', {
    solanaCore: version['solana-core'],
    blockHeight,
  });

  const secretText = process.env.DEVNET_AGENT_KEYPAIR;
  if (!secretText) {
    addCheck('Devnet agent wallet secret', 'skip', { message: 'DEVNET_AGENT_KEYPAIR is not configured.' });
    report.status = 'pass';
    await saveReport();
    console.log('Network check passed; transaction test skipped because DEVNET_AGENT_KEYPAIR is absent.');
    process.exit(0);
  }

  let secret;
  try {
    secret = JSON.parse(secretText);
  } catch {
    throw new Error('DEVNET_AGENT_KEYPAIR must be a JSON array of 64 integers.');
  }

  if (!Array.isArray(secret) || secret.length !== 64 || secret.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('DEVNET_AGENT_KEYPAIR must contain exactly 64 byte integers (0-255).');
  }
  addCheck('Devnet agent wallet secret', 'pass');

  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const address = payer.publicKey.toBase58();
  const balance = await connection.getBalance(payer.publicKey, 'confirmed');
  const balanceSol = balance / LAMPORTS_PER_SOL;
  report.wallet = { address, balanceLamports: balance, balanceSol: Number(balanceSol.toFixed(9)) };
  addCheck('Wallet derivation and balance', 'pass', { address, balanceSol });

  if (mode !== 'transact') {
    addCheck('Signed self-transaction', 'skip', { message: 'Check mode only.' });
    report.status = 'pass';
    await saveReport();
    console.log(`Wallet check passed for ${address}; balance ${balanceSol.toFixed(6)} SOL.`);
    process.exit(0);
  }

  const minimumBalance = 0.005 * LAMPORTS_PER_SOL;
  if (balance < minimumBalance) {
    throw new Error(`Insufficient Devnet balance. Fund ${address} with at least 0.005 SOL.`);
  }
  addCheck('Minimum Devnet balance', 'pass');

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

  const explorer = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  report.transaction = { signature, explorer, lamports: 0, recipient: address };
  addCheck('Signed zero-SOL self-transaction', 'pass', { signature });
  report.status = 'pass';
  await saveReport();

  console.log(`Transaction passed: ${signature}`);
  console.log(`Explorer: ${explorer}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  report.status = 'fail';
  report.error = { message };
  addCheck('Execution', 'fail', { message });
  await saveReport();
  console.error(message);
  process.exit(1);
}
