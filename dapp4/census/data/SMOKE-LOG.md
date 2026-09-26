# CLE2-29 Phase 1 스모크 테스트 실행 로그

- 실행일: 2026-09-26 (KST) · 실행자: 개발 서브에이전트 (세션 16339fe3)
- 대상 브랜치: `cle2-29-census` (origin/main 기준)
- 원칙: 전 구간 읽기 전용 (mainnet-beta 공개 RPC GET + 공개 API 조회만, 서명/발송 0건, 유료 키 0개, 외부 발신 0건)

## ① collector `--coins 8 --dry-run` — PASS

```
[selftest] Metaplex PDA 유도 OK (BONK → FDZZbyY9…)   ← 순수 파이썬 ed25519 PDA 유도가 프로브 실측값과 일치
[detect] 확정 8코인 — pumpfun 5 · meteoradbc 2 · orca 1 혼합 감지
[dry-run] 기록 없음 종료. 감지 8코인, RPC 0회, 0.7s
```
- 감지 소스: GeckoTerminal new_pools(solana) + DexScreener 정준 페어 부착(유동성 최대 고정)
- 파일 기록 0건 확인 (dry-run 원칙 준수)

## ② collector `--coins 8` 실측 — PASS

```
[done] 스냅샷 8코인 → dapp4/census/data/snapshots/2026-09-26/ (8파일)
[done] latest.json 갱신 (series 1일분)
[done] 요약: n=8 · mint_ren_rate=1.0 · double_ren_rate=1.0 · deep_ren_rate=0.0
       · template 8/8 · custom 0 · template_share_of_renunciations=1.0
       · top10_filtered_mean=22.32%
[done] RPC 16회 / 상한 400회 · 102.1초 · 스킵 0
```
- 관측 내용(신규 발행 단면): 감지 8코인 전부 pump.fun/Meteora DBC 출생 — **mint/freeze 출생 시 이미 폐기(제로데이)**,
  update 권한은 본딩커브 중 오프체인 메타데이터로 미확인(metaplex PDA 부재, 정상 기록됨)
- 집중도 필터 동작: 예시 코인 top10 raw 100% → filtered 0% (본딩커브 PDA 2개 `probable-bonding-curve` 태그 제외 — 3단 계층 근사, 명시 라벨)
- 경로 기록: getTokenLargestAccounts는 공개 RPC에서 429/장지연 상습(프로브 운영 교훈 재확인) → RugCheck report 폴백으로 수집(방법 필드에 기록)

### 운영 중 발견·수정 사항 (투명성 기록)
1. base58을 little-endian으로 잘못 구현 → PDA 자체검증에서 적발, big-endian 수정 후 BONK·SAMO 2코인 교차검증 통과.
2. Metaplex 프로그램 ID 오기입(기억 의존) → 실측 owner 필드로 정정(`metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`).
3. RPC 가드 대소문자 비교 버그 → 허용 목록 소문자 통일.
4. mainnet 429 연쇄(공유 IP 레이트리밋) → RPC 간격 200ms→600ms 상향(요구 조건 '200ms+' 준수), publicnode 폴백 엔드포인트 순환 추가(PLAN 리스크 대응).
5. meteoradbc(Meteora DBC 런치패드)를 템플릿 분류에 포함, DexScreener 미등재 신규 풀은 `unclassified-new-pool`로 무분별 분류 금지.

## ③ verdict-v2 baseline 판정 재현 — PASS

```
입력: dapp4/census/data/baseline/aggregate.json (95코인, 수집 2026-09-26)
S1: 코인-가중=0.1311 (13.1%) · 모집단-가중=1.0(센서스 프록시 병기, n=8, 검출 편향 고지) → 미발동
S2: 기울기=0.6809 (유명 1.0 vs 테일 0.3191) → 밴드 존재 → 미발동
S3: 0.9429 (≥0.30) → 미발동
S4: UNSCORABLE(온체인 주장 0건 — 담론 패널 대기) → 미발동
판정: PRIOR-HOLD B 55 : A 45 (스위치 0발동 → 사전 유지)
재현 검증: PASS — 프로브(2026-09-26) 판정 B 55:A 45 유지 · S1 13.1% 일치
```
- summary.csv 재계산 경로도 동일 결과 확인 (S1 0.1311 · PRIOR-HOLD · 재현 PASS)
- 프레임 조항 v2 동작 확인: S1 이중 프레임 병기(공식 판정은 등록=코인-가중 프레임, 모집단 값은 고지)

## ④ 대시보드 정적 로드 — PASS

```
node --check app.js → OK (syntax)
python3 -m http.server 8091 -d dapp4 후 curl:
  census/index.html → 200 · complianceNotice 요소 존재(1)
  census/app.js → 200 · census/styles.css → 200
  census/data/latest.json → 200 · verdict.json → 200 · baseline/aggregate.json → 200
  index.html(dapp4 셸) → 200
```
- 컴플라이언스 UI 강제 구현 확인: 고지문("교육·관측 목적 · 투자 권유 아님 · read-only") 미표시 시 렌더 거부 + KRW/₩/원화 스캔 거부(app.js 게이트)
- KRW 표기 0건(모든 금액 USD)

## 예산·예절 준수 요약
- RPC 총 호출: dry-run 0 + 실측 16 + 디버그 직접 호출 소량(수정 검증용 getVersion/계정 조회 수 회) — 전부 상한 내
- 호출 간 600ms+ 준수, 429 지수 백오프·엔드포인트 순환 동작 확인
- 서명/발송 메서드 0회 (allowlist 밖 메서드 감지 시 즉시 예외 안전장치 포함)
- 유료 키 0개 · 지갑 파일 0개 생성
