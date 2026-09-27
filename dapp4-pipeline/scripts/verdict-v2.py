#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verdict-v2.py — CLE2-29 A/B 판정 함수 v2 (4스위치 + 프레임 조항)

동결 계보:
- r8c02 (memecoin-contagion 세션4): 판정 함수 프레임 = 사전 B 55 : A 45 (동률 A) + 4스위치.
- memecoin-probe 실행 세션1 (2026-09-26): 조작화 등록본 — evidence_log/README.md §3.
- v2 신설 — 프레임 조항 (REPORT §5 한계 1의 설계 결함 수정):
  * 각 스위치 판정에 코인-가중(coin-weighted, 등록/가시성 프레임) /
    모집단-가중(population-weighted) 프레임을 명시.
  * S1은 두 프레임을 모두 계산·병기. 공식 판정은 '등록 프레임' 위에서 내리고,
    모집단 프레임 값은 병기 고지로 붙인다 (deep_r1c05 계승).
  * pump 테일 무작위 프레임: Phase 2 센서스 데이터로 보강 예정 — 상태 필드로 추적.

스위치 정의 (프로브 등록본 준용):
  S1 바닥 상위 3분위→A : 전체 폐기(doubleR) 중 템플릿 폐기 비중 ≥ 75% → A
  S2 자발 층 밴드 부재→A : era-1 유명 상단 꼬리 − 중앙값 테일 기울기가 밴드를 못 이루면 → A
  S3 혼합<30%→A        : era-2 커스텀 런치 폐기 비중 < 30% → A
  S4 거짓주장률>50%→B  : 폐기 주장 코인 중 체인 불일치 > 50% → B (담론 패널 입력 필요)
스위치 순서 무관 합산, 발동 다수결(동률 A), 0발동 → 사전 유지.

CLI:
  python3 verdict-v2.py                                   # 기본 baseline 판정
  python3 verdict-v2.py --input <aggregate.json|summary.csv|dir>
  python3 verdict-v2.py --latest <census latest.json>     # S1 모집단 프레임 프록시 병기
  python3 verdict-v2.py --discourse <claims.json>         # S4 채점(Phase 2)
