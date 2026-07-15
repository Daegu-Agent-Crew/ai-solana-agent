// ============================================================
//  출석 인증 DApp — Solana Devnet · Memo Program
// ============================================================

import {
  Connection,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
} from "https://esm.sh/@solana/web3.js@1.95.4";

// ── Config ──────────────────────────────────────────────────
const RPC_URL = "https://api.devnet.solana.com";
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const MEMO_PREFIX = "ATTEND:";
const LS_KEY = "dapp1_attendance_v1";

// ── DOM ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  wallet: $("wallet"),
  balance: $("balance"),
  todayBadge: $("todayBadge"),
  todayDate: $("todayDate"),
  memoPreview: $("memoPreview"),
  connect: $("connect"),
  disconnect: $("disconnect"),
  airdrop: $("airdrop"),
  attend: $("attend"),
  totalDays: $("totalDays"),
  myCount: $("myCount"),
  globalRank: $("globalRank"),
  lastAttend: $("lastAttend"),
  explorerLink: $("explorerLink"),
  leaderboard: $("leaderboard"),
  totalParticipants: $("totalParticipants"),
  status: $("status"),
};

// ── State ───────────────────────────────────────────────────
let connection = null;
let provider = null;
let pubKey = null;
let myAttendance = { count: 0, lastSig: null, lastTime: null, todayDone: false };

// ── Helpers ─────────────────────────────────────────────────
const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const shortAddr = (addr) => addr.slice(0, 4) + "…" + addr.slice(-4);

