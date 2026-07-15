# AI Solana NFT Agent

Phantom 모바일 지갑으로 Solana Devnet에 NFT를 발행하는 MVP입니다.

이미지 업로드 API는 `https://ai-solana-upload.sfex11.workers.dev`이며, 웹 화면의 `app.js`에서 이 주소를 호출해 GitHub 이미지와 메타데이터를 생성합니다.

## 목표

1. Phantom 연결
2. Devnet SOL 잔액 확인
3. NFT 이름·설명 확인
4. Metaplex Token Metadata NFT 민팅
5. Solana Explorer에서 결과 확인

## 보안

복구 문구·개인키·지갑 비밀번호를 저장하거나 입력하지 않습니다. 모든 서명은 Phantom에서 직접 승인합니다.

## 배포

`main` 브랜치에 push되면 GitHub Actions가 GitHub Pages로 자동 배포합니다.

_Last deployment trigger: 2026-07-15_
