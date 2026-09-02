# 게이트 ④ — 번·LP 볼트 주소 특정 및 집중도 필터 실측 (CLE2-25 Phase 4 · dapp4)

- **실행일**: 2026-09-02 (KST) 09:03–09:47 · 실행 주체: teamwork Solver (subagent)
- **리포/브랜치**: ai-solana-agent @ `cle2-25-phase0` (읽기 전용 — 커밋 0건)
- **판정**: **CONDITIONAL** — 필터 규칙의 필요성은 실증(위양성 1건 온체인 적발 + 정량화 완료)됐으나, (a) 순진한 규칙 v1은 실데이터에서 실패, (b) BONK급 대형 민트의 top-20 획득 경로가 이 호스트에서 불가. 아래 상세.

---

## 1. 요약 수치

### 섀도우 토큰 1: MEME (소형, Raydium AMM v4 단일 풀) — 완전 실측
- mint: `7cyAGa4XsNDnSgnFuwmVFgp9JGqZoZYkiVyFPSke9CuP` (decimals 6, DexScreener 검색 "meme" LP $21,475)
- totalSupply: 996,745,751.875113 (raw 996745751875113) · 전체 토큰계정(홀더) 7,366개 — `getProgramAccounts`(dataSlice+memcmp) 전수 열거
- **CR20(필터 전) = 56.3173%** → **CR20(필터 후) = 31.3417%** (Δ **−24.98pp**, 상위 20 중 1개 계정 제외)

### 섀도우 토큰 2: BONK (대형) — top-20 획득 불가(부분 실측)
- mint: `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` · totalSupply 87,994,535,484,847.61 (확인됨)
- `getTokenLargestAccounts` 27회 시도 전부 차단(§3) → CR20 산출 불가. 대형 토큰은 홀더 수십만~수백만 건이라 `getProgramAccounts` 대체도 불가(응답 한계). DexScreener 상위 3개 풀 전부 CLMM/Whirlpool(포지션별 볼트)로 풀 계정 파싱 경로도 부적합 — 대형 민트 측정은 별도 경로 필수(§6 권고).

---

## 2. 규칙 v1(순진 owner-program 검사)의 실패 — 온체인으로 적발된 위양성

MEME top-1 홀더(전체 공급의 24.98%)는 토큰계정 `62Gz989sENuuNMPRQZRssxMQmZYuVT8SyRkMrg45eVLn`(잔액 248,942,737.757 MEME). 이 계정의 owner 지갑 `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`을 `getMultipleAccounts`로 조회하면:

```
owner: 11111111111111111111111111111111 (System Program)
lamports: 34,578,143,522 (~34.6 SOL), space: 0
```

즉 **일반 지갑과 구분 불가** → 규칙 v1("owner 프로그램 ≠ System ⇒ 제외")은 제외 0건, CR 불변(56.32%)으로 오보.

**정체**: Raydium AMM v4 전역 권한 PDA(모든 v4 풀 볼트의 소유자). PDA는 원래 온체인 계정이 없지만 SOL을 받은 이력이 있으면 `space=0`의 System 소유 계정으로 나타나 위장한다.

**온체인 증명 사슬** (외부 기억 없이 데이터 자체로 완결):
1. DexScreener pairAddress `8yP8vN47fEBmoLKBdp7mwSwT4emdyrwu7Qd7xMc83RqL`(MEME/SOL)의 계정 owner = `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`(Raydium AMM v4)
2. 해당 풀 계정 원문(base64, 752바이트) offset **368**에 `62Gz989s...`(top-1 홀더)가 **token vault로 명시** — 풀→볼트 직접 근거
3. 볼트 토큰계정 owner = `5Q544fKrFoe6...`(위 권한 PDA)
4. 잔액 교차검증: 248,942,737.757 MEME × $0.00004318 = **$10,749** ≔ 풀 LP $21,475의 절반($10,738) — 0.1% 오차(수수료 누적으로 설명) ✓

