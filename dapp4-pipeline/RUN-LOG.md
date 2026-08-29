# CLE2-25 Phase 0 — Solana Meme Coin Devnet Rehearsal RUN LOG

- 목적: 교육·데모. 솔라나 밈코인 라이프사이클(발행 → CPMM 풀 → 첫 스왑 → LP 소각)을 devnet에서 리허설
- 브랜치: `cle2-25-phase0` · 결정사항: Raydium CPMM 수동 루트, mainnet 예산 상한 2 SOL(추후), LP 소각 증명 포함
- 지갑: devnet 전용 (`dapp4-pipeline/.devnet-wallet.json`, gitignored, 절대 커밋 금지)
- 모든 스크립트는 RPC URL에 `devnet` 포함 여부를 검사하는 Safety stop 내장 (`lib.mjs#assertDevnet`)

## 사전 검증 (온체인 사실 조사)

| 항목 | 결과 |
|---|---|
| Raydium CPMM devnet 프로그램 | `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb` (SDK `DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM`) 존재 확인 |
| devnet AmmConfig 0~7 | 전부 존재. config 0 = tradeFee 0.25%, createPoolFee **0.15 SOL(WSOL)**, `disableCreatePool=false` |
| create pool fee 계정 | `3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy` — WSOL 토큰 계정(ATA) 확인 → 풀 생성 수수료는 WSOL로 지불 |
| SDK 설치 | `@raydium-io/raydium-sdk-v2@0.2.62-alpha` Termux arm64 설치 성공 (npm install 이상 없음) |

## 단계별 실행 결과

### Step 1 — 코인 발행 (`meme-coin-mint.mjs`)
- 스펙: 1,000,000,000 DMEME / 6 decimals / Metaplex 메타데이터(불변) / mint·freeze authority 폐기
- 지갑: `2Ln5n8rB5Gh7bjmmurqhTZzbdT5PjezWumQYgMTMUDbh`
- 상태: ⏳ **BLOCKED — devnet 파우셋 429**

### Step 2 — CPMM 풀 생성 (`create-cpmm-pool.mjs`)
- 스펙: devnet config 0, 시드 0.5 WSOL + 5,000,000 DMEME (1 SOL = 10M DMEME), LP ATA 동봉
- 상태: ⏳ BLOCKED (Step 1 잔고 의존)

### Step 3 — 첫 스왑 (`swap-test.mjs`)
- 스펙: 0.001 SOL → DMEME, 5% 슬리피지, 온체인 준비금으로 기대 출력 계산
- 상태: ⏳ BLOCKED (Step 2 의존)

### Step 4 — LP 전량 소각 (`burn-lp.mjs`)
- 스펙: SPL `burn`으로 크리에이터 LP 전량 소각 → 잔여 LP 0, 준비금은 풀에 영구 귀속(러그풀 불가 증명)
- 상태: ⏳ BLOCKED (Step 2 의존)

## 막힌 지점 (정확한 기록)

**Devnet SOL 부족 — 퍼블릭 파우셋 고갈/레이트리밋.**

- 최초 요청(2 SOL): `Internal error` → 45초 후 재시도 → `429: You've either reached your airdrop limit today or the airdrop faucet has run dry. Please visit https://faucet.solana.com`
- 재시도 간격: 첫 실패 후 45s → 약 8분 후 1회 → 계속 429 (일일 한 도달 또는 파우셋 고갈 추정)
- 대체 무료 RPC 검토: drpc(유료 플랜 필요), ankr(API 키 필요), publicnode(엔드포인트 없음), helius(API 키 필요) → 전부 불가
- 리포 내 기존 devnet 지갑 잔액 조사: 로컬 키페어 없음(기존 지갑은 GitHub Actions 시크릿에만 존재)

필요 최소 잔고: Step1 약 0.03 SOL + Step2 약 0.7 SOL(0.15 수수료+0.5 시드+랜트) + Step3 약 0.01 SOL ≈ **0.75 SOL** (파우셋 1회 요청으로 충분)

## 다음 액션 제안

1. **수동 펀딩(최우선, 1분 소요)**: 회장님이 보유한 다른 devnet 지갑(또는 faucet.solana.com에서 GitHub 로그인으로 발급)에서 `2Ln5n8rB5Gh7bjmmurqhTZzbdT5PjezWumQYgMTMUDbh`로 ≥0.8 devnet SOL 전송. 이후 아래 4개 커맨드만 순차 실행하면 전 파이프라인 완료:
   ```bash
   node dapp4-pipeline/scripts/meme-coin-mint.mjs
   node dapp4-pipeline/scripts/create-cpmm-pool.mjs
   node dapp4-pipeline/scripts/swap-test.mjs
   node dapp4-pipeline/scripts/burn-lp.mjs
   ```
2. **자동 대기 재시도**: 파우셋은 주기적으로 리필됨. 1~2시간 간격으로 1 SOL 요청 재시도 스크립트 회람 가능(429 시 즉시 중단하는 보수적 로직 이미 `lib.mjs#ensureBalance`에 구현됨).
3. **GitHub Actions 우회**: 시크릿 `DEVNET_AGENT_KEYPAIR` 지갑에 잔고가 있다면 해당 키페어로 실행하도록 스크립트가 env `DEVNET_AGENT_KEYPAIR` 우선 로드하도록 개선 가능(현재는 파일 우선).

## 트랜잭션 서명

- (펀딩 후 기록: metadata / mintTo / revokeMint / revokeFreeze / createPool / swap / burnLP)

## 안전 준수

- devnet 외 RPC 실행 차단 검증 포함(`assertDevnet`) · mainnet 트랜잭션 0건
- 시크릿 키 파일 `.gitignore` 등록(`dapp4-pipeline/.devnet-wallet.json`, `state.json`) · 커밋 대상에서 제외 확인
- 커밋 브랜치: `cle2-25-phase0` 만. main 푸시/PR 없음
