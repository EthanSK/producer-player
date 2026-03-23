import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 32,
            color: '#ff6b6b',
            backgroundColor: '#0a0f14',
            fontFamily: 'monospace',
            fontSize: 14,
            whiteSpace: 'pre-wrap',
            height: '100vh',
            overflow: 'auto',
          }}
        >
          <h2 style={{ color: '#ff6b6b', marginTop: 0 }}>Renderer crashed</h2>
          <p>{this.state.error.message}</p>
          <pre style={{ color: '#888', fontSize: 12 }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Could not find #root element');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
