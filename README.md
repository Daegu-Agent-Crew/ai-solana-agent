# AI Solana Agent DApp Hub

Phantom 모바일 지갑으로 Solana Devnet에 NFT를 발행하는 MVP입니다.

## DApps

- `dapp1/` — Memo 기반 출석 체크
- `dapp2/` — NFT 쿠폰 발행과 로컬 사용 처리
- `dapp3/` — 활동 크레딧과 리더보드
- `dapp4/` — Metaplex Core 쿠폰, 3분 QR/OTP, D1 랭킹, 사용 완료 동결

이미지 업로드 API는 `https://ai-solana-upload.sfex11.workers.dev`이며, 웹 화면의 `app.js`에서 이 주소를 호출해 GitHub 이미지와 메타데이터를 생성합니다.

## 목표

1. Phantom 연결
2. Devnet SOL 잔액 확인
3. NFT 이름·설명 확인
4. Metaplex Token Metadata NFT 민팅
5. Solana Explorer에서 결과 확인

## 보안

복구 문구·개인키·지갑 비밀번호를 저장하거나 입력하지 않습니다. 모든 서명은 Phantom에서 직접 승인합니다.

DApp 4의 쓰기 API는 Phantom Ed25519 메시지 서명을 검증하고, 5분 이내 요청과 일회성 nonce만 허용합니다. 쿠폰 사용은 Solana Devnet Memo 트랜잭션을 확인한 뒤 D1에서 원자적으로 상태를 변경합니다.

## DApp 4 Edge API

- API: `https://coupon-loop-api.sfex11.workers.dev`
- D1: 매장, 쿠폰, 사용 기록, 사용자 랭킹
- KV: 180초 OTP, 서명 nonce 재사용 방지

## 배포

`main` 브랜치에 push되면 GitHub Actions가 GitHub Pages로 자동 배포합니다.

_Last deployment trigger: 2026-07-15_
