import { useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, percentAmount } from '@metaplex-foundation/umi';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { createNft, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';

const METADATA_URI = 'https://daegu-agent-crew.github.io/ai-solana-agent/metadata/doctor-slump-001.json';

export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [name, setName] = useState('닥터슬럼프 #001');
  const [description, setDescription] = useState('사막 디오라마를 배경으로 한 AI 팬아트 스타일 컬렉터 이미지. Solana Devnet 검증용 NFT입니다.');
  const [status, setStatus] = useState('Phantom을 연결하세요.');
  const [busy, setBusy] = useState(false);
  const [mintAddress, setMintAddress] = useState('');

  const explorerUrl = useMemo(
    () => mintAddress ? `https://explorer.solana.com/address/${mintAddress}?cluster=devnet` : '',
    [mintAddress],
  );

  async function refreshBalance() {
    if (!wallet.publicKey) return;
    const lamports = await connection.getBalance(wallet.publicKey, 'confirmed');
    setBalance(lamports / 1_000_000_000);
  }

  useEffect(() => {
    if (wallet.connected && wallet.publicKey) {
      refreshBalance().catch(() => setStatus('Devnet 잔액을 불러오지 못했습니다.'));
      setStatus('Phantom 연결 완료. Devnet SOL 잔액을 확인하세요.');
    } else {
      setBalance(null);
    }
  }, [wallet.connected, wallet.publicKey]);

  async function requestAirdrop() {
    if (!wallet.publicKey) return;
    try {
      setBusy(true);
      setStatus('Solana Devnet에서 1 SOL 에어드롭을 요청합니다…');
      const signature = await connection.requestAirdrop(wallet.publicKey, 1_000_000_000);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
      await refreshBalance();
      setStatus('Devnet SOL 지급 완료. 이제 NFT를 발행할 수 있습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '에어드롭 실패';
      setStatus(`에어드롭 실패: ${message}. 잠시 후 다시 시도하거나 공식 Faucet을 사용하세요.`);
    } finally {
      setBusy(false);
    }
  }

  async function mintNft() {
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      setStatus('먼저 Phantom을 연결하세요.');
      return;
    }
    if ((balance ?? 0) <= 0) {
      setStatus('Devnet SOL이 필요합니다. 먼저 에어드롭을 받으세요.');
      return;
    }

    try {
      setBusy(true);
      setStatus('Phantom에서 NFT 발행을 승인하세요…');

      const umi = createUmi('https://api.devnet.solana.com')
        .use(mplTokenMetadata())
        .use(walletAdapterIdentity(wallet));

      const mint = generateSigner(umi);
      await createNft(umi, {
        mint,
        name: name.trim() || 'AI Solana NFT #001',
        uri: METADATA_URI,
        sellerFeeBasisPoints: percentAmount(0),
      }).sendAndConfirm(umi);

      setMintAddress(mint.publicKey.toString());
      await refreshBalance();
      setStatus(`NFT 발행 완료: ${mint.publicKey.toString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'NFT 발행 실패';
      setStatus(`NFT 발행 실패: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <span className="badge">Solana Devnet · Phantom</span>
        <h1>AI Solana NFT Agent</h1>
        <p>AI가 NFT 정보를 준비하고, 사용자는 Phantom에서 최종 승인만 합니다.</p>
      </header>

      <section className="card walletRow">
        <div>
          <h2>1. Phantom 연결</h2>
          <p>{wallet.publicKey ? wallet.publicKey.toBase58() : 'Phantom 앱 브라우저에서 여는 것이 가장 안정적입니다.'}</p>
        </div>
        <WalletMultiButton />
      </section>

      <section className="grid">
        <article className="card preview">
          <img src="./nft-image.svg" alt="NFT preview" />
          <div><strong>{name}</strong><span>{description}</span></div>
        </article>
        <article className="card formCard">
          <h2>2. NFT 정보</h2>
          <label>NFT 이름<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>설명<textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <div className="balance"><span>Devnet 잔액</span><strong>{balance === null ? '-' : `${balance.toFixed(4)} SOL`}</strong></div>
          <button onClick={requestAirdrop} disabled={!wallet.connected || busy}>1 SOL 테스트 에어드롭</button>
        </article>
      </section>

      <section className="card actions">
        <h2>3. NFT 발행</h2>
        <p>메타데이터는 GitHub Pages에 저장되며, Phantom 승인 후 Metaplex NFT가 생성됩니다.</p>
        <button className="primary" onClick={mintNft} disabled={!wallet.connected || busy}>NFT 발행 승인</button>
        <div className="status">{status}</div>
        {explorerUrl && <a className="explorer" href={explorerUrl} target="_blank" rel="noreferrer">Solana Explorer에서 NFT 확인</a>}
      </section>

      <section className="notice">
        <strong>보안</strong><p>복구 문구와 개인키는 어디에도 입력하지 않습니다. 모든 서명은 Phantom에서 직접 확인합니다.</p>
        <strong>권리</strong><p>현재 이미지는 테스트넷 검증용입니다. 상업 유통 전에는 이미지와 캐릭터 권리를 확인해야 합니다.</p>
      </section>
    </main>
  );
}
