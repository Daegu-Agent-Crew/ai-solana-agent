import { Connection, PublicKey, Transaction, TransactionInstruction } from 'https://esm.sh/@solana/web3.js@1.98.4';
import { createUmi } from 'https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.5.1?bundle';
import { generateSigner, publicKey as umiPublicKey } from 'https://esm.sh/@metaplex-foundation/umi@1.5.1?bundle';
import { base58 } from 'https://esm.sh/@metaplex-foundation/umi@1.5.1/serializers?bundle';
import { create, mplCore, updatePlugin } from 'https://esm.sh/@metaplex-foundation/mpl-core@1.10.0?bundle';
import { walletAdapterIdentity } from 'https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@1.5.1?bundle';
import QRCode from 'https://esm.sh/qrcode@1.5.4';

const API_BASE = 'https://coupon-loop-api.sfex11.workers.dev';
const RPC_URL = 'https://api.devnet.solana.com';
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const connection = new Connection(RPC_URL, 'confirmed');

const $ = (id) => document.getElementById(id);
let provider = null;
let walletAddress = '';
let myCoupons = [];
let storeCoupons = [];
let ranking = [];

function short(value, size = 5) {
  return value && value.length > size * 2 ? `${value.slice(0, size)}…${value.slice(-size)}` : value || '-';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function showToast(message, error = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast${error ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 5000);
}

function setBusy(button, busy, label) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

function getProvider() {
  const candidate = window.phantom?.solana || window.solana;
  return candidate?.isPhantom ? candidate : null;
}

async function connectWallet() {
  provider = getProvider();
  if (!provider) {
    showToast('Phantom 지갑을 설치하거나 Phantom 모바일 브라우저에서 열어주세요.', true);
    return;
  }
  try {
    const result = await provider.connect();
    walletAddress = result.publicKey.toString();
    $('connectWallet').classList.add('hidden');
    $('walletChip').classList.remove('hidden');
    $('walletAddress').textContent = short(walletAddress, 6);
    $('couponOwner').value ||= walletAddress;
    await Promise.all([loadMyCoupons(), loadStoreCoupons(), loadRanking()]);
    showToast('Phantom 연결 완료');
  } catch (error) {
    showToast(`지갑 연결 실패: ${error.message || error}`, true);
  }
}

async function ensureWallet() {
  if (!walletAddress) await connectWallet();
  if (!walletAddress) throw new Error('Phantom 지갑 연결이 필요합니다.');
}

async function authHeaders(action) {
  await ensureWallet();
  if (typeof provider.signMessage !== 'function') throw new Error('이 Phantom 환경은 메시지 서명을 지원하지 않습니다.');
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const message = `CouponNFT DApp4\nAction: ${action}\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
  const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
  const signature = signed?.signature || signed;
  return {
    'Content-Type': 'application/json',
    'X-Wallet': walletAddress,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': bytesToBase64(signature),
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `API 요청 실패: HTTP ${response.status}`);
  return data;
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${name}`));
  document.querySelector('.tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function couponStatus(coupon) {
  if (coupon.status === 'used') return ['사용 완료', 'used'];
  if (Number(coupon.expires_at) < Date.now()) return ['기간 만료', 'expired'];
  return ['사용 가능', ''];
}

