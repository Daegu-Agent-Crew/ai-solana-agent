const RPC = 'https://api.devnet.solana.com';
const connection = new solanaWeb3.Connection(RPC, 'confirmed');

const walletEl = document.getElementById('wallet');
const balanceEl = document.getElementById('balance');
const statusEl = document.getElementById('status');
const connectBtn = document.getElementById('connect');
const refreshBtn = document.getElementById('refresh');
const testTxBtn = document.getElementById('testTx');
const explorerEl = document.getElementById('explorer');

let provider = null;
let publicKey = null;

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function getProvider() {
  const candidate = window.phantom?.solana || window.solana;
  return candidate?.isPhantom ? candidate : null;
}

async function refreshBalance() {
  if (!publicKey) return;
  try {
    setStatus('Devnet 잔액 확인 중…', 'working');
    const lamports = await connection.getBalance(publicKey, 'confirmed');
    balanceEl.textContent = `${(lamports / solanaWeb3.LAMPORTS_PER_SOL).toFixed(4)} SOL`;
    setStatus('Devnet 잔액 확인 완료', 'success');
  } catch (error) {
    setStatus(`잔액 조회 실패: ${error.message || error}`, 'error');
  }
}

async function connectWallet() {
  try {
    provider = getProvider();
    if (!provider) {
      throw new Error('Phantom 앱 내부 브라우저에서 페이지를 열어주세요.');
    }

    setStatus('Phantom 연결 승인 대기 중…', 'working');
    const result = await provider.connect();
    publicKey = result.publicKey;
    walletEl.textContent = publicKey.toString();
    connectBtn.textContent = '연결됨';
    refreshBtn.disabled = false;
    testTxBtn.disabled = false;
    await refreshBalance();
  } catch (error) {
    setStatus(`연결 실패: ${error.message || error}`, 'error');
  }
}

async function waitForConfirmation(signature, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = result.value[0];
    if (status?.err) {
      throw new Error(`트랜잭션 오류: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error('확인 시간이 초과되었습니다. Explorer에서 서명 상태를 확인하세요.');
}

async function sendTestTransaction() {
  try {
    if (!provider || !publicKey) throw new Error('먼저 Phantom을 연결하세요.');

    setStatus('최신 블록해시로 테스트 트랜잭션 준비 중…', 'working');
    const latest = await connection.getLatestBlockhash('finalized');
    const transaction = new solanaWeb3.Transaction({
      feePayer: publicKey,
      recentBlockhash: latest.blockhash,
    }).add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: publicKey,
        lamports: 0,
      }),
    );

    setStatus('Phantom에서 트랜잭션을 승인하세요.', 'working');
    const signedTransaction = await provider.signTransaction(transaction);

    setStatus('서명된 트랜잭션 전송 중…', 'working');
    const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 5,
    });

    explorerEl.href = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
    explorerEl.classList.remove('hidden');

    setStatus('Devnet 확인 중…', 'working');
    await waitForConfirmation(signature);

    setStatus(`테스트 트랜잭션 성공: ${signature}`, 'success');
    await refreshBalance();
  } catch (error) {
    setStatus(`테스트 트랜잭션 실패: ${error.message || error}`, 'error');
  }
}

connectBtn.addEventListener('click', connectWallet);
refreshBtn.addEventListener('click', refreshBalance);
testTxBtn.addEventListener('click', sendTestTransaction);

window.addEventListener('load', async () => {
  provider = getProvider();
  if (!provider) return;
  try {
    const result = await provider.connect({ onlyIfTrusted: true });
    publicKey = result.publicKey;
    walletEl.textContent = publicKey.toString();
    connectBtn.textContent = '연결됨';
    refreshBtn.disabled = false;
    testTxBtn.disabled = false;
    await refreshBalance();
  } catch (_) {
    // 사용자가 아직 연결을 승인하지 않은 정상 상태입니다.
  }
});