**결론**: "번·LP 볼트·권한 주소 필터"는 owner-program 검사만으로는 불충분하며, 아래 §5 규칙 v2가 필요. 설계서 핵심 결정 7번의 우려가 실데이터로 확정됨.

---

## 3. RPC 실행 이력 (전부 read-only · 서명/전송 0건)

- 1차 엔드포인트: `https://api.mainnet-beta.solana.com` / 지정 폴백: `https://solana-rpc.publicnode.com`
- **`getTokenLargestAccounts` = 이 호스트(모바일 IP)에서 메서드 단위 하드 차단**: 27회 시도 전부 실패 — mainnet-beta 429(`Too many requests for a specific RPC call`, 응답 200~430ms의 즉시 거부) 21회+, publicnode 403 `Request blocked`/429 혼재. 16분 무호출 정숙 후에도 첫 시도 즉시 429(09:39:09 KST) → 버스트 한도가 아니라 지속 차단.
- **메서드 특이성 증명**: 동일 IP·동일 시각에 `getVersion`·`getTokenSupply`(역시 인덱스 메서드)·`getMultipleAccounts`·`getProgramAccounts`(dataSlice)는 전부 HTTP 200 정상 응답. 차단은 `getTokenLargestAccounts` 단독.
- 429 타임라인(KST, 백오프 30초→점증 준수): 09:03~09:09경 12회 실패(v1) · 09:12:04–09:13:43 4×429 · 09:14:15 publicnode 403 · 09:15:15 publicnode 429(48초 지연 응답) · 09:17:53–09:23:00 6×429 · 09:39:09–09:41:06 3×429 · 이후 해당 메서드 포기
- **폴백 불가 확정**: publicnode는 `getTokenSupply`/`getTokenLargestAccounts` 등 인덱스 메서드 전반이 유료 개인 토큰 요구(`Indexed requests require a personal token`). 도달성 리컨(빈 POST, 메서드 미호출): ankr 403(키 필요), drpc "chain is not available on free plan", solana.public-rpc/genesysgo/projectserum/solanavisor/omniatech/1rpc 전멸. **키리스로 이 메서드를 제공하는 공개 RPC는 사실상 mainnet-beta뿐.**
- 최종 성공 경로(v5, 09:43:49–09:44:14): `getTokenSupply`×2 + `getMultipleAccounts`×3 + `getProgramAccounts`×1 = **7 호출, 429 0회** (+09:46 풀/권한 검증 1회). 총 RPC HTTP 요청(진단 프로브 포함) ≈ 51회 ≤ 60 예산.
- WebSocket 경로(`wss://api.mainnet-beta.solana.com`)는 해당 메서드 `Method not found` — 우회 불가. 브라우저 경로(핵심 결정 8번)는 이 호스트에 Chromium 부재로 미검증.

---

## 4. MEME 상위 20 계정 분류 결과 (규칙 v2 적용)

전수 열거(7,366계정) 후 잔액 내림차순 top-20. 제외 1건:

| 구분 | 주소 | 근거 프로그램 | 잔액(MEME) | 공급 비중 |
|---|---|---|---|---|
| **제외(LP 볼트)** | 토큰계정 `62Gz989sENuuNMPRQZRssxMQmZYuVT8SyRkMrg45eVLn` | owner `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1` = Raydium AMM v4 권한 PDA(볼트는 풀 계정 offset 368에서 직접 증명) | 248,942,737.757 | **24.9755%** |

- 나머지 19계정: owner가 전부 System Program 소유 일반 지갑(또는 미존재 키페어 1건 `H3rMER...tcmX`) — 개인/봇/거래소 핫월렛으로 규칙상 유지. top-2 `7QMTWRk6...`(2.65%) 등.
- 번(소각) 주소: top-20 내 불검출(MEME은 소각 설계 아님).
- **CR20: 56.3173% → 31.3417%** — 필터 미적용 시 농도를 실제보다 1.8배 과대 보고.

## 5. 정제 필터 규칙 v2 (실측 기반 확정안)

