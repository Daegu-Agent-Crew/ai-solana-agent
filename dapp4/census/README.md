# dapp4/census — 밈코인 권한 센서스 (CLE2-29 Phase 1)

솔라나 신규 밈코인의 **권한 폐기 상태**(mint/freeze/update authority)를 read-only로 관측해,
"규범 전염(B) vs 템플릿 확산(A)" 판정 함수 v2(4스위치 + 프레임 조항)를 운영하는 대시보드·파이프라인.

> **컴플라이언스 (강제)**: 교육·관측 목적 · 투자 권유 아님 · read-only.
> 거래·서명·발송 기능 없음(코드 레벨 차단). 금액 표기 USD/SOL만(KRW 금지 — UI가 미표시 시 렌더 거부).
> 대상 네트워크는 mainnet-beta **읽기 전용** 공개 RPC. 유료 API 키 사용 없음.

## 아키텍처

```
GeckoTerminal new_pools ──감지──┐
DexScreener tokens/v1  ──정준 페어·출처──┤
                                  ├→ census-collector.py (Python 표준 라이브러리만)
mainnet-beta 공개 RPC ──권한·집중도──┘        │
                                              ├→ data/snapshots/YYYY-MM-DD/*.json  (일별 증거 로그)
                                              ├→ data/latest.json                  (최신 + 채택곡선 series)
                                              └→ verdict-v2.py → data/verdict.json (판정)
읽기: GitHub Pages 정적 호스팅 (index.html + app.js + styles.css, 무빌드 vanilla JS)
      · 신선도 라벨 generated_at + 90분 경과 경고 배지 (dapp4 설계 계승)
      · 컴플라이언스 고지문 미표시 시 렌더 거부 (UI 강제)
```

- **감지**: GeckoTerminal `new_pools`(solana)에서 신규 풀의 베이스 토큰 수확 → DexScreener 일괄 조회로
  **유동성 최대 페어 1개 고정**(동률 시 pairAddress 사전순 — dapp4 시장 대시보드 설계 §6 계승) 후 `pair_id` 기록.
- **권한 스냅샷(코인당 4 RPC)**: ① `getAccountInfo(mint, jsonParsed)` — mint/freeze authority·supply
  ② `getAccountInfo(metadata PDA)` — update_authority·name/symbol/uri (Metaplex PDA는 **순수 파이썬 ed25519 유도**, 외부 의존성 0)
  ③ `getTokenLargestAccounts` — 상위 20 계정 ④ `getMultipleAccounts` — 상위 10 계정 owner 해석.
- **집중도 필터(3단 계층 중 1단 적용)**: 상위 계정은 AMM 풀 볼트·번 주소 포함(설계 반증 계승) →
  owner가 소각 프로그램(1nc1nerator…)/시스템 싱크(111…)/인프라 레지스트리(pump.fun·Raydium 권한 등)면 제외한
  `top10_share_filtered`를 원시값(`top10_share_raw`)과 **병기 기록**. 2·3단(풀 계정 파싱·owner-program)은 Phase 2 확장.
  `getTokenLargestAccounts` 실패 시 프로브 운영 교훈에 따라 RugCheck 공개 리포트 폴백(topHolders의 owner로 동일 필터 적용,
  방법 필드에 명시). 본딩커브 상위 대량 보유는 `probable-bonding-curve` 휴리스틱 라벨로 명시 후 제외(3단 근사, 미검증 표시).
  운영 실측: mainnet 공개 RPC는 getTokenLargestAccounts에 429 상습, publicnode는 12초+ 지연 → 폴백이 상시 경로가 됨(프로브와 동일 결론).
- **출처 추정**: dexId ∈ {pumpfun, pumpswap, meteoradbc(Meteora DBC 런치패드)} 또는 RugCheck launchpad 존재 →
  `template`(런치패드 출생), 런치패드 없음 → `custom-launch`, DexScreener 미등재 신규 풀 → `unclassified-new-pool`(무분별 분류 금지).
- **예절**: RPC 호출 간 200ms+, 429/5xx 지수 백오프(0.6s×2^n, 상한 20s, 5회), 실행당 RPC ~400회 상한(기본), 유료 키 금지.

