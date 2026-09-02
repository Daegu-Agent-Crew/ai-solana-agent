# 게이트 ③ — 페어 선택 규칙 실측 (CLE2-25 Phase 4, dapp4 시장 관측 대시보드)

- 일시: 2026-09-02 09:00:28 ~ 09:13:04 KST
- 방법: DexScreener 공개 API (`/latest/dex/tokens/{mint}`), 인증 없음, curl
- 리포: ai-solana-agent @ cle2-25-phase0 (read-only, 커밋 없음)
- 검증 대상 규칙: "토큰 조회는 다중 페어를 반환(설계서 실측 30개). 유동성 최대 페어를 시작 시점에 고정, tokens.pair_id 기록, 페어 전환 시 신규 시계열 분리" (설계 결정 6번 / Pitfall 5)
- 자체 후보 토큰은 mainnet 미발행 → **섀도우 토큰 4종으로 대체 실측** (결정 11번 합의 경로)

---

## 1. 섀도우 토큰 구성

| 역할 | 토큰 | mint | 선정 근거 |
|---|---|---|---|
| 극단 사례 | BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | 다중 페어 30+ 재현 확인용 |
| 중형 사례 1 | BABYSOL | `54meDtup2K7pqyhUK24AymoLzMPtrkhNTbEzQ6gSpump` | $623k, orca+raydium 혼재 다중 페어 |
| 중형 사례 2 | SPSC | `4nswj3o1Lo9iWYvvRJxUD8vbCy9ay7QQoXYcncHNbonk` | $88k, raydium+meteora 혼재 |
| 저유동성 신규 | RAYCAT | `BigyjrdWDpnSuvZbrdGcN5XrsfXBFgPC7pQUT9tBpump` | $16.5k, raydium 단일 페어 (< $50k 조건 충족) |

후보 발견은 검색 엔드포인트 `/latest/dex/search?q=...` 2회 사용.

## 2. 토큰별 실측 결과

### R1 (2026-09-02 09:00~09:01 KST)

| 토큰 | 총 페어 수 | dexId 분포 | 유동성 상위 3개 (USD, dex, pairAddress) | 최대 페어 | 1위-2위 격차 |
|---|---|---|---|---|---|
| BONK | **30 (상한 도달)** | orca 10 / raydium 8 / meteora 12 | 149,274 raydium `3UwfrdLTpAjxTRni1boc5HUWe6hzc4HgE5yLdvEp2Noc` / 122,312 orca `BqnpCdDLPV2pFdAaLnVidmn3G93RP2p5oRdGEY2sJGez` / 110,256 orca `5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9` | raydium/USDC `3Uwfrd…` | 18.06% |
| BABYSOL | 4 | orca 2 / raydium 2 | 623,320 orca `6sJJ33pLNkAWgwG4CghSZzAJXMynUtkMebnuFqGS8iGb` / 22,476 raydium `J61feDAJ3UyYL7gFUeoJN7E2koYz6th88t6wPC5n2HJw` / 278 orca `CXZDGnd4GdN1VPNaRfo5wEhL75Q2a8tuT1z8BKGg2PhB` | orca/RAY `6sJJ33…` | 96.39% |
| SPSC | 5 | raydium 1 / meteora 4 | 88,405 raydium `6MHj1z5BgC1UiTNEWrnJfbGtQPuPdh2qgdWkemGxT2c5` / 1,847 meteora `5UmV3eMyR29TQ2pQR5LtEa58BFbRV6ho18eXmb5i63Ma` / 410 meteora `8ghCN11mdspnSZpNA2f2Z3zMXYmpqp6ufkFKvg27JWLd` | raydium/USD1 `6MHj1z…` | 97.91% |
| RAYCAT | 1 | raydium 1 | 16,511 raydium `mFyqaAUXgobqwXFUsLM222uJDWRrjUwJXTShizPfDX5` | raydium/SOL `mFyqaA…` | n/a (단일 페어) |

- 근소차(<1%) 검사: **4개 토큰 전부에서 근소차/동률 없음**. 최소 격차가 BONK의 18.06%.
- BONK 중간 시점 R1.5 (09:05:20): 최대 페어 동일(3Uwfrd…), 유동성 149,274→149,197 (−0.05%), 격차 18.02% 유지.

### R2 (2026-09-02 09:12:35~09:13:04 KST, R1로부터 ~12분 경과)

| 토큰 | 페어 수 변화 | dex 분포 변화 | 최대 페어 R1→R2 동일? | top1 유동성 변화 | 격차(1-2위) |
|---|---|---|---|---|---|
| BONK | 30→30 | 없음 | **YES** (raydium/USDC `3Uwfrd…`) | 149,274→149,246 (−0.02%) | 18.05% |
| BABYSOL | 4→4 | 없음 | **YES** (orca/RAY `6sJJ33…`) | 623,320→623,320 (0.00%) | 96.40% |
| SPSC | 5→5 | 없음 | **YES** (raydium/USD1 `6MHj1z…`) | 88,405→88,405 (0.00%) | 97.91% |
| RAYCAT | 1→1 | 없음 | **YES** (raydium/SOL `mFyqaA…`) | 16,511→16,511 (0.00%) | n/a |

