import fs from 'node:fs';

const uri = process.env.NFT_METADATA_URI;
if (!uri || !uri.startsWith('https://')) {
  throw new Error('NFT_METADATA_URI must be a public HTTPS URL.');
}

const response = await fetch(uri, {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(15000),
});

if (!response.ok) {
  throw new Error(`Metadata request failed: HTTP ${response.status}`);
}

const metadata = await response.json();
const errors = [];

if (typeof metadata.name !== 'string' || !metadata.name.trim()) errors.push('name is required');
if (typeof metadata.description !== 'string' || !metadata.description.trim()) errors.push('description is required');
if (typeof metadata.image !== 'string' || !metadata.image.startsWith('https://')) errors.push('image must be an HTTPS URL');

let imageStatus = null;
let imageType = null;
if (!errors.length) {
  const imageResponse = await fetch(metadata.image, {
    method: 'HEAD',
    signal: AbortSignal.timeout(15000),
  });
  imageStatus = imageResponse.status;
  imageType = imageResponse.headers.get('content-type') || '';
  if (!imageResponse.ok) errors.push(`image request failed: HTTP ${imageResponse.status}`);
  if (imageType && !imageType.startsWith('image/')) errors.push(`image content-type is not image/*: ${imageType}`);
}

const report = {
  ok: errors.length === 0,
  uri,
  name: metadata.name || null,
  description: metadata.description || null,
  image: metadata.image || null,
  imageStatus,
  imageType,
  attributesCount: Array.isArray(metadata.attributes) ? metadata.attributes.length : 0,
  errors,
  checkedAt: new Date().toISOString(),
};

fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/metadata-validation-report.json', JSON.stringify(report, null, 2));
fs.writeFileSync(
  'reports/metadata-validation-report.md',
  `# NFT Metadata Validation\n\n` +
    `- Status: ${report.ok ? 'PASS' : 'FAIL'}\n` +
    `- URI: ${report.uri}\n` +
    `- Name: ${report.name || '-'}\n` +
    `- Image: ${report.image || '-'}\n` +
    `- Image HTTP: ${report.imageStatus ?? '-'}\n` +
    `- Image type: ${report.imageType || '-'}\n` +
    `- Attributes: ${report.attributesCount}\n` +
    (errors.length ? `- Errors: ${errors.join('; ')}\n` : ''),
);

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
