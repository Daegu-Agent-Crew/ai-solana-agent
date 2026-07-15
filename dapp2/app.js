import { createUmi } from 'https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.2.0?bundle';
import { generateSigner, percentAmount } from 'https://esm.sh/@metaplex-foundation/umi@1.2.0?bundle';
import { createNFT, mplTokenMetadata, fetchDigitalAsset } from 'https://esm.sh/@metaplex-foundation/mpl-token-metadata@3.4.0?bundle';
import { walletAdapterIdentity } from 'https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@1.2.0?bundle';
import { createUploadKey } from './upload-state.js';

const RPC = 'https://api.devnet.solana.com';
const UPLOAD_API_URL = 'https://ai-solana-upload.sfex11.workers.dev';
const connection = new solanaWeb3.Connection(RPC, 'confirmed');

// 발행자/검증자 주소 (첫 연결 지갑이 발행자, 프로젝트 설정 가능)
const ISSUER_ADDRESSES = JSON.parse(localStorage.getItem('couponIssuers') || '[]');

const $ = (id) => document.getElementById(id);
const walletEl = $('wallet');
const balanceEl = $('balance');
const roleEl = $('role');
const statusEl = $('status');
const connectBtn = $('connect');
const refreshBtn = $('refresh');
const mintBtn = $('mintNft');
const mintForm = $('mintForm');
const metadataUriEl = $('metadataUri');
const nftNameEl = $('nftName');
const nftSymbolEl = $('nftSymbol');
const isMutableEl = $('isMutable');
const mintPreviewEl = $('mintPreview');
const previewMessageEl = $('previewMessage');
const previewMetadataBtn = $('previewMetadata');
const nftImageEl = $('nftImage');
const nftDescriptionEl = $('nftDescription');
const couponTypeEl = $('couponType');
const couponValueEl = $('couponValue');
const expiryDaysEl = $('expiryDays');
const uploadAssetBtn = $('uploadAsset');
const uploadApiUrlEl = $('uploadApiUrl');
const mintExplorerEl = $('mintExplorer');
const couponGalleryEl = $('couponGallery');
const userCouponCountEl = $('userCouponCount');
const userMintGalleryEl = $('userMintGallery');
const userMintCountEl = $('userMintCount');
const useCouponMintEl = $('useCouponMint');
const useCouponBtn = $('useCoupon');
const verifyCouponBtn = $('verifyCoupon');
const useResultEl = $('useResult');
const clearUserMintsBtn = $('clearUserMints');

let provider = null;
let publicKey = null;
let cachedMetadata = null;
let minting = false;
let localImageUrl = '';

uploadApiUrlEl.textContent = UPLOAD_API_URL;

// ─── 유틸 ───
function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function getProvider() {
  const candidate = window.phantom?.solana || window.solana;
  return candidate?.isPhantom ? candidate : null;
}