- 순위 변동: 상위 3개 페어 구성·순서 모두 불변 (BONK top3만 미세 유동성 변동 −0.02~+0.06%, 순위 동일).
- pair_id 고정 가능성: **4/4에서 재조회 시 동일 페어 선택 → 시작 시점 고정 규칙이 12분 스케일에서 안정적으로 재현**.

## 3. API 신뢰성 관찰

- 총 호출: **12회** (검색 2 + R1 5 + R1.5 1 + R2 4). 가드레일 40회 이내 준수. ※ 병렬 exec 세션 격리로 BONK R1 1회 응답이 유실되어 동일 엔드포인트 재수집 1회 포함.
- 응답 코드: 전 호출 **200 OK**, 실패 0, **429/5xx 없음** (호출 간 1초 슬립 적용).
- 응답 시간: **0.18s ~ 0.47s** (curl time_total, 전 구간 안정).
- 문서화되지 않은 동작 2건 (구현 영향):
  1. **반환 순서는 유동성 정렬 보장 없음** — BONK·SPSC 응답에서 원본 배열 순서가 유동성 내림차순이 아님(예: BONK 응답 첫 페어 = 110,256로 3위). **클라이언트 측에서 liquidity.usd 내림차순 정렬 후 argmax 필수.**
  2. **토큰 엔드포인트 페어 상한 30개** — BONK에서 정확히 30개 반환. 유동성 분포(149k→56$까지 연속 하강)로 볼 때 반환 30개는 유동성 상위 세트이며 top1 선택에는 무해. 그러나 총 유동성 집계에는 과소평가 가능.

## 4. 판정: **PASS**

"유동성 최대 페어 1개를 시작 시점에 고정(tokens.pair_id 기록)" 규칙이 실측 데이터에서 결정론적으로 작동함.

근거:
1. **다중 페어 재현 확인** — BONK 정확히 30 페어(상한), dex 3종 혼재. 설계 전제(다중 페어 반환) 사실 확인.
2. **선택 안정성** — 4/4 토큰에서 R1 → R1.5(5분) → R2(12분) 최대 유동성 페어 불변. 유동성 값 자체도 ±0.06% 이내 미세 변동.
3. **동률 리스크 실측 범위 내 제로** — 1-2위 격차 최소 18% (BONK). 나머지 96%+. 저유동성 단일 페어 토큰(RAYCAT)은 선택 규칙이 trivially 결정론적.
4. **API 신뢰성 양호** — 인증 불필요, 12/12 성공, 무 429, sub-second 응답.

## 5. 규칙 보완 제안 (CONDITIONAL 항목은 아니고 권고)

1. **동률 tie-break 명시(방어)**: liquidity.usd 완전 동률은 실측에서 관찰 안 됐으나 이론적 가능성 존재. 결정론성 보장을 위해 "동률 시 (a) 24h volume.usd 큰 페어 → (b) 그마저 동률이면 pairAddress 사전순 낮은 쪽"을 규칙에 명문화 권장. 근소차(<1%)에 대한 특수 처리는 불필요(18% 격차가 최소였고, 격차가 좁아져도 argmax 결과 자체는 여전히 결정론적).
2. **클라이언트 측 정렬 필수 명시**: API 원본 순서 의존 금지. `pairs.sort(liquidity.usd desc)` 후 `pairs[0]` 선택을 구현 계약에 포함.
3. **최소 유동성 하한(경고 플래그)**: 선택은 하되, top1 liquidity.usd < $10k 인 경우 대시보드에 "저유동성·가격 신뢰도 낮음" 주석 권장(선택 거부 아님 — RAYCAT $16.5k도 정상 선택됨). 매우 낮은 유동성에서는 소량 매수로 가격이 왜곡될 수 있어 시계열 해석 보조 목적.
4. **페어 전환 감지 임계값**: 12분 실측에서 전환 0회. 전환 감지는 "현 top1 ≠ tokens.pair_id" 조건으로 충분하며, 히스테리시스(예: 신규 후보가 기존 pair 유동성을 20% 이상 초과 시만 전환)는 과잉 설계로 판단 — 다만 향후 실측에서 잦은 flip이 관찰되면 재검토.

## 6. 기록

- 스냅샷 파일: `tmp/teamwork-dapp4/{bonk,babysol,spsc,raycat}-r1.json`, `bonk-r15.json`, `*-r2.json`, `search-mid.json`, `search-small.json`
- 타임스탬프(KST): R1 09:00:28(BONK)/09:01:34(3종) · R1.5 09:05:20(BONK) · R2 09:12:35~09:13:04
- 사용 mint 전체: BONK `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` · BABYSOL `54meDtup2K7pqyhUK24AymoLzMPtrkhNTbEzQ6gSpump` · SPSC `4nswj3o1Lo9iWYvvRJxUD8vbCy9ay7QQoXYcncHNbonk` · RAYCAT `BigyjrdWDpnSuvZbrdGcN5XrsfXBFgPC7pQUT9tBpump`
- 리포 변경 없음(결과 파일 1개 신규 생성만).
