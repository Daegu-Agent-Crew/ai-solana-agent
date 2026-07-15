import { createUploadKey } from './upload-state.js';

const form = document.getElementById('mintForm');
const mintBtn = document.getElementById('mintNft');
const uploadBtn = document.getElementById('uploadAsset');
const fileInput = document.getElementById('nftImage');
const metadataInput = document.getElementById('metadataUri');
const statusEl = document.getElementById('status');
const nameInput = document.getElementById('nftName');
const symbolInput = document.getElementById('nftSymbol');
const descriptionInput = document.getElementById('nftDescription');

let resubmitting = false;
let orchestrating = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUpload(previousUri, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const uri = metadataInput.value.trim();
    const status = statusEl.textContent || '';
    if (uri && uri !== previousUri && status.includes('업로드') && status.includes('완료')) return uri;
    if (status.includes('이미지 업로드 실패')) throw new Error(status.replace(/^이미지 업로드 실패:\s*/, ''));
    await sleep(500);
  }
  throw new Error('이미지 업로드 확인 시간이 초과되었습니다.');
}

form.addEventListener('submit', async (event) => {
  if (resubmitting || orchestrating) return;

  const file = fileInput.files?.[0];
  if (!file) return; // Existing metadata URI mint flow remains available.

  event.preventDefault();
  event.stopImmediatePropagation();
  orchestrating = true;

  const originalText = mintBtn.textContent;
  mintBtn.disabled = true;

  try {
    const previousUri = metadataInput.value.trim();
    const currentUploadKey = createUploadKey(file, {
      name: nameInput.value,
      symbol: symbolInput.value,
      description: descriptionInput.value,
    });
    const canReuseUpload = previousUri && metadataInput.dataset.uploadKey === currentUploadKey;

    if (canReuseUpload) {
      statusEl.textContent = '기존 업로드를 재사용해 NFT 발행을 준비합니다.';
      statusEl.className = 'status working';
    } else {
      mintBtn.textContent = '1/2 이미지 업로드·서명 중…';
      uploadBtn.click();
      await waitForUpload(previousUri);
    }

    mintBtn.textContent = '2/2 Phantom NFT 발행 준비 중…';
    resubmitting = true;
    form.requestSubmit(mintBtn);
  } catch (error) {
    statusEl.textContent = `원클릭 NFT 발행 실패: ${error.message || error}`;
    statusEl.className = 'status error';
  } finally {
    orchestrating = false;
    if (!resubmitting) {
      mintBtn.disabled = false;
      mintBtn.textContent = originalText;
    }
  }
}, true);

// app.js handles the actual mint and restores its own button state.
new MutationObserver(() => {
  const message = statusEl.textContent || '';
  if (resubmitting && (message.startsWith('NFT 발행 성공:') || message.startsWith('NFT 발행 실패:'))) {
    resubmitting = false;
  }
}).observe(statusEl, { childList: true, characterData: true, subtree: true });
