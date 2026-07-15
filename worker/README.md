# AI Solana Upload Worker

Cloudflare Worker that uploads a mobile image and generated NFT metadata to this GitHub repository.

## Deploy

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put UPLOAD_AUTH_SECRET
npm run deploy
```

`UPLOAD_AUTH_SECRET` should be a long random string. Example generation:

```bash
openssl rand -hex 32
```

Create a fine-grained GitHub token limited to `Daegu-Agent-Crew/ai-solana-agent` with:

- Contents: Read and write
- Metadata: Read

Do not commit either secret.

## Health check

```bash
curl https://ai-solana-upload.sfex11.workers.dev/api/health
```

Expected security fields:

```json
{
  "ok": true,
  "walletAuth": true,
  "persistentRateLimit": false
}
```

`persistentRateLimit: false` means the Worker uses an edge-cache cooldown. For a persistent daily limit, create a KV namespace and bind it as `UPLOAD_LIMITS`.

```bash
npx wrangler kv namespace create UPLOAD_LIMITS
```

Then add the returned namespace ID to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "UPLOAD_LIMITS"
id = "<namespace-id>"
```

## Upload flow

1. The frontend requests `/api/auth/challenge?wallet=...`.
2. Phantom signs the challenge message.
3. The signed challenge is included in `/api/upload`.
4. The Worker verifies the Ed25519 signature.
5. The image and metadata are committed to GitHub.
6. The Worker waits until both Raw GitHub URLs return successfully.
7. The returned `metadataUri` is used for Phantom NFT minting.

## Limits

- JPEG, PNG, WebP only
- Maximum 5 MB
- 5-minute signature authorization
- Minimum 30 seconds between uploads
- Daily limit 10 when KV is configured
- Allowed browser origin: `https://daegu-agent-crew.github.io`
- Devnet prototype only