function setStatus(msg, type = "") {
  el.status.textContent = msg;
  el.status.className = "status " + type;
  if (msg === "") el.status.classList.add("hidden");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// localStorage participant DB
function loadDB() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveDB(db) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function recordParticipant(addr, dateStr, count) {
  const db = loadDB();
  if (!db[addr]) db[addr] = { count: 0, lastDate: null };
  db[addr].count = Math.max(db[addr].count, count);
  db[addr].lastDate = dateStr;
  saveDB(db);
}

function renderLeaderboard() {
  const db = loadDB();
  const entries = Object.entries(db).sort((a, b) => b[1].count - a[1].count);
  el.totalParticipants.textContent = entries.length + "명";

  if (entries.length === 0) {
    el.leaderboard.innerHTML = '<div class="empty-state">아직 참여자가 없습니다.</div>';
    return;
  }

  el.leaderboard.innerHTML = entries
    .map(([addr, info], i) => `
      <div class="attend-item">
        <div>
          <span class="addr">${shortAddr(addr)}</span>
        </div>
        <div class="meta">
          <span class="cnt">${info.count}일</span>
          <div class="when">${info.lastDate || "-"}</div>
        </div>
      </div>`)
    .join("");

  // my rank
  if (pubKey) {
    const rank = entries.findIndex(([a]) => a === pubKey.toBase58());
    el.globalRank.textContent = rank >= 0 ? `#${rank + 1}` : "-";
  }
}

// ── Memo encoding (varint length prefix per Solana memo spec) ─
// Memo program accepts raw UTF-8 bytes as instruction data
function encodeMemo(text) {
  return new TextEncoder().encode(text);
}

// Minimal base58 decoder (for fallback memo parsing)
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = {};
[...B58_ALPHABET].forEach((c, i) => (B58_MAP[c] = i));

function decodeBase58(str) {
  const bytes = [];
  for (const c of str) {
    let carry = B58_MAP[c];
    if (carry === undefined) throw new Error("Invalid base58 char: " + c);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's = leading zeros
  for (const c of str) {
    if (c !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// ── Wallet ──────────────────────────────────────────────────
function getProvider() {
  if ("solana" in window) return window.solana;
  // Brave / mobile fallback
  if ("phantom" in window) return window.phantom?.solana;
  return null;
}

async function connectWallet() {
  try {
    provider = getProvider();
    if (!provider) {
      setStatus(
        "Phantom 지갑을 찾을 수 없습니다. https://phantom.app 에서 설치해주세요.",
        "error"
      );
      return;
    }
    setStatus("Phantom 연결 중…", "working");
    const resp = await provider.connect();
    pubKey = new PublicKey(resp.publicKey.toString());
    el.wallet.textContent = `${shortAddr(pubKey.toBase58())} (${pubKey.toBase58()})`;
    el.connect.classList.add("hidden");
    el.disconnect.classList.remove("hidden");
    el.airdrop.disabled = false;
    setStatus("지갑 연결됨", "success");
    await refreshAll();
  } catch (err) {
    setStatus("연결 실패: " + (err.message || err), "error");
  }
}

function disconnectWallet() {
  if (provider?.disconnect) provider.disconnect();
  pubKey = null;
  provider = null;
  myAttendance = { count: 0, lastSig: null, lastTime: null, todayDone: false };
  el.wallet.textContent = "연결되지 않음";
  el.balance.textContent = "-";
  el.connect.classList.remove("hidden");
  el.disconnect.classList.add("hidden");
  el.airdrop.disabled = true;
  el.attend.disabled = true;
  el.todayBadge.textContent = "미출석";
  el.todayBadge.className = "today-badge pending";
  el.myCount.textContent = "0";
  el.totalDays.textContent = "0일";
  el.lastAttend.textContent = "-";
  el.globalRank.textContent = "-";
  el.explorerLink.classList.add("hidden");
  setStatus("", "");
  renderLeaderboard();
}

// ── Balance ─────────────────────────────────────────────────
async function refreshBalance() {
  if (!pubKey) return;
  try {
    const lamports = await connection.getBalance(pubKey);
    el.balance.textContent = (lamports / LAMPORTS_PER_SOL).toFixed(4) + " SOL";
  } catch {
    el.balance.textContent = "-";
  }
}

// ── Airdrop ─────────────────────────────────────────────────
async function requestAirdrop() {
  if (!pubKey) return;
  try {
    setStatus("Devnet 에어드롭 요청 중… (수 분 걸릴 수 있습니다)", "working");
    el.airdrop.disabled = true;
    const sig = await connection.requestAirdrop(
      pubKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    setStatus("2 SOL 수령 완료! ✅", "success");
    await refreshBalance();
  } catch (err) {
    setStatus("에어드롭 실패: " + (err.message || err), "error");
  } finally {
    el.airdrop.disabled = false;
  }
}

// ── Parse attendance from transaction history ───────────────
async function loadMyAttendance() {
  if (!pubKey) return;
  setStatus("출석 기록 불러오는 중…", "working");

  try {
    const today = todayStr();
    const memo = MEMO_PREFIX + today;
    let count = 0;
    let lastSig = null;
    let lastTime = null;
    let todayDone = false;

    // Fetch recent signatures (up to 1000)
    let allSigs = [];
    let fetched = null;
    let before = undefined;

    for (let page = 0; page < 10; page++) {
      fetched = await connection.getSignaturesForAddress(pubKey, {
        limit: 100,
        before,
      });
      if (!fetched || fetched.length === 0) break;
      allSigs.push(...fetched);
      if (fetched.length < 100) break;
      before = fetched[fetched.length - 1].signature;
    }

    // Check each signature's transaction for memo
    // We batch-check by fetching parsed transactions
    const BATCH = 50;
    for (let i = 0; i < allSigs.length; i += BATCH) {
      const batch = allSigs.slice(i, i + BATCH);
      const sigStrs = batch.map((s) => s.signature);
      const txs = await connection.getParsedTransactions(sigStrs, {
        maxSupportedTransactionVersion: 0,
      });

      for (let j = 0; j < txs.length; j++) {
        const tx = txs[j];
        if (!tx) continue;

        // Look for memo instruction in this transaction
        const memoData = extractMemoFromTx(tx);
        if (memoData && memoData.startsWith(MEMO_PREFIX)) {
          count++;
          const sigInfo = batch[j];
          if (sigInfo) {
            lastSig = sigInfo.signature;
            lastTime = sigInfo.blockTime
              ? new Date(sigInfo.blockTime * 1000)
              : null;
          }
          if (memoData === memo) {
            todayDone = true;
          }
        }
      }
    }

    myAttendance = { count, lastSig, lastTime, todayDone };

    // Update UI
    el.myCount.textContent = count;
    el.totalDays.textContent = count + "일";
    el.attend.disabled = todayDone;

    if (todayDone) {
      el.todayBadge.textContent = "✓ 출석 완료";
      el.todayBadge.className = "today-badge done";
    } else {
      el.todayBadge.textContent = "미출석";
      el.todayBadge.className = "today-badge pending";
    }

    if (lastTime) {
      el.lastAttend.textContent =
        lastTime.toLocaleDateString("ko-KR") +
        " " +
        lastTime.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    } else {
      el.lastAttend.textContent = "-";
    }

    if (lastSig) {
      el.explorerLink.href =
        `https://solscan.io/tx/${lastSig}?cluster=devnet`;
      el.explorerLink.classList.remove("hidden");
    }

    // Record in localStorage leaderboard
    recordParticipant(pubKey.toBase58(), today, count);
    renderLeaderboard();

    setStatus(todayDone ? "오늘 이미 출석하셨습니다." : "출석 가능합니다.", "");
    if (todayDone) setStatus("오늘 출석 완료! 🎉", "success");
  } catch (err) {
    setStatus("출석 기록 조회 실패: " + (err.message || err), "error");
  }
}

// Extract memo text from a parsed transaction
// Memo program ID as base58 string for comparison
const MEMO_ID_STR = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function extractMemoFromTx(tx) {
  try {
    // Check top-level instructions
    const instructions = tx.transaction?.message?.instructions || [];
    for (const ix of instructions) {
      const progId = ix.programId?.toString?.() || ix.programId;
      if (progId === MEMO_ID_STR) {
        // getParsedTransactions returns memo text in ix.parsed
        if (typeof ix.parsed === "string") return ix.parsed;
        if (ix.parsed && typeof ix.parsed.memo === "string") return ix.parsed.memo;
        // Fallback: decode base58 data
        if (typeof ix.data === "string") {
          try {
            const raw = decodeBase58(ix.data);
            const text = new TextDecoder().decode(raw);
            if (text.startsWith(MEMO_PREFIX)) return text;
          } catch {}
        }
      }
    }
    // Check inner instructions
    if (tx.meta?.innerInstructions) {
      for (const inner of tx.meta.innerInstructions) {
        for (const ix of inner.instructions) {
          const progId = ix.programId?.toString?.() || ix.programId;
          if (progId === MEMO_ID_STR) {
            if (typeof ix.parsed === "string") return ix.parsed;
            if (ix.parsed && typeof ix.parsed.memo === "string") return ix.parsed.memo;
            if (typeof ix.data === "string") {
              try {
                const raw = decodeBase58(ix.data);
                const text = new TextDecoder().decode(raw);
                if (text.startsWith(MEMO_PREFIX)) return text;
              } catch {}
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// ── Attendance transaction ──────────────────────────────────
async function submitAttendance() {
  if (!pubKey || !provider) return;
  const today = todayStr();
  const memo = MEMO_PREFIX + today;

  if (myAttendance.todayDone) {
    setStatus("오늘은 이미 출석했습니다!", "error");
    return;
  }

  try {
    setStatus("트랜잭션 생성 중…", "working");
    el.attend.disabled = true;

    // Build memo instruction
    const memoData = encodeMemo(memo);
    const instruction = {
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: memoData,
    };

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: pubKey,
    }).add(instruction);

    setStatus("Phantom 서명 요청…", "working");
    const signed = await provider.signTransaction(tx);

    setStatus("블록체인에 전송 중…", "working");
    const sig = await connection.sendRawTransaction(signed.serialize());

    // Confirm
    setStatus("컨펌 대기 중…", "working");
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    setStatus(`출석 완료! TX: ${sig.slice(0, 16)}…`, "success");

    // Update local state
    myAttendance.count++;
    myAttendance.lastSig = sig;
    myAttendance.lastTime = new Date();
    myAttendance.todayDone = true;

    el.myCount.textContent = myAttendance.count;
    el.totalDays.textContent = myAttendance.count + "일";
    el.todayBadge.textContent = "✓ 출석 완료";
    el.todayBadge.className = "today-badge done";
    el.attend.disabled = true;
    el.lastAttend.textContent =
      myAttendance.lastTime.toLocaleDateString("ko-KR") +
      " " +
      myAttendance.lastTime.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      });

    el.explorerLink.href = `https://solscan.io/tx/${sig}?cluster=devnet`;
    el.explorerLink.classList.remove("hidden");

    recordParticipant(pubKey.toBase58(), today, myAttendance.count);
    renderLeaderboard();
  } catch (err) {
    setStatus("출석 실패: " + (err.message || err), "error");
    el.attend.disabled = false;
  }
}

// ── Refresh all ─────────────────────────────────────────────
async function refreshAll() {
  await Promise.all([refreshBalance(), loadMyAttendance()]);
}

// ── Init ────────────────────────────────────────────────────
function init() {
  connection = new Connection(RPC_URL, "confirmed");
  const today = todayStr();
  el.todayDate.textContent = today;
  el.memoPreview.textContent = MEMO_PREFIX + today;

  renderLeaderboard();

  // Auto-connect if Phantom already approved
  provider = getProvider();
  if (provider) {
    provider.on?.("connect", (pk) => {
      pubKey = new PublicKey(pk.toString());
      el.wallet.textContent = `${shortAddr(pubKey.toBase58())} (${pubKey.toBase58()})`;
      el.connect.classList.add("hidden");
      el.disconnect.classList.remove("hidden");
      el.airdrop.disabled = false;
      refreshAll();
    });
    provider.on?.("disconnect", () => {
      disconnectWallet();
    });
    // Check if already connected
    if (provider.isConnected && provider.publicKey) {
      pubKey = new PublicKey(provider.publicKey.toString());
      el.wallet.textContent = `${shortAddr(pubKey.toBase58())} (${pubKey.toBase58()})`;
      el.connect.classList.add("hidden");
      el.disconnect.classList.remove("hidden");
      el.airdrop.disabled = false;
      refreshAll();
    }
  }

  // Event listeners
  el.connect.addEventListener("click", connectWallet);
  el.disconnect.addEventListener("click", disconnectWallet);
  el.airdrop.addEventListener("click", requestAirdrop);
  el.attend.addEventListener("click", submitAttendance);
}

init();
