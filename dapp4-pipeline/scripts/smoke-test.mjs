#!/usr/bin/env node
// smoke-test.mjs — CLE2-29 배포 후 스모크 테스트 (L2 자동 검사)
// 대상: census 전문가 버전 + easy 버전 (GitHub Pages 배포 후 실제 브라우저 렌더 검증)
//
// 검사 항목(페이지별):
//  (a) 오류 배너 비가시 — census: #complianceError가 .hidden 유지, easy: #guard-error가 display:none 유지
//  (b) 본문 가시 — census: main.shell, easy: #app (hidden 해제)
//  (c) 숫자 일치 — BASE에서 latest.json / verdict.json / baseline/aggregate.json을 직접 fetch해
//      코인 수·반납률·판정 문자열이 화면 텍스트에 실재하는지 대조
//  (d) 스크린샷 저장 → artifacts/
//
// 실패 시 exit 1 + smoke-failure.txt (워크플로가 이슈 본문에 첨부).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.SMOKE_BASE ?? "https://daegu-agent-crew.github.io/ai-solana-agent/dapp4/census/";
const PAGES = [
  { name: "census", url: BASE, shot: "artifacts/census.png" },
  { name: "easy", url: new URL("easy/", BASE).href, shot: "artifacts/census-easy.png" },
];
const WAIT_MS = 3000; // 로드 후 렌더 안정 대기 (3초)

const failures = [];
const notes = [];
function fail(page, check, detail) {
  failures.push({ page, check, detail });
  console.error(`✗ [${page}] ${check}: ${detail}`);
}
function note(msg) {
  notes.push(msg);
  console.log(`· ${msg}`);
}

