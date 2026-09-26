/* CLE2-29 권한 센서스 대시보드 — 무빌드 vanilla JS
 * 컴플라이언스 UI 강제:
 *  1) 고지문("교육·관측 목적 · 투자 권유 아님 · read-only") 미표시 시 렌더 거부
 *  2) KRW/₩/원화 표기 감지 시 렌더 거부
 * read-only: 이 스크립트는 어떤 트랜잭션도 만들지 않으며 정적 JSON만 GET 한다.
 */
(function () {
  "use strict";

  var NOTICE = "교육·관측 목적 · 투자 권유 아님 · read-only";
  var STALE_MIN = 90; // 신선도 경계(분) — dapp4 설계 계승

  /* ── 컴플라이언스 게이트 ─────────────────────────────── */
  function complianceGate() {
    var el = document.getElementById("complianceNotice");
    var ok = !!el && el.getAttribute("data-notice") === NOTICE && el.offsetParent !== null;
    var text = el ? el.textContent || "" : "";
    ["교육", "관측", "투자 권유 아님", "read-only"].forEach(function (t) {
      if (text.indexOf(t) === -1) ok = false;
    });
    if (!ok) {
      document.getElementById("complianceError").classList.remove("hidden");
      document.querySelector("main").style.display = "none";
      throw new Error("컴플라이언스 고지문 미표시 — 렌더 거부");
    }
  }

  function krwGate() {
    var t = document.body.textContent || "";
    if (/₩|KRW|원화/.test(t)) {
      document.getElementById("complianceError").classList.remove("hidden");
      document.querySelector("main").style.display = "none";
      throw new Error("KRW 표기 감지 — 렌더 거부 (USD/SOL만 허용)");
    }
  }

  /* ── 유틸 ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function pct(x, digits) {
    return (x === null || x === undefined || isNaN(x)) ? "-" : (100 * x).toFixed(digits === undefined ? 1 : digits) + "%";
  }
  function fetchJson(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error(path + " " + r.status));
    });
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ── 신선도 라벨 (90분 경과 경고 배지) ───────────────── */
  function freshness(iso) {
    var el = $("freshnessText"), badge = $("staleBadge");
    if (!iso) { el.textContent = "스냅샷 없음(baseline 모드)"; return; }
    var t = new Date(iso).getTime();
    var ageMin = (Date.now() - t) / 60000;
    el.textContent = "생성 " + new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST";
    if (ageMin > STALE_MIN) badge.classList.remove("hidden");
    else badge.classList.add("hidden");
  }

  /* ── 수평 바 차트 (의존성 0) ─────────────────────────── */
  function hbar(el, rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    el.innerHTML = rows.map(function (r) {
      var w = Math.round((r.value / max) * 100);
      return '<div class="hrow"><span class="hlabel">' + esc(r.label) + '</span>' +
        '<span class="htrack"><span class="hfill' + (r.hot ? " hot" : "") + '" style="width:' + w + '%"></span></span>' +
        '<span class="hval">' + esc(r.display !== undefined ? r.display : r.value) + "</span></div>";
    }).join("");
  }

  /* ── ①② baseline: 인구 통계 + 분해 ──────────────────── */
  function renderBaseline(agg) {
    if (!agg) return;
    $("statN").innerHTML = esc(agg.n) + "<small>코인</small>";
    var ec = agg.era_contrast;
    $("statEra").innerHTML = pct(ec.era1_double_rate) + " → " + pct(ec.era2_double_rate);
    var ua = agg.update_authority || {};
    $("statDepth").innerHTML = pct(ua.era1_renounced_kept_update) + " → " + pct(ua.era2_custom_renounced_kept_update);
    $("statS1").innerHTML = pct(ec.template_share_of_renunciations, 1).replace("13.1%", "13.1<small>%</small>");

    var b = agg.buckets || {};
    hbar($("bucketsChart"), [
      { label: "E1 · 2021", value: b.E1 || 0 },
      { label: "E2 · 2022-23", value: b.E2 || 0 },
      { label: "E3 · 2024", value: b.E3 || 0, hot: true },
      { label: "E4 · 2025-26", value: b.E4 || 0, hot: true }
    ]);
    hbar($("eraChart"), [
      { label: "era-1 전체", value: ec.era1_double_rate, display: pct(ec.era1_double_rate) },
      { label: "era-1 유명", value: ec.era1_famous_rate, display: pct(ec.era1_famous_rate) },
      { label: "era-1 테일", value: ec.era1_tail_rate, display: pct(ec.era1_tail_rate) },
      { label: "era-2 커스텀", value: ec.era2_custom_double_rate, display: pct(ec.era2_custom_double_rate), hot: true },
      { label: "era-2 pump", value: ec.era2_pump_double_rate, display: pct(ec.era2_pump_double_rate), hot: true }
    ]);
    var st = agg.strata || {};
    hbar($("strataChart"), [
      { label: "voluntary-era1 (자발 폐기)", value: st["voluntary-era1"] || 0, hot: true },
      { label: "era1-kept (자발 시대 유지)", value: st["era1-kept"] || 0 },
      { label: "mixed-custom (문화템플릿 폐기)", value: st["mixed-custom"] || 0, hot: true },
      { label: "custom-kept", value: st["custom-kept"] || 0 },
      { label: "template (강제 폐기)", value: st["template"] || 0 }
    ]);
  }

  /* ── ③ 채택곡선 (스냅샷 시계열) ─────────────────────── */
  function renderAdoption(latest) {
    var el = $("adoptionCurve");
    var series = latest && latest.series ? latest.series : [];
    if (series.length < 1) return; // baseline 안내 유지
    var W = 560, H = 170, pad = 34;
    var max = Math.max(1, series.length - 1);
    function x(i) { return pad + (i / max) * (W - pad - 12); }
    function y(v) { return H - pad - (v || 0) * (H - pad - 16); }
    function line(key) {
      return series.map(function (s, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(s[key]).toFixed(1); }).join("");
    }
    var pts = series.map(function (s, i) {
      return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(s.double_ren_rate).toFixed(1) + '" r="3.4"><title>' +
        esc(s.date) + " 이중폐기 " + pct(s.double_ren_rate) + " · 깊이 " + pct(s.deep_ren_rate) + "</title></circle>";
    }).join("");
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="채택곡선">' +
      '<line x1="' + pad + '" y1="' + y(1) + '" x2="' + (W - 8) + '" y2="' + y(1) + '" class="grid"/>' +
      '<line x1="' + pad + '" y1="' + y(0.5) + '" x2="' + (W - 8) + '" y2="' + y(0.5) + '" class="grid"/>' +
      '<text x="' + (pad - 6) + '" y="' + (y(1) + 4) + '" class="tick" text-anchor="end">100%</text>' +
      '<text x="' + (pad - 6) + '" y="' + (y(0.5) + 4) + '" class="tick" text-anchor="end">50%</text>' +
      '<path d="' + line("double_ren_rate") + '" class="line double"/>' +
      '<path d="' + line("deep_ren_rate") + '" class="line deep"/>' +
      pts + series.map(function (s, i) {
        return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" class="tick" text-anchor="middle">' + esc(s.date.slice(5)) + "</text>";
      }).join("") + "</svg>" +
      '<div class="legend"><span>▬ 이중 폐기율(mint+freeze)</span><span>▬ 깊은 폐기율(+update)</span></div>';
  }

  /* ── ④ 판정 현황판 ──────────────────────────────────── */
  function renderVerdict(v) {
    if (!v) return;
    $("verdictDate").textContent = "실행 " + (v.generated_at || "").slice(0, 16).replace("T", " ") + "Z";
    var big = $("verdictBig");
    if (v.verdict.winner === "B(prior)") { big.textContent = "B 55 : A 45"; $("verdictSub").textContent = "사전 유지(스위치 0발동) — 재현 확인"; }
    else if (v.verdict.winner === "A") { big.textContent = "A"; $("verdictSub").textContent = "스위치 다수결로 A 반전 — " + v.verdict.flips_A.join(", "); }
    else { big.textContent = "B"; $("verdictSub").textContent = "스위치 다수결로 B 확정 — " + v.verdict.flips_B.join(", "); }

    var rows = "";
    var order = ["S1_floor_75pct_to_A", "S2_voluntary_band_absence_to_A", "S3_mixed_lt30_to_A", "S4_false_claim_gt50_to_B"];
    order.forEach(function (k) {
      var s = v.switches[k]; if (!s) return;
      var val;
      if (k.indexOf("S1") === 0) {
        val = "코인-가중 " + pct(s.value_coin_weighted) +
          (s.value_population_weighted !== null && s.value_population_weighted !== undefined ? " · 모집단-가중 " + pct(s.value_population_weighted) : " · 모집단-가중 미측정");
      } else if (k.indexOf("S2") === 0) {
        val = "기울기 " + pct(s.gradient) + " (유명 " + pct(s.era1_famous_rate) + " vs 테일 " + pct(s.era1_tail_rate) + ") → 밴드 " + (s.band_present ? "존재" : "부재");
      } else {
        val = (s.value === null || s.value === undefined) ? (s.status ? "미채점" : "-") : pct(s.value) + " (n=" + (s.n || s.claims_found || "-") + ")";
      }
      rows += "<tr><td><b>" + k.split("_")[0] + "</b> " + esc(k.slice(k.indexOf("_") + 1).replace(/_/g, " ")) + "</td>" +
        "<td>" + esc(s.condition) + "</td><td>" + val + "</td>" +
        "<td><small>" + esc(s.frame) + "</small></td>" +
        '<td><span class="badge ' + (s.fired ? "fired" : "hold") + '">' + (s.fired ? "발동" : "미발동") + "</span></td></tr>";
    });
    $("switchRows").innerHTML = rows;

    var fc = v.frame_clauses || {};
    var items = [];
    if (fc.s1_dual_frame) items.push("S1 이중 프레임: " + fc.s1_dual_frame);
    if (fc.s2_population_note) items.push("S2 모집단 고지: " + fc.s2_population_note);
    if (fc.pump_tail_random_frame) items.push("pump 테일 무작위 프레임: " + fc.pump_tail_random_frame);
    if (fc.official_frame) items.push("공식 판정 축: " + fc.official_frame);
    if (items.length) $("frameClauseList").innerHTML = items.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
  }

  /* ── 신규 코인 스냅샷 테이블 ───────────────────────── */
  function stateCell(state) {
    if (!state) return "-";
    var ren = state.indexOf("renounced") === 0;
    return '<span class="badge ' + (ren ? "ren" : "kept") + '">' + (ren ? "폐기" : (state === "unknown" ? "미확인" : "유지")) + "</span>";
  }

  function renderCensus(latest) {
    var coins = latest && latest.coins ? latest.coins.filter(function (c) { return c.status === "ok"; }) : [];
    var s = (latest && latest.summary) || {};
    if (!latest || !latest.generated_at) {
      $("cWhen").textContent = "스냅샷 없음 — Phase 2 대기";
      $("coinRows").innerHTML = '<tr><td colspan="7" class="empty">아직 실측 스냅샷이 없습니다. Phase 2 관측 시작 후 일일 수집됩니다.</td></tr>';
      return;
    }
    freshness(latest.generated_at);
    $("cN").innerHTML = (s.n || coins.length || 0) + "<small>코인</small>";
    $("cWhen").textContent = "RPC " + ((latest.run || {}).rpc_calls || "-") + "회 · 건너뜀 " + ((latest.run || {}).skipped || []).length;
    $("cMint").textContent = s.mint_ren_rate !== undefined ? pct(s.mint_ren_rate) : "-";
    $("cDouble").textContent = s.double_ren_rate !== undefined ? pct(s.double_ren_rate) : "-";
    $("cTemplate").textContent = s.template_share_of_renunciations !== undefined && s.template_share_of_renunciations !== null ? pct(s.template_share_of_renunciations) : "-";

    var now = Date.now();
    $("coinRows").innerHTML = coins.map(function (c) {
      var created = c.pair && c.pair.pair_created_at_ms;
      var ageH = created ? ((now - created) / 3600000).toFixed(1) + "시간" : "?";
      var conc = c.concentration || {};
      var top10 = conc.top10_share_filtered !== null && conc.top10_share_filtered !== undefined
        ? conc.top10_share_filtered.toFixed(1) + "% <small>(raw " + (conc.top10_share_raw || 0).toFixed(1) + "%)</small>"
        : (conc.top10_share_raw !== null && conc.top10_share_raw !== undefined ? "raw " + conc.top10_share_raw.toFixed(1) + "%" : "-");
      var st = c.authority_states || {};
      return "<tr><td><b>" + esc(c.expected_symbol) + "</b><small> " + esc((c.addr || "").slice(0, 4) + "…" + (c.addr || "").slice(-4)) + "</small></td>" +
        "<td>" + esc((c.origin && c.origin.kind) || "-") + "<small> " + esc((c.pair && c.pair.dex_id) || "") + "</small></td>" +
        "<td>" + stateCell(st.mint) + "</td><td>" + stateCell(st.freeze) + "</td><td>" + stateCell(st.update) + "</td>" +
        "<td>" + top10 + "</td><td>" + ageH + "</td></tr>";
    }).join("") || '<tr><td colspan="7" class="empty">유효 기록 없음</td></tr>';
  }

  /* ── 실행 ───────────────────────────────────────────── */
  function boot() {
    complianceGate();
    fetchJson("data/baseline/aggregate.json")
      .then(renderBaseline)
      .catch(function () { /* baseline 없으면 카드 기본값 유지 */ });
    fetchJson("data/verdict.json")
      .then(renderVerdict)
      .catch(function () { $("switchRows").innerHTML = '<tr><td colspan="5" class="empty">verdict.json 없음 — <code>verdict-v2.py</code> 실행 필요</td></tr>'; });
    fetchJson("data/latest.json")
      .then(function (latest) {
        freshness(latest && latest.generated_at);
        renderAdoption(latest);
        renderCensus(latest);
      })
      .catch(function () {
        freshness(null);
        renderCensus(null);
      });
    var btn = $("refreshCensus");
    if (btn) btn.addEventListener("click", function () {
      fetchJson("data/latest.json?t=" + Date.now()).then(renderCensus).catch(function () {});
    });
    setTimeout(krwGate, 1500); // 동적 렌더 후 최종 점검
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
