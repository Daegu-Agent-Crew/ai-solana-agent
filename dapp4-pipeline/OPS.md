# OPS.md — CLE2-29 운영 방어 매뉴얼

검증·감시 자동화 3종 + 수집기 가드 확장의 운영 문서. 대상 리포: `Daegu-Agent-Crew/ai-solana-agent`.

## 시간대 원칙 (KST 단일화)

- **모든 일정·판정 기준 시간대는 KST(Asia/Seoul)로 단일화**한다.
- GitHub Actions `cron:`은 UTC 표기이므로 **KST-9 시각으로 적는다** (예: 06:00 KST → `0 21 * * *`).
- 워크플로에는 공통 `env: TZ: Asia/Seoul`을 명시해 셸 `date`가 KST로 동작하게 한다.
- 데이터 파일의 날짜 키(스냅샷 디렉터리, random-sample 파일명, missing 마커)는 각 스크립트가 KST로 계산한다.
  - 주의(계승): `census-collector.py`의 `snapshots/<date>/` 디렉터리명과 `latest.json`의 `series[].date`는 **실행 시점 UTC 날짜**로 찍힌다(04:30 KST 크론 → 전날 UTC 날짜). 관측 존재 판정은 디렉터리명이 아니라 `latest.json`의 `generated_at`을 KST 환산한 날짜로 한다(데드맨이 이 규칙을 사용).

## 워크플로 3종

### 1. freeze-guard — 판정 파일 해시 동결 CI

- 파일: `.github/workflows/freeze-guard.yml` + `dapp4-pipeline/FROZEN.sha256`
- 트리거: push(main), 모든 pull_request
- 동작: `sha256sum -c dapp4-pipeline/FROZEN.sha256` — `verdict-v2.py` 본문이 매니페스트 해시와 불일치하면 CI 실패.
- **해제 절차**: 10/3 판정 이후 PR에서만. 대상 파일을 수정한 뒤 `sha256sum dapp4-pipeline/scripts/verdict-v2.py`로 새 해시를 계산해 `FROZEN.sha256`의 해시 열을 교체(주석의 해제 안내 줄도 갱신). 그 PR의 freeze-guard가 green이면 해제 완료.
- 수동 검증: 리포 루트에서 `sha256sum -c dapp4-pipeline/FROZEN.sha256`.

### 2. census-smoke — 배포 후 스모크 테스트 (L2 자동 검사)

- 파일: `.github/workflows/census-smoke.yml` + `dapp4-pipeline/scripts/smoke-test.mjs`
- 스케줄: 매일 **06:00 KST** (`0 21 * * *` UTC) + `workflow_dispatch`
- 대상 페이지:
  - 전문가 버전: `https://daegu-agent-crew.github.io/ai-solana-agent/dapp4/census/`
  - 쉬운 버전: `https://daegu-agent-crew.github.io/ai-solana-agent/dapp4/census/easy/`
- 검사(페이지별): (a) 오류 배너 비가시 — census `#complianceError` `.hidden` 유지 / easy `#guard-error` `display:none` 유지, (b) 본문 가시(`main` / `#app`), (c) 숫자 일치 — BASE에서 `data/latest.json`·`data/verdict.json`·`data/baseline/aggregate.json`을 직접 fetch해 코인 수·반낼률·판정 문자열이 화면 텍스트에 실재하는지 대조, (d) 스크린샷 저장(artifact `smoke-screenshots-<run_id>`).
- 실패 시: `GITHUB_TOKEN`으로 이슈 생성("🚨 census 스모크 실패", 본문에 run 링크 + 실패 지점 `smoke-failure.txt`). 동일 제목 오픈 이슈가 있으면 코멘트로 재발 기록(스팸 방지).
- 수동 실행: Actions 탭 → census-smoke → Run workflow. 또는
  `gh workflow run census-smoke.yml && gh run watch $(gh run list --workflow=census-smoke.yml --limit 1 --json databaseId --jq '.[0].databaseId')`

### 3. deadman-observation — 데드맨 스위치 (관측 누락 감시)

- 파일: `.github/workflows/deadman-observation.yml`
- 스케줄: 매일 **05:30 KST** (`30 20 * * *` UTC, 일일 04:30 수집 크론 후 1시간 여유) + `workflow_dispatch`(`date` 입력 — 테스트용 과거/미래 날짜 가능)
- 관측 존재 판정(대상 날짜 D, 기본 오늘 KST):
  1. `dapp4/census/data/latest.json`의 `generated_at`을 KST 환산한 날짜 == D, 또는
  2. `dapp4/census/data/snapshots/D/`에 스냅샷 json 존재(동일 날짜 오후 수동 관측 커버)