function renderCoupons() {
  $('activeCount').textContent = String(myCoupons.filter((coupon) => coupon.status === 'active' && coupon.expires_at > Date.now()).length);
  $('usedCount').textContent = String(myCoupons.filter((coupon) => coupon.status === 'used').length);
  if (!myCoupons.length) {
    $('couponGrid').innerHTML = '<div class="empty">등록된 쿠폰이 없습니다. 매장에서 내 지갑으로 Core 쿠폰을 발행해 보세요.</div>';
    return;
  }
  $('couponGrid').innerHTML = myCoupons.map((coupon) => {
    const [label, klass] = couponStatus(coupon);
    const imageUrl = safeHttpsUrl(coupon.image_url);
    return `<article class="coupon-card">
      <div class="coupon-image">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />` : '🎫'}</div>
      <div class="coupon-body"><span class="pill ${klass}">${label}</span><h3>${escapeHtml(coupon.name)}</h3>
      <p class="muted">${escapeHtml(coupon.benefit || coupon.store_name)}</p>
      <div class="coupon-meta"><span>${escapeHtml(coupon.store_name)}</span><span>~ ${new Date(coupon.expires_at).toLocaleDateString('ko-KR')}</span></div>
      <button class="button ghost wide use-from-card" data-asset="${escapeHtml(coupon.asset_address)}" ${coupon.status !== 'active' ? 'disabled' : ''}>${coupon.status === 'active' ? '이 쿠폰 사용' : '컬렉션에서 보관 중'}</button></div>
    </article>`;
  }).join('');
  document.querySelectorAll('.use-from-card').forEach((button) => button.addEventListener('click', () => {
    $('redeemAsset').value = button.dataset.asset;
    switchTab('redeem');
  }));
}

async function loadMyCoupons() {
  if (!walletAddress) return;
  try {
    const data = await api(`/api/coupons?owner=${encodeURIComponent(walletAddress)}`);
    myCoupons = data.coupons || [];
    renderCoupons();
  } catch (error) {
    showToast(`쿠폰 조회 실패: ${error.message}`, true);
  }
}

function renderStoreCoupons() {
  const select = $('storeCouponSelect');
  select.innerHTML = '<option value="">쿠폰을 선택하세요</option>' + storeCoupons
    .filter((coupon) => coupon.status === 'active' && coupon.expires_at > Date.now())
    .map((coupon) => `<option value="${escapeHtml(coupon.asset_address)}">${escapeHtml(coupon.name)} · ${short(coupon.owner_wallet)}</option>`).join('');
  if (!storeCoupons.length) {
    $('storeCouponList').innerHTML = '<div class="empty">아직 발행한 쿠폰이 없습니다.</div>';
    return;
  }
  $('storeBadge').textContent = '등록됨';
  $('storeCouponList').innerHTML = `<table class="data-table"><thead><tr><th>쿠폰</th><th>고객</th><th>상태</th><th>Asset</th><th>온체인</th></tr></thead><tbody>${storeCoupons.map((coupon) => {
    const [label, klass] = couponStatus(coupon);
    const freezeButton = coupon.status === 'used' && !coupon.freeze_tx
      ? `<button class="button ghost freeze-coupon" data-asset="${escapeHtml(coupon.asset_address)}">동결 확정</button>`
      : coupon.freeze_tx ? '동결 완료' : '-';
    return `<tr><td><b>${escapeHtml(coupon.name)}</b><br><small>${escapeHtml(coupon.benefit)}</small></td><td><code>${short(coupon.owner_wallet)}</code></td><td><span class="pill ${klass}">${label}</span></td><td><a href="https://core.metaplex.com/explorer/${escapeHtml(coupon.asset_address)}?env=devnet" target="_blank" rel="noreferrer">${short(coupon.asset_address)}</a></td><td>${freezeButton}</td></tr>`;
  }).join('')}</tbody></table>`;
  document.querySelectorAll('.freeze-coupon').forEach((button) => button.addEventListener('click', () => freezeCoupon(button.dataset.asset, button)));
}

async function loadStoreCoupons() {
  if (!walletAddress) return;
  try {
    const data = await api(`/api/coupons?storeOwner=${encodeURIComponent(walletAddress)}`);
    storeCoupons = data.coupons || [];
    renderStoreCoupons();
  } catch {
    storeCoupons = [];
    renderStoreCoupons();
  }
}

function renderRanking() {
  const index = ranking.findIndex((entry) => entry.wallet_address === walletAddress);
  $('myRank').textContent = index >= 0 ? `#${index + 1}` : '-';
  $('rankingList').innerHTML = ranking.length ? ranking.map((entry, i) => `<div class="rank-row"><div class="rank-no">${i + 1}</div><div class="rank-wallet"><b>${escapeHtml(entry.nickname)}</b><small>${short(entry.wallet_address, 7)}</small></div><div class="rank-score">${entry.total_scans}<small>회</small></div></div>`).join('') : '<div class="empty">첫 쿠폰 사용자가 되어보세요.</div>';
}

async function loadRanking() {
  try {
    const data = await api('/api/ranking');
    ranking = data.ranking || [];
    renderRanking();
  } catch (error) {
    $('rankingList').innerHTML = `<div class="empty">랭킹 조회 실패: ${escapeHtml(error.message)}</div>`;
  }
}

async function registerStore(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, '지갑 서명 대기 중…');
  try {
    const headers = await authHeaders('register-store');
    const data = await api('/api/stores', { method: 'POST', headers, body: JSON.stringify({ name: $('storeName').value.trim() }) });
    $('storeBadge').textContent = data.store.name;
    showToast('매장 등록이 완료됐습니다.');
  } catch (error) {
    showToast(`매장 등록 실패: ${error.message}`, true);
  } finally { setBusy(button, false); }
}

