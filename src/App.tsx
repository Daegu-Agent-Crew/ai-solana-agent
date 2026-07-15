import { useEffect, useState } from 'react';

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
};

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  }
}

const RPC = 'https://api.devnet.solana.com';

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || 'Solana RPC 오류');
  return json.result;
}

function getProvider(): PhantomProvider | null {
  const provider = window.phantom?.solana || window.solana;
  return provider?.isPhantom ? provider : null;
}

export default function App() {
  const [wallet, setWallet] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState('페이지가 정상적으로 실행되었습니다. Phantom을 연결하세요.');
  const [busy, setBusy] = useState(false);

  async function refreshBalance(address = wallet) {
    if (!address) return;
    const result = await rpc('getBalance', [address, { commitment: 'confirmed' }]);
    setBalance(result.value / 1_000_000_000);
  }

  async function connect() {
    try {
      setBusy(true);
      const provider = getProvider();
      if (!provider) {
        setStatus('Phantom이 감지되지 않았습니다. Phantom 앱의 브라우저에서 이 페이지를 열어주세요.');
        return;
      }
      const result = await provider.connect();
      const address = result.publicKey.toString();
      setWallet(address);
      setStatus('Phantom 연결 완료. Devnet 잔액을 확인했습니다.');
      await refreshBalance(address);
    } catch (error) {
      setStatus(`Phantom 연결 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setBusy(false);
    }
  }

  async function airdrop() {
    try {
      if (!wallet) throw new Error('먼저 Phantom을 연결하세요.');
      setBusy(true);
      setStatus('Devnet SOL 에어드롭을 요청하고 있습니다…');
      const signature = await rpc('requestAirdrop', [wallet, 1_000_000_000]);
      for (let i = 0; i < 12; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const result = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
        const value = result.value?.[0];
        if (value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') break;
      }
      await refreshBalance(wallet);
      setStatus(`에어드롭 요청 완료: ${signature}`);
    } catch (error) {
      setStatus(`에어드롭 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const provider = getProvider();
    provider?.connect({ onlyIfTrusted: true })
      .then((result) => {
        const address = result.publicKey.toString();
        setWallet(address);
        refreshBalance(address).catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  return (
    <main className="shell">
      <header className="hero">
        <span className="badge">Solana Devnet · Phantom</span>
        <h1>AI Solana NFT Agent</h1>
        <p>먼저 Phantom 직접 연결과 Devnet SOL 흐름을 안정화한 버전입니다.</p>
      </header>

      <section className="card walletRow">
        <div>
          <h2>1. Phantom 연결</h2>
          <p>{wallet || 'Phantom 앱 내부 브라우저에서 연결하세요.'}</p>
        </div>
        <button onClick={connect} disabled={busy}>{wallet ? '연결됨' : 'Phantom 연결'}</button>
      </section>

      <section className="grid">
        <article className="card preview">
          <img src={`${import.meta.env.BASE_URL}nft-image.svg`} alt="NFT preview" />
          <div><strong>닥터슬럼프 #001</strong><span>Solana Devnet 검증용 NFT</span></div>
        </article>
        <article className="card formCard">
          <h2>2. Devnet 준비</h2>
          <div className="balance"><span>Devnet 잔액</span><strong>{balance === null ? '-' : `${balance.toFixed(4)} SOL`}</strong></div>
          <button onClick={airdrop} disabled={!wallet || busy}>1 SOL 테스트 에어드롭</button>
          <button onClick={() => refreshBalance()} disabled={!wallet || busy}>잔액 새로고침</button>
        </article>
      </section>

      <section className="card actions">
        <h2>3. NFT 발행</h2>
        <p>Phantom 연결과 에어드롭이 확인되면 다음 커밋에서 Metaplex 민팅을 다시 연결합니다.</p>
        <button className="primary" disabled>NFT 발행 준비 중</button>
        <div className="status">{status}</div>
      </section>

      <section className="notice">
        <strong>보안</strong><p>복구 문구와 개인키는 입력하지 않습니다. 지갑 연결은 Phantom에서만 승인합니다.</p>
      </section>
    </main>
  );
}
