# AI Solana Upload Worker

Cloudflare Worker that uploads a mobile image and generated NFT metadata to this GitHub repository.

## One-time setup

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npm run deploy
```

Create a fine-grained GitHub token limited to `Daegu-Agent-Crew/ai-solana-agent` with:

- Contents: Read and write
- Metadata: Read

Do not commit the token. Paste it only when `wrangler secret put GITHUB_TOKEN` asks for it.

## Test

```bash
curl https://ai-solana-upload.<your-subdomain>.workers.dev/api/health
```

Expected response:

```json
{
  "ok": true,
  "service": "ai-solana-upload",
  "storage": "github"
}
```

Upload example:

```bash
curl -X POST \
  -F 'file=@photo.jpg' \
  -F 'name=Mobile NFT' \
  -F 'symbol=AISOL' \
  -F 'description=Uploaded from a phone' \
  -F 'wallet=<SOLANA_WALLET>' \
  https://ai-solana-upload.<your-subdomain>.workers.dev/api/upload
```

The response includes `imageUrl` and `metadataUri`. The frontend should use `metadataUri` for Phantom minting.

## Limits

- JPEG, PNG, WebP only
- Maximum 5 MB
- Allowed browser origin: `https://daegu-agent-crew.github.io`
- Devnet prototype only