## 데이터 규격 (프로브 증거 로그 레코드 계승 + 확장)

`deepthink/memecoin-probe/evidence_log` 레코드 규격(addr·source·token_program·decimals·supply_raw·
mint_authority·freeze_authority·metadata_pda·meta_found·update_authority·status)을 그대로 계승하고,
센서스 확장 필드(`authority_states`, `mintR/freezeR/updateR/doubleR/deepR`, `origin`, `pair`, `concentration`)를 추가.

폐기 조작화: authority가 `null` → 폐기, 시스템프로그램 주소(111…11) → **싱크 폐기로 분류**(PONKE 사례, 프로브 확장 계승).
관측 노트(스모크 실측): pump.fun 본딩커브 코인은 메타데이터가 오프체인(pump.fun 자체 JSON)이라 Metaplex PDA 부재 —
`meta_found=false` → update 권한은 '미확인'으로 기록되고, 마이그레이션(pumpswap) 후 관측 가능. mint/freeze는 출생 시 이미 폐기(제로데이).

- `data/baseline/` — 95코인 소급 프로브(2026-09-26, P1~P12 동결 후 수집 — 반앵커링 순서 조항 준수).
  `aggregate.json`(집계) + `summary.csv`(행 단위). 원본: `workspace/deepthink/memecoin-probe/evidence_log/`.
- `data/snapshots/YYYY-MM-DD/` — 일별 수집 기록(코인 1건 = JSON 1파일).
- `data/latest.json` — 최종 실행 요약 + 채택곡선 `series`(일 1포인트, 동일 날짜 교체, 60일 보존).
- `data/verdict.json` — 판정 함수 v2 실행 결과.

## 실행 매뉴얼

```bash
# 1) 수집기 — 감지만 (파일 기록 없음)
python3 dapp4-pipeline/scripts/census-collector.py --coins 8 --dry-run

# 2) 수집기 — 실측 스냅샷 (기본 30코인, 최대 100, RPC 상한 400)
python3 dapp4-pipeline/scripts/census-collector.py --coins 8

# 3) 판정 함수 v2 — baseline 재현 (기대: 사전 유지 B 55:A 45 · S1 13.1%)
python3 dapp4-pipeline/scripts/verdict-v2.py                      # baseline 판정 → data/verdict.json
python3 dapp4-pipeline/scripts/verdict-v2.py \
  --input dapp4/census/data/baseline/summary.csv \
  --latest dapp4/census/data/latest.json                          # summary.csv 재계산 + S1 모집단 프레임 병기
# --discourse claims.json — Phase 2 담론 패널(S4 거짓주장률) 채점용

# 4) 대시보드 로컬 확인
python3 -m http.server 8080 -d dapp4   # → http://localhost:8080/census/
```

의존성: Python 3 표준 라이브러리만(ed25519 PDA 유도 포함 순수 파이썬 구현). Node/빌드 도구 불필요.

## 판정 함수 v2 (4스위치 + 프레임 조항)

동결 계보: r8c02(세션4, 사전 B 55 : A 45 · 동률 A) → 프로브 등록본 조작화(§3) → **v2 프레임 조항**(프로브 한계 1 수정).

| 스위치 | 조건 | 프레임 |
|---|---|---|
| S1 바닥 상위 3분위→A | 폐기 중 템플릿 비중 ≥ 75% | **코인-가중(공식 축) + 모집단-가중 병기** — v2 신설 |
| S2 자발 밴드 부재→A | era-1 유명−테일 기울기 ≥ 0.40 & n≥10이면 밴드 존재 | 코인-가중(등재 코인 프레임) + 모집단 프레임 고지 |
| S3 혼합<30%→A | era-2 커스텀 폐기율 < 30% | 코인-가중(검색-가시 프레임) |
| S4 거짓주장률>50%→B | 주장 중 체인 불일치 > 50% | 담론 패널(Phase 2 입력) |

순서 무관 합산·다수결(동률 A), 0발동 → 사전 유지. baseline 실행 시 재현 검증 자동 수행
(`reproduction_check`: 사전 유지 + S1 13.1% 일치 → PASS).
**pump 테일 무작위 프레임**: Phase 2 관측으로 era-2 무작위 테일 프레임을 구축한 뒤 S1/S3 모집단-가중 값을 확정(상태 추적 필드 `PENDING`).

