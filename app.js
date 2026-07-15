import { createUmi } from 'https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.2.0?bundle';
import { generateSigner, percentAmount } from 'https://esm.sh/@metaplex-foundation/umi@1.2.0?bundle';
import { createNft, mplTokenMetadata } from 'https://esm.sh/@metaplex-foundation/mpl-token-metadata@3.4.0?bundle';
import { walletAdapterIdentity } from 'https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@1.2.0?bundle';

const RPC = 'https://api.devnet.solana.com';
const UPLOAD_API_URL = 'https://ai-solana-upload.sfex11.workers.dev';
const connection = new solanaWeb3.Connection(RPC, 'confirmed');

const $ = (id) => document.getElementById(id);
const walletEl = $('wallet');
const balanceEl = $('balance');
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
const uploadAssetBtn = $('uploadAsset');
const uploadApiUrlEl = $('uploadApiUrl');
const mintExplorerEl = $('mintExplorer');
const latestNftStatusEl = $('latestNftStatus');
const latestNftNameEl = $('latestNftName');
const latestNftMintEl = $('latestNftMint');
const latestNftExplorerEl = $('latestNftExplorer');
const galleryEl = $('nftGallery');
const galleryCountEl = $('galleryCount');

let provider = null;
let publicKey = null;
let cachedMetadata = null;
let minting = false;
let localImageUrl = '';

uploadApiUrlEl.textContent = UPLOAD_API_URL;

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

function updateMintButton() {
  if (minting) return;
  mintBtn.disabled = false;
  mintBtn.textContent = publicKey ? 'Phantom으로 NFT 발행' : 'Phantom 연결 후 NFT 발행';
}

function validateMintInput() {
  const name = nftNameEl.value.trim();
  const symbol = nftSymbolEl.value.trim().toUpperCase();
  const uri = metadataUriEl.value.trim();
  if (!name) throw new Error('NFT 이름을 입력하세요.');
  if (new TextEncoder().encode(name).length > 32) throw new Error('NFT 이름은 UTF-8 기준 32바이트 이하여야 합니다.');
  if (!symbol) throw new Error('심볼을 입력하세요.');
  if (new TextEncoder().encode(symbol).length > 10) throw new Error('심볼은 UTF-8 기준 10바이트 이하여야 합니다.');
  if (!uri.startsWith('https://')) throw new Error('메타데이터 URI는 HTTPS 주소여야 합니다.');
  if (new TextEncoder().encode(uri).length > 200) throw new Error('메타데이터 URI는 200바이트 이하여야 합니다.');
  return { name, symbol, uri, isMutable: isMutableEl.checked };
}

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
    const { uri } = validateMintInput();
    setStatus('메타데이터 확인 중…', 'working');
    cachedMetadata = await fetchMetadataWithRetry(uri);
    mintPreviewEl.src = cachedMetadata.image;
    mintPreviewEl.alt = cachedMetadata.name || 'NFT 미리보기';
    previewMessageEl.textContent = cachedMetadata.description || cachedMetadata.name || '메타데이터 확인 완료';
    setStatus('메타데이터와 이미지 확인 완료', 'success');
  } catch (error) {
    cachedMetadata = null;
    previewMessageEl.textContent = error.message || String(error);
    setStatus(`미리보기 실패: ${error.message || error}`, 'error');
  }
}

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
  if (!provider) throw new Error('Phantom 앱 또는 Phantom 확장 프로그램이 필요합니다.');
  setStatus('Phantom 연결 승인 대기 중…', 'working');
  const result = await provider.connect();
  publicKey = result.publicKey;
  walletEl.textContent = publicKey.toString();
  connectBtn.textContent = '연결됨';
  refreshBtn.disabled = false;
  updateMintButton();
  await refreshBalance();
  setStatus('Phantom 연결 완료', 'success');
  return publicKey;
}

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
  if (!name || !symbol) return setStatus('NFT 이름과 심볼을 먼저 입력하세요.', 'error');

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
    setStatus('업로드와 공개 검증 완료. 이제 Phantom으로 NFT를 발행할 수 있습니다.', 'success');
  } catch (error) {
    setStatus(`이미지 업로드 실패: ${error.message || error}`, 'error');
  } finally {
    uploadAssetBtn.disabled = false;
    uploadAssetBtn.textContent = '이미지 업로드 → 메타데이터 생성';
  }
}