// ── 데이터 기대값 계산 (페이지 렌더 로직과 동일한 규칙 재현) ──
function pctCensus(x) {
  return x === null || x === undefined || Number.isNaN(x) ? "-" : (100 * x).toFixed(1) + "%";
}
function fmtPctEasy(p) {
  return p == null || !Number.isFinite(p) ? "–" : p.toFixed(1).replace(/\.0$/, "") + "%";
}
function ratePctEasy(v) {
  return typeof v === "number" && Number.isFinite(v) ? (v <= 1 ? v * 100 : v) : null;
}
function expectedVerdictStrings(verdictDoc) {
  // census #verdictBig: winner 분기 (app.js 146-148행과 동일)
  // easy: readPrior(prior) → "B <b> : A <a>" (score-bar + 요약 문장)
  const winner = String(verdictDoc?.verdict?.winner ?? "");
  let censusBig;
  if (winner === "B(prior)") censusBig = "B 55 : A 45";
  else if (winner === "A") censusBig = "A";
  else if (winner === "B") censusBig = "B";
  else censusBig = null;
  let b = 55, a = 45;
  const prior = verdictDoc?.prior;
  if (prior && typeof prior === "object") {
    const pb = prior.B ?? prior.b, pa = prior.A ?? prior.a;
    if (Number.isFinite(pb) && Number.isFinite(pa) && pa + pb > 0) {
      b = Math.round((pb / (pa + pb)) * 100); a = 100 - b;
    }
  } else if (typeof prior === "string") {
    const m = prior.match(/B\s*[:=]?\s*(\d+(?:\.\d+)?)[^\d]+A\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (m) { b = +m[1]; a = +m[2]; }
  }
  return { censusBig, easyPrior: `B ${b} : A ${a}` };
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

// ── playwright 동적 임포트 (CI에서 npm i playwright 후 실행) ──
const { chromium } = await import("playwright");

await mkdir("artifacts", { recursive: true });

// 데이터 직접 fetch (화면과 동일 소스)
const [latest, verdictDoc, aggregate] = await Promise.all([
  fetchJson(new URL("data/latest.json", BASE).href),
  fetchJson(new URL("data/verdict.json", BASE).href),
  fetchJson(new URL("data/baseline/aggregate.json", BASE).href),
]);
const s = latest?.summary ?? {};
const nCoins = Number.isFinite(s.n) ? s.n : (latest?.coins?.length ?? 0);
const aggN = aggregate?.n;
const { censusBig, easyPrior } = expectedVerdictStrings(verdictDoc);
note(`데이터 기대값 — 코인수=${nCoins}, aggregate.n=${aggN}, 판정(census)=${censusBig}, 판정(easy)=${easyPrior}, 이중폐기율=${pctCensus(s.double_ren_rate)}`);

if (!Number.isFinite(nCoins) || nCoins <= 0) fail("data", "latest.json", "summary.n 부재 — 데이터 자체가 비었음");
if (censusBig === null) fail("data", "verdict.json", "verdict.winner 해석 불가");
if (!Number.isFinite(aggN)) fail("data", "aggregate.json", "n 부재");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

for (const page of PAGES) {
  const pg = await ctx.newPage();
  const consoleErrs = [];
  pg.on("pageerror", (e) => consoleErrs.push(String(e)));
  try {
    await pg.goto(page.url, { waitUntil: "load", timeout: 45000 });
  } catch (e) {
    fail(page.name, "페이지 로드", String(e));
    await pg.screenshot({ path: page.shot, fullPage: true }).catch(() => {});
    continue;
  }
  await pg.waitForTimeout(WAIT_MS);

  // (a) 오류 배너 비가시
  const banner = await pg.evaluate(() => {
    const c = document.getElementById("complianceError"); // census
    const g = document.getElementById("guard-error");      // easy
    const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return { census: c ? { exists: true, hiddenClass: c.classList.contains("hidden"), visible: visible(c) } : null,
             easy: g ? { exists: true, display: getComputedStyle(g).display, visible: visible(g) } : null };
  });
  if (page.name === "census") {
    if (!banner.census) fail(page.name, "(a) 오류 배너", "#complianceError 요소 부재");
    else if (banner.census.visible || !banner.census.hiddenClass)
      fail(page.name, "(a) 오류 배너", `#complianceError 가시(visible=${banner.census.visible}, hidden클래스=${banner.census.hiddenClass}) — 컴플라이언스/게이트 오류`);
  } else {
    if (!banner.easy) fail(page.name, "(a) 오류 배너", "#guard-error 요소 부재");
    else if (banner.easy.display !== "none")
      fail(page.name, "(a) 오류 배너", `#guard-error display=${banner.easy.display} — 고지문 게이트 오류`);
  }

  // (b) 본문 가시
  const body = await pg.evaluate(() => {
    const main = document.querySelector("main");
    const app = document.getElementById("app");
    const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return { main: main ? { visible: visible(main), textLen: (main.innerText || "").length } : null,
             app: app ? { hiddenAttr: app.hidden, visible: visible(app), textLen: (app.innerText || "").length } : null };
  });
  if (page.name === "census") {
    if (!body.main || !body.main.visible || body.main.textLen < 50)
      fail(page.name, "(b) 본문 가시", `main.shell 비가시 또는 빈 본문(${body.main?.textLen ?? "null"}자)`);
  } else {
    if (!body.app || body.app.hiddenAttr || !body.app.visible || body.app.textLen < 50)
      fail(page.name, "(b) 본문 가시", `#app hidden=${body.app?.hiddenAttr} — 데이터 로드 실패(가드 발동 가능성)`);
  }

  // (c) 숫자 일치 — 데이터 ↔ 화면 텍스트 실재 대조
  const text = await pg.evaluate(() => document.body.innerText || "");
  const want = page.name === "census"
    ? [
        [`${nCoins}코인`, `코인 수(latest.n=${nCoins}) — #cN`],
        [pctCensus(s.double_ren_rate), `이중 폐기율(${pctCensus(s.double_ren_rate)}) — #cDouble`],
        [`${aggN}`, `baseline 코인 수(aggregate.n=${aggN}) — #statN`],
        [censusBig, `판정 문자열("${censusBig}") — #verdictBig`],
      ]
    : [
        [`${nCoins}개`, `코인 수(latest.n=${nCoins}) — 오늘의 숫자 타일`],
        [fmtPctEasy(ratePctEasy(s.double_ren_rate)), `이중 폐기율(${fmtPctEasy(ratePctEasy(s.double_ren_rate))}) — 오늘의 숫자 타일`],
        [easyPrior, `판정 문자열("${easyPrior}") — 판정 게임판`],
      ];
  for (const [needle, desc] of want) {
    if (needle == null) continue;
    if (!text.includes(String(needle))) fail(page.name, "(c) 숫자 일치", `${desc} — 화면 텍스트에서 발견 안 됨`);
  }

  // (d) 스크린샷
  await pg.screenshot({ path: page.shot, fullPage: true });
  note(`스크린샷 저장: ${page.shot}`);

  if (consoleErrs.length) note(`[${page.name}] JS 페이지 오류 ${consoleErrs.length}건 (참고): ${consoleErrs[0].slice(0, 120)}`);
  await pg.close();
}

await browser.close();

if (failures.length) {
  const lines = failures.map((f) => `- [${f.page}] ${f.check}: ${f.detail}`);
  const report = ["스모크 실패 지점:", ...lines, "", "기대값:", ...notes].join("\n");
  await writeFile("smoke-failure.txt", report, "utf-8");
  console.error(`\n🚨 스모크 실패 — ${failures.length}건`);
  process.exit(1);
}
console.log("\n✅ 스모크 통과 — 2페이지 · 게이트/본문/숫자 일치 확인");
