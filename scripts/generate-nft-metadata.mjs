import fs from 'node:fs';
import path from 'node:path';

const name = (process.env.NFT_NAME || 'AI Agent NFT').trim();
const symbol = (process.env.NFT_SYMBOL || 'AISOL').trim();
const description = (process.env.NFT_DESCRIPTION || 'Created by the AI Solana Agent on Devnet.').trim();
const image = (process.env.NFT_IMAGE_URL || 'https://daegu-agent-crew.github.io/ai-solana-agent/assets/ai-agent-nft.svg').trim();
const rawAttributes = (process.env.NFT_ATTRIBUTES || '[{"trait_type":"Network","value":"Devnet"}]').trim();
const runNumber = process.env.GITHUB_RUN_NUMBER || Date.now().toString();
const fileName = `${Date.now()}-${runNumber}.json`;
const outputPath = path.join('metadata', 'generated', fileName);

if (Buffer.byteLength(name, 'utf8') > 32) throw new Error('NFT_NAME exceeds 32 UTF-8 bytes.');
if (Buffer.byteLength(symbol, 'utf8') > 10) throw new Error('NFT_SYMBOL exceeds 10 UTF-8 bytes.');
if (!image.startsWith('https://')) throw new Error('NFT_IMAGE_URL must use HTTPS.');

let attributes;
try {
  attributes = JSON.parse(rawAttributes);
} catch {
  throw new Error('NFT_ATTRIBUTES must be valid JSON.');
}
if (!Array.isArray(attributes)) throw new Error('NFT_ATTRIBUTES must be a JSON array.');

const metadata = {
  name,
  symbol,
  description,
  image,
  attributes,
  properties: {
    files: [{ uri: image, type: image.endsWith('.svg') ? 'image/svg+xml' : 'image/*' }],
    category: 'image',
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2) + '\n');

const rawUri = `https://raw.githubusercontent.com/Daegu-Agent-Crew/ai-solana-agent/main/${outputPath}`;
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/generated-metadata-path.txt', `${outputPath}\n`);
fs.writeFileSync('reports/generated-metadata-uri.txt', `${rawUri}\n`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `path=${outputPath}\nuri=${rawUri}\n`);
}

console.log(JSON.stringify({ outputPath, rawUri, metadata }, null, 2));
