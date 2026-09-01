# dapp4 시장 관측 대시보드 — 통합 설계서 (CLE2-25 Phase 4)

- 작성일: 2026-09-01
- 작성 방법: teamwork 스킬(경쟁 전략 탐색) — Explorer 3개 전략(MVP / 데이터 깊이 / 교육·투명성) × Falsifier 3개 독립 반증 → 통합·게이트 심사(통과, 조건부)
- 추적: Daegu-Agent-Crew/creative-loop-engineering2 이슈 #72 Phase 4
- 목적 재확인: **수익 추출이 아닌 교육·관측.** "이벤트 마케팅 효과의 정량 관찰"이 이 태스크의 진짜 산출물

## 1. 목표·비목표

| 구분 | 내용 |
|---|---|
| 목표 | 가격·거래량·유동성·집중도 시계열 관측, 이벤트(삼체 EP 공개 등) 전후 지표 변화 리포트 자동 생성 |
| 비목표 | 거래 기능(완전 read-only), 인과 주장(상관 관찰로 표기 강등), KRW 환산 표기, 수익 추출 |

## 2. 핵심 설계 결정 (반증 검증 통과분)

1. **저장 축 = D1 원본 시계열** — 모든 파생 지표는 스냅샷 테이블 위에서 재계산 가능(재현성 원칙). KV는 최신 스냅샷 캐시용만.
2. **수집 주기 이원화** — 평시 15분, 이벤트 창(T0±4h) 5분. 1시간 해상도는 수 분 단위 이벤트 반응을 놓친다는 반증 채택(F1).
3. **소스 이중화** — DexScreener(주) + GeckoTerminal(교차검증·OHLCV 폴백). 무SLA 대응.
4. **거래량 = 증분(incremental)** — DexScreener volume.h24는 롤링 창이라 차분 시 최대 23h 중첩·부호 왜곡. 증분 추정(연속 스냅샷 h24 차분의 양수 클램프)으로 재정의하고 결측 구간은 명시적 마킹(보간 금지).
5. **가격은 price_usd 원본 저장** — SOL 환산은 파생 계산. ΔSOL 통제(상대 등락)는 리포트 표기용.
6. **페어 1개 고정** — 토큰 조회는 다중 페어를 반환(실측: 주요 토큰 30개). 유동성 최대 페어를 시작 시점에 고정하고 `tokens.pair_id`에 기록. 페어 전환 시 신규 시계열로 분리(체계 혼합 금지).
7. **"상위 잔액 집중도"로 명칭 변경** — `getTokenLargestAccounts` 상위 계정은 AMM 풀 볼트·번 주소를 포함(반증 2건 독립 적발). 번 주소·LP 볼트·권한 주소를 필터한 뒤에만 "집중도"로 표기하며, "홀더 수 대리 지표" 표현은 삭제. 전체 홀더 수는 무료 실측 경로 확보 전 보류.
8. **RPC 호출 주체 = 브라우저 우선** — 데이터센터(Cloudflare) IP→솔라나 공개 RPC는 403/429 상습(반증 실측 429). 집중도 계산은 브라우저에서 수행해 Worker에 POST하거나, Worker egress 실측 통과 시에만 Worker가 직접 호출(0단계 실측 게이트).
9. **배치 = `dapp4/market/` 독립 경로 + dapp4 셸 탭 진입** — Coupon Loop 앱과 파일 분리(장애 격리), 내비게이션은 dapp4 셸에서 진입.
10. **컴플라이언스 = UI 강제 조건** — 고지문("투자 권유 아님·원금 손실 가능") 미표시 시 렌더 거부, 거래 실행 UI 요소 0개(read-only 검증), 팀 지갑 목록은 "자기 신고 하한선" 명시, 단위 USD/SOL만(KRW 금지).
11. **리허설 = 섀도우 토큰(mainnet 읽기 전용)** — devnet엔 DEX 데이터가 없어 셸만 검증 가능. 기존 공개 Raydium 페어를 관측 대상으로 파이프라인 전체를 리허설.
12. **mainnet 게이트** — `tokens.mainnet_ok=0`이면 수집 크론이 자체 토큰 mainnet mint 수집 거부. 승인 기록 없이 mainnet 전환 불가.

