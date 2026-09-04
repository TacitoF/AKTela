import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import './style.css';

const CLIENT_ID = '1545406549105713182';
const DIRECT_RELAY = 'wss://aktela-relay.tacito1-filho.workers.dev/ws';
const PROTOCOL_MAGIC = [65, 75, 86, 52]; // AKV4
const HEADER = 24;
const discordSdk = new DiscordSDK(CLIENT_ID);

type StreamConfig = {
  type: 'stream-config';
  protocol: 4;
  videoCodec: string;
  width: number;
  height: number;
  fps: number;
  audioEnabled: boolean;
  audioSampleRate: number;
  audioChannels: number;
  preset: string;
};

type RelayControl =
  | { type: 'hello'; role: string; protocol: number }
  | { type: 'status'; live: boolean }
  | { type: 'viewer-count'; count: number }
  | { type: 'pong'; sentAt: number }
  | { type: 'error'; message: string }
  | { type: 'cursor'; x: number; y: number; visible: boolean; w?: number; h?: number; hx?: number; hy?: number }
  | StreamConfig;

function roomCode(instanceId: string) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < instanceId.length; i++) {
    hash ^= instanceId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let x = hash;
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[x % alphabet.length];
    x = (Math.floor(x / alphabet.length) ^ (hash >>> (i + 1))) >>> 0;
  }
  return out;
}

function viewerRelayUrl(room: string) {
  // Dentro do Discord, todo tráfego externo precisa passar pelo proxy/URL Mapping.
  if (location.hostname.endsWith('discordsays.com')) {
    return `wss://${location.host}/relay/ws?role=viewer&room=${encodeURIComponent(room)}`;
  }
  // Facilita testes fora do iframe do Discord.
  return `${DIRECT_RELAY}?role=viewer&room=${encodeURIComponent(room)}`;
}

function Icon({ name }: { name: 'volume' | 'mute' | 'fullscreen' | 'copy' | 'fit' | 'monitor' }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'volume') return <svg {...p}><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.8 6.5a8 8 0 0 1 0 11"/></svg>;
  if (name === 'mute') return <svg {...p}><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 9 5 5M21 9l-5 5"/></svg>;
  if (name === 'fullscreen') return <svg {...p}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>;
  if (name === 'copy') return <svg {...p}><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>;
  if (name === 'fit') return <svg {...p}><path d="M8 5H5v3M16 5h3v3M8 19H5v-3M16 19h3v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>;
  return <svg {...p}><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
}

