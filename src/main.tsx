import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import './style.css';

const CLIENT_ID = '1545406549105713182';
const discordSdk = new DiscordSDK(CLIENT_ID);

function roomCodeFromInstanceId(instanceId: string) {
  let hash = 2166136261;
  for (let i = 0; i < instanceId.length; i += 1) {
    hash ^= instanceId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = hash >>> 0;
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length) ^ ((hash >>> (i + 1)) & 0xffff);
    value >>>= 0;
  }
  return code;
}

function makeRelayUrl(room: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws?role=viewer&room=${encodeURIComponent(room)}`;
}

type RelayMessage =
  | { type: 'status'; live: boolean }
  | { type: 'viewer-count'; count: number }
  | { type: 'pong' }
  | { type: 'error'; message: string };

function App() {
  const imageRef = React.useRef<HTMLImageElement>(null);
  const objectUrlRef = React.useRef<string | null>(null);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const socketRef = React.useRef<WebSocket | null>(null);

  const roomCode = React.useMemo(() => roomCodeFromInstanceId(discordSdk.instanceId), []);
  const [discordReady, setDiscordReady] = React.useState(false);
  const [relayConnected, setRelayConnected] = React.useState(false);
  const [live, setLive] = React.useState(false);
  const [viewerCount, setViewerCount] = React.useState(0);
  const [hasFrame, setHasFrame] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    discordSdk.ready()
      .then(() => active && setDiscordReady(true))
      .catch(() => active && setDiscordReady(false));
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(makeRelayUrl(roomCode));
      ws.binaryType = 'arraybuffer';
      socketRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setRelayConnected(true);
      };

      ws.onmessage = (event) => {
        if (disposed) return;

        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data) as RelayMessage;
            if (message.type === 'status') {
              setLive(message.live);
              if (!message.live) setHasFrame(false);
            } else if (message.type === 'viewer-count') {
              setViewerCount(message.count);
            }
          } catch {
            // Mensagem de controle inválida: ignora e mantém a transmissão.
          }
          return;
        }

        const blob = new Blob([event.data], { type: 'image/jpeg' });
        const nextUrl = URL.createObjectURL(blob);
        if (imageRef.current) imageRef.current.src = nextUrl;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = nextUrl;
        setHasFrame(true);
        setLive(true);
      };

      ws.onclose = () => {
        if (disposed) return;
        setRelayConnected(false);
        reconnectTimerRef.current = window.setTimeout(connect, 1200);
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* noop */ }
      };
    };

    connect();

    const heartbeat = window.setInterval(() => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20000);

    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      try { socketRef.current?.close(); } catch { /* noop */ }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [roomCode]);

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const statusText = !discordReady
    ? 'Conectando ao Discord…'
    : !relayConnected
      ? 'Conectando ao servidor…'
      : live
        ? 'Transmissão ao vivo'
        : 'Aguardando o AKTela Capture';

  return (
    <main className="page">
      <section className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="logo">AK</div>
            <div>
              <h1>AKTela</h1>
              <p>Compartilhamento dentro do Discord</p>
            </div>
          </div>
          <div className={`connection ${relayConnected ? 'ok' : ''}`}>
            <span className="dot" /> {statusText}
          </div>
        </header>

        <div className="player">
          <img ref={imageRef} className={hasFrame ? 'frame visible' : 'frame'} alt="Tela compartilhada" />
          {!hasFrame && (
            <div className="empty-state">
              <div className="empty-icon">▣</div>
              <h2>{live ? 'Recebendo transmissão…' : 'Nenhuma tela sendo compartilhada'}</h2>
              <p>Abra o AKTela Capture, informe o código abaixo e clique em “Ligar compartilhamento”.</p>
            </div>
          )}
        </div>

        <footer className="bottom">
          <div className="pair-card">
            <div>
              <span className="eyebrow">Código do Capture</span>
              <strong>{roomCode}</strong>
            </div>
            <button type="button" onClick={copyRoomCode}>{copied ? 'Copiado' : 'Copiar código'}</button>
          </div>
          <div className="viewer-pill">{Math.max(viewerCount, 1)} na Activity</div>
        </footer>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