function shortAddress(value) {
  return value && value.length >= 14 ? `${value.slice(0, 7)}…${value.slice(-7)}` : value || '-';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ─── 쿠폰 상태 관리 (localStorage) ───
function getUsedCoupons() {
  return JSON.parse(localStorage.getItem('usedCoupons') || '[]');
}

function markCouponUsed(mintAddress) {
  const used = getUsedCoupons();
  if (!used.includes(mintAddress)) {
    used.push(mintAddress);
    localStorage.setItem('usedCoupons', JSON.stringify(used));
  }
  return used;
}

function isCouponUsed(mintAddress) {
  return getUsedCoupons().includes(mintAddress);
}

function getCouponExpiry(mintAddress) {
  const data = JSON.parse(localStorage.getItem('couponMeta') || '{}');
  return data[mintAddress]?.expiry || null;
}

function setCouponMeta(mintAddress, meta) {
  const data = JSON.parse(localStorage.getItem('couponMeta') || '{}');
  data[mintAddress] = meta;
  localStorage.setItem('couponMeta', JSON.stringify(data));
}

function getCouponMeta(mintAddress) {
  const data = JSON.parse(localStorage.getItem('couponMeta') || '{}');
  return data[mintAddress] || null;
}

function getCouponStatus(mintAddress) {
  if (isCouponUsed(mintAddress)) return { label: '사용됨', class: 'status-used' };
  const meta = getCouponMeta(mintAddress);
  if (meta?.expiry) {
    const expiryDate = new Date(meta.expiry);
    if (expiryDate < new Date()) return { label: '만료', class: 'status-expired' };
    return { label: '활성', class: 'status-active' };
  }
  return { label: '활성', class: 'status-active' };
}

function isIssuer(addr) {
  return ISSUER_ADDRESSES.includes(addr);
}

function addIssuer(addr) {
  if (!isIssuer(addr)) {
    ISSUER_ADDRESSES.push(addr);
    localStorage.setItem('couponIssuers', JSON.stringify(ISSUER_ADDRESSES));
  }
}

// ─── 지갑 ───
async function refreshBalance() {
  if (!publicKey) return;
  try {
    const lamports = await connection.getBalance(publicKey, 'confirmed');
    balanceEl.textContent = `${(lamports / solanaWeb3.LAMPORTS_PER_SOL).toFixed(4)} SOL`;
  } catch (error) {
    setStatus(`잔액 조회 실패: ${error.message || error}`, 'error');
  }
}

async function connectWallet() {
  provider = getProvider();
  if (!provider) throw new Error('Phantom 앱 또는 확장 프로그램이 필요합니다.');
  setStatus('Phantom 연결 승인 대기 중…', 'working');
  const result = await provider.connect();
  publicKey = result.publicKey;
  const addr = publicKey.toString();
  walletEl.textContent = addr;
  connectBtn.textContent = '연결됨';
  refreshBtn.disabled = false;

  // 첫 연결 시 발행자로 등록
  if (!isIssuer(addr)) {
    addIssuer(addr);
  }
  roleEl.textContent = isIssuer(addr) ? '발행자 / 검증자' : '사용자';

  await refreshBalance();
  setStatus('Phantom 연결 완료', 'success');
  await loadUserCoupons();
  return publicKey;
}

// ─── 메타데이터 ───
async function fetchMetadataWithRetry(uri, attempts = 8) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${uri}${uri.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const metadata = await response.json();
      if (!metadata?.name || !metadata?.image) throw new Error('메타데이터에 name과 image가 필요합니다.');
      return metadata;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 700, 2500)));
    }
  }
  throw new Error(`메타데이터 요청 실패: ${lastError?.message || lastError}`);
}

async function previewMetadata() {
  try {
    const uri = metadataUriEl.value.trim();
    if (!uri.startsWith('https://')) throw new Error('메타데이터 URI는 HTTPS 주소여야 합니다.');
    setStatus('메타데이터 확인 중…', 'working');
    cachedMetadata = await fetchMetadataWithRetry(uri);
    mintPreviewEl.src = cachedMetadata.image;
    mintPreviewEl.alt = cachedMetadata.name || '쿠폰 미리보기';
    previewMessageEl.textContent = cachedMetadata.description || cachedMetadata.name || '메타데이터 확인 완료';
    setStatus('메타데이터와 이미지 확인 완료', 'success');
  } catch (error) {
    cachedMetadata = null;
    previewMessageEl.textContent = error.message || String(error);
    setStatus(`미리보기 실패: ${error.message || error}`, 'error');
  }
}