async function fetchMetadata(uri) {
  const response = await fetch(uri, { cache: 'no-store' });
  if (!response.ok) throw new Error(`메타데이터 HTTP ${response.status}`);
  const metadata = await response.json();
  if (!metadata?.name) throw new Error('유효한 NFT 메타데이터가 아닙니다.');
  return metadata;
}

function createCoreUmi() {
  return createUmi(RPC_URL).use(mplCore()).use(walletAdapterIdentity(provider));
}

async function mintCoupon(event) {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Core NFT 발행 중…');
  try {
    await ensureWallet();
    const recipient = new PublicKey($('couponOwner').value.trim()).toString();
    const name = $('couponName').value.trim();
    const benefit = $('couponBenefit').value.trim();
    const metadataUri = $('metadataUri').value.trim();
    if (!name || !metadataUri.startsWith('https://')) throw new Error('쿠폰 이름과 HTTPS 메타데이터 URI를 확인하세요.');
    const metadata = await fetchMetadata(metadataUri);
    const umi = createCoreUmi();
    const asset = generateSigner(umi);
    showToast('Phantom에서 Metaplex Core 발행 트랜잭션을 승인하세요.');
    const result = await create(umi, {
      asset,
      name,
      uri: metadataUri,
      owner: umiPublicKey(recipient),
      plugins: [{ type: 'PermanentFreezeDelegate', frozen: false, authority: { type: 'UpdateAuthority' } }],
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
    const mintTx = base58.deserialize(result.signature)[0];
    const expiresAt = Date.now() + Math.max(1, Math.min(365, Number($('expiryDays').value) || 30)) * 86400000;
    const headers = await authHeaders('register-coupon');
    await api('/api/coupons', { method: 'POST', headers, body: JSON.stringify({
      assetAddress: asset.publicKey.toString(), ownerWallet: recipient, name, benefit,
      imageUrl: metadata.image || '', metadataUri, mintTx, expiresAt,
    }) });
    showToast(`쿠폰 발행 완료: ${short(asset.publicKey.toString(), 7)}`);
    await loadStoreCoupons();
    if (recipient === walletAddress) await loadMyCoupons();
  } catch (error) {
    console.error(error);
    showToast(`쿠폰 발행 실패: ${error.message || error}`, true);
  } finally { setBusy(button, false); }
}

async function createOtp() {
  const button = $('createOtp');
  const assetAddress = $('storeCouponSelect').value;
  if (!assetAddress) return showToast('활성 쿠폰을 선택하세요.', true);
  setBusy(button, true, 'OTP 생성 중…');
  try {
    const headers = await authHeaders('create-otp');
    const data = await api('/api/coupon/otp', { method: 'POST', headers, body: JSON.stringify({ assetAddress }) });
    const redeemUrl = `${location.origin}${location.pathname}?asset=${encodeURIComponent(assetAddress)}&otp=${encodeURIComponent(data.otp)}#redeem`;
    $('qrImage').src = await QRCode.toDataURL(redeemUrl, { width: 360, margin: 1, color: { dark: '#07120f', light: '#ffffff' } });
    $('otpCode').textContent = data.otp;
    $('qrBox').classList.remove('hidden');
    showToast('3분용 QR과 OTP가 생성됐습니다.');
  } catch (error) { showToast(`OTP 생성 실패: ${error.message}`, true); }
  finally { setBusy(button, false); }
}

async function sendRedeemMemo(assetAddress, otp) {
  const memo = `COUPON_REDEEM:${assetAddress}:${otp}`;
  const tx = new Transaction().add(new TransactionInstruction({
    keys: [{ pubkey: new PublicKey(walletAddress), isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM,
    data: new TextEncoder().encode(memo),
  }));
  tx.feePayer = new PublicKey(walletAddress);
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  const signed = await provider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  return signature;
}

async function redeemCoupon() {
  const button = $('redeemCoupon');
  const assetAddress = $('redeemAsset').value.trim();
  const otp = $('redeemOtp').value.trim().toUpperCase();
  if (!assetAddress || otp.length !== 6) return showToast('쿠폰 Asset 주소와 6자리 OTP를 확인하세요.', true);
  setBusy(button, true, 'Solana 확인 중…');
  try {
    await ensureWallet();
    new PublicKey(assetAddress);
    showToast('Phantom에서 쿠폰 사용 Memo 트랜잭션을 승인하세요.');
    const txSignature = await sendRedeemMemo(assetAddress, otp);
    setBusy(button, true, 'Edge에서 중복 사용 확인 중…');
    const headers = await authHeaders('redeem-coupon');
    const data = await api('/api/coupon/redeem', { method: 'POST', headers, body: JSON.stringify({ assetAddress, otp, txSignature }) });
    $('redeemResult').innerHTML = `사용 완료 · <a href="https://explorer.solana.com/tx/${encodeURIComponent(txSignature)}?cluster=devnet" target="_blank" rel="noreferrer">Solana 기록 확인</a>`;
    $('redeemResult').classList.remove('hidden');
    showToast('쿠폰 사용이 완료됐습니다. NFT는 컬렉션에 남습니다.');
    await Promise.all([loadMyCoupons(), loadRanking()]);
  } catch (error) {
    showToast(`쿠폰 사용 실패: ${error.message || error}`, true);
  } finally { setBusy(button, false); }
}

async function freezeCoupon(assetAddress, button) {
  setBusy(button, true, '동결 중…');
  try {
    await ensureWallet();
    const umi = createCoreUmi();
    showToast('Phantom에서 사용 완료 NFT 동결을 승인하세요.');
    const result = await updatePlugin(umi, {
      asset: umiPublicKey(assetAddress),
      plugin: { type: 'PermanentFreezeDelegate', frozen: true },
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
    const freezeTx = base58.deserialize(result.signature)[0];
    const headers = await authHeaders('confirm-freeze');
    await api('/api/coupon/freeze', { method: 'POST', headers, body: JSON.stringify({ assetAddress, freezeTx }) });
    showToast('사용 완료 NFT가 동결되어 컬렉션에 보존됩니다.');
    await loadStoreCoupons();
  } catch (error) { showToast(`동결 실패: ${error.message || error}`, true); }
  finally { setBusy(button, false); }
}

async function checkHealth() {
  try {
    await api('/health');
    $('apiState').textContent = '정상';
    $('apiState').style.color = 'var(--mint)';
  } catch {
    $('apiState').textContent = '연결 대기';
    $('apiState').style.color = 'var(--danger)';
  }
}

function hydrateFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get('asset')) $('redeemAsset').value = params.get('asset');
  if (params.get('otp')) $('redeemOtp').value = params.get('otp').toUpperCase();
  if (params.get('asset') || location.hash === '#redeem') switchTab('redeem');
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
document.querySelectorAll('[data-tab-target]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tabTarget)));
$('connectWallet').addEventListener('click', connectWallet);
$('refreshCoupons').addEventListener('click', loadMyCoupons);
$('refreshStore').addEventListener('click', loadStoreCoupons);
$('refreshRanking').addEventListener('click', loadRanking);
$('storeForm').addEventListener('submit', registerStore);
$('mintForm').addEventListener('submit', mintCoupon);
$('createOtp').addEventListener('click', createOtp);
$('redeemCoupon').addEventListener('click', redeemCoupon);

provider = getProvider();
if (provider) provider.connect({ onlyIfTrusted: true }).then((result) => {
  walletAddress = result.publicKey.toString();
  $('connectWallet').classList.add('hidden');
  $('walletChip').classList.remove('hidden');
  $('walletAddress').textContent = short(walletAddress, 6);
  $('couponOwner').value ||= walletAddress;
  return Promise.all([loadMyCoupons(), loadStoreCoupons(), loadRanking()]);
}).catch(() => {});

hydrateFromUrl();
checkHealth();
loadRanking();