"""

import argparse
import csv
import datetime as dt
import json
import os
import sys

PRIOR = {"B": 55, "A": 45}
REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DEFAULT_BASELINE = os.path.join(REPO, "dapp4", "census", "data", "baseline")
DEFAULT_OUT = os.path.join(REPO, "dapp4", "census", "data", "verdict.json")

ERA2_CUTOFF = "2024-01-01"  # pump.fun 시대 경계 (P3 도플러)


# ─────────────────────────────────────────────────────────────────
# 입력 로딩: aggregate.json 직독 또는 summary.csv 재계산
# ─────────────────────────────────────────────────────────────────

def load_input(path: str) -> dict:
    """aggregate.json → 그대로 사용 / summary.csv(또는 그것을 담은 dir) → 스위치 입력 재계산."""
    if os.path.isdir(path):
        if os.path.exists(os.path.join(path, "aggregate.json")):
            return load_aggregate(os.path.join(path, "aggregate.json"))
        if os.path.exists(os.path.join(path, "summary.csv")):
            return recompute_from_summary(os.path.join(path, "summary.csv"))
        raise FileNotFoundError(f"dir 내 aggregate.json/summary.csv 없음: {path}")
    if path.endswith("aggregate.json"):
        return load_aggregate(path)
    if path.endswith(".csv"):
        return recompute_from_summary(path)
    raise ValueError("입력은 aggregate.json / summary.csv / 디렉터리 중 하나여야 함")


def load_aggregate(path: str) -> dict:
    doc = json.load(open(path, encoding="utf-8"))
    ec = doc["era_contrast"]
    sw = doc.get("switches", {})
    return {
        "source": path,
        "n": doc.get("n"),
        "era1_n": ec["era1_n"],
        "era1_double_rate": ec["era1_double_rate"],
        "era1_famous_rate": ec["era1_famous_rate"],
        "era1_tail_rate": ec["era1_tail_rate"],
        "era2_n": ec["era2_n"],
        "era2_custom_n": ec["era2_custom_n"],
        "era2_custom_double_rate": ec["era2_custom_double_rate"],
        "era2_pump_n": ec["era2_pump_n"],
        "era2_pump_double_rate": ec["era2_pump_double_rate"],
        "s1_template_share": ec["template_share_of_renunciations"],
        "s4_claims_found": (sw.get("S4_false_claim_gt50_to_B") or {}).get("claims_found", 0),
        "meta_collected_at": (doc.get("meta") or {}).get("collected_at"),
    }


def recompute_from_summary(path: str) -> dict:
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    truthy = lambda v: str(v).strip().lower() in ("true", "1", "yes")

    def bucket_rows(*bs):
        return [r for r in rows if r["bucket"] in bs]

    era1 = [r for r in rows if r["era_date"] < ERA2_CUTOFF]
    era2 = [r for r in rows if r["era_date"] >= ERA2_CUTOFF]
    era2_custom = [r for r in era2 if not truthy(r["pump_born"])]
    era2_pump = [r for r in era2 if truthy(r["pump_born"])]
    ren = [r for r in rows if truthy(r["doubleR"])]
    ren_pump = [r for r in ren if truthy(r["pump_born"])]
    era1_famous = [r for r in era1 if truthy(r["famous"])]
    era1_tail = [r for r in era1 if not truthy(r["famous"])]
    rate = lambda rs: (sum(1 for r in rs if truthy(r["doubleR"])) / len(rs)) if rs else None
    return {
        "source": path,
        "n": len(rows),
        "era1_n": len(era1), "era1_double_rate": rate(era1),
        "era1_famous_rate": rate(era1_famous), "era1_tail_rate": rate(era1_tail),
        "era2_n": len(era2), "era2_custom_n": len(era2_custom),
        "era2_custom_double_rate": rate(era2_custom),
        "era2_pump_n": len(era2_pump), "era2_pump_double_rate": rate(era2_pump),
        "s1_template_share": (len(ren_pump) / len(ren)) if ren else None,
        "s4_claims_found": 0,
        "meta_collected_at": None,
    }


# ─────────────────────────────────────────────────────────────────
# 스위치 판정 (프레임 조항 포함)
# ─────────────────────────────────────────────────────────────────

def score_switches(d: dict, s4_discourse=None, latest=None) -> dict:
    switches = {}

    # S1 — 바닥 상위 3분위 → A (임계 0.75)
    s1_coin = d["s1_template_share"]
    s1_pop = None
    s1_pop_note = "미측정 — 모집단 프레임(무작위 pump 테일) 구축 전. 프로브 order-of-magnitude 추정 ~0.99(발동 전망, 미검증)."
    if latest:
        s = latest.get("summary") or {}
        if s.get("template_share_of_renunciations") is not None:
            s1_pop = s["template_share_of_renunciations"]
            s1_pop_note = f"센서스 신규 발행 모집단 프록시(latest.json, n={s.get('n')}) — 무작위 프레임은 아님(검출 편향 고지)."
    switches["S1_floor_75pct_to_A"] = {
        "condition": "전체 폐기 중 템플릿(강제/주변) 폐기 비중 ≥ 0.75 → A",
        "value_coin_weighted": round(s1_coin, 4) if s1_coin is not None else None,
        "value_population_weighted": round(s1_pop, 4) if s1_pop is not None else None,
        "population_note": s1_pop_note,
        "threshold": 0.75,
        "fired": bool(s1_coin is not None and s1_coin >= 0.75),
        "frame": "coin-weighted (등록/가시성 프레임) — 공식 판정 축 / population-weighted 병기 고지",
    }

    # S2 — 자발 층 밴드 부재 → A
    famous_rate, tail_rate, era1_n = d["era1_famous_rate"], d["era1_tail_rate"], d["era1_n"]
    gradient = (famous_rate - tail_rate) if (famous_rate is not None and tail_rate is not None) else None
    band_present = bool(gradient is not None and gradient >= 0.40 and era1_n >= 10)
    switches["S2_voluntary_band_absence_to_A"] = {
        "condition": "era-1 자발 층 밴드 부재(유명 상단 꼬리 − 중앙값 테일 기울기 ≥ 0.40 및 유효 n ≥ 10이면 밴드 존재) → 부재 시 A",
        "era1_famous_rate": round(famous_rate, 4) if famous_rate is not None else None,
        "era1_tail_rate": round(tail_rate, 4) if tail_rate is not None else None,
        "gradient": round(gradient, 4) if gradient is not None else None,
        "era1_n": era1_n,
        "band_present": band_present,
        "fired": not band_present,
        "frame": "coin-weighted (등재 코인 프레임 — era-1은 token-list 등재 모집단). "
                 "모집단 프레임에서는 유명 층 비중 ≈ 0 → 밴드 붕괴 전망(고지 조항)",
    }

    # S3 — 혼합 < 30% → A
    s3 = d["era2_custom_double_rate"]
    switches["S3_mixed_lt30_to_A"] = {
        "condition": "era-2 커스텀 런치 폐기 비중 < 0.30 → A",
        "value": round(s3, 4) if s3 is not None else None,
        "n": d["era2_custom_n"],
        "threshold": 0.30,
        "fired": bool(s3 is not None and s3 < 0.30),
        "frame": "coin-weighted (검색-가시 커스텀 프레임 — 검출 편향 고지)",
    }

    # S4 — 거짓주장률 > 50% → B (담론 패널 입력)
    if s4_discourse:
        claims = s4_discourse.get("claims_total", 0)
        mism = s4_discourse.get("chain_mismatch", 0)
        s4_rate = (mism / claims) if claims else None
        switches["S4_false_claim_gt50_to_B"] = {
            "condition": "폐기 주장 중 체인 불일치 > 0.50 → B",
            "claims_found": claims, "mismatch": mism,
            "value": round(s4_rate, 4) if s4_rate is not None else None,
            "threshold": 0.50,
            "fired": bool(s4_rate is not None and s4_rate > 0.50),
            "frame": "coin-weighted (담론 패널 — 공개 주장 표본)",
        }
    else:
        switches["S4_false_claim_gt50_to_B"] = {
            "condition": "폐기 주장 중 체인 불일치 > 0.50 → B",
            "claims_found": d.get("s4_claims_found", 0),
            "value": None,
            "threshold": 0.50,
            "fired": False,
            "status": "UNSCORABLE — 담론 패널(오프체인 주장 수집) 필요. 상태층 온체인 텍스트 주장 0건(프로브 슬롯3).",
            "frame": "discourse panel (Phase 2 입력 대기)",
        }
    return switches


def verdict(switches: dict) -> dict:
    flips_a = [k for k, v in switches.items() if v["fired"] and k.endswith("_to_A")]
    flips_b = [k for k, v in switches.items() if v["fired"] and k.endswith("_to_B")]
    if not flips_a and not flips_b:
        final = f"PRIOR-HOLD B {PRIOR['B']} : A {PRIOR['A']} (스위치 0발동 → 사전 유지)"
        winner = "B(prior)"
    elif len(flips_a) > len(flips_b):
        final = f"A (발동 A {len(flips_a)} : B {len(flips_b)} — 다수결)"
        winner = "A"
    else:  # 동률 또는 B 우세 → 동률 A 규칙은 '발동 스위치 간 동률'에만 적용(프로브 등록본)
        final = f"B (발동 A {len(flips_a)} : B {len(flips_b)})"
        winner = "B"
    return {"prior": f"B {PRIOR['B']} : A {PRIOR['A']}", "flips_A": flips_a, "flips_B": flips_b, "final": final, "winner": winner}


def reproduction_check(out: dict) -> dict:
    """baseline 실행 시 프로브 판정 재현 검증: 사전 유지(B55:A45) + S1 13.1%."""
    s1 = out["switches"]["S1_floor_75pct_to_A"]["value_coin_weighted"]
    final_hold = out["verdict"]["winner"] == "B(prior)" and out["verdict"]["flips_A"] == [] and out["verdict"]["flips_B"] == []
    s1_match = s1 is not None and abs(s1 - 0.1311) <= 0.001
    return {
        "expected": "PRIOR-HOLD B 55 : A 45 · S1 13.1% (memecoin-probe 2026-09-26)",
        "prior_hold_reproduced": final_hold,
        "s1_value": s1,
        "s1_reproduced": s1_match,
        "pass": bool(final_hold and s1_match),
    }


# ─────────────────────────────────────────────────────────────────
# 사람 읽기 요약
# ─────────────────────────────────────────────────────────────────

def human_summary(out: dict):
    lines = []
    lines.append("=" * 72)
    lines.append("CLE2-29 판정 함수 v2 — 4스위치 + 프레임 조항")
    lines.append(f"입력: {out['input']['source']} (n={out['input']['n']}, 수집 {out['input'].get('meta_collected_at') or 'n/a'})")
    lines.append(f"사전(동결 r8c02): B {PRIOR['B']} : A {PRIOR['A']} · 동률 A")
    lines.append("-" * 72)
    for k, v in out["switches"].items():
        val = v.get("value_coin_weighted", v.get("value"))
        lines.append(f"[{k}]")
        lines.append(f"  조건: {v['condition']}")
        shown = []
        if v.get("value_coin_weighted") is not None:
            shown.append(f"코인-가중={v['value_coin_weighted']}")
        if v.get("value_population_weighted") is not None:
            shown.append(f"모집단-가중={v['value_population_weighted']}")
        if v.get("gradient") is not None:
            shown.append(f"기울기={v['gradient']}(유명 {v['era1_famous_rate']} vs 테일 {v['era1_tail_rate']})")
        lines.append(f"  실측: {' · '.join(shown) if shown else val}")
        lines.append(f"  프레임: {v['frame']}")
        if v.get("population_note"):
            lines.append(f"  모집단 프레임 고지: {v['population_note']}")
        if v.get("status"):
            lines.append(f"  상태: {v['status']}")
        lines.append(f"  발동: {'YES' if v['fired'] else 'NO'}")
    lines.append("-" * 72)
    lines.append(f"판정: {out['verdict']['final']}")
    rc = out["reproduction_check"]
    lines.append(f"재현 검증: {'PASS' if rc['pass'] else 'FAIL'} — 기대 {rc['expected']} / 관측 S1={rc['s1_value']}")
    lines.append(f"프레임 조항: {out['frame_clauses']['pump_tail_random_frame']}")
    lines.append("=" * 72)
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="CLE2-29 판정 함수 v2")
    ap.add_argument("--input", default=DEFAULT_BASELINE, help="aggregate.json | summary.csv | dir")
    ap.add_argument("--latest", default=None, help="센서스 latest.json — S1 모집단 프레임 프록시 병기")
    ap.add_argument("--discourse", default=None, help="담론 패널 claims.json — S4 채점(Phase 2)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="판정 JSON 출력 경로")
    args = ap.parse_args()

    d = load_input(args.input)
    latest = None
    if args.latest and os.path.exists(args.latest):
        latest = json.load(open(args.latest, encoding="utf-8"))
    discourse = None
    if args.discourse and os.path.exists(args.discourse):
        discourse = json.load(open(args.discourse, encoding="utf-8"))

    switches = score_switches(d, s4_discourse=discourse, latest=latest)
    v = verdict(switches)
    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "version": "verdict-v2 (CLE2-29 Phase 1) — 4스위치 + 프레임 조항",
        "input": d,
        "prior": v["prior"],
        "switches": switches,
        "verdict": v,
        "frame_clauses": {
            "s1_dual_frame": "S1은 코인-가중(공식 판정 축)과 모집단-가중(병기 고지)을 모두 계산한다.",
            "s2_population_note": "S2 밴드는 등재 코인 프레임 위의 존재 판정 — 모집단 프레임에서 유명 층 비중 ≈ 0이면 밴드 붕괴(등록 설계 한계 고지).",
            "pump_tail_random_frame": "PENDING — Phase 2 센서스 관측으로 era-2 무작위 pump 테일 프레임 구축 후 S1/S3 모집단-가중 값 확정.",
            "official_frame": "공식 판정은 등록(코인-가중) 프레임 위에서 — deep_r1c05 계승",
        },
        "compliance": "교육·관측 목적 · 투자 권유 아님 · read-only · KRW 표기 금지",
    }
    out["reproduction_check"] = reproduction_check(out) if "baseline" in str(d["source"]).replace("\\", "/") else None

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(human_summary(out))
    print(f"[out] {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# tamper-test
