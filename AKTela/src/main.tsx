import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import './style.css';

const CLIENT_ID = '1545406549105713182';
const discordSdk = new DiscordSDK(CLIENT_ID);

function App() {
  const [status, setStatus] = React.useState('Conectando ao Discord...');
  const [insideDiscord, setInsideDiscord] = React.useState(false);

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
    };
  }, []);

  return (
    <main className="page">
      <section className="card">
        <div className="logo">AK</div>
        <h1>AKTela</h1>
        <p className="subtitle">Activity de compartilhamento</p>

        <div className={`status ${insideDiscord ? 'ok' : ''}`}>
          <span className="dot" />
          {status}
        </div>

        <button type="button" disabled>
          Compartilhar tela
        </button>

        <small>
          Primeira versão: validação da Activity e integração com o Discord.
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