// ─── 업로드 ───
async function getSignedUploadAuthorization() {
  if (!provider || !publicKey) await connectWallet();
  if (typeof provider.signMessage !== 'function') throw new Error('현재 Phantom 환경은 메시지 서명을 지원하지 않습니다.');

  const wallet = publicKey.toString();
  const response = await fetch(`${UPLOAD_API_URL}/api/auth/challenge?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
  const challenge = await response.json().catch(() => ({}));
  if (!response.ok || !challenge.message || !challenge.token) {
    throw new Error(challenge.error || `인증 요청 실패: HTTP ${response.status}`);
  }

  setStatus('Phantom에서 이미지 업로드 권한 서명을 승인하세요.', 'working');
  const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
  const signature = signed?.signature || signed;
  if (!signature) throw new Error('Phantom 메시지 서명을 받지 못했습니다.');
  return { wallet, authMessage: challenge.message, authToken: challenge.token, signature: bytesToBase64(signature) };
}

async function uploadAsset() {
  const file = nftImageEl.files?.[0];
  if (!file) return setStatus('업로드할 JPG, PNG 또는 WebP 이미지를 선택하세요.', 'error');
  const name = nftNameEl.value.trim();
  const symbol = nftSymbolEl.value.trim().toUpperCase();
  if (!name || !symbol) return setStatus('쿠폰 이름과 심볼을 먼저 입력하세요.', 'error');

  uploadAssetBtn.disabled = true;
  uploadAssetBtn.textContent = '업로드 인증 중…';
  try {
    const auth = await getSignedUploadAuthorization();
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    form.append('symbol', symbol);
    form.append('description', nftDescriptionEl.value.trim());
    form.append('wallet', auth.wallet);
    form.append('authMessage', auth.authMessage);
    form.append('authToken', auth.authToken);
    form.append('signature', auth.signature);

    uploadAssetBtn.textContent = 'GitHub에 업로드 중…';
    setStatus('이미지 저장과 메타데이터 공개 여부를 확인 중입니다…', 'working');
    const response = await fetch(`${UPLOAD_API_URL}/api/upload`, { method: 'POST', body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.metadataUri) throw new Error(result.error || `업로드 실패: HTTP ${response.status}`);

    metadataUriEl.value = result.metadataUri;
    cachedMetadata = null;
    await previewMetadata();
    setStatus('업로드 완료. 이제 쿠폰 NFT를 발행할 수 있습니다.', 'success');
  } catch (error) {
    setStatus(`이미지 업로드 실패: ${error.message || error}`, 'error');
  } finally {
    uploadAssetBtn.disabled = false;
    uploadAssetBtn.textContent = '이미지 업로드 → 메타데이터 생성';
  }
}

// ─── 쿠폰 NFT 발행 ───
function validateMintInput() {
  const name = nftNameEl.value.trim();
  const symbol = nftSymbolEl.value.trim().toUpperCase();
  const uri = metadataUriEl.value.trim();
  if (!name) throw new Error('쿠폰 이름을 입력하세요.');
  if (new TextEncoder().encode(name).length > 32) throw new Error('이름은 32바이트 이하여야 합니다.');
  if (!symbol) throw new Error('심볼을 입력하세요.');
  if (new TextEncoder().encode(symbol).length > 10) throw new Error('심볼은 10바이트 이하여야 합니다.');
  if (!uri.startsWith('https://')) throw new Error('메타데이터 URI는 HTTPS여야 합니다.');
  return { name, symbol, uri, isMutable: true };
}

async function mintCoupon(event) {
  event.preventDefault();
  try {
    const input = validateMintInput();
    if (!provider || !publicKey) await connectWallet();
    minting = true;
    mintBtn.disabled = true;
    mintBtn.textContent = '쿠폰 발행 중…';
    mintExplorerEl.classList.add('hidden');

    setStatus('메타데이터 검증 중…', 'working');
    cachedMetadata = await fetchMetadataWithRetry(input.uri);
    mintPreviewEl.src = cachedMetadata.image;

    const umi = createUmi(RPC).use(mplTokenMetadata()).use(walletAdapterIdentity(provider));
    const mint = generateSigner(umi);
    setStatus('Phantom에서 쿠폰 발행 트랜잭션을 승인하세요.', 'working');
    await createNFT(umi, {
      mint,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      sellerFeeBasisPoints: percentAmount(0),
      isMutable: true,
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

    const mintAddress = mint.publicKey.toString();

    // 쿠폰 메타데이터 저장
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(expiryDaysEl.value) || 30);
    setCouponMeta(mintAddress, {
      type: couponTypeEl.value,
      value: couponValueEl.value,
      expiry: expiryDate.toISOString(),
      createdAt: new Date().toISOString(),
      issuer: publicKey.toString(),
      name: input.name,
    });

    // 발행 이력 저장
    saveUserMint(mintAddress, input.name, input.uri);

    mintExplorerEl.href = `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`;
    mintExplorerEl.textContent = `Explorer에서 ${shortAddress(mintAddress)} 확인`;
    mintExplorerEl.classList.remove('hidden');
    setStatus(`쿠폰 발행 성공: ${mintAddress}`, 'success');
    await refreshBalance();
    await loadUserCoupons();
  } catch (error) {
    console.error(error);
    setStatus(`쿠폰 발행 실패: ${error.message || error}`, 'error');
  } finally {
    minting = false;
    mintBtn.disabled = false;
    mintBtn.textContent = publicKey ? '쿠폰 NFT 발행' : 'Phantom 연결 후 발행';
  }
}

// ─── 발행 이력 ───
function saveUserMint(mintAddress, name, uri) {
  const mints = JSON.parse(localStorage.getItem('userCouponMints') || '[]');
  mints.unshift({ mint: mintAddress, name, uri, createdAt: new Date().toISOString() });
  localStorage.setItem('userCouponMints', JSON.stringify(mints));
}

function loadUserMints() {
  const mints = JSON.parse(localStorage.getItem('userCouponMints') || '[]');
  userMintCountEl.textContent = String(mints.length);
  clearUserMintsBtn.disabled = mints.length === 0;
  if (mints.length === 0) {
    userMintGalleryEl.innerHTML = '<p class="muted">발행한 쿠폰이 없습니다.</p>';
    return;
  }
  userMintGalleryEl.innerHTML = mints.map((m) => {
    const status = getCouponStatus(m.mint);
    const explorer = `https://explorer.solana.com/address/${m.mint}?cluster=devnet`;
    return `<article class="nft-item">
      <div class="nft-copy">
        <strong>${escapeHtml(m.name)}</strong>
        <p>${formatDate(m.createdAt)}</p>
        <span class="coupon-badge ${status.class}">${status.label}</span>
        <code>${escapeHtml(shortAddress(m.mint))}</code>
      </div>
      <a href="${escapeHtml(explorer)}" target="_blank" rel="noreferrer">Explorer</a>
    </article>`;
  }).join('');
}

