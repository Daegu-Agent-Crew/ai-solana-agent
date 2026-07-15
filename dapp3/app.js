// ============================================================
// DApp3 — Local Credit (온체인 memo 기반 크레딧 시스템)
// ============================================================

// --- Config ---
const RPC_URL = 'https://api.devnet.solana.com';
const ADMIN_ADDRESS = null; // null = 첫 번째 연결 지갑이 관리자
const MEMO_PREFIX = 'CREDIT';
const LS_KEY_CREDITS = 'dapp3_local_credits';
const LS_KEY_ACTIVITIES = 'dapp3_local_activities';
const LS_KEY_ADMIN = 'dapp3_admin_pubkey';

// --- Activity Presets ---
const ACTIVITY_PRESETS = [
  { id: 'event',     name: '행사 참여',     points: 10, icon: '🎪' },
  { id: 'shop',      name: '상점 방문',     points: 5,  icon: '🛍️' },
  { id: 'coupon',    name: '쿠폰 사용',     points: 3,  icon: '🎫' },
  { id: 'show',      name: '공연 관람',     points: 10, icon: '🎭' },
  { id: 'community', name: '커뮤니티 활동', points: 20, icon: '🤝' },
  { id: 'custom',    name: '커스텀',        points: 0,  icon: '✨' },
];

// --- State ---
let connection = null;
let wallet = null;
let walletPubkey = null;
let isAdmin = false;
let selectedActivity = null;
let creditData = {};    // { address: { totalCredits, activities: [{type, name, points, date, txSig}] } }

// ============================================================
// --- Solana web3.js import via ESM ---
// ============================================================
let web3 = null;

async function loadWeb3() {
  if (web3) return web3;
  const mod = await import('https://esm.sh/@solana/web3.js@1.95.4');
  web3 = mod;
  return web3;
}

// ============================================================
// --- LocalStorage Helpers ---
// ============================================================
function loadData() {
  try {
    creditData = JSON.parse(localStorage.getItem(LS_KEY_CREDITS) || '{}');
  } catch { creditData = {}; }
}

function saveData() {
  localStorage.setItem(LS_KEY_CREDITS, JSON.stringify(creditData));
}

function getStoredAdmin() {
  return localStorage.getItem(LS_KEY_ADMIN);
}

function setStoredAdmin(pubkey) {
  localStorage.setItem(LS_KEY_ADMIN, pubkey);
}

// ============================================================
// --- DOM Helpers ---
// ============================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function showAlert(id, msg, type = 'warn') {
  const a = $(id);
  a.textContent = msg;
  a.className = `alert alert-${type} show`;
  setTimeout(() => a.classList.remove('show'), 4000);
}

function shortAddr(addr) {
  if (!addr) return '—';
  return addr.slice(0, 4) + '…' + addr.slice(-4);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// --- Wallet Connection ---
// ============================================================
async function connectWallet() {
  try {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) {
      showAlert('alert-main', 'Phantom 지갑을 설치해주세요.', 'error');
      return;
    }

    const res = await provider.connect();
    wallet = provider;
    walletPubkey = res.publicKey.toString();

    // Determine admin
    const stored = getStoredAdmin();
    if (stored) {
      isAdmin = walletPubkey === stored;
    } else if (ADMIN_ADDRESS) {
      isAdmin = walletPubkey === ADMIN_ADDRESS;
    } else {
      // First connector becomes admin
      setStoredAdmin(walletPubkey);
      isAdmin = true;
    }

    updateWalletUI();
    await checkNetwork();

  } catch (err) {
    console.error('Connect error:', err);
    showAlert('alert-main', '지갑 연결 실패: ' + (err.message || err), 'error');
  }
}

async function disconnectWallet() {
  try {
    if (wallet) await wallet.disconnect();
  } catch {}
  wallet = null;
  walletPubkey = null;
  isAdmin = false;
  updateWalletUI();
}

async function checkNetwork() {
  if (!wallet) return;
  try {
    // Phantom doesn't expose cluster directly; we attempt a devnet read
    const { Connection, PublicKey } = web3;
    connection = new Connection(RPC_URL, 'confirmed');
    const balance = await connection.getBalance(new web3.PublicKey(walletPubkey));
    $('network-badge').style.display = 'inline-flex';
  } catch (err) {
    console.warn('Network check failed', err);
  }
}

