# 0단계 게이트 ①② 실측 결과 — Worker 크론 CPU 벤치마크 / egress→공개 RPC

- 실측일: 2026-09-02 09:29~09:37 KST
- 실행자: Lead 직접 (Cloudflare 계정: sfex11, 계정 ID c1aaa7119ad1420b83ed3c47d6cbdebb)
- 방법: 임시 Worker `dapp4-gate-bench` 배포(workers.dev + 크론 `*/2 * * * *`) → 실측 → 삭제 완료
- Worker 코드: `tmp/teamwork-dapp4/gate-bench/src/worker.js` (지표 8종 집계 프로토타입 + RPC 프로브)
- 환경 비고: Termux에 wrangler 4.128.0 설치(workerd 미지원 → 배포 전용 스텁 처리, 로컬 실행 안 함)

## 게이트 ① Worker 크론 CPU 10ms 상한 벤치마크 — 판정: PASS

- 측정 방식: scheduled 핸들러(무료 플랜 CPU 제한 강제 환경)에서 지표 8종 집계(스냅샷 400행 = 설계상 일 최대치)를 performance.now()로 측정
- 결과 (2회 샘플, 크론 상태 전부 "Ok", CPU 한도 초과 오류 0건):
  - 09:34:55 — cpuMs = 0 (반올림, 실측치 <0.5ms)
  - 09:36:55 — cpuMs = 0
  - HTTP 핸들러 참고치: 400행·2000행 모두 cpuMs = 0
- 근거: 설계상 일일 최대 쓰기량(이벤트 창 포함 ~400행) 기준 집계가 10ms 상한의 1/20 이하. 지표 8종 집계 전체를 크론 1회에서 실행해도 여유
- 조건: 실운영은 DexScreener/GeckoTerminal fetch 후 JSON 파싱이 추가되나, 파싱+집계 모두 합쳐도 10ms 내 예상. A단계 배포 시 실데이터로 재확인 권장

## 게이트 ② Worker egress → 솔라나 공개 RPC 실측 — 판정: 확인 완료(차단 확정 → 설계 유지)

- 측정 방식: Worker에서 `api.mainnet-beta.solana.com` JSON-RPC `getSlot` POST 호출 (HTTP 핸들러 3회 + 크론 환경 2회, 계 5회)
- 결과:
  - 3회 명확한 403: `{"error":{"code":403,"message":"Your IP or provider is blocked from this endpoint"}}` (HTTP 1회 + 크론 2회)
  - 2회 Cloudflare 오류(1104/1042, 초기 요청) — 재시도 시 정상 응답 경로 확보되나 이후에도 403 본문 반복
- 결론: **Worker(egress IP) → 솔라나 공개 RPC 직접 호출 불가 확정.** 설계 핵심 결정 8번(집중도 계산은 브라우저 우선, Worker 직접 호출 전제 금지)이 실측으로 확증됨
- 설계 반영: 유지(변경 불필요). 수집 크론의 DexScreener/GeckoTerminal 호출은 본 실측 범위 밖(별도 소스, egress 차단 무관 — A단계에서 확인)

## 게이트 ④ Solver 발견 보강 (gate4-concentration.md 참조)

- 이 호스트(모바일 IP)에서도 `getTokenLargestAccounts` 메서드 단위 429 차단 27/27회 — RPC 차단은 Worker egress뿐 아니라 메서드별로도 발생
- 대체 경로: `getProgramAccounts`(memcmp+dataSlice) 전수 열거로 top-N/CR 산출 가능(소형 민트)

## 정리 상태

- [x] 임시 Worker dapp4-gate-bench 삭제 (2026-09-02 09:5x, wrangler delete 완료)
- [ ] CF 토큰: 실측 종료 — 회장님 토큰 폐기 권장 (CLE2-25 A단계 배포 시 재발급 또는 유지 결정 필요)