상위 N 토큰계정 각각에 대해 순서대로:
1. **볼트/권한 등록부 대조**: owner가 알려진 AMM 권한 PDA(시작: Raydium v4 `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`, CPMM 권한, Orca Whirlpool 권한 등 레지스트리 유지) → 제외. *PDA가 SOL 보유 시 System 소유로 위장하므로 주소 대조가 유일한 확실 검사*
2. **관측 대상 풀에서 유도**: 모니터링 중인 pairAddress의 풀 계정(base64)에서 볼트 주소를 파싱(예: AMM v4 offset 368/400, CPMM vault0/1 offset 113/145 — 레이아웃은 프로그램별 고정, mint 역필드로 자기검증)하여 top-N 내 대조 → 제외
3. **owner-program 검사**: owner 계정이 존재하고 소유 프로그램이 System/미존재가 아니면(=프로그램 소유 PDA/중첩 토큰계정, 소각 incinerator 등) → 제외
4. 그 외 → "집중도" 가산 (거래소 핫월렛은 구분 불가 — 한계 §7)
- 산출: CR* = Σ(제외 후 topN) ÷ totalSupply, 메타데이터에 제외 근거(프로그램 ID/풀 주소) 첨부

## 6. 권고 (Phase A 설계 반영)

1. **농도 수집 경로 변경**: `getTokenLargestAccounts`는 이 호스트/키리스 경로에서 사용 불가 확정. 소형 민트(홀더 ~1만)는 `getProgramAccounts(tokenProgram, memcmp mint, dataSlice amount)` 전수 열거로 완전 대체 가능(7,366계정 25초 내 성공, top-N·CR·필터 전부 동일 산출) — 단 대형 민트는 불가하므로 관측 대상 토큰 등급에 따라 경로 분기 명시 필요.
2. **대형 민트용**: 유료 RPC 키(인덱스 메서드 포함 플랜) 확보 또는 핵심 결정 8번대로 브라우저 계산 경로 검증(이 호스트엔 브라우저 없어 미실시) 전까지 BONK급 섀도우 실측은 보류 표기.
3. 규칙 v2를 dapp4 수집 코드의 필터 표준으로 채택 + 권한 PDA 레지스트리 버전 관리.

## 7. 한계 명시

- **일반 지갑으로 위장한 내부 주소 구분 불가**: 팀 유포 지갑·MM·거래소 핫월렛은 System 소유 일반 계정 — 온체인만으로 필터 불가(자기 신고 하한선 설계 유지 필수).
- **역방향 위양성 가능성**: 권한 PDA 레지스트리 미등록 신규 AMM의 볼트는 규칙 3에 걸리나(프로그램 소유) SOL 보유 PDA 권한 주소는 규칙 1 등록 전까지 누출 — 레지스트리 갱신 의존.
- BONK 부분 실측: CLMM/Whirlpool 풀은 볼트가 포지션 계정에 분산 → 풀 파싱 경로 부적합(관측 필요 없음을 확인한 것 자체가 결과).
- MEME 단일 토큰·단일 시점(confirmed 커밋먼트) 실측 — 통계 일반화에는 Phase A 48h 리허설에서 복수 토큰·시계열 확인 필요.
- owner 미파싱 0건, 토큰계정 165바이트 표준 레이아웃만 처리(Token-2022 확장 계정은 미검증).
- RPC 예산 ≈51/60호출, 결과 파일 이외 산출물 없음(스크립트·중간 JSON은 /usr/tmp 임시).

## 부록: 사용 RPC·도구

- `https://api.mainnet-beta.solana.com`(JSON-RPC POST, read-only 메서드만) · `https://solana-rpc.publicnode.com`(폴백 시도, 인덱스 메서드 유료벽 확인) · DexScreener `/latest/dex/tokens`, `/latest/dex/search`(경로: 섀도우 토큰 선정 + pairAddress·LP 교차검증)
- 원시 데이터: /usr/tmp/gate4-v5.json(전체), /usr/tmp/gate4-attempts.jsonl(시도별 로그)