function updateWalletUI() {
  if (walletPubkey) {
    $('btn-connect').style.display = 'none';
    $('wallet-display').style.display = 'flex';
    $('wallet-address').textContent = shortAddr(walletPubkey);

    // Role badge
    if (isAdmin) {
      $('role-badge').innerHTML = '<span class="badge badge-admin">👑 관리자</span>';
      $('admin-panel').style.display = 'block';
    } else {
      $('role-badge').innerHTML = '<span class="badge badge-user">🙋 참여자</span>';
      $('admin-panel').style.display = 'none';
    }

    // Show user panels
    $('user-panels').style.display = 'block';

    refreshCreditDisplay();
    refreshLeaderboard();
  } else {
    $('btn-connect').style.display = 'inline-block';
    $('wallet-display').style.display = 'none';
    $('admin-panel').style.display = 'none';
    $('user-panels').style.display = 'none';
  }
}

// ============================================================
// --- Activity Selection ---
// ============================================================
function renderActivityGrid() {
  const grid = $('activity-grid');
  grid.innerHTML = '';
  ACTIVITY_PRESETS.forEach(a => {
    const opt = el('div', 'activity-option', '');
    opt.dataset.id = a.id;
    opt.innerHTML = `
      <span class="icon">${a.icon}</span>
      <div>${a.name}</div>
      ${a.points > 0 ? `<div class="points">+${a.points} P</div>` : ''}
    `;
    opt.onclick = () => selectActivity(a.id);
    grid.appendChild(opt);
  });
}

function selectActivity(id) {
  selectedActivity = ACTIVITY_PRESETS.find(a => a.id === id);
  document.querySelectorAll('.activity-option').forEach(e => {
    e.classList.toggle('selected', e.dataset.id === id);
  });

  // Show custom fields if custom
  const isCustom = id === 'custom';
  $('custom-name-row').style.display = isCustom ? 'block' : 'none';
  $('custom-points-row').style.display = isCustom ? 'block' : 'none';

  // Prefill points
  if (!isCustom) {
    $('input-points').value = selectedActivity.points;
    $('input-activity-name').value = selectedActivity.name;
  } else {
    $('input-points').value = '';
    $('input-activity-name').value = '';
  }
}