## Phase 2 — 1주일 관측 운영 계획 (다음 단계)

1. **T0 선언 절차**: 관측 시작 시점을 증거로 남기고(본 README 갱신 + latest.json 첫 기록) P1~P12 예측 패킷 동결 준수 확인.
   T0 이후 데이터만 판정에 사용(소급 혼입 금지 — 순서 조항).
2. **일일 수집**: 1회/일 `census-collector.py --coins 30` 실행(cron/세션 스케줄). 스냅샷+latest.json 커밋 → Pages 반영.
   이상 탐지: 재무장(mint authority null→주소 복귀)·깊은 폐기 사건(update authority 소각) 발생 시 기록.
3. **중간 점검 D+3 / D+5**: 수집 품질(RPC 실패율·스킵률), 프레임 균형(템플릿/커스텀 비중 편향 점검 — 검출 편향 고지),
   채택곡선 추세 확인. 편향 심각 시 감지 소스 배합 조정(변경 사항 기록).
4. **D+7 판정**: `verdict-v2.py`에 담론 패널(S4)·채택곡선 입력 → A/B 최종 보고서.
5. **Phase 2 남은 세팅(본 PR 범위 밖)**: cron 등록·T0 선언 기록·담론 패널 claims.json 스키마 확정.

## 담론 패널(거짓주장률) 설계 초안 — S4 입력

- 목적: "폐기 주장 vs 체인 실측"의 불일치율(거짓주장률) 측정 — 온체인 상태층에서는 주장 0건(프로브 슬롯3)으로
  측정 불가였던 슬롯을 오프체인 담론으로 여는 것.
- 소스: 공개 채널의 폐기 주장(코인 공지·웹사이트 텍스트·X 게시 — 외부 발신 없이 **읽기만**). 소스별 등록제.
- 레코드 스키마 초안:
  ```json
  {"coin": "<mint>", "claimed_at": "ISO", "source": "url",
   "claim_text": "…", "claim_type": "mint|freeze|update",
   "verified_chain": {"mintR": true, "observed_at": "ISO", "snapshot": "path"},
   "verdict": "consistent|mismatch|unverifiable"}
  ```
- 집계: `claims_total`, `chain_mismatch` → `--discourse` 입력으로 S4 채점(>50% → B 발동).
  최소 표본(예: 30건) 미달 시 "슬롯 유보" 보고(PLAN 리스크 항목 계승).
- 마진 확장(차후): 연극 마진 = 외형 R0 − 행동 R0 (r8c02 슬롯 매핑 계승).

## 컴플라이언스 요약

| 항목 | 규칙 | 구현 |
|---|---|---|
| 읽기 전용 | 서명·발송·에어드랍 금지 | RPC 메서드 allowlist + 금지 문자열 감지 시 즉시 예외(`ReadOnlyViolation`) |
| 네트워크 | mainnet-beta 읽기만 | 엔드포인트 host 검증 |
| 예산 | 실행당 RPC ~400회 | 호출 카운터 상한 초과 시 정지(부분 저장) |
| 비용 | 유료 키 금지 | 공개 엔드포인트만 하드코딩 |
| 통화 | KRW 금지, USD/SOL만 | UI 렌더 후 ₩/KRW/원화 스캔 → 감지 시 렌더 거부 |
| 고지 | "교육·관측 목적 · 투자 권유 아님 · read-only" | 고지문 요소 검증 실패 시 렌더 거부 |
| 자기참조 | "객관 관측" 표현 금지 | "관측 기록" 표기 (dapp4 설계 §8 계승) |

## 관련

- 이슈: creative-loop-engineering2 #102 (CLE2-29) · GOAL.md/PLAN.md: `workspace/creative-loop-engineering2/tasks/CLE2-29/`
- baseline 출처: `workspace/deepthink/memecoin-probe/` (REPORT.md · evidence_log/ · aggregate.json)
- 판정 함수 계보: `workspace/deepthink/memecoin-contagion/REPORT.md` r8c02 · deep_r8c02.md
- dapp4 셸 진입: `../index.html` 탭 링크