// ─── 보유 쿠폰 조회 ───
async function loadUserCoupons() {
  if (!publicKey) {
    couponGalleryEl.innerHTML = '<p class="muted">Phantom 연결 후 조회됩니다.</p>';
    userCouponCountEl.textContent = '0';
    return;
  }
  try {
    setStatus('보유 NFT 쿠폰 조회 중…', 'working');
    const umi = createUmi(RPC).use(mplTokenMetadata());
    // Solana RPC로 소유 NFT 조회
    const tokens = await connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    const couponTokens = tokens.value.filter(t => {
      const info = t.account.data.parsed?.info;
      return info && info.tokenAmount.uiAmount > 0 && info.tokenAmount.decimals === 0;
    });

    userCouponCountEl.textContent = String(couponTokens.length);

    if (couponTokens.length === 0) {
      couponGalleryEl.innerHTML = '<p class="muted">보유한 쿠폰이 없습니다.</p>';
      return;
    }

    const items = await Promise.all(couponTokens.map(async (t) => {
      const mint = t.account.data.parsed.info.mint;
      const meta = getCouponMeta(mint);
      const status = getCouponStatus(mint);
      return { mint, meta, status };
    }));

    couponGalleryEl.innerHTML = items.map((item) => {
      const explorer = `https://explorer.solana.com/address/${item.mint}?cluster=devnet`;
      const couponName = item.meta?.name || 'Unknown Coupon';
      const typeLabel = item.meta?.type ? { discount: '할인', voucher: '상품권', event: '이벤트', membership: '멤버십' }[item.meta.type] || item.meta.type : 'NFT';
      const valueLabel = item.meta?.value ? `${item.meta.value}${item.meta.type === 'discount' ? '%' : '원'}` : '';
      const expiryLabel = item.meta?.expiry ? formatDate(item.meta.expiry) : '-';
      return `<article class="nft-item">
        <div class="nft-copy">
          <strong>${escapeHtml(couponName)}</strong>
          <p>유형: ${typeLabel}${valueLabel ? ' · ' + valueLabel : ''}</p>
          <p>유효기간: ${expiryLabel}</p>
          <span class="coupon-badge ${item.status.class}">${item.status.label}</span>
          <code>${escapeHtml(shortAddress(item.mint))}</code>
        </div>
        <a href="${escapeHtml(explorer)}" target="_blank" rel="noreferrer">Explorer</a>
      </article>`;
    }).join('');

    setStatus('보유 쿠폰 조회 완료', 'success');
  } catch (error) {
    couponGalleryEl.innerHTML = `<p class="muted">조회 실패: ${escapeHtml(error.message || String(error))}</p>`;
    setStatus(`쿠폰 조회 실패: ${error.message || error}`, 'error');
  }
}

