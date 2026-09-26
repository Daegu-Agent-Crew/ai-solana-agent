#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
census-collector.py — CLE2-29 Phase 1 밈코인 권한 센서스 수집기 (read-only)

신규 솔라나 코인 감지 → 코인당 권한 스냅샷(mint/freeze/update authority) +
상위 잔액 집중도(번·LP 볼트 제외 원칙) + 출처 추정(템플릿/커스텀 런칭) 기록.

계승 문서:
- dapp4-pipeline/DESIGN-market-dashboard.md (CLE2-25 Phase 4): 페어 고정·집중도 필터·
  컴플라이언스·read-only 원칙 — 본 브랜치 이전 단계 산출물로 cle2-25-phase0 브랜치에 있음.
- deepthink/memecoin-probe/evidence_log/README.md: 95코인 증거 로그 레코드 규격·예절.
- deepthink/memecoin-contagion r8c02: 판정 함수(사전 B 55 : A 45 + 4스위치) — verdict-v2.py 참조.

규칙 (강제):
- 읽기 전용: RPC 메서드 허용 목록(allowlist) 밖 → 즉시 예외. 서명/발송/에어드랍 금지.
- mainnet-beta 공개 엔드포인트만. 유료 키 없음.
- 호출 간 200ms+, 429/5xx 지수 백오프, 1회 실행 RPC 총 ~400회 상한.
- KRW 표기 없음(USD/SOL만). 투자 권유 아님 — 관측 기록만 생성.

CLI:
  python3 census-collector.py --coins 8 --dry-run     # 감지만
  python3 census-collector.py --coins 8               # 스냅샷 생성 + latest.json 갱신
  python3 census-collector.py --coins 30 --out /tmp/x # 출력 경로 지정