async function mintWithConnectedWallet(event) {
  event.preventDefault();
  try {
    const input = validateMintInput();
    if (!provider || !publicKey) await connectWallet();
    minting = true;
    mintBtn.disabled = true;
    mintBtn.textContent = 'NFT 발행 진행 중…';
    mintExplorerEl.classList.add('hidden');

    setStatus('메타데이터 검증 중…', 'working');
    cachedMetadata = await fetchMetadataWithRetry(input.uri);
    mintPreviewEl.src = cachedMetadata.image;
    previewMessageEl.textContent = cachedMetadata.description || cachedMetadata.name;

    const umi = createUmi(RPC).use(mplTokenMetadata()).use(walletAdapterIdentity(provider));
    const mint = generateSigner(umi);
    setStatus('Phantom에서 NFT 발행 트랜잭션을 승인하세요.', 'working');
    await createNft(umi, {
      mint,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      sellerFeeBasisPoints: percentAmount(0),
      isMutable: input.isMutable,
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

    const mintAddress = mint.publicKey.toString();
    mintExplorerEl.href = `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`;
    mintExplorerEl.textContent = `Explorer에서 ${shortAddress(mintAddress)} 확인`;
    mintExplorerEl.classList.remove('hidden');
    setStatus(`NFT 발행 성공: ${mintAddress}`, 'success');
    await refreshBalance();
  } catch (error) {
    console.error(error);
    setStatus(`NFT 발행 실패: ${error.message || error}`, 'error');
  } finally {
    minting = false;
    updateMintButton();
  }
}

async function loadLatestNft() {
  try {
    const response = await fetch(`./latest-nft.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('자동 민팅 결과 없음');
    const nft = await response.json();
    latestNftStatusEl.textContent = nft.ok ? 'PASS' : 'FAIL';
    latestNftNameEl.textContent = nft.name || '-';
    latestNftMintEl.textContent = nft.mint || '-';
    if (nft.mint) {
      latestNftExplorerEl.href = nft.explorer || `https://explorer.solana.com/address/${nft.mint}?cluster=devnet`;
      latestNftExplorerEl.classList.remove('hidden');
    }
  } catch (error) {
    latestNftStatusEl.textContent = '대기 중';
    latestNftNameEl.textContent = error.message || String(error);
  }
}

async function loadNftHistory() {
  try {
    const response = await fetch(`./nft-history.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('민팅 이력이 아직 없습니다.');
    const history = await response.json();
    if (!Array.isArray(history)) throw new Error('민팅 이력 형식 오류');
    galleryCountEl.textContent = String(history.length);
    const enriched = await Promise.all(history.map(async (nft) => {
      try { return { ...nft, offchain: await fetchMetadataWithRetry(nft.uri, 2) }; }
      catch { return { ...nft, offchain: null }; }
    }));
    galleryEl.innerHTML = enriched.map((nft) => {
      const explorer = nft.explorer || `https://explorer.solana.com/address/${nft.mint}?cluster=devnet`;
      const image = nft.image || nft.offchain?.image;
      const description = nft.description || nft.offchain?.description || '';
      return `<article class="nft-item">
        <div class="nft-thumb-wrap">${image ? `<img class="nft-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(nft.name || 'NFT')}" loading="lazy" />` : '<div class="nft-thumb placeholder">No image</div>'}</div>
        <div class="nft-copy"><strong>${escapeHtml(nft.name || 'Unnamed NFT')}</strong><p>${formatDate(nft.createdAt)}</p>${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}<code>${escapeHtml(shortAddress(nft.mint))}</code></div>
        <a href="${escapeHtml(explorer)}" target="_blank" rel="noreferrer">Explorer</a>
      </article>`;
    }).join('');
  } catch (error) {
    galleryCountEl.textContent = '0';
    galleryEl.innerHTML = `<p class="muted">${escapeHtml(error.message || String(error))}</p>`;
  }
}

connectBtn.addEventListener('click', async () => {
  try { await connectWallet(); }
  catch (error) { setStatus(`연결 실패: ${error.message || error}`, 'error'); }
});
refreshBtn.addEventListener('click', refreshBalance);
previewMetadataBtn.addEventListener('click', previewMetadata);
uploadAssetBtn.addEventListener('click', uploadAsset);
mintForm.addEventListener('submit', mintWithConnectedWallet);
metadataUriEl.addEventListener('change', () => { cachedMetadata = null; });
nftImageEl.addEventListener('change', () => {
  const file = nftImageEl.files?.[0];
  if (!file) return;
  if (localImageUrl) URL.revokeObjectURL(localImageUrl);
  localImageUrl = URL.createObjectURL(file);
  mintPreviewEl.src = localImageUrl;
  previewMessageEl.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
});

window.addEventListener('load', async () => {
  updateMintButton();
  await Promise.all([loadLatestNft(), loadNftHistory(), previewMetadata()]);
  provider = getProvider();
  if (!provider) return;
  try {
    const result = await provider.connect({ onlyIfTrusted: true });
    publicKey = result.publicKey;
    walletEl.textContent = publicKey.toString();
    connectBtn.textContent = '연결됨';
    refreshBtn.disabled = false;
    updateMintButton();
    await refreshBalance();
  } catch {
    updateMintButton();
  }
});
