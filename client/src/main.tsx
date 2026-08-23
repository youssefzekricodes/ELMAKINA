import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/oswald';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles.css';
import App from './App';

// Keep the last runtime errors reachable for debugging (window.__mekinaErrors) and show a readable fallback.
const errs: string[] = ((window as any).__mekinaErrors = []);
const push = (e: any) => { errs.push(String((e && (e.stack || e.message)) || e)); };
window.addEventListener('error', (e) => push(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => push(e.reason));

class Boundary extends React.Component<{ children: React.ReactNode }, { err: any }> {
  state = { err: null as any };
  static getDerivedStateFromError(err: any) { return { err }; }
  componentDidCatch(err: any) { push(err); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui', color: '#fff', background: '#18181b', minHeight: '100vh' }}>
          <h2 style={{ margin: 0 }}>ELMAKINA — something broke in the UI</h2>
          <p>Reload the page. If it keeps happening, copy this and report it:</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, opacity: 0.8 }}>{String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err))}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>,
);