"""

import argparse
import base64
import csv
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

# ─────────────────────────────────────────────────────────────────
# read-only 안전장치 (우선 평가)
# ─────────────────────────────────────────────────────────────────

ALLOWED_RPC_METHODS = {
    "getaccountinfo",
    "getmultipleaccounts",
    "gettokenlargestaccounts",
    "getsignaturesforaddress",
    "getblocktime",
    "getslot",
    "getversion",
    "getbalance",
}

FORBIDDEN_SUBSTRINGS = (
    "sendtransaction", "sign", "airdrop", "requestairdrop", "transfer",
    "mintto", "setauthority", "burn", "closeaccount", "initializeaccount",
    "createmint", "upgrade", "delegate",
)

MAINNET_RPC = "https://api.mainnet-beta.solana.com"
# 분산 엔드포인트 (PLAN 리스크 대응: 공개 RPC 레이트리밋 → 백오프·분산) — 유료 키 없음, 읽기 전용 동일
RPC_ENDPOINTS = [
    MAINNET_RPC,
    "https://solana-rpc.publicnode.com",
]


class ReadOnlyViolation(RuntimeError):
    """읽기 전용 원칙 위반 시도 감지 — 즉시 중단."""


def rpc_guard(method: str, endpoint: str):
    m = method.strip()
    low = m.lower()
    if low not in ALLOWED_RPC_METHODS:
        raise ReadOnlyViolation(f"허용 목록 밖 RPC 메서드: {method!r} (read-only 위반)")
    for bad in FORBIDDEN_SUBSTRINGS:
        if bad in low:
            raise ReadOnlyViolation(f"금지 문자열 감지: {bad!r} in {method!r}")
    host = endpoint.split("//", 1)[-1].split("/", 1)[0].lower()
    if "mainnet-beta" not in host and "rpc" not in host:
        raise ReadOnlyViolation(f"대상 네트워크 확인 불가: {endpoint}")


# ─────────────────────────────────────────────────────────────────
# base58 + ed25519 순수 파이썬 PDA 유도 (외부 의존성 0)
# ─────────────────────────────────────────────────────────────────

B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(raw: bytes) -> str:
    n = int.from_bytes(raw, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = B58_ALPHABET[r] + s
    pad = 0
    for b in raw:
        if b == 0:
            pad += 1
        else:
            break
    return "1" * pad + s


def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        n = n * 58 + B58_ALPHABET.index(ch)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    pad = 0
    for ch in s:
        if ch == "1":
            pad += 1
        else:
            break
    return b"\x00" * pad + body


P_CURVE = 2**255 - 19
D_CURVE = (-121665 * pow(121666, P_CURVE - 2, P_CURVE)) % P_CURVE
SQRT_M1 = pow(2, (P_CURVE - 1) // 4, P_CURVE)


def is_on_ed25519_curve(b: bytes) -> bool:
    """32바이트가 ed25519 곡선 위 압축점으로 해석 가능한지 (RFC 8032 역산)."""
    if len(b) != 32:
        return False
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= P_CURVE:
        return False
    u = (y * y - 1) % P_CURVE
    v = (D_CURVE * y * y + 1) % P_CURVE
    if v == 0:
        return False
    x = (u * pow(v, 3, P_CURVE) * pow(u * pow(v, 7, P_CURVE), (P_CURVE - 5) // 8, P_CURVE)) % P_CURVE
    if (v * x * x) % P_CURVE == u:
        return True
    x = (x * SQRT_M1) % P_CURVE
    if (v * x * x) % P_CURVE == u:
        return True
    return False


def create_program_address(seeds, program_id: bytes):
    h = hashlib.sha256(b"".join(seeds) + program_id + b"ProgramDerivedAddress").digest()
    if is_on_ed25519_curve(h):
        return None
    return b58encode(h)


def find_program_address(seeds, program_id: bytes):
    for bump in range(255, 0, -1):
        addr = create_program_address(list(seeds) + [bytes([bump])], program_id)
        if addr is not None:
            return addr, bump
    raise ValueError("PDA 유도 실패")


METADATA_PROGRAM = b58decode("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
TOKEN_METADATA_SEED = b"metadata"


def metadata_pda(mint_b58: str) -> str:
    return find_program_address(
        [TOKEN_METADATA_SEED, METADATA_PROGRAM, b58decode(mint_b58)], METADATA_PROGRAM
    )[0]


# ─────────────────────────────────────────────────────────────────
# HTTP 공통 (예절: 200ms 간격, 429 지수 백오프)
# ─────────────────────────────────────────────────────────────────

LAST_CALL_TS = {"rpc": 0.0, "api": 0.0}
MIN_INTERVAL = {"rpc": 0.6, "api": 0.25}  # RPC 600ms — 공유 IP 쿼터 존중 (요구 조건 '200ms+'의 상향 준수)
RPC_CALLS = {"n": 0}
RPC_BUDGET = 400
BACKOFF_BASE = 0.6
BACKOFF_MAX = 20.0
RETRIES = 5


class BudgetExceeded(RuntimeError):
    pass


def _polite(kind: str):
    gap = time.time() - LAST_CALL_TS[kind]
    if gap < MIN_INTERVAL[kind]:
        time.sleep(MIN_INTERVAL[kind] - gap)
    LAST_CALL_TS[kind] = time.time()


def http_json(url: str, payload=None, kind: str = "api", timeout: int = 30, headers=None, retries=None):
    """GET(또는 JSON POST). 429/5xx → 지수 백오프 재시도(retries=1이면 단발 — rpc()가 상위 재시도·순환 소유)."""
    attempts = retries if retries else RETRIES
    for attempt in range(attempts):
        _polite(kind)
        req_headers = {"User-Agent": "cle2-29-census/1.0 (read-only observation; educational)"}
        if headers:
            req_headers.update(headers)
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            req_headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=req_headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", "replace")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
                sleep = min(BACKOFF_BASE * (2**attempt), BACKOFF_MAX)
                time.sleep(sleep)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt < attempts - 1:
                time.sleep(min(BACKOFF_BASE * (2**attempt), BACKOFF_MAX))
                continue
            raise
    raise RuntimeError(f"요청 실패(재시도 소진): {url}")


def rpc(method: str, params: list, timeout: int = 30):
    """mainnet-beta 공개 RPC 호출 (read-only 감시 하) — 429/5xx 시 엔드포인트 순환 + 지수 백오프."""
    payload = {"jsonrpc": "2.0", "id": RPC_CALLS["n"] + 1, "method": method, "params": params}
    last_err = None
    for attempt in range(RETRIES):
        endpoint = RPC_ENDPOINTS[attempt % len(RPC_ENDPOINTS)]
        rpc_guard(method, endpoint)
        if RPC_CALLS["n"] >= RPC_BUDGET:
            raise BudgetExceeded(f"RPC 상한 {RPC_BUDGET}회 도달 — 실행 중단(부분 결과 저장)")
        try:
            out = http_json(endpoint, payload=payload, kind="rpc", timeout=timeout, retries=1)
        except (ReadOnlyViolation, BudgetExceeded):
            raise
        except Exception as e:
            last_err = e
            time.sleep(min(BACKOFF_BASE * (2**attempt), BACKOFF_MAX))
            continue
        RPC_CALLS["n"] += 1
        if "error" in out:
            raise RuntimeError(f"RPC 오류 {method}: {out['error']}")
        return out.get("result")
    raise last_err if last_err else RuntimeError(f"RPC 실패 {method}")


# ─────────────────────────────────────────────────────────────────
# 알려진 주소 레지스트리 (집중도 필터 3단 계층 중 1단: 권한/인프라 대조)
# ─────────────────────────────────────────────────────────────────

BURN_SINKS = {
    "11111111111111111111111111111111",        # 시스템 프로그램 (폐기 싱크 조작화 — PONKE 사례 계승)
    "1nc1nerator11111111111111111111111111111111",  # SPL 토큰 소각 프로그램
}
INFRA_REGISTRY = {
    # pump.fun 본딩커브/수수료/AMM
    "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
    "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM",
    "pumpbXw7gD8LLHqZr64wXqNbXjHUCpgVB6JUy7Dk6tk",
    # Raydium AMM 권한/프로그램 파생
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    "6LLhMeVw7B8o0cVwP4Na6dBuJ5f6r3v5P3oM3W3vJ7xG",
    # Metaplex / 토큰 프로그램
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "ComputeDatum111111111111111111111111111111",
}
QUOTE_MINTS = {
    "So11111111111111111111111111111111111111112",   # WSOL
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  # USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",  # USDT
}


# ─────────────────────────────────────────────────────────────────
# 1) 신규 코인 감지: GeckoTerminal new_pools (검출) + DexScreener (정준 페어·출처)
# ─────────────────────────────────────────────────────────────────

GT_NEW_POOLS = "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page={page}"
DEX_TOKENS = "https://api.dexscreener.com/tokens/v1/solana/{mints}"


def discover_new_coins(n: int):
    """최근 신규 풀에서 유니크 베이스 토큰(신규 코인) n개 수확."""
    mints = {}  # mint -> {pool_created_at, pool_addr, name}
    page = 1
    while len(mints) < n and page <= 12:
        doc = http_json(GT_NEW_POOLS.format(page=page), kind="api", timeout=25)
        rows = (doc.get("data") or [])
        if not rows:
            break
        for row in rows:
            rel = row.get("relationships") or {}
            base_id = ((rel.get("base_token") or {}).get("data") or {}).get("id", "")
            quote_id = ((rel.get("quote_token") or {}).get("data") or {}).get("id", "")
            if not base_id.startswith("solana_"):
                continue
            mint = base_id[len("solana_"):]
            if mint in QUOTE_MINTS or quote_id == base_id:
                continue
            attrs = row.get("attributes") or {}
            if mint not in mints:
                # GT 풀명 "BASE / QUOTE" → 베이스 심볼 추출(DexScreener 미등재 신규 풀 폴백용)
                gt_name = attrs.get("name") or ""
                gt_symbol = gt_name.split(" / ")[0].strip() if " / " in gt_name else None
                mints[mint] = {
                    "detected_pool": attrs.get("address") or row.get("id", ""),
                    "detected_at_pool_created": attrs.get("pool_created_at"),
                    "detected_name": gt_name,
                    "detected_symbol": gt_symbol,
                }
            if len(mints) >= n + 10:  # 여유분 확보(스키프 대비)
                break
        page += 1
    return mints


def enrich_pairs(mints: list):
    """DexScreener 일괄 조회 → 민트당 정준 페어 1개 고정(유동성 최대, 동률 pairAddress 사전순).
    설계 관례 계승: 페어 전환 시 신규 시계열 분리 원칙 — snapshot.pair_id로 기록."""
    out = {}
    for i in range(0, len(mints), 30):
        batch = mints[i : i + 30]
        url = DEX_TOKENS.format(mints=",".join(batch))
        pairs = http_json(url, kind="api", timeout=25)
        if not isinstance(pairs, list):
            continue
        for p in pairs:
            base = ((p.get("baseToken") or {}).get("address") or "")
            if base not in out:
                out[base] = []
            out[base].append(p)
    canonical = {}
    for mint, plist in out.items():
        if not plist:
            continue
        ranked = sorted(
            plist,
            key=lambda p: (-float(((p.get("liquidity") or {}).get("usd")) or 0), p.get("pairAddress") or ""),
        )
        best = ranked[0]
        canonical[mint] = {
            "pair_id": best.get("pairAddress"),
            "dex_id": best.get("dexId"),
            "pair_created_at_ms": best.get("pairCreatedAt"),
            "liquidity_usd": ((best.get("liquidity") or {}).get("usd")),
            "price_usd": best.get("priceUsd"),
            "fdv_usd": best.get("fdv"),
            "pair_url": best.get("url"),
            "token_symbol": (best.get("baseToken") or {}).get("symbol"),
            "token_name": (best.get("baseToken") or {}).get("name"),
            "n_pairs_seen": len(plist),
            "info_socials": bool(((best.get("info") or {}).get("socials"))),
        }
    return canonical


# ─────────────────────────────────────────────────────────────────
# 2) 체인 권한 스냅샷
# ─────────────────────────────────────────────────────────────────

def parse_metadata_account(b64_data: str):
    """Metaplex TokenMetadata 계정 파싱: update_authority / name / symbol / uri."""
    try:
        raw = base64.b64decode(b64_data)
    except Exception:
        return None
    if len(raw) < 65 or raw[0] not in (4, 5):
        return None
    update_authority = b58encode(raw[1:33])
    _mint = b58encode(raw[33:65])
    pos = 65

    def borsh_str():
        nonlocal pos
        if pos + 4 > len(raw):
            return ""
        ln = int.from_bytes(raw[pos : pos + 4], "little")
        pos += 4
        s = raw[pos : pos + ln].decode("utf-8", "replace").rstrip("\x00")
        pos += ln
        return s

    name = borsh_str()
    symbol = borsh_str()
    uri = borsh_str()
    return {
        "update_authority": update_authority,
        "mint": _mint,
        "name": name,
        "symbol": symbol,
        "uri": uri,
    }


def authority_state(authority, sinks=BURN_SINKS):
    """None=폐기(null), 'sink'=시스템프로그램 싱크 폐기(프로브 확장), 주소=유지."""
    if authority is None or authority == "":
        return "renounced"
    if authority in sinks:
        return "renounced_sink"
    return "kept"


def fetch_mint_account(mint: str):
    res = rpc("getAccountInfo", [mint, {"encoding": "jsonParsed"}])
    val = (res or {}).get("value")
    if not val:
        return None
    parsed = (((val.get("data") or {}).get("parsed")) or {}).get("info") or {}
    return {
        "token_program": val.get("owner"),
        "mint_authority": parsed.get("mintAuthority"),
        "freeze_authority": parsed.get("freezeAuthority"),
        "supply_raw": str(parsed.get("supply") or "0"),
        "decimals": parsed.get("decimals"),
    }


def fetch_metadata(mint: str):
    pda = metadata_pda(mint)
    res = rpc("getAccountInfo", [pda, {"encoding": "base64"}])
    val = (res or {}).get("value")
    if not val:
        return {"metadata_pda": pda, "meta_found": False}
    data = ((val.get("data") or [None, None])[1]) if isinstance(val.get("data"), list) else None
    parsed = parse_metadata_account(data) if data else None
    if not parsed:
        return {"metadata_pda": pda, "meta_found": False}
    parsed["metadata_pda"] = pda
    parsed["meta_found"] = True
    return parsed


def fetch_concentration(mint: str, supply_raw: str, decimals, dex_id=None):
    """상위 잔액 집중도 — getTokenLargestAccounts + owner 해석(3단 계층 중 1단 적용).
    상위 계정은 AMM 풀 볼트·번 주소 포함(설계 반증 계승) → raw/filtered 병기 기록.
    운영 교훈(프로브 계승): 공개 RPC에서 해당 호출은 429/장지연 상습 → 재시도 최소화 후
    RugCheck 공개 리포트 폴백(topHolders owner 포함 — 동일 레지스트리 필터 적용, 방법 기록)."""
    supply = int(supply_raw or "0")
    global RETRIES
    saved = RETRIES
    RETRIES = 2
    try:
        res = rpc("getTokenLargestAccounts", [mint], timeout=12)
    except (TimeoutError, RuntimeError, BudgetExceeded, urllib.error.HTTPError) as e:
        RETRIES = saved
        if isinstance(e, BudgetExceeded):
            raise
        try:
            doc = http_json(f"https://api.rugcheck.xyz/v1/tokens/{mint}/report", kind="api", timeout=30)
            holders = doc.get("topHolders") or []
            entries = []
            for rank, h in enumerate(holders[:20]):
                owner = h.get("owner")
                pct = h.get("pct") or 0
                tag = ("burn" if owner in BURN_SINKS else
                       "infra" if owner in INFRA_REGISTRY else
                       "wallet_or_unlisted_program")
                # 휴리스틱(3단 근사, 명시 라벨): 본딩커브 코인의 상위 대량 보유 = 커브 PDA(민트별 유도 → 정적 레지스트리 불가)
                if (dex_id == "pumpfun" and rank < 2 and pct >= 40 and tag == "wallet_or_unlisted_program"):
                    tag = "probable-bonding-curve"
                entries.append({"account": None, "owner": owner, "pct_raw": h.get("pct"), "tag": tag})
            top10_raw = sum((h.get("pct") or 0) for h in holders[:10])
            top20_raw = sum((h.get("pct") or 0) for h in holders[:20])
            top10_filtered = sum((h.get("pct") or 0) for h, e in zip(holders[:10], entries[:10])
                                 if e["tag"] not in ("burn", "infra", "probable-bonding-curve"))
            return {
                "method": "rugcheck-report-fallback",
                "filter_note": "getTokenLargestAccounts 실패(공개 RPC 429/장지연 — 프로브 운영 대체 계승) → RugCheck report topHolders. owner 기준 burn/infra 레지스트리 필터(1단) + 본딩커브 휴리스틱(3단 근사, probable-* 라벨로 명시) 적용.",
                "rpc_attempt_error": str(e)[:120],
                "top_accounts": entries,
                "top10_share_raw": round(top10_raw, 4),
                "top20_share_raw": round(top20_raw, 4),
                "top10_share_filtered": round(top10_filtered, 4),
                "total_holders": doc.get("totalHolders"),
                "launchpad": doc.get("launchpad"),
            }
        except Exception:
            return {"method": "failed", "filter_note": "집중도 수집 실패(RPC+폴백 모두)", "top_accounts": [],
                    "top10_share_raw": None, "top20_share_raw": None, "top10_share_filtered": None}
    RETRIES = saved
    accounts = (res or {}).get("value") or []
    entries = []
    for a in accounts[:20]:
        amt = float(a.get("amount") or 0)
        pct = (amt / supply * 100.0) if supply else 0.0
        entries.append({"account": a.get("address"), "amount_raw": a.get("amount"), "pct_raw": pct, "owner": None, "tag": "unresolved"})
    # owner 해석: 상위 10개 토큰 계정 → getMultipleAccounts(parsed) 1회
    top10 = [e["account"] for e in entries[:10] if e.get("account")]
    if top10:
        res2 = rpc("getMultipleAccounts", [top10, {"encoding": "jsonParsed"}])
        vals = (res2 or {}).get("value") or []
        for e, v in zip(entries[:10], vals):
            if not v:
                e["tag"] = "closed_or_unknown"
                continue
            owner = (((v.get("data") or {}).get("parsed")) or {}).get("info", {}).get("owner")
            e["owner"] = owner
            if owner in BURN_SINKS:
                e["tag"] = "burn"
            elif owner in INFRA_REGISTRY:
                e["tag"] = "infra"  # 풀 볼트·권한·수수료 추정 (1단 대조)
            else:
                e["tag"] = "wallet_or_unlisted_program"
    top10_raw = sum(e["pct_raw"] for e in entries[:10])
    top20_raw = sum(e["pct_raw"] for e in entries[:20])
    top10_filtered = sum(e["pct_raw"] for e in entries[:10] if e["tag"] in ("wallet_or_unlisted_program", "closed_or_unknown"))
    return {
        "method": "getTokenLargestAccounts+owner-resolve(layer1-registry)",
        "filter_note": "상위 계정은 AMM 풀 볼트·번 주소 포함 — burn/infra 태그 제외 후 filtered 값. 2·3단(풀 파싱·owner-program)은 Phase 2 확장.",
        "top_accounts": entries,
        "top10_share_raw": round(top10_raw, 4),
        "top20_share_raw": round(top20_raw, 4),
        "top10_share_filtered": round(top10_filtered, 4),
    }


TEMPLATE_DEX_IDS = {
    "pumpfun", "pumpswap",          # pump.fun 본딩커브/AMM
    "meteoradbc",                    # Meteora Dynamic Bonding Curve(런치패드)
}


def estimate_origin(pair_info: dict, conc: dict):
    """출처 추정(템플릿/커스텀 런칭 특징). 프로브 조작화 계승+확장:
    dexId ∈ {pumpfun, pumpswap, meteoradbc} 또는 RugCheck launchpad 존재 → 템플릿(런치패드 출생).
    커스텀 = 런치패드 없이 자체 AMM 페어로 출시. 미등재 신규 풀은 무분별 분류 금지(unclassified)."""
    dex_id = (pair_info or {}).get("dex_id")
    launchpad = (conc or {}).get("launchpad")
    feats = []
    is_template = False
    if dex_id in TEMPLATE_DEX_IDS:
        is_template = True
        feats.append(f"dexId={dex_id}")
        if dex_id == "pumpfun":
            feats.append("본딩커브 거래 중(마이그레이션 전)")
    if launchpad:
        is_template = True
        platform = (launchpad.get("platform") if isinstance(launchpad, dict) else str(launchpad)) or str(launchpad)
        feats.append(f"launchpad={platform}")
    if dex_id is None and not is_template:
        # 감지된 직후 품 — DexScreener 미등재. 무분별 커스텀 분류 금지(프레임 오염 방지)
        kind = "unclassified-new-pool"
        feats = ["DexScreener 페어 미등재(수집 직후 풀)"]
    else:
        kind = "template" if is_template else "custom-launch"
    return {"kind": kind, "evidence": feats, "has_socials": (pair_info or {}).get("info_socials")}


# ─────────────────────────────────────────────────────────────────
# 3) 실행·저장 (프로브 증거 로그 레코드 규격 계승 + 확장)
# ─────────────────────────────────────────────────────────────────

def snapshot_coin(mint: str, detected: dict, pair_info: dict) -> dict:
    mintacct = fetch_mint_account(mint)
    if not mintacct:
        return {"addr": mint, "status": "no_mint_account", "source": "geckoterminal-new_pools"}
    meta = fetch_metadata(mint)
    conc = fetch_concentration(mint, mintacct["supply_raw"], mintacct["decimals"], dex_id=(pair_info or {}).get("dex_id"))
    origin = estimate_origin(pair_info, conc)

    mint_state = authority_state(mintacct["mint_authority"])
    freeze_state = authority_state(mintacct["freeze_authority"])
    update_state = authority_state(meta.get("update_authority")) if meta.get("meta_found") else "unknown"
    renounced = lambda s: s.startswith("renounced")

    symbol = (pair_info or {}).get("token_symbol") or (meta.get("symbol") or detected.get("detected_symbol") or "?")
    record = {
        # 프로브 증거 로그 레코드 규격 (addr/symbol/source/token_program/decimals/supply_raw/
        # mint_authority/freeze_authority/metadata_pda/meta_found/update_authority/status) 계승
        "addr": mint,
        "expected_symbol": symbol,
        "source": "geckoterminal-new_pools",
        "detected": detected,
        "pair": pair_info,
        "token_program": mintacct["token_program"],
        "decimals": mintacct["decimals"],
        "supply_raw": mintacct["supply_raw"],
        "mint_authority": mintacct["mint_authority"],
        "freeze_authority": mintacct["freeze_authority"],
        "metadata_pda": meta.get("metadata_pda"),
        "meta_found": meta.get("meta_found", False),
        "meta_name": meta.get("name"),
        "meta_symbol": meta.get("symbol"),
        "meta_uri": meta.get("uri"),
        "identity_match": (not meta.get("meta_found")) or str(meta.get("symbol", "")).strip().upper() == str(symbol).strip().upper(),
        "update_authority": meta.get("update_authority") if meta.get("meta_found") else None,
        # 센서스 확장 필드 (판정 v2 프레임 조항 입력)
        "authority_states": {
            "mint": mint_state, "freeze": freeze_state, "update": update_state,
        },
        "mintR": renounced(mint_state),
        "freezeR": renounced(freeze_state),
        "updateR": (renounced(update_state) if update_state != "unknown" else None),
        "doubleR": renounced(mint_state) and renounced(freeze_state),
        "deepR": renounced(mint_state) and renounced(freeze_state) and (renounced(update_state) if update_state != "unknown" else False),
        "origin": origin,
        "concentration": conc,
        "status": "ok",
        "read_only": True,
        "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    return record


def summarize(records: list) -> dict:
    ok = [r for r in records if r.get("status") == "ok"]
    n = len(ok)
    if not n:
        return {"n": 0}
    m = sum(1 for r in ok if r["mintR"])
    d = sum(1 for r in ok if r["doubleR"])
    dep = sum(1 for r in ok if r["deepR"])
    tmpl_ren = [r for r in ok if r["doubleR"] and r["origin"]["kind"] == "template"]
    custom = [r for r in ok if r["origin"]["kind"] == "custom-launch"]
    custom_d = [r for r in custom if r["doubleR"]]
    top10f = [r["concentration"].get("top10_share_filtered") for r in ok]
    top10f = [v for v in top10f if isinstance(v, (int, float))]
    return {
        "n": n,
        "mint_renounced": m,
        "double_renounced": d,
        "deep_renounced": dep,
        "mint_ren_rate": round(m / n, 4),
        "double_ren_rate": round(d / n, 4),
        "deep_ren_rate": round(dep / n, 4),
        "template_n": sum(1 for r in ok if r["origin"]["kind"] == "template"),
        "custom_n": len(custom),
        "custom_double_rate": round(len(custom_d) / len(custom), 4) if custom else None,
        "template_share_of_renunciations": round(len(tmpl_ren) / d, 4) if d else None,
        "top10_filtered_mean": round(sum(top10f) / len(top10f), 2) if top10f else None,
    }


def main():
    global RPC_BUDGET
    ap = argparse.ArgumentParser(description="CLE2-29 권한 센서스 수집기 (read-only)")
    ap.add_argument("--coins", type=int, default=30, help="수집 코인 수(기본 30, 최대 100)")
    ap.add_argument("--dry-run", action="store_true", help="신규 코인 감지만 수행(파일 기록 없음)")
    ap.add_argument("--out", default=None, help="출력 루트(기본: 리포 dapp4/census/data)")
    ap.add_argument("--budget", type=int, default=RPC_BUDGET, help="RPC 호출 상한(기본 400)")
    args = ap.parse_args()
    RPC_BUDGET = args.budget
    n = max(1, min(args.coins, 100))

    t0 = time.time()
    # 자체 검증: BONK 메타데이터 PDA 순수 파이썬 유도가 프로브 실측값과 일치하는지
    bonk_pda = metadata_pda("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")
    assert bonk_pda == "FDZZbyY9XGpL3CNKUZxLk3wFTTQYL3TkDiDzqxrizcPN", f"PDA 자체검증 실패: {bonk_pda}"
    print(f"[selftest] Metaplex PDA 유도 OK (BONK → {bonk_pda[:8]}…)")

    print(f"[detect] 신규 풀 감지 시작 (목표 {n}코인)…")
    detected = discover_new_coins(n)
    print(f"[detect] 후보 {len(detected)}민트 — DexScreener 정준 페어 부착…")
    canonical = enrich_pairs(list(detected.keys()))
    targets = []
    for mint, det in detected.items():
        pinfo = canonical.get(mint) or {}
        targets.append((mint, det, pinfo))
        if len(targets) >= n:
            break
    print(f"[detect] 확정 {len(targets)}코인")

    now = dt.datetime.now(dt.timezone.utc)
    for mint, det, pinfo in targets:
        sym = (pinfo.get("token_symbol") or det.get("detected_name") or mint[:4])[:16]
        created = pinfo.get("pair_created_at_ms")
        age_h = f"{(now.timestamp() - created/1000)/3600:.1f}h" if created else "?"
        print(f"  - {sym:<12} {mint[:8]}… dex={(pinfo.get('dex_id') or '?'):<10} 페어연령={age_h} 유동성=${pinfo.get('liquidity_usd') or 0:,.0f}")

    if args.dry_run:
        print(f"[dry-run] 기록 없음 종료. 감지 {len(targets)}코인, RPC {RPC_CALLS['n']}회, {time.time()-t0:.1f}s")
        return 0

    out_root = args.out or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "dapp4", "census", "data")
    out_root = os.path.normpath(out_root)
    day_dir = os.path.join(out_root, "snapshots", now.strftime("%Y-%m-%d"))
    os.makedirs(day_dir, exist_ok=True)

    records = []
    skipped = []
    for mint, det, pinfo in targets:
        try:
            rec = snapshot_coin(mint, det, pinfo)
        except BudgetExceeded as e:
            print(f"[budget] {e} — 나머지 {len(targets)-len(records)-len(skipped)}코인 스킵")
            skipped.append(mint)
            break
        except Exception as e:
            print(f"[warn] {mint[:8]}… 수집 실패: {e}")
            skipped.append(mint)
            continue
        records.append(rec)
        sym = (rec.get("expected_symbol") or "?").replace("/", "-")[:16]
        fname = f"{sym}_{mint[:8]}.json"
        with open(os.path.join(day_dir, fname), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
        states = rec["authority_states"]
        print(f"  ✓ {sym:<12} mint={states['mint']:<14} freeze={states['freeze']:<14} update={states['update']:<14} origin={rec['origin']['kind']}")

    summary = summarize(records)
    # latest.json 갱신 + 채택곡선 series (동일 날짜 교체)
    latest_path = os.path.join(out_root, "latest.json")
    prev = {}
    if os.path.exists(latest_path):
        try:
            prev = json.load(open(latest_path, encoding="utf-8"))
        except Exception:
            prev = {}
    series = [s for s in prev.get("series", []) if s.get("date") != now.strftime("%Y-%m-%d")]
    series.append({
        "date": now.strftime("%Y-%m-%d"),
        **summary,
        "rpc_calls": RPC_CALLS["n"],
    })
    latest = {
        "generated_at": now.isoformat(timespec="seconds"),
        "run": {"coins_requested": n, "records": len(records), "skipped": skipped,
                "rpc_calls": RPC_CALLS["n"], "rpc_budget": RPC_BUDGET,
                "elapsed_s": round(time.time() - t0, 1)},
        "summary": summary,
        "series": series[-60:],
        "coins": records,
        "compliance": {"purpose": "교육·관측 목적 · 투자 권유 아님 · read-only", "currency": "USD/SOL only"},
    }
    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, indent=1)

    print(f"[done] 스냅샷 {len(records)}코인 → {day_dir}")
    print(f"[done] latest.json 갱신 (series {len(series)}일분) → {latest_path}")
    print(f"[done] 요약: {json.dumps(summary, ensure_ascii=False)}")
    print(f"[done] RPC {RPC_CALLS['n']}회 / 상한 {RPC_BUDGET}회 · {time.time()-t0:.1f}초")
    return 0


if __name__ == "__main__":
    sys.exit(main())
