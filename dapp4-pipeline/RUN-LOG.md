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

- 재시도 타임라인 (23:11 최초 요청 2 SOL `Internal error` → 23:12 429 → 23:20 429 → 23:30 429, 총 4회 요청/3회 간격 재시도 후 중단)
- **8/30 09:15 자동 재시도 (cron)**: 09:16 요청 1 SOL → `Internal error` → 90초 대기 후 09:18 재요청 → **429** (동일 문구, 일일 한도/파우셋 고갈). 총 2회 요청 후 즉시 중단. 어젯밤 첫 요청(23:11) 기준 24h 롤링 윈도우로 추정 → **다음 자동 재시도 유효 시점: 8/30 23:30 이후** (수동 펀딩은 언제든 가능)
- 응답: `429: You've either reached your airdrop limit today or the airdrop faucet has run dry. Please visit https://faucet.solana.com` → 일일 한 도달 또는 파우셋 고갈 (일시적 버스트가 아님)
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
- 오프라인 검증 대체: initialize ix 32바이트(disc `afaf6d1f0d989bed` ✓), swapBaseInput ix 24바이트(disc `8fbe5adac41e33de` ✓) 드라이런 통과 · devnet config 0 계정 디코딩 통과

## 안전 준수

- devnet 외 RPC 실행 차단 검증 포함(`assertDevnet`) · mainnet 트랜잭션 0건
- 시크릿 키 파일 `.gitignore` 등록(`dapp4-pipeline/.devnet-wallet.json`, `state.json`) · 커밋 대상에서 제외 확인
- 커밋 브랜치: `cle2-25-phase0` 만. main 푸시/PR 없음

## 2026-09-01 · Phase 4 관측 대시보드 통합 설계 (teamwork 경쟁 탐색)

- 과정: teamwork 스킬 — Explorer 3개 전략(MVP / 데이터 깊이 / 교육·투명성) 병렬 설계 → Falsifier 3개 독립 반증 → 통합·게이트 심사(세 안 모두 조건부 생존, 폐기 0건)
- 산출: `DESIGN-market-dashboard.md` (dapp4/market 배치, D1 시계열 축, 컴플라이언스 UI 강제, 반증 반영 측정 수정)
- 주요 정정(반증 결과): ① 집중도 지표는 풀 볼트·번 주소 포함 시 오보 → 필터+명칭 변경 ② 롤링 h24 차분 부호 왜곡 → 증분 정의 ③ Worker egress→공개 RPC 429 실측 → 브라우저 계산 우선 ④ devnet 리허설 무의미 → 섀도우 토큰 방식 채택
- 선행 실측 게이트(0단계) 통과 전 구현 착수 금지로 명문화
- 커밋 브랜치: `cle2-25-phase0` 만. main 푸시/PR 없음

## 2026-09-02 · 0단계 선행 실측 게이트 4건 완료 (teamwork 패턴 B: 분해+병렬)

- 과정: Solver 2명 병렬(게이트 ③페어 선택 · 게이트 ④집중도 필터) + Lead 직접 실측(게이트 ①CPU · 게이트 ②egress RPC, 임시 Worker `dapp4-gate-bench` 배포→실측→삭제) → Verifier 독립 검수(전 게이트 Accepted, 0단계 승인)
- 결과: `dapp4-pipeline/gates/gate{1-2,3,4}*.md` + 벤치마크 코드 `dapp4-pipeline/gate-bench/`

| 게이트 | 판정 | 핵심 결과 |
|---|---|---|
| ① Worker 크론 CPU 10ms | **PASS** | 400행(일 최대치) 지표 8종 집계 cpuMs≈0, 크론 Ok 2회, 한도 초과 0건 |
| ② Worker egress→공개 RPC | **확인 완료(차단 확정)** | `getSlot` 403 "Your IP or provider is blocked" 3회(본문 기록) → 핵심 결정 8(브라우저 우선) 유지 |
| ③ 페어 선택 규칙 | **PASS** | BONK 30페어·BABYSOL·SPSC·RAYCAT, 12분 재조회 top1 불변. 응답 비정렬 확인 → 클라이언트 정렬 계약 필요 |
| ④ 집중도 필터 | **CONDITIONAL** | 필터 전 CR20 56.32% → 필터 후 31.34%(**1.8배 과대 오보 실증**). v1 태그 방식 위양성(온체인 태그 부재) → v2 3단 계층(레지스트리→풀 파싱→owner-program) 채택. 대형 민트는 이 호스트 경로 봉쇄(getTokenLargestAccounts·getProgramAccounts 429 27/27) → 경로 분기 필요 |

- Verifier 경미 지점(판정 불변): 게이트 ④ 원시데이터 일부 미보존(/usr/tmp 소실 — 방법 기록으로 재현 가능), 게이트 ① cpuMs 측정 출처(코드 toFixed(3))·게이트 ③ 격차 공식 정의 미기재 → 보고서에 명시했음
- 잔여 조치: ① 설계 반영 3건(필터 v2 채택 · 소형/대형 민트 경로 분기 · 게이트 ③ 권고 계약화) — 본 커밋에 반영 ② CF 토큰 폐기 권장(회장님 조치) ③ 대형 민트 집중도 경로(브라우저 실증 또는 유료 RPC)는 A단계 분기로 처리
- 커밋 브랜치: `cle2-25-phase0` 만. main 푸시/PR 없음
