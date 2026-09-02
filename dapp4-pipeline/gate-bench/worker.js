// dapp4 0단계 실측 게이트 G1(크론 CPU 벤치마크) + G2(egress→공개 RPC)
// 목적: 실측 후 삭제하는 임시 Worker. 저장소 없음, read-only 외부 호출만.
const results = { g2: [], g1: [] };

function bench(rows) {
  const samples = [];
  let p = 100;
  for (let i = 0; i < rows; i++) {
    p += (Math.sin(i / 13) - Math.cos(i / 7)) * 0.5;
    samples.push({
      ts: 1700000000 + i * 900,
      price: p,
      liquidity: 50000 + Math.sin(i / 5) * 10000,
      volH24: 100000 + i * 137,
      txns: 100 + (i % 50),
      buys: 50 + (i % 25),
      sells: 50 + ((i * 7) % 25),
    });
  }
  const t0 = performance.now();
  // --- 지표 8종 집계 (설계서 §4) ---
  const n = samples.length;
  const last = samples[n - 1];
  const P = last.price; // 1) 가격
  let volInc = 0; // 2) 증분 거래량(양수 클램프)
  let liqSum = 0, liqMin = Infinity, liqMax = 0;
  let txns = 0, buys = 0, sells = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    if (i > 0) { const d = s.volH24 - samples[i - 1].volH24; if (d > 0) volInc += d; }
    liqSum += s.liquidity;
    if (s.liquidity < liqMin) liqMin = s.liquidity;
    if (s.liquidity > liqMax) liqMax = s.liquidity;
    txns += s.txns; buys += s.buys; sells += s.sells;
  }
  const dP = (last.price - samples[0].price) / samples[0].price; // 8) 상대 등락
  const buyRatio = buys / txns; // 7) 매수 비율
  // 3~6) 유동성 avg/min/max, txns 합
  const cpuMs = performance.now() - t0;
  return {
    cpuMs: +cpuMs.toFixed(3), rows: n,
    metrics: { P: +P.toFixed(4), volInc: Math.round(volInc), liqAvg: Math.round(liqSum / n), liqMin: Math.round(liqMin), liqMax: Math.round(liqMax), txns, buyRatio: +buyRatio.toFixed(4), dP: +dP.toFixed(6) },
  };
}

async function rpcProbe() {
  const t0 = Date.now();
  try {
    const r = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] }),
    });
    const body = await r.text();
    return { ts: new Date().toISOString(), status: r.status, ms: Date.now() - t0, body: body.slice(0, 120) };
  } catch (e) {
    return { ts: new Date().toISOString(), error: String(e).slice(0, 200), ms: Date.now() - t0 };
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/g2') {
      const r = await rpcProbe();
      results.g2.push(r);
      return Response.json(r);
    }
    if (url.pathname === '/g2-result') return Response.json(results.g2);
    if (url.pathname === '/g1-result') return Response.json(results.g1);
    if (url.pathname === '/g1-run') {
      const rows = Number(url.searchParams.get('rows') || 400);
      const r = bench(rows);
      results.g1.push({ ...r, via: 'http', ts: new Date().toISOString() });
      return Response.json({ ...r, via: 'http' });
    }
    return new Response('dapp4 gate bench. /g2 /g2-result /g1-run?rows= /g1-result');
  },
  async scheduled(event) {
    // 크론 = 무료 플랜 CPU 제한(10ms) 강제 환경 — 이곳에서 측정해야 유효
    const r = bench(400);
    results.g1.push({ ...r, via: 'cron', ts: new Date().toISOString(), scheduledFor: event.scheduledTime });
    console.log('G1-BENCH ' + JSON.stringify(r));
    // 크론 환경에서 egress RPC도 함께 프로브(동일 isolate 관점)
    const g2 = await rpcProbe();
    results.g2.push({ ...g2, via: 'cron' });
    console.log('G2-CRON ' + JSON.stringify(g2));
  },
};
