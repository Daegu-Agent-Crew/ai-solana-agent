import { useEffect, useMemo, useState } from 'react';

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
const METADATA_URI = 'https://daegu-agent-crew.github.io/ai-solana-agent/metadata/doctor-slump-001.json';

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
  const [name, setName] = useState('닥터슬럼프 #001');
  const [description, setDescription] = useState('사막 디오라마를 배경으로 한 AI 팬아트 스타일 컬렉터 이미지. Solana Devnet 검증용 NFT입니다.');
  const [mintAddress, setMintAddress] = useState('');

  const explorerUrl = useMemo(
    () => mintAddress ? `https://explorer.solana.com/address/${mintAddress}?cluster=devnet` : '',
    [mintAddress],
  );

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

  async function copyWallet() {
    if (!wallet) return;
    await navigator.clipboard.writeText(wallet);
    setStatus('지갑 주소를 복사했습니다.');
  }

  async function mintNft() {
    try {
      if (!wallet) throw new Error('먼저 Phantom을 연결하세요.');
      if ((balance ?? 0) < 0.02) throw new Error('Devnet SOL 잔액이 부족합니다. 최소 0.02 SOL 이상을 권장합니다.');

      setBusy(true);
      setStatus('공식 Phantom 민팅 모듈을 불러오는 중입니다…');

      const [umiDefaults, umiCore, metadata, signerAdapters, phantomModule] = await Promise.all([
        import('@metaplex-foundation/umi-bundle-defaults'),
        import('@metaplex-foundation/umi'),
        import('@metaplex-foundation/mpl-token-metadata'),
        import('@metaplex-foundation/umi-signer-wallet-adapters'),
        import('@solana/wallet-adapter-phantom'),
      ]);

      const adapter = new phantomModule.PhantomWalletAdapter();
      if (!adapter.connected) {
        await adapter.connect();
      }
      if (!adapter.publicKey) {
        throw new Error('Phantom 공개 주소를 읽지 못했습니다.');
      }
      if (adapter.publicKey.toBase58() !== wallet) {
        throw new Error('연결된 Phantom 계정이 변경되었습니다. 페이지를 새로고침해 다시 연결하세요.');
      }

      const umi = umiDefaults.createUmi(RPC)
        .use(metadata.mplTokenMetadata())
        .use(signerAdapters.walletAdapterIdentity(adapter));

      const mint = umiCore.generateSigner(umi);
      setStatus('Phantom에서 NFT 발행 트랜잭션을 승인하세요.');

      await metadata.createNft(umi, {
        mint,
        name: name.trim() || 'AI Solana NFT #001',
        uri: METADATA_URI,
        sellerFeeBasisPoints: umiCore.percentAmount(0),
      }).sendAndConfirm(umi);

      const address = mint.publicKey.toString();
      setMintAddress(address);
      await refreshBalance(wallet);
      setStatus(`NFT 발행 완료: ${address}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      setStatus(`NFT 발행 실패: ${message}`);
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
        <p>GitHub Pages에서 직접 NFT 트랜잭션을 만들고 Phantom으로 최종 승인합니다.</p>
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
          <div><strong>{name}</strong><span>{description}</span></div>
        </article>
        <article className="card formCard">
          <h2>2. NFT 정보</h2>
          <label>NFT 이름<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>설명<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="balance"><span>Devnet 잔액</span><strong>{balance === null ? '-' : `${balance.toFixed(4)} SOL`}</strong></div>
          <button onClick={() => refreshBalance()} disabled={!wallet || busy}>잔액 새로고침</button>
          <button onClick={copyWallet} disabled={!wallet || busy}>지갑 주소 복사</button>
        </article>
      </section>

      <section className="card actions">
        <h2>3. NFT 발행</h2>
        <p>메타데이터는 GitHub Pages에 저장되고, 민팅 비용은 연결한 Devnet 지갑에서 지불합니다.</p>
        <button className="primary" onClick={mintNft} disabled={!wallet || busy || (balance ?? 0) <= 0}>
          {busy ? '처리 중…' : 'NFT 발행 승인'}
        </button>
        <div className="status">{status}</div>
        {explorerUrl && <a className="explorer" href={explorerUrl} target="_blank" rel="noreferrer">Solana Explorer에서 NFT 확인</a>}
      </section>

      <section className="notice">
        <strong>보안</strong><p>복구 문구와 개인키는 입력하지 않습니다. 모든 서명은 Phantom에서 직접 확인합니다.</p>
        <strong>권리</strong><p>현재 이미지는 Devnet 기술 테스트용입니다. 상업 유통 전에는 이미지와 캐릭터 권리를 확인해야 합니다.</p>
      </section>
    </main>
  );
}