- 관측 있음 → green no-op 종료.
- 관측 없음 →
  1. `dapp4/census/data/missing/<D>.json` 마커 생성(**create-only**: 이미 있으면 스킵) 후 main에 데이터 커밋·푸시(기존 일일 데이터 커밋 패턴과 동일),
  2. 이슈 생성: "⚠️ 관측 누락 <D> — 유보 조건 추적(2일 누적 시 전체 유보, PRE-REGISTRATION 참조)".
- `concurrency: deadman-observation`로 동시 실행 방지.
- 유보 규칙: 누락 2일 누적 시 전체 판정 유보(PRE-REGISTRATION 참조) — 마커 디렉터리(`data/missing/`)의 날짜 파일 수로 추적.

## 수집기 가드 확장 (census-collector.py)

### RPC 소비자 로그 + 일한도 (fail-closed)

- `rpc()` 호출 1건당 1줄을 `$HOME/.rpc/<KST-date>.<consumer>.log`에 append (디렉터리 자동 생성, 소비자 기본 `dg1`).
- 실행 시작 시 오늘 로그 줄수 + 예상 호출수 > 일한도(기본 **250**, `--rpc-budget`로 오버라이드)면 **즉시 중단**.
- 로그 파일이 손상되어 파싱 불가하면 중단(한도 소진 간주).
- 예상 호출수 산정: 전수 관측 `--coins N` → `N*4+15`, 표본 `--sample N` → `N*12+10` (보수적 상한).
- 기존 안전장치 유지: RPC 메서드 allowlist(read-only), 엔드포인트 검증, 실행당 상한 `--budget`(기본 400).

### --sample N — 무작위 표본 편향 점검

- `python3 dapp4-pipeline/scripts/census-collector.py --sample 10`
- KST 오늘 날짜 문자열의 sha256 → 정수 시드로, 검출된 신규 코인 풀에서 N개 **결정론적** 선택(정렬된 후보 풀 + `random.Random(seed).sample`).
- 코인당 스냅샷은 기존 `snapshot_coin()` 로직 재사용(권한 상태 + pump/custom 출처 추정 포함).
- 결과: `dapp4/census/data/random-sample/<KST-date>.json` (일일 전수 관측 `latest.json`과 독립 파일 — 프레임 오염 방지).
- 표본 실행당 RPC 상한 별도 가드: **120회**(`RPC_SAMPLE_BUDGET`).

### 일일 크론 기본 경로 (호환 유지)

```
python3 dapp4-pipeline/scripts/census-collector.py --coins 30
```

기존과 동일하게 동작(전수 관측 + latest.json 갱신). 새 가드는 이 경로에 자동 적용(로그 적립·일한도).

## 수동 실행법 요약

| 목적 | 명령 |
|---|---|
| 스모크 즉시 실행 | `gh workflow run census-smoke.yml` |
| 데드맨 임의 날짜 점검 | `gh workflow run deadman-observation.yml -f date=2026-09-28` |
| 동결 해시 로컬 검증 | `sha256sum -c dapp4-pipeline/FROZEN.sha256` |
| 표본 편향 점검 | `python3 dapp4-pipeline/scripts/census-collector.py --sample 10` |
| 오늘 RPC 사용량 확인 | `wc -l ~/.rpc/$(TZ=Asia/Seoul date +%F).dg1.log` |

## 롤백 절차

문제 발생 시(잘못된 자동화·오작동 커밋 등):

1. **last-known-good 태그**: 각 운영 변경 머지 직후 `git tag ops-lkg-<YYYYMMDD> && git push origin ops-lkg-<YYYYMMDD>`로 복원점 확보.
2. **워크플로 문제**: `git revert <merge-commit> -m 1` 로 롤백 PR(또는 Actions 탭에서 해당 워크플로 Disable). 스케줄 워크플로는 main에 파일이 존재해야 스케줄이 살아있으므로 revert만으로 충분.
3. **오작동 데이터 커밋(마커 등)**: revert 커밋으로 제거. 마커는 create-only이므로 재생성 걱정 없음(관측 복구 시 green no-op).
4. **수집기 문제**: `git revert`로 이전 버전 복원 — 일일 크론 `--coins 30` 기본 경로는 항상 호환 유지됨.
5. **동결 CI 오탐**: `FROZEN.sha256`이 정합인지 로컬 `sha256sum -c`로 먼저 확인(매니페스트 갱신 PR이 누락된 경우가 원인).

## 관련 이슈

- CLE2-29 운영 방어: creative-loop-engineering2 #102
