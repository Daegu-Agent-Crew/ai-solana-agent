import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';
import App from './App';
import './styles.css';

globalThis.Buffer = Buffer;
(globalThis as typeof globalThis & { global?: typeof globalThis }).global = globalThis;

class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: string }> {
  state = { error: '' };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || '알 수 없는 실행 오류' };
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ maxWidth: 720, margin: '40px auto', padding: 24, fontFamily: 'system-ui', color: '#fff', background: '#111827', borderRadius: 16 }}>
          <h1>앱 실행 오류</h1>
          <p>{this.state.error}</p>
          <p>페이지를 새로고침한 뒤에도 반복되면 이 화면을 캡처해 주세요.</p>
        </main>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const endpoint = 'https://api.devnet.solana.com';
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