## 3. 아키텍처

```
DexScreener ─┐
GeckoTerminal ─┼→ Worker Cron(평시 15m / 이벤트창 5m) → D1(원본 시계열)
브라우저 RPC(집중도) → Worker POST ─┘         │
                                              └→ 리포트 빌더 → dapp4/market/data/event-{slug}.json 커밋
읽기: Pages 정적(dapp4/market, 무빌드 vanilla JS + vendored 차트)
      → Worker REST /api/series?mint=(읽기 전용) + 정적 JSON(신선도 라벨 필수)
```

- 신선도 표기 규칙: 정적 JSON과 /api/series 중 어느 쪽 데이터인지 generated_at 라벨로 항상 표기(이중 진실원 방지).
- 크론 실패 감지: 마지막 스냅샷 ts > 90분이면 대시보드에 경고 배지.

## 4. 지표 정의

- 가격 P_t: price_usd (DexScreener 고정 페어)
- 증분 거래량 V_inc: 연속 스냅샷 h24 차분, 양수 클램프(결측 구간 마킹)
- 유동성 L_t: liquidity.usd
- 상위 잔액 집중도 CR*: 필터(번·LP 볼트·권한) 후 Σ(topN) ÷ totalSupply
- 팀 보유율: Σ(공개된 팀 지갑) ÷ totalSupply — 자기 신고 하한선
- LP 소각률: 소각 LP 토큰 ÷ 초기 LP 토큰(burn tx 서명 근거 링크)
- 이상 거래량 배수 AVR: median(V_inc, 기저선 [T−72h, T−24h]) 대비 이벤트 창 시간당 배수
- 상대 등락: ΔP_token − ΔP_SOL — **"시장 전체 등락 미교정 가능" 고지 문구 상시 표기**
- 이벤트 비교 창: T0±72h(차트), T0±4h(고해상도). 모든 리포트 표기는 **"상관 관찰"** — 인과 주장 금지, 창 민감도(±24h/±48h 대안) 병기
- 첫 런칭 이벤트: 기저선 부재 → 정성 서술 병기, AVR·순증가 지표는 2회차 이벤트부터 산출

## 5. D1 스키마 (초안)

```sql
CREATE TABLE tokens(mint TEXT PRIMARY KEY, symbol TEXT, pair_id TEXT,
  mainnet_ok INTEGER DEFAULT 0, shadow INTEGER DEFAULT 0);
CREATE TABLE snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, ts INTEGER,
  price_usd REAL, liquidity_usd REAL, vol_h24_usd REAL, vol_inc_usd REAL,
  txns_h24 INTEGER, buys_h24 INTEGER, sells_h24 INTEGER,
  source TEXT, UNIQUE(mint, ts, source));
CREATE TABLE balance_samples(
  mint TEXT, ts INTEGER, topn_share REAL, team_share REAL,
  lp_burned_pct REAL, method TEXT, UNIQUE(mint, ts));
CREATE TABLE events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT,
  t0 INTEGER, pre_h INTEGER DEFAULT 72, post_h INTEGER DEFAULT 72,
  baseline_d INTEGER DEFAULT 3);
CREATE TABLE event_reports(
  slug TEXT, generated_at INTEGER, payload TEXT, PRIMARY KEY(slug, generated_at));
```

일 쓰기량 평시 ~140행(이벤트 창 포함 최대 ~400행) — D1 무료 한도 여유.

## 6. 이벤트 리포트 흐름