// ─── 쿠폰 사용 처리 ───
async function useCoupon() {
  const mintAddr = useCouponMintEl.value.trim();
  if (!mintAddr) return setStatus('쿠폰 Mint 주소를 입력하세요.', 'error');

  if (isCouponUsed(mintAddr)) {
    showUseResult('이미 사용된 쿠폰입니다.', 'used');
    return;
  }

  const meta = getCouponMeta(mintAddr);
  if (meta?.expiry) {
    const expiryDate = new Date(meta.expiry);
    if (expiryDate < new Date()) {
      showUseResult('만료된 쿠폰입니다.', 'expired');
      return;
    }
  }

  try {
    // 온체인 검증: memo 트랜잭션으로 사용 기록
    if (!provider || !publicKey) await connectWallet();
    setStatus('Phantom에서 쿠폰 사용 트랜잭션을 승인하세요.', 'working');

    const memoInstruction = new solanaWeb3.TransactionInstruction({
      keys: [],
      programId: new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: new TextEncoder().encode(`COUPON_USED:${mintAddr}:${new Date().toISOString()}`),
    });

    const transaction = new solanaWeb3.Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: publicKey,
        lamports: 0,
      }),
      memoInstruction,
    );

    const signature = await provider.signAndSendTransaction(transaction, { connection });
    await connection.confirmTransaction(signature, 'confirmed');

    markCouponUsed(mintAddr);
    showUseResult(`쿠폰 사용 처리 완료. 트랜잭션: ${shortAddress(signature)}`, 'used');
    setStatus('쿠폰 사용 처리 완료', 'success');
    await loadUserCoupons();
    loadUserMints();
  } catch (error) {
    setStatus(`쿠폰 사용 실패: ${error.message || error}`, 'error');
    showUseResult(`실패: ${error.message || error}`, 'error');
  }
}

// ─── 쿠폰 상태 확인 ───
async function verifyCouponStatus() {
  const mintAddr = useCouponMintEl.value.trim();
  if (!mintAddr) return setStatus('쿠폰 Mint 주소를 입력하세요.', 'error');

  const status = getCouponStatus(mintAddr);
  const meta = getCouponMeta(mintAddr);

  let html = `<div class="verify-result ${status.class}">
    <h3>쿠폰 상태: ${status.label}</h3>`;
  if (meta) {
    html += `<p>이름: ${escapeHtml(meta.name || '-')}</p>
    <p>유형: ${escapeHtml(meta.type || '-')}</p>
    <p>발행일: ${formatDate(meta.createdAt)}</p>
    <p>유효기간: ${formatDate(meta.expiry)}</p>`;
  }
  html += `<p>Mint: <code>${escapeHtml(mintAddr)}</code></p>
    <a href="https://explorer.solana.com/address/${escapeHtml(mintAddr)}?cluster=devnet" target="_blank" rel="noreferrer">Explorer 확인</a>
  </div>`;
  useResultEl.innerHTML = html;
  useResultEl.classList.remove('hidden');
}

function showUseResult(message, kind) {
  useResultEl.innerHTML = `<div class="verify-result status-${kind}"><p>${escapeHtml(message)}</p></div>`;
  useResultEl.classList.remove('hidden');
}

// ─── 이벤트 ───
connectBtn.addEventListener('click', async () => {
  try { await connectWallet(); loadUserMints(); }
  catch (error) { setStatus(`연결 실패: ${error.message || error}`, 'error'); }
});
refreshBtn.addEventListener('click', refreshBalance);
previewMetadataBtn.addEventListener('click', previewMetadata);
uploadAssetBtn.addEventListener('click', uploadAsset);
mintForm.addEventListener('submit', mintCoupon);
useCouponBtn.addEventListener('click', useCoupon);
verifyCouponBtn.addEventListener('click', verifyCouponStatus);
metadataUriEl.addEventListener('change', () => { cachedMetadata = null; });
nftImageEl.addEventListener('change', () => {
  const file = nftImageEl.files?.[0];
  if (!file) return;
  if (localImageUrl) URL.revokeObjectURL(localImageUrl);
  localImageUrl = URL.createObjectURL(file);
  mintPreviewEl.src = localImageUrl;
  previewMessageEl.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
});
clearUserMintsBtn.addEventListener('click', () => {
  localStorage.removeItem('userCouponMints');
  loadUserMints();
});

// ─── 초기화 ───
window.addEventListener('load', async () => {
  loadUserMints();
  await previewMetadata();
  provider = getProvider();
  if (!provider) return;
  try {
    const result = await provider.connect({ onlyIfTrusted: true });
    publicKey = result.publicKey;
    const addr = publicKey.toString();
    walletEl.textContent = addr;
    connectBtn.textContent = '연결됨';
    refreshBtn.disabled = false;
    if (!isIssuer(addr)) addIssuer(addr);
    roleEl.textContent = isIssuer(addr) ? '발행자 / 검증자' : '사용자';
    await refreshBalance();
    await loadUserCoupons();
  } catch {
    // 자동 연결 실패 시 대기
  }
});