// ============================================================
// --- Credit Award (Admin) ---
// ============================================================
async function awardCredit() {
  if (!isAdmin) {
    showAlert('alert-admin', '관리자만 크레딧을 지급할 수 있습니다.', 'error');
    return;
  }

  const recipient = $('input-recipient').value.trim();
  const activityName = $('input-activity-name').value.trim() || selectedActivity?.name || '활동';
  const points = parseInt($('input-points').value) || 0;

  if (!recipient) {
    showAlert('alert-admin', '수신자 주소를 입력하세요.', 'warn');
    return;
  }
  if (points <= 0 || points > 9999) {
    showAlert('alert-admin', '크레딧 점수는 1~9999 사이여야 합니다.', 'warn');
    return;
  }

  // Validate address
  try {
    new web3.PublicKey(recipient);
  } catch {
    showAlert('alert-admin', '올바른 Solana 주소가 아닙니다.', 'error');
    return;
  }

  // Duplicate check (same day, same activity, same recipient)
  const today = todayStr();
  const existing = creditData[recipient];
  if (existing && existing.activities) {
    const dup = existing.activities.find(a =>
      a.date === today && a.name === activityName
    );
    if (dup) {
      showAlert('alert-admin', `오늘 이미 "${activityName}" 활동으로 ${shortAddr(recipient)}에게 크레딧을 지급했습니다.`, 'warn');
      return;
    }
  }

  // Disable button, show loading
  const btn = $('btn-award');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 기록 중…';

  try {
    // Build memo transaction
    const memoStr = `${MEMO_PREFIX}:${activityName}:${points}:${recipient}`;
    const { Transaction, TransactionInstruction, PublicKey, SystemProgram } = web3;

    const memoIx = new TransactionInstruction({
      keys: [
        { pubkey: new PublicKey(walletPubkey), isSigner: true, isWritable: true },
        { pubkey: new PublicKey(recipient), isSigner: false, isWritable: false },
      ],
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: new TextEncoder().encode(memoStr),
    });

    const tx = new Transaction();
    tx.add(memoIx);

    // Set fee payer & recent blockhash
    tx.feePayer = new PublicKey(walletPubkey);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    // Sign & send
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    console.log('TX signature:', sig);

    // Wait for confirmation
    await connection.confirmTransaction(sig, 'confirmed');

    // Record locally
    if (!creditData[recipient]) {
      creditData[recipient] = { totalCredits: 0, activities: [] };
    }
    creditData[recipient].totalCredits += points;
    creditData[recipient].activities.push({
      type: selectedActivity?.id || 'custom',
      name: activityName,
      points: points,
      date: today,
      txSig: sig,
      timestamp: Date.now(),
    });
    saveData();

    // Show success
    showAlert('alert-admin', `✅ ${shortAddr(recipient)}에게 +${points} 크레딧 지급 완료!`, 'success');

    // Show TX link
    $('tx-link').innerHTML = `<a class="tx-link" href="https://solscan.io/tx/${sig}?cluster=devnet" target="_blank">🔗 트랜잭션 확인 (Solscan)</a>`;

    // Clear recipient field
    $('input-recipient').value = '';

    refreshCreditDisplay();
    refreshLeaderboard();
    refreshActivityLog();

  } catch (err) {
    console.error('Award error:', err);
    showAlert('alert-admin', '크레딧 지급 실패: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🏆 크레딧 지급';
  }
}

// ============================================================
// --- Credit Display ---
// ============================================================
function refreshCreditDisplay() {
  if (!walletPubkey) return;

  const data = creditData[walletPubkey];
  const myCredits = data?.totalCredits || 0;
  const myActivities = data?.activities?.length || 0;

  $('stat-credits').textContent = myCredits;
  $('stat-activities').textContent = myActivities;

  // Update log
  refreshActivityLog();
}

// ============================================================
// --- Activity Log ---
// ============================================================
function refreshActivityLog() {
  const container = $('activity-log');

  if (!walletPubkey) {
    container.innerHTML = '<div class="empty-state"><span class="icon">📋</span>지갑을 연결하면 활동 기록을 볼 수 있습니다.</div>';
    return;
  }

  const data = creditData[walletPubkey];
  if (!data || !data.activities || data.activities.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="icon">📋</span>아직 기록된 활동이 없습니다.</div>';
    return;
  }

  container.innerHTML = '';
  // Sort by timestamp desc
  const sorted = [...data.activities].sort((a, b) => b.timestamp - a.timestamp);

  sorted.forEach(act => {
    const item = el('div', 'log-item', '');
    item.innerHTML = `
      <div class="log-header">
        <span class="log-activity">${act.name}</span>
        <span class="log-points">+${act.points} P</span>
      </div>
      <div class="log-meta">${act.date} · <a class="tx-link" href="https://solscan.io/tx/${act.txSig}?cluster=devnet" target="_blank">트랜잭션 ↗</a></div>
    `;
    container.appendChild(item);
  });
}

// ============================================================
// --- Leaderboard ---
// ============================================================
function refreshLeaderboard() {
  const container = $('leaderboard');

  // Collect all participants from creditData
  const entries = Object.entries(creditData)
    .map(([addr, d]) => ({
      address: addr,
      totalCredits: d.totalCredits || 0,
      activityCount: d.activities?.length || 0,
    }))
    .filter(e => e.totalCredits > 0)
    .sort((a, b) => b.totalCredits - a.totalCredits);

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="icon">🏆</span>아직 랭킹 데이터가 없습니다.</div>';
    return;
  }

  container.innerHTML = '';
  entries.forEach((e, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : 'rank-other';
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;

    const item = el('div', 'leaderboard-item', '');
    item.innerHTML = `
      <div class="rank ${rankClass}">${medal}</div>
      <div class="leaderboard-info">
        <div class="leaderboard-name">${shortAddr(e.address)}${e.address === walletPubkey ? ' (나)' : ''}</div>
        <div class="leaderboard-count">활동 ${e.activityCount}회</div>
      </div>
      <div class="leaderboard-score">
        <div class="leaderboard-points">${e.totalCredits}</div>
        <div class="leaderboard-label">credits</div>
      </div>
    `;
    container.appendChild(item);
  });
}

