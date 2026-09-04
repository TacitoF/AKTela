import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import './style.css';

const CLIENT_ID = '1545406549105713182';
const discordSdk = new DiscordSDK(CLIENT_ID);

function App() {
  const [status, setStatus] = React.useState('Conectando ao Discord...');
  const [insideDiscord, setInsideDiscord] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  React.useEffect(() => {
    let active = true;

    discordSdk.ready()
      .then(() => {
        if (!active) return;
        setInsideDiscord(true);
        setStatus('Activity conectada ao Discord');
      })
      .catch(() => {
        if (!active) return;
        setStatus('Abra este aplicativo como uma Activity dentro do Discord.');
      });

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startCapture() {
    setError(null);

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('A captura de tela não está disponível neste ambiente.');
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setSharing(true);
      setStatus('Captura de tela iniciada');

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener('ended', stopCapture, { once: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao iniciar a captura de tela.';
      setError(message);
      setStatus('Captura não iniciada');
    }
  }

  function stopCapture() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setSharing(false);
    setStatus('Activity conectada ao Discord');
  }

  return (
    <main className="page">
      <section className="card">
        <div className="logo">AK</div>
        <h1>AKTela</h1>
        <p className="subtitle">Teste de captura dentro da Activity</p>

        <div className={`status ${insideDiscord ? 'ok' : ''}`}>
          <span className="dot" />
          {status}
        </div>

        {sharing && (
          <div className="preview-wrap">
            <video ref={videoRef} autoPlay muted playsInline />
          </div>
        )}

        {error && <div className="error">{error}</div>}

        {!sharing ? (
          <button type="button" onClick={startCapture} disabled={!insideDiscord}>
            Compartilhar tela
          </button>
        ) : (
          <button type="button" className="danger" onClick={stopCapture}>
            Parar compartilhamento
          </button>
        )}

        <small>
          Este teste verifica se o cliente do Discord permite que a Activity capture a tela.
        </small>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