function App() {
  const room = React.useMemo(() => roomCode(discordSdk.instanceId), []);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const cursorRef = React.useRef<HTMLDivElement>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectTimer = React.useRef<number | null>(null);
  const videoDecoder = React.useRef<any>(null);
  const audioDecoder = React.useRef<any>(null);
  const audioContext = React.useRef<AudioContext | null>(null);
  const gainNode = React.useRef<GainNode | null>(null);
  const mediaBaseUs = React.useRef<number | null>(null);
  const perfBaseMs = React.useRef(0);
  const audioBaseSec = React.useRef(0);
  const waitForKeyframe = React.useRef(true);

  const [discordReady, setDiscordReady] = React.useState(false);
  const [relayConnected, setRelayConnected] = React.useState(false);
  const [live, setLive] = React.useState(false);
  const [hasVideo, setHasVideo] = React.useState(false);
  const [viewers, setViewers] = React.useState(0);
  const [latency, setLatency] = React.useState(0);
  const [error, setError] = React.useState('');
  const [config, setConfig] = React.useState<StreamConfig | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [fit, setFit] = React.useState<'contain' | 'cover'>('contain');
  const [immersive, setImmersive] = React.useState(false);
  const [hud, setHud] = React.useState(true);
  const hudTimer = React.useRef<number | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [volume, setVolume] = React.useState(() => Number(localStorage.getItem('aktela-volume') ?? '80'));
  const [audioReady, setAudioReady] = React.useState(false);

  const resetTimeline = React.useCallback(() => {
    mediaBaseUs.current = null;
    perfBaseMs.current = 0;
    audioBaseSec.current = 0;
    waitForKeyframe.current = true;
  }, []);

  const ensureTimeline = React.useCallback((ts: number) => {
    if (mediaBaseUs.current !== null) return;
    mediaBaseUs.current = ts;
    perfBaseMs.current = performance.now() + 45;
    audioBaseSec.current = (audioContext.current?.currentTime ?? 0) + 0.045;
  }, []);

  const configureVideo = React.useCallback((cfg: StreamConfig) => {
    try { videoDecoder.current?.close?.(); } catch { }
    const VideoDecoderCtor = (window as any).VideoDecoder;
    if (!VideoDecoderCtor) {
      setError('O cliente do Discord não oferece WebCodecs H.264 nesta plataforma.');
      return;
    }
    const decoder = new VideoDecoderCtor({
      output: (frame: any) => {
        const ts = Number(frame.timestamp ?? 0);
        ensureTimeline(ts);
        const due = perfBaseMs.current + (ts - (mediaBaseUs.current ?? ts)) / 1000;
        const draw = () => {
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== cfg.width || canvas.height !== cfg.height) {
              canvas.width = cfg.width;
              canvas.height = cfg.height;
              canvasCtxRef.current = null;
            }
            const ctx = canvasCtxRef.current ?? canvas.getContext('2d', { alpha: false, desynchronized: true });
            canvasCtxRef.current = ctx;
            ctx?.drawImage(frame, 0, 0, canvas.width, canvas.height);
            setHasVideo(true);
          }
          frame.close();
        };
        const wait = Math.max(0, due - performance.now());
        wait > 3 ? window.setTimeout(draw, Math.min(wait, 90)) : draw();
      },
      error: (e: any) => {
        waitForKeyframe.current = true;
        setError(`Falha no decoder de vídeo: ${e?.message ?? e}`);
      }
    });
    decoder.configure({
      codec: cfg.videoCodec,
      codedWidth: cfg.width,
      codedHeight: cfg.height,
      optimizeForLatency: true,
      hardwareAcceleration: 'prefer-hardware'
    });
    videoDecoder.current = decoder;
    waitForKeyframe.current = true;
  }, [ensureTimeline]);

  const ensureAudio = React.useCallback(async () => {
    let ac = audioContext.current;
    if (!ac) {
      ac = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      audioContext.current = ac;
    }
    let gain = gainNode.current;
    if (!gain) {
      gain = ac.createGain();
      gain.connect(ac.destination);
      gainNode.current = gain;
    }
    gain.gain.value = muted ? 0 : Math.max(0, Math.min(1, volume / 100));
    await ac.resume();
    setAudioReady(ac.state === 'running');
  }, [muted, volume]);

  const configureAudio = React.useCallback((cfg: StreamConfig) => {
    try { audioDecoder.current?.close?.(); } catch { }
    if (!cfg.audioEnabled) return;
    const AudioDecoderCtor = (window as any).AudioDecoder;
    if (!AudioDecoderCtor) return;
    const decoder = new AudioDecoderCtor({
      output: (data: any) => {
        const ac = audioContext.current;
        const gain = gainNode.current;
        if (!ac || !gain || ac.state !== 'running') { data.close(); return; }
        const ts = Number(data.timestamp ?? 0);
        ensureTimeline(ts);
        const buffer = ac.createBuffer(data.numberOfChannels, data.numberOfFrames, data.sampleRate);
        for (let ch = 0; ch < data.numberOfChannels; ch++) {
          const channel = new Float32Array(data.numberOfFrames);
          try { data.copyTo(channel, { planeIndex: ch, format: 'f32-planar' }); }
          catch { data.close(); return; }
          buffer.copyToChannel(channel, ch);
        }
        const source = ac.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        let when = audioBaseSec.current + (ts - (mediaBaseUs.current ?? ts)) / 1_000_000;
        if (when < ac.currentTime + 0.006) when = ac.currentTime + 0.006;
        if (when > ac.currentTime + 0.16) {
          audioBaseSec.current -= when - (ac.currentTime + 0.045);
          when = ac.currentTime + 0.045;
        }
        source.start(when);
        data.close();
      },
      error: () => { }
    });
    decoder.configure({ codec: 'opus', sampleRate: cfg.audioSampleRate, numberOfChannels: cfg.audioChannels });
    audioDecoder.current = decoder;
  }, [ensureTimeline]);

  React.useEffect(() => {
    let active = true;
    discordSdk.ready().then(() => active && setDiscordReady(true)).catch(() => active && setDiscordReady(false));
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      const url = viewerRelayUrl(room);
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setRelayConnected(true);
        setError('');
        ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const m = JSON.parse(event.data) as RelayControl;
            if (m.type === 'status') {
              setLive(m.live);
              if (!m.live) { setHasVideo(false); resetTimeline(); }
            } else if (m.type === 'viewer-count') {
              setViewers(m.count);
            } else if (m.type === 'pong') {
              setLatency(Math.max(0, Date.now() - m.sentAt));
            } else if (m.type === 'stream-config') {
              setConfig(m);
              setHasVideo(false);
              resetTimeline();
              configureVideo(m);
              configureAudio(m);
            } else if (m.type === 'cursor') {
              const el = cursorRef.current;
              if (!el) return;
              const w = m.w ?? 0.016;
              const h = m.h ?? 0.028;
              el.style.display = m.visible ? 'block' : 'none';
              el.style.left = `${m.x * 100}%`;
              el.style.top = `${m.y * 100}%`;
              el.style.width = `${w * 100}%`;
              el.style.height = `${h * 100}%`;
              el.style.transform = `translate(-${(m.hx ?? 0.05) * 100}%,-${(m.hy ?? 0.05) * 100}%)`;
            } else if (m.type === 'error') {
              setError(m.message);
            }
          } catch { }
          return;
        }

        const ab = event.data as ArrayBuffer;
        if (ab.byteLength < HEADER) return;
        const dv = new DataView(ab);
        for (let i = 0; i < PROTOCOL_MAGIC.length; i++) if (dv.getUint8(i) !== PROTOCOL_MAGIC[i]) return;
        const kind = dv.getUint8(5);
        const key = (dv.getUint8(6) & 1) !== 0;
        const ts = Number(dv.getBigInt64(8, true));
        const duration = dv.getInt32(16, true);
        const len = dv.getInt32(20, true);
        if (len < 0 || HEADER + len > ab.byteLength) return;
        const payload = new Uint8Array(ab, HEADER, len);
        ensureTimeline(ts);

        try {
          if (kind === 1 && videoDecoder.current?.state === 'configured') {
            if (waitForKeyframe.current && !key) return;
            if (key) waitForKeyframe.current = false;
            if (videoDecoder.current.decodeQueueSize > 6 && !key) return;
            const C = (window as any).EncodedVideoChunk;
            videoDecoder.current.decode(new C({ type: key ? 'key' : 'delta', timestamp: ts, duration, data: payload }));
            setLive(true);
          } else if (kind === 2 && audioDecoder.current?.state === 'configured') {
            if (audioDecoder.current.decodeQueueSize > 8) return;
            const C = (window as any).EncodedAudioChunk;
            audioDecoder.current.decode(new C({ type: 'key', timestamp: ts, duration, data: payload }));
          }
        } catch {
          if (kind === 1) waitForKeyframe.current = true;
        }
      };

      ws.onclose = (ev) => {
        setRelayConnected(false);
        setLive(false);
        setHasVideo(false);
        if (!disposed) {
          if (ev.code === 1006 && location.hostname.endsWith('discordsays.com')) {
            setError('Não foi possível alcançar o relay. Confirme o URL Mapping /relay no Developer Portal.');
          }
          reconnectTimer.current = window.setTimeout(connect, 1200);
        }
      };
      ws.onerror = () => { try { ws.close(); } catch { } };
    };

    connect();
    const ping = window.setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
    }, 4000);

    return () => {
      disposed = true;
      window.clearInterval(ping);
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch { }
      try { videoDecoder.current?.close?.(); } catch { }
      try { audioDecoder.current?.close?.(); } catch { }
      try { audioContext.current?.close(); } catch { }
    };
  }, [room, configureVideo, configureAudio, ensureTimeline, resetTimeline]);

  React.useEffect(() => {
    localStorage.setItem('aktela-volume', String(volume));
    if (gainNode.current) gainNode.current.gain.value = muted ? 0 : volume / 100;
  }, [volume, muted]);

  const copy = async () => {
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1000); };
    try { await navigator.clipboard.writeText(room); done(); return; } catch { }
    const t = document.createElement('textarea');
    t.value = room; t.style.position = 'fixed'; t.style.left = '-9999px'; document.body.appendChild(t); t.select();
    try { if (document.execCommand('copy')) done(); } finally { t.remove(); }
  };

  const showHud = React.useCallback(() => {
    if (!immersive) return;
    setHud(true);
    if (hudTimer.current) window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(false), 1700);
  }, [immersive]);

  React.useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setImmersive(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const status = !discordReady ? 'Conectando ao Discord' : !relayConnected ? 'Reconectando ao relay' : live ? 'Ao vivo' : 'Aguardando Capture';
  const health = !relayConnected ? 'Offline' : latency === 0 ? 'Conectando' : latency < 90 ? 'Excelente' : latency < 160 ? 'Boa' : 'Instável';
  const quality = config ? `${config.height >= 1080 ? '1080p' : '720p'} · ${config.fps} FPS` : '—';

  return <main className="page"><section className={`shell ${immersive ? 'immersive' : ''}`}>
    <header className="topbar">
      <div className="brand"><div className="logo">AK</div><div><h1>AKTela</h1><p>Compartilhamento em baixa latência</p></div></div>
      <div className={`connection ${relayConnected ? 'ok' : ''}`}><span className="dot"/><span>{status}</span></div>
    </header>

    <div className={`player ${immersive && hud ? 'hud-visible' : ''}`} onDoubleClick={() => setImmersive(v => !v)} onPointerMove={showHud}>
      <div className={`surface ${fit}`} style={{ aspectRatio: `${config?.width ?? 16}/${config?.height ?? 9}` }}>
        <canvas ref={canvasRef} className={hasVideo ? 'frame visible' : 'frame'} width={config?.width ?? 1280} height={config?.height ?? 720}/>
        <div ref={cursorRef} className="remote-cursor" style={{ display: 'none' }}><svg viewBox="0 0 32 32"><path d="M4 2.5v24.2l6.35-5.95 4.45 9.35 4.3-2.05-4.35-9.1h8.95L4 2.5Z"/></svg></div>
      </div>

      {!hasVideo && <div className="empty-state"><div className="empty-icon"><Icon name="monitor"/></div><h2>{live ? 'Sincronizando vídeo' : 'Pronto para receber uma transmissão'}</h2><p>Abra o AKTela Capture, use o código abaixo e inicie o compartilhamento.</p></div>}

      {!immersive && <>
        <div className="live-badge"><span className={`live-dot ${live ? 'active' : ''}`}/>{live ? 'AO VIVO' : 'AGUARDANDO'}</div>
        <div className="stream-meta"><span>{quality}</span>{config?.audioEnabled && <span>Áudio</span>}<span>{latency ? `${latency} ms` : '— ms'}</span></div>
        <div className="player-controls">
          <div className="control-left">{config?.audioEnabled && <>
            <button className="icon-button" onClick={async () => { if (!audioReady) await ensureAudio(); setMuted(v => !v); }}><Icon name={muted ? 'mute' : 'volume'}/></button>
            <input className="volume" type="range" min="0" max="100" value={muted ? 0 : volume} onPointerDown={() => { if (!audioReady) void ensureAudio(); }} onChange={e => { setMuted(false); setVolume(Number(e.target.value)); }}/>
            <span className="volume-value">{muted ? 0 : volume}%</span>
          </>}</div>
          <div className="control-right"><button className="text-button" onClick={() => setFit(v => v === 'contain' ? 'cover' : 'contain')}><Icon name="fit"/><span>{fit === 'contain' ? 'Ajustar' : 'Preencher'}</span></button><button className="icon-button" onClick={() => setImmersive(true)}><Icon name="fullscreen"/></button></div>
        </div>
      </>}

      {immersive && <>
        <button className="immersive-exit" onClick={() => setImmersive(false)} aria-label="Sair da tela cheia"><Icon name="fullscreen"/></button>
        {config?.audioEnabled && <div className="immersive-volume"><button className="immersive-audio-button" onClick={async () => { if (!audioReady) await ensureAudio(); setMuted(v => !v); }}><Icon name={muted ? 'mute' : 'volume'}/></button><div className="immersive-volume-details"><input className="volume" type="range" min="0" max="100" value={muted ? 0 : volume} onPointerDown={() => { if (!audioReady) void ensureAudio(); }} onChange={e => { setMuted(false); setVolume(Number(e.target.value)); }}/><span>{muted ? 0 : volume}%</span></div></div>}
      </>}
    </div>

    {error && <div className="error"><span>{error}</span><button onClick={() => setError('')}>Fechar</button></div>}

    <footer className="bottom"><div className="pair-card"><div><span>Código do Capture</span><strong>{room}</strong></div><button onClick={copy}><Icon name="copy"/><span>{copied ? 'Copiado' : 'Copiar'}</span></button></div><div className="session-stats"><div><span>Conexão</span><strong>{health}</strong></div><div><span>Assistindo</span><strong>{viewers}</strong></div><div><span>Perfil</span><strong>{config?.preset ?? '—'}</strong></div></div></footer>
  </section></main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App/>);
