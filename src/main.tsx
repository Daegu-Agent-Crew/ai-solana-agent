import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
