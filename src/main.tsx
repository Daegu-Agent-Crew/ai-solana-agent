import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import './styles.css';

type GlobalWithNodePolyfills = typeof globalThis & {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
  process?: { env: Record<string, string> };
};

const browserGlobal = globalThis as GlobalWithNodePolyfills;
browserGlobal.Buffer = Buffer;
browserGlobal.global = globalThis;
browserGlobal.process = browserGlobal.process || { env: {} };
browserGlobal.process.env = browserGlobal.process.env || {};
browserGlobal.process.env.NODE_ENV = 'production';

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
        </main>
      );
    }
    return this.props.children;
  }
}

async function bootstrap() {
  try {
    const { default: App } = await import('./App');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '앱 초기화 실패';
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <main style={{ maxWidth: 720, margin: '40px auto', padding: 24, fontFamily: 'system-ui', color: '#fff', background: '#111827', borderRadius: 16 }}>
        <h1>앱 초기화 오류</h1>
        <p>{message}</p>
      </main>,
    );
  }
}

void bootstrap();
