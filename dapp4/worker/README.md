# Coupon Loop Worker

DApp 4의 Cloudflare Edge API입니다.

## Endpoints

- `GET /health`
- `GET /api/ranking`
- `GET /api/coupons?owner=...`
- `GET /api/coupons?storeOwner=...`
- `POST /api/stores`
- `POST /api/coupons`
- `POST /api/coupon/otp`
- `POST /api/coupon/redeem`
- `POST /api/coupon/freeze`

쓰기 요청은 `X-Wallet`, `X-Timestamp`, `X-Nonce`, `X-Signature` 헤더로 Phantom Ed25519 서명을 검증합니다. OTP는 KV에서 180초 후 만료되며 쿠폰 상태와 랭킹은 D1에 저장됩니다.

## Deploy

```bash
npm install
npx wrangler d1 migrations apply coupon-loop-db --remote
npm run deploy
```
