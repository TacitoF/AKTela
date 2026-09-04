import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';
import './style.css';

const CLIENT_ID = '1545406549105713182';
const RELAY_TARGET = 'aktela-relay.tacito1-filho.workers.dev';
const DIRECT_RELAY = `wss://${RELAY_TARGET}/ws`;
const TEXT_MEDIA_PREFIX = '@media:';
const PROTOCOL_MAGIC = [65, 75, 86, 52]; // AKV4
const HEADER = 24;
if (location.hostname.endsWith('discordsays.com')) {
  patchUrlMappings([{ prefix: '/relay', target: RELAY_TARGET }]);
}

const discordSdk = new DiscordSDK(CLIENT_ID);

type StreamConfig = {
  type: 'stream-config';
  protocol: 4;
  videoCodec?: string;
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
  // patchUrlMappings reescreve o domínio externo para /relay dentro do Discord.
  // O viewer pede transporte textual porque esse caminho é o mais consistente
  // através do proxy da Activity. Fora do Discord a URL direta continua válida.
  return `${DIRECT_RELAY}?role=viewer&room=${encodeURIComponent(room)}&transport=text`;
}

function base64ToArrayBuffer(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function startCodeLength(data: Uint8Array, i: number) {
  if (i + 3 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) return 4;
  if (i + 2 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) return 3;
  return 0;
}

function codecFromAnnexB(data: Uint8Array) {
  for (let i = 0; i + 7 < data.length; i++) {
    const sc = startCodeLength(data, i);
    if (!sc) continue;
    const nal = i + sc;
    if ((data[nal] & 0x1f) !== 7 || nal + 3 >= data.length) continue;
    const hex = (v: number) => v.toString(16).padStart(2, '0').toUpperCase();
    return `avc1.${hex(data[nal + 1])}${hex(data[nal + 2])}${hex(data[nal + 3])}`;
  }
  return null;
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
  const playerRef = React.useRef<HTMLDivElement>(null);
  const videoPlaneRef = React.useRef<HTMLDivElement>(null);
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
  const configRef = React.useRef<StreamConfig | null>(null);
  const videoCodecRef = React.useRef('');
  const videoPacketCount = React.useRef(0);

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
  const [videoPackets, setVideoPackets] = React.useState(0);

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

  const configureVideo = React.useCallback(async (cfg: StreamConfig, codec: string) => {
    try { videoDecoder.current?.close?.(); } catch { }
    videoDecoder.current = null;
    videoCodecRef.current = '';

    const VideoDecoderCtor = (window as any).VideoDecoder;
    if (!VideoDecoderCtor) {
      setError('O cliente do Discord não oferece WebCodecs H.264 nesta plataforma.');
      return false;
    }

    const candidates = [
      {
        codec,
        codedWidth: cfg.width,
        codedHeight: cfg.height,
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware'
      },
      {
        codec,
        codedWidth: cfg.width,
        codedHeight: cfg.height,
        optimizeForLatency: true
      },
      {
        codec,
        codedWidth: cfg.width,
        codedHeight: cfg.height,
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-software'
      }
    ];

    let supportedConfig: any = null;
    for (const candidate of candidates) {
      try {
        if (typeof VideoDecoderCtor.isConfigSupported === 'function') {
          const support = await VideoDecoderCtor.isConfigSupported(candidate);
          if (support?.supported) {
            supportedConfig = support.config ?? candidate;
            break;
          }
        } else {
          supportedConfig = candidate;
          break;
        }
      } catch { }
    }

    if (!supportedConfig) {
      setError(`Este cliente do Discord não suporta o perfil H.264 recebido (${codec}). O Capture tentará um perfil mais compatível na próxima transmissão.`);
      return false;
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
            setError('');
          }
          frame.close();
        };
        const wait = Math.max(0, due - performance.now());
        wait > 3 ? window.setTimeout(draw, Math.min(wait, 90)) : draw();
      },
      error: (e: any) => {
        waitForKeyframe.current = true;
        setHasVideo(false);
        setError(`Falha ao decodificar H.264 (${codec}): ${e?.message ?? e}`);
        try { videoDecoder.current?.close?.(); } catch { }
        videoDecoder.current = null;
        videoCodecRef.current = '';
      }
    });

    try {
      decoder.configure(supportedConfig);
      videoDecoder.current = decoder;
      videoCodecRef.current = codec;
      waitForKeyframe.current = true;
      return true;
    } catch (e: any) {
      try { decoder.close(); } catch { }
      setError(`H.264 não suportado pelo cliente (${codec}): ${e?.message ?? e}`);
      return false;
    }
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

  const processMediaPacket = React.useCallback(async (ab: ArrayBuffer) => {
    try {
      if (ab.byteLength < HEADER) return;
      const dv = new DataView(ab);
      for (let i = 0; i < PROTOCOL_MAGIC.length; i++) {
        if (dv.getUint8(i) !== PROTOCOL_MAGIC[i]) return;
      }

      const kind = dv.getUint8(5);
      const key = (dv.getUint8(6) & 1) !== 0;
      const lo = dv.getUint32(8, true);
      const hi = dv.getInt32(12, true);
      const ts = hi * 4294967296 + lo;
      const duration = dv.getInt32(16, true);
      const len = dv.getInt32(20, true);
      if (len < 0 || HEADER + len > ab.byteLength) return;

      const payload = new Uint8Array(ab, HEADER, len);
      ensureTimeline(ts);

      if (kind === 1) {
        videoPacketCount.current++;
        if (videoPacketCount.current === 1) setVideoPackets(1);
        const cfg = configRef.current;
        if (!cfg) return;

        if (waitForKeyframe.current && !key) return;

        if (key) {
          const detectedCodec = codecFromAnnexB(payload);
          if (!detectedCodec) {
            setError('Recebi vídeo, mas o quadro-chave chegou sem SPS. Aguardando o próximo quadro-chave.');
            waitForKeyframe.current = true;
            return;
          }

          if (videoDecoder.current?.state !== 'configured' || videoCodecRef.current !== detectedCodec) {
            if (!await configureVideo(cfg, detectedCodec)) return;
          }
          waitForKeyframe.current = false;
        }

        if (videoDecoder.current?.state !== 'configured') return;
        if (videoDecoder.current.decodeQueueSize > 3 && !key) return;

        const C = (window as any).EncodedVideoChunk;
        if (!C) {
          setError('EncodedVideoChunk não está disponível neste cliente do Discord.');
          return;
        }

        videoDecoder.current.decode(new C({
          type: key ? 'key' : 'delta',
          timestamp: ts,
          duration,
          data: payload
        }));
        setLive(true);
        return;
      }

      if (kind === 2 && audioDecoder.current?.state === 'configured') {
        if (audioDecoder.current.decodeQueueSize > 8) return;
        const C = (window as any).EncodedAudioChunk;
        if (!C) return;
        audioDecoder.current.decode(new C({ type: 'key', timestamp: ts, duration, data: payload }));
      }
    } catch (e: any) {
      waitForKeyframe.current = true;
      setHasVideo(false);
      setError(`Falha ao processar pacote de mídia: ${e?.message ?? e}`);
    }
  }, [configureVideo, ensureTimeline]);

  React.useEffect(() => {
    let disposed = false;
    let reconnectAttempt = 0;

    const connect = () => {
      if (disposed) return;
      const url = viewerRelayUrl(room);
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
        setRelayConnected(true);
        setError('');
        ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          if (event.data.startsWith(TEXT_MEDIA_PREFIX)) {
            try {
              void processMediaPacket(base64ToArrayBuffer(event.data.slice(TEXT_MEDIA_PREFIX.length)));
            } catch (e: any) {
              setError(`Falha ao reconstruir vídeo recebido: ${e?.message ?? e}`);
            }
            return;
          }

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
              configRef.current = m;
              setConfig(m);
              setHasVideo(false);
              resetTimeline();
              try { videoDecoder.current?.close?.(); } catch { }
              videoDecoder.current = null;
              videoCodecRef.current = '';
              videoPacketCount.current = 0;
              setVideoPackets(0);
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

        // Compatibilidade: fora do Discord o relay ainda pode enviar mídia binária.
        if (event.data instanceof ArrayBuffer) {
          void processMediaPacket(event.data);
        } else if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then(ab => processMediaPacket(ab)).catch(() => setError('Falha ao ler pacote binário do relay.'));
        } else if (ArrayBuffer.isView(event.data)) {
          const view = event.data as ArrayBufferView;
          void processMediaPacket(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer);
        }
      };

      ws.onclose = (ev) => {
        setRelayConnected(false);
        setLive(false);
        if (!disposed) {
          if (ev.code === 1006 && location.hostname.endsWith('discordsays.com')) {
            setError('A conexão com o relay caiu. Reconectando automaticamente.');
          }
          const delay = Math.min(4000, 600 * Math.pow(1.6, reconnectAttempt++));
          reconnectTimer.current = window.setTimeout(connect, delay);
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
  }, [room, configureAudio, processMediaPacket, resetTimeline]);

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

  const enterImmersive = React.useCallback(() => {
    setFit('contain');
    setImmersive(true);
  }, []);

  const toggleImmersive = React.useCallback(() => {
    if (!immersive) setFit('contain');
    setImmersive(v => !v);
  }, [immersive]);

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

  React.useEffect(() => {
    const player = playerRef.current;
    const plane = videoPlaneRef.current;
    if (!player || !plane) return;

    const update = () => {
      const rect = player.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const sourceW = Math.max(1, config?.width ?? 16);
      const sourceH = Math.max(1, config?.height ?? 9);
      const aspect = sourceW / sourceH;
      const containerAspect = rect.width / rect.height;

      let width: number;
      let height: number;

      if (fit === 'contain') {
        if (containerAspect > aspect) {
          height = rect.height;
          width = height * aspect;
        } else {
          width = rect.width;
          height = width / aspect;
        }
      } else {
        if (containerAspect > aspect) {
          width = rect.width;
          height = width / aspect;
        } else {
          height = rect.height;
          width = height * aspect;
        }
      }

      plane.style.width = `${Math.ceil(width)}px`;
      plane.style.height = `${Math.ceil(height)}px`;
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(player);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [config?.width, config?.height, fit, immersive]);

  const status = !discordReady ? 'Conectando ao Discord' : !relayConnected ? 'Reconectando ao relay' : live ? 'Ao vivo' : 'Aguardando Capture';
  const health = !relayConnected ? 'Offline' : latency === 0 ? 'Conectando' : latency < 120 ? 'Excelente' : latency < 260 ? 'Boa' : latency < 450 ? 'Alta latência' : 'Instável';
  const quality = config ? `${config.height >= 1080 ? '1080p' : '720p'} · ${config.fps} FPS` : '—';

  return <main className="page"><section className={`shell ${immersive ? 'immersive' : ''}`}>
    <header className="topbar">
      <div className="brand"><div className="logo">AK</div><div><h1>AKTela</h1><p>Compartilhamento em baixa latência</p></div></div>
      <div className={`connection ${relayConnected ? 'ok' : ''}`}><span className="dot"/><span>{status}</span></div>
    </header>

    <div ref={playerRef} className={`player ${immersive && hud ? 'hud-visible' : ''}`} onDoubleClick={toggleImmersive} onPointerMove={showHud}>
      <div className={`surface ${fit}`}>
        <div ref={videoPlaneRef} className="video-plane">
          <canvas ref={canvasRef} className={hasVideo ? 'frame visible' : 'frame'} width={config?.width ?? 1280} height={config?.height ?? 720}/>
          <div ref={cursorRef} className="remote-cursor" style={{ display: 'none' }}><svg viewBox="0 0 32 32"><path d="M4 2.5v24.2l6.35-5.95 4.45 9.35 4.3-2.05-4.35-9.1h8.95L4 2.5Z"/></svg></div>
        </div>
      </div>

      {!hasVideo && <div className="empty-state"><div className="empty-icon"><Icon name="monitor"/></div><h2>{live ? (videoPackets > 0 ? 'Preparando o primeiro quadro' : 'Aguardando vídeo do Capture') : 'Pronto para receber uma transmissão'}</h2><p>{live ? (videoPackets > 0 ? 'Os dados de vídeo já chegaram. O decoder está sincronizando o quadro-chave.' : 'A conexão e a sala estão ativas; aguardando o primeiro pacote de mídia.') : 'Abra o AKTela Capture, use o código abaixo e inicie o compartilhamento.'}</p></div>}

      {!immersive && <>
        <div className="live-badge"><span className={`live-dot ${live ? 'active' : ''}`}/>{live ? 'AO VIVO' : 'AGUARDANDO'}</div>
        <div className="stream-meta"><span>{quality}</span>{config?.audioEnabled && <span>Áudio</span>}<span>{latency ? `${latency} ms` : '— ms'}</span></div>
        <div className="player-controls">
          <div className="control-left">{config?.audioEnabled && <>
            <button className="icon-button" onClick={async () => { if (!audioReady) await ensureAudio(); setMuted(v => !v); }}><Icon name={muted ? 'mute' : 'volume'}/></button>
            <input className="volume" type="range" min="0" max="100" value={muted ? 0 : volume} onPointerDown={() => { if (!audioReady) void ensureAudio(); }} onChange={e => { setMuted(false); setVolume(Number(e.target.value)); }}/>
            <span className="volume-value">{muted ? 0 : volume}%</span>
          </>}</div>
          <div className="control-right"><button className="text-button" onClick={() => setFit(v => v === 'contain' ? 'cover' : 'contain')}><Icon name="fit"/><span>{fit === 'contain' ? 'Ajustar' : 'Preencher'}</span></button><button className="icon-button" onClick={enterImmersive}><Icon name="fullscreen"/></button></div>
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