// ============================================================
// --- On-chain Credit Fetch (memo parsing from tx history) ---
// ============================================================
async function fetchOnchainCredits() {
  if (!walletPubkey) return;
  const btn = $('btn-fetch');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 조회 중…';

  try {
    const { PublicKey } = web3;
    const pubKey = new PublicKey(walletPubkey);
    const sigs = await connection.getSignaturesForAddress(pubKey, { limit: 50 });

    let found = 0;
    for (const sigInfo of sigs) {
      const tx = await connection.getParsedTransaction(sigInfo.signature, 'confirmed');
      if (!tx || !tx.meta) continue;

      // Check memo logs
      const logMessages = tx.meta.logMessages || [];
      for (const log of logMessages) {
        // Memo program logs look like: "Program log: CREDIT:..."
        const match = log.match(/Program log: (CREDIT:.+)/);
        if (match) {
          const parts = match[1].split(':');
          // CREDIT:activity_name:points:recipient
          if (parts.length >= 4 && parts[0] === MEMO_PREFIX) {
            const activityName = parts[1];
            const points = parseInt(parts[2]) || 0;
            const recipient = parts[3];

            // Record if not already in local data
            if (!creditData[recipient]) {
              creditData[recipient] = { totalCredits: 0, activities: [] };
            }
            const exists = creditData[recipient].activities.find(a => a.txSig === sigInfo.signature);
            if (!exists) {
              creditData[recipient].totalCredits += points;
              creditData[recipient].activities.push({
                type: 'fetched',
                name: activityName,
                points: points,
                date: sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString().slice(0, 10) : todayStr(),
                txSig: sigInfo.signature,
                timestamp: sigInfo.blockTime ? sigInfo.blockTime * 1000 : Date.now(),
              });
              found++;
            }
          }
        }
      }
    }

    saveData();
    refreshCreditDisplay();
    refreshLeaderboard();

    if (found > 0) {
      showAlert('alert-main', `✅ 온체인에서 ${found}개의 크레딧 기록을 동기화했습니다.`, 'success');
    } else {
      showAlert('alert-main', '최근 트랜잭션에서 새 크레딧 기록이 없습니다.', 'warn');
    }
  } catch (err) {
    console.error('Fetch error:', err);
    showAlert('alert-main', '온체인 조회 실패: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔄 온체인 동기화';
  }
}

// ============================================================
// --- Clear Data (Admin) ---
// ============================================================
function clearAllData() {
  if (!isAdmin) return;
  if (!confirm('모든 로컬 크레딧 데이터를 삭제하시겠습니까?')) return;
  creditData = {};
  localStorage.removeItem(LS_KEY_CREDITS);
  refreshCreditDisplay();
  refreshLeaderboard();
  refreshActivityLog();
  showAlert('alert-admin', '로컬 데이터가 삭제되었습니다.', 'success');
}

// ============================================================
// --- Init ---
// ============================================================
async function init() {
  // Load web3 module
  try {
    await loadWeb3();
    console.log('web3.js loaded');
  } catch (err) {
    console.error('Failed to load web3.js', err);
    showAlert('alert-main', 'Solana web3.js 로드 실패. 네트워크를 확인하세요.', 'error');
  }

  loadData();
  renderActivityGrid();

  // Event listeners
  $('btn-connect').onclick = connectWallet;
  $('btn-disconnect').onclick = disconnectWallet;
  $('btn-award').onclick = awardCredit;
  $('btn-fetch').onclick = fetchOnchainCredits;
  $('btn-clear-data').onclick = clearAllData;

  // Tab switching
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.dataset.tab;
      $('tab-leaderboard').style.display = target === 'leaderboard' ? 'block' : 'none';
      $('tab-myactivity').style.display = target === 'myactivity' ? 'block' : 'none';
    };
  });

  // Auto-connect if Phantom already approved
  if (window.solana && window.solana.isConnected) {
    connectWallet();
  }

  refreshLeaderboard();
}

// Phantom injected load event
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