1. 이벤트 등록: `events` 행 삽입(slug, t0) — 삼체 EP 공개 등
2. 크론(이벤트 윈도우 중 시간당, 평시 일 1회): 스냅샷 집계 → 지표 산출 → `event_reports` upsert
3. 최신판을 `dapp4/market/data/event-{slug}.json`로 커밋(일 1~2회, Pages 리빌드 절제)
4. 정적 페이지 렌더 — 근거 링크(스냅샷 ts·소스·tx 링크) 없는 수치는 게시 불가

## 7. 구현 단계

| 단계 | 내용 | 완료 조건 |
|---|---|---|
| 0 (선행 실측 게이트) | ① Worker 크론 CPU 10ms 상한 벤치마크(지표 8종 집계) ② Worker egress→공개 RPC 실측 ③ 페어 선택 규칙 실측(자체 후보 토큰) ④ 번·LP 볼트 주소 특정 및 집중도 필터 실측 | 4건 결과 기록, 실패 항목은 설계 반영 후 재실측 |
| A | D1 스키마 + 수집 크론 배포, **섀도우 토큰** 48h 리허설 | 성공률 ≥94%, 갭 0건(90분 경보 동작) |
| B | dapp4/market 정적 대시보드 + 읽기 API | 48h+ 시계열 렌더, 고지문 누락 시 렌더 거부 테스트 통과, 거래 UI 요소 0개 |
| C | 이벤트 등록 + 리포트 자동화 | 과거 t0 등록 시 1크론 주기 내 JSON 커밋, 지표 non-null |
| D | mainnet 승인 게이트 기록 후 자체 토큰 실전 관측 | 런칭 이벤트 T+72h 리포트 Pages 게시(정성 병기 포함) |

## 8. 리스크·한계 (수시 고지)

- 무료 공개 API 무SLA — 이중 소스로 완화, 완전 대체 불가
- 이벤트 1건 = n=1 — 경향 해석은 3회 이상 누적 후
- ΔSOL 통제도 완전한 베타 보정 아님 — "미교정 가능" 고지 유지
- 전체 홀더 수 무료 산출 불가 — 확보 전까지 보류(집중도로 대체하되 명칭 정확화)
- Worker 크론 CPU 10ms — 0단계 벤치마크 통과 전 과도한 집계 배치 금지
- 자기참조 관측(관측 주체=발행 주체) — "객관 관측" 표현 금지, "자체 관측 기록"으로 표기

## 9. Pitfall Registry (재탐색·구현 시 반드시 첨부)

1. `getTokenLargestAccounts`는 풀 볼트·번 주소 포함 — 농도 지표는 필터 없이 쓰면 오보
2. 롤링 24h 거래량 차분은 창 중첩으로 부호 왜곡 — 증분 사용
3. 데이터센터 IP→솔라나 공개 RPC 차단(실측 429) — egress 실측 전 Worker 직접 호출 전제 금지
4. devnet엔 DEX 데이터 없음 — 리허설은 섀도우 토큰(mainnet 읽기 전용)으로
5. DexScreener 토큰 조회는 다중 페어 반환(실측 30개) — 페어 선택 규칙 필수

## 부록: 경쟁 탐색 결과 요약

- ① MVP(정성 카드+매시 KV): 반증 — 1h 해상도 목적 모순, ΔV 롤링 왜곡, RPC 차단, devnet 무의미 → **측정 설계는 기각, 무빌드 정성·fail-stale·속도는 계승**
- ② 데이터 깊이(D1 시계열·8지표·자동 리포트): 반증 — 첫 이벤트 기저선 부재, AVR 정의 불일치, price_sol만 저장 모순 → **아키텍처 축으로 채택, 지표 정의 수정 후 계승**
- ③ 교육·투명성(스토리 뷰·컴플라이언스 UI 강제): 반증 — CR10 정의 오류, 자기참조 이해충돌, 근거 링크≠서사 방지 → **컴플라이언스 강제 메커니즘 채택, 스토리 뷰는 지표 신뢰 확보 후(B단계 이후) 순차 도입**
- 반증 전문: 워크스페이스 `tmp/teamwork-dapp4/findings.md`
