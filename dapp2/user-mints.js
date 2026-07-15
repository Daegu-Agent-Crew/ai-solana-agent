const STORAGE_KEY = 'ai-solana-agent:user-mints:v1';
const statusEl = document.getElementById('status');
const explorerEl = document.getElementById('mintExplorer');
const galleryEl = document.getElementById('userMintGallery');
const countEl = document.getElementById('userMintCount');
const clearBtn = document.getElementById('clearUserMints');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

function readItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
}

function shortAddress(value) {
  return value?.length > 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value || '-';
}

function render() {
  const items = readItems();
  countEl.textContent = String(items.length);
  clearBtn.disabled = items.length === 0;
  if (!items.length) {
    galleryEl.innerHTML = '<p class="muted">이 기기에서 발행한 NFT가 아직 없습니다.</p>';
    return;
  }
  galleryEl.innerHTML = items.map((item) => `
    <article class="nft-item">
      <div class="nft-thumb-wrap">
        ${item.image ? `<img class="nft-thumb" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" />` : '<div class="nft-thumb placeholder">No image</div>'}
      </div>
      <div class="nft-copy">
        <strong>${escapeHtml(item.name || 'Unnamed NFT')}</strong>
        <p>${new Date(item.createdAt).toLocaleString('ko-KR')}</p>
        ${item.description ? `<p class="description">${escapeHtml(item.description)}</p>` : ''}
        <code title="${escapeHtml(item.mint)}">${escapeHtml(shortAddress(item.mint))}</code>
      </div>
      <a href="${escapeHtml(item.explorer)}" target="_blank" rel="noreferrer">Explorer</a>
    </article>`).join('');
}

async function captureSuccessfulMint() {
  const message = statusEl.textContent || '';
  if (!message.startsWith('NFT 발행 성공:')) return;
  const mint = message.slice('NFT 발행 성공:'.length).trim();
  if (!mint) return;
  const items = readItems();
  if (items.some((item) => item.mint === mint)) return;

  const metadataUri = document.getElementById('metadataUri')?.value?.trim() || '';
  let metadata = {};
  try {
    const response = await fetch(`${metadataUri}${metadataUri.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
    if (response.ok) metadata = await response.json();
  } catch {
    // Mint result is still stored even when metadata lookup is temporarily unavailable.
  }

  const explorer = explorerEl.href || `https://explorer.solana.com/address/${mint}?cluster=devnet`;
  items.unshift({
    mint,
    explorer,
    metadataUri,
    name: metadata.name || document.getElementById('nftName')?.value || 'NFT',
    description: metadata.description || document.getElementById('nftDescription')?.value || '',
    image: metadata.image || document.getElementById('mintPreview')?.src || '',
    wallet: document.getElementById('wallet')?.textContent || '',
    createdAt: new Date().toISOString(),
  });
  writeItems(items);
  render();
}

new MutationObserver(captureSuccessfulMint).observe(statusEl, { childList: true, characterData: true, subtree: true });
clearBtn.addEventListener('click', () => {
  if (!confirm('이 기기에 저장된 사용자 민팅 이력을 지울까요? 블록체인의 NFT는 삭제되지 않습니다.')) return;
  localStorage.removeItem(STORAGE_KEY);
  render();
});

render();
