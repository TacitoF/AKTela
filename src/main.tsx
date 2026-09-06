import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk';
import './style.css';

const CLIENT_ID = '1545406549105713182';
const RELAY_TARGET = 'aktela-relay.tacito1-filho.workers.dev';
const DIRECT_RELAY = `wss://${RELAY_TARGET}/ws`;
const PROXIED_RELAY = `wss://${CLIENT_ID}.discordsays.com/relay/ws`;
const TEXT_MEDIA_PREFIX = '@media:';
const PROTOCOL_MAGIC = [65, 75, 86, 53]; // AKV5
const HEADER = 24;

if (location.hostname.endsWith('discordsays.com')) {
  patchUrlMappings([{ prefix: '/relay', target: RELAY_TARGET }]);
}

const discordSdk = new DiscordSDK(CLIENT_ID);

type ModeKey = '720p30' | '720p60' | '1080p30' | '1080p60';
type CapabilityToken = 'h264-baseline' | 'h264-main' | 'h264-high' | 'vp8';

type StreamConfig = {
  type: 'stream-config';
  protocol: 5;
  qualityKey: ModeKey;
  videoCodec: 'h264' | 'vp8';
  videoProfile: string;
  videoCodecString: string;
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  audioEnabled: boolean;
  audioSampleRate: number;
  audioChannels: number;
  preset: string;
  compatibilityMode: boolean;
};

type ViewerCapabilities = {
  type: 'viewer-capabilities';
  protocol: 5;
  modes: Partial<Record<ModeKey, CapabilityToken[]>>;
  audioOpus: boolean;
};

type RelayControl =
  | { type: 'hello'; role: string; protocol: number }
  | { type: 'status'; live: boolean }
  | { type: 'viewer-count'; count: number }
  | { type: 'pong'; sentAt: number }
  | { type: 'latency-probe'; sentAt: number }
  | { type: 'error'; message: string }
  | { type: 'cursor'; x: number; y: number; visible: boolean; w?: number; h?: number; hx?: number; hy?: number }
  | StreamConfig;

const MODE_SPECS: Record<ModeKey, { width: number; height: number; fps: number; level: string }> = {
  '720p30': { width: 1280, height: 720, fps: 30, level: '1F' },
  '720p60': { width: 1280, height: 720, fps: 60, level: '20' },
  '1080p30': { width: 1920, height: 1080, fps: 30, level: '28' },
  '1080p60': { width: 1920, height: 1080, fps: 60, level: '2A' }
};

function tokenCodec(mode: ModeKey, token: CapabilityToken) {
  if (token === 'vp8') return 'vp8';
  const profile = token === 'h264-main' ? '4D40' : token === 'h264-high' ? '6400' : '42E0';
  return `avc1.${profile}${MODE_SPECS[mode].level}`;
}

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

function viewerRelayUrl(room: string, viewerId: string) {
  const base = location.hostname.endsWith('discordsays.com') ? PROXIED_RELAY : DIRECT_RELAY;
  return `${base}?role=viewer&room=${encodeURIComponent(room)}&transport=text&viewerId=${encodeURIComponent(viewerId)}`;
}

function base64ToArrayBuffer(value: string) {
  const fast = (Uint8Array as unknown as { fromBase64?: (input: string) => Uint8Array }).fromBase64;
  if (typeof fast === 'function') {
    try {
      const bytes = fast.call(Uint8Array, value);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } catch { }
  }

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

async function probeCapabilities(): Promise<ViewerCapabilities> {
  const modes: Partial<Record<ModeKey, CapabilityToken[]>> = {};
  const VideoDecoderCtor = (window as any).VideoDecoder;

  if (VideoDecoderCtor?.isConfigSupported) {
    for (const mode of Object.keys(MODE_SPECS) as ModeKey[]) {
      const spec = MODE_SPECS[mode];
      const supported: CapabilityToken[] = [];
      const tokens: CapabilityToken[] = ['h264-main', 'h264-baseline', 'h264-high', 'vp8'];
      for (const token of tokens) {
        try {
          const result = await VideoDecoderCtor.isConfigSupported({
            codec: tokenCodec(mode, token),
            codedWidth: spec.width,
            codedHeight: spec.height,
            optimizeForLatency: true
          });
          if (result?.supported) supported.push(token);
        } catch { }
      }
      modes[mode] = supported;
    }
  }

  let audioOpus = false;
  const AudioDecoderCtor = (window as any).AudioDecoder;
  if (AudioDecoderCtor?.isConfigSupported) {
    try {
      const result = await AudioDecoderCtor.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
      audioOpus = !!result?.supported;
    } catch { }
  }

  return { type: 'viewer-capabilities', protocol: 5, modes, audioOpus };
}

function Icon({ name }: { name: 'volume' | 'mute' | 'fullscreen' | 'copy' | 'fit' | 'monitor' | 'close' }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'volume') return <svg {...p}><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.8 6.5a8 8 0 0 1 0 11"/></svg>;
  if (name === 'mute') return <svg {...p}><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 9 5 5M21 9l-5 5"/></svg>;
  if (name === 'fullscreen') return <svg {...p}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>;
  if (name === 'copy') return <svg {...p}><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>;
  if (name === 'fit') return <svg {...p}><path d="M8 5H5v3M16 5h3v3M8 19H5v-3M16 19h3v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>;
  if (name === 'close') return <svg {...p}><path d="m6 6 12 12M18 6 6 18"/></svg>;
  return <svg {...p}><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
}

function App() {
  const room = React.useMemo(() => roomCode(discordSdk.instanceId), []);
  const viewerIdRef = React.useRef(typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const playerRef = React.useRef<HTMLDivElement>(null);
  const videoPlaneRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const cursorRef = React.useRef<HTMLDivElement>(null);
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectTimer = React.useRef<number | null>(null);
  const hudTimer = React.useRef<number | null>(null);
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
  const capabilitiesRef = React.useRef<ViewerCapabilities | null>(null);
  const lastPongRef = React.useRef(0);
  const lastPingSentAtRef = React.useRef(0);
  const lastKeyframeRequestRef = React.useRef(0);
  const reconnectsRef = React.useRef(0);
  const packetCounterRef = React.useRef(0);
  const packetRateBaseRef = React.useRef(0);
  const keyframeCounterRef = React.useRef(0);
  const droppedCounterRef = React.useRef(0);
  const decoderResetsRef = React.useRef(0);
  const videoGenerationRef = React.useRef(0);
  const decodedFrameCounterRef = React.useRef(0);
  const decodedFrameRateBaseRef = React.useRef(0);
  const lastVideoPacketAtRef = React.useRef(0);
  const lastDecodedFrameAtRef = React.useRef(0);
  const lastStallRecoveryAtRef = React.useRef(0);
  const remoteCursorTimerRef = React.useRef<number | null>(null);
  const remoteCursorVisibleRef = React.useRef(false);
  const liveRef = React.useRef(false);
  const relayConnectedRef = React.useRef(false);
  const immersiveRef = React.useRef(false);

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
  const [muted, setMuted] = React.useState(false);
  const [volume, setVolume] = React.useState(() => {
    try {
      const value = Number(localStorage.getItem('aktela-volume') ?? '80');
      return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 80;
    } catch { return 80; }
  });
  const [audioReady, setAudioReady] = React.useState(false);
  const [videoPackets, setVideoPackets] = React.useState(0);
  const [capabilitiesReady, setCapabilitiesReady] = React.useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState({ packetsPerSec: 0, decodedFps: 0, decodeQueue: 0, codec: '—', reconnects: 0, keyframes: 0, dropped: 0, resets: 0, stalled: false });

  const resetTimeline = React.useCallback(() => {
    mediaBaseUs.current = null;
    perfBaseMs.current = 0;
    audioBaseSec.current = 0;
    waitForKeyframe.current = true;
  }, []);

  const ensureTimeline = React.useCallback((ts: number) => {
    if (mediaBaseUs.current !== null) return;
    mediaBaseUs.current = ts;
    perfBaseMs.current = performance.now() + 35;
    audioBaseSec.current = (audioContext.current?.currentTime ?? 0) + 0.035;
  }, []);

  const requestKeyframe = React.useCallback((reason: string) => {
    const now = Date.now();
    if (now - lastKeyframeRequestRef.current < 700) return;
    lastKeyframeRequestRef.current = now;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'request-keyframe', reason }));
    }
  }, []);

  const closeVideoDecoder = React.useCallback(() => {
    videoGenerationRef.current++;
    try { videoDecoder.current?.close?.(); } catch { }
    videoDecoder.current = null;
    videoCodecRef.current = '';
    waitForKeyframe.current = true;
  }, []);

  const rejectCodecCapability = React.useCallback((cfg: StreamConfig, codec: string) => {
    const caps = capabilitiesRef.current;
    if (!caps) return;

    let token: CapabilityToken | null = null;
    if (codec === 'vp8') token = 'vp8';
    else if (codec.startsWith('avc1.') && codec.length >= 11) {
      const profileHex = codec.slice(5, 7).toUpperCase();
      token = profileHex === '42' ? 'h264-baseline' : profileHex === '4D' ? 'h264-main' : profileHex === '64' ? 'h264-high' : null;
    }
    if (!token) return;

    const current = caps.modes[cfg.qualityKey] ?? [];
    if (!current.includes(token)) return;

    const updated: ViewerCapabilities = {
      ...caps,
      modes: { ...caps.modes, [cfg.qualityKey]: current.filter(item => item !== token) }
    };
    capabilitiesRef.current = updated;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(updated));
  }, []);

  const configureVideo = React.useCallback(async (cfg: StreamConfig, codec: string) => {
    closeVideoDecoder();
    const generation = videoGenerationRef.current;
    const VideoDecoderCtor = (window as any).VideoDecoder;
    if (!VideoDecoderCtor) {
      setError('Este cliente do Discord não oferece WebCodecs para vídeo.');
      return false;
    }

    const candidate = {
      codec,
      codedWidth: cfg.width,
      codedHeight: cfg.height,
      optimizeForLatency: true
    };

    try {
      if (typeof VideoDecoderCtor.isConfigSupported === 'function') {
        const support = await VideoDecoderCtor.isConfigSupported(candidate);
        if (generation !== videoGenerationRef.current || configRef.current !== cfg) return false;
        if (!support?.supported) {
          setError(`Codec não suportado neste cliente: ${codec}. O AKTela solicitará modo compatibilidade.`);
          rejectCodecCapability(cfg, codec);
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'decoder-error', reason: 'unsupported-codec', codec }));
          requestKeyframe('unsupported-codec');
          return false;
        }
      }
    } catch (e: any) {
      setError(`Falha ao verificar ${codec}: ${e?.message ?? e}`);
      rejectCodecCapability(cfg, codec);
      return false;
    }

    const decoder = new VideoDecoderCtor({
      output: (frame: any) => {
        const ts = Number(frame.timestamp ?? 0);
        ensureTimeline(ts);
        const due = perfBaseMs.current + (ts - (mediaBaseUs.current ?? ts)) / 1000;
        const draw = () => {
          if (generation !== videoGenerationRef.current) {
            frame.close();
            return;
          }
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
            lastDecodedFrameAtRef.current = Date.now();
            decodedFrameCounterRef.current++;
            setHasVideo(true);
            setError('');
          }
          frame.close();
        };
        const wait = Math.max(0, due - performance.now());
        wait > 3 ? window.setTimeout(draw, Math.min(wait, 70)) : draw();
      },
      error: (e: any) => {
        if (generation !== videoGenerationRef.current) return;
        decoderResetsRef.current++;
        setHasVideo(false);
        setError(`Falha ao decodificar ${codec}: ${e?.message ?? e}`);
        rejectCodecCapability(cfg, codec);
        closeVideoDecoder();
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'decoder-error', reason: 'decode-error', codec }));
        requestKeyframe('decode-error');
      }
    });

    try {
      decoder.configure(candidate);
      videoDecoder.current = decoder;
      videoCodecRef.current = codec;
      waitForKeyframe.current = true;
      return true;
    } catch (e: any) {
      try { decoder.close(); } catch { }
      setError(`Não foi possível configurar ${codec}: ${e?.message ?? e}`);
      rejectCodecCapability(cfg, codec);
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'decoder-error', reason: 'configure-error', codec }));
      requestKeyframe('configure-error');
      return false;
    }
  }, [closeVideoDecoder, ensureTimeline, rejectCodecCapability, requestKeyframe]);

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
    audioDecoder.current = null;
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
        if (when > ac.currentTime + 0.14) {
          audioBaseSec.current -= when - (ac.currentTime + 0.035);
          when = ac.currentTime + 0.035;
        }
        source.start(when);
        data.close();
      },
      error: () => { }
    });

    try {
      decoder.configure({ codec: 'opus', sampleRate: cfg.audioSampleRate, numberOfChannels: cfg.audioChannels });
      audioDecoder.current = decoder;
    } catch { }
  }, [ensureTimeline]);

  const processMediaPacket = React.useCallback(async (ab: ArrayBuffer) => {
    try {
      if (ab.byteLength < HEADER) return;
      const dv = new DataView(ab);
      for (let i = 0; i < PROTOCOL_MAGIC.length; i++) if (dv.getUint8(i) !== PROTOCOL_MAGIC[i]) return;

      const kind = dv.getUint8(5);
      if (dv.getUint8(4) !== 5 || (kind !== 1 && kind !== 2)) return;
      const key = (dv.getUint8(6) & 1) !== 0;
      const lo = dv.getUint32(8, true);
      const hi = dv.getInt32(12, true);
      const ts = hi * 4294967296 + lo;
      const duration = dv.getInt32(16, true);
      const len = dv.getInt32(20, true);
      if (len <= 0 || HEADER + len !== ab.byteLength || duration <= 0 || ts < 0) return;

      const payload = new Uint8Array(ab, HEADER, len);
      ensureTimeline(ts);

      if (kind === 1) {
        lastVideoPacketAtRef.current = Date.now();
        packetCounterRef.current++;
        setVideoPackets(v => v === 0 ? 1 : v);
        const cfg = configRef.current;
        if (!cfg) return;

        if (waitForKeyframe.current && !key) {
          droppedCounterRef.current++;
          return;
        }

        let codec = cfg.videoCodec === 'vp8' ? 'vp8' : cfg.videoCodecString;
        if (key) {
          keyframeCounterRef.current++;
          if (cfg.videoCodec === 'h264') {
            const detected = codecFromAnnexB(payload);
            if (!detected) {
              setError('Quadro-chave H.264 sem SPS. Solicitando outro quadro-chave.');
              waitForKeyframe.current = true;
              requestKeyframe('missing-sps');
              return;
            }
            codec = detected;
          }

          if (videoDecoder.current?.state !== 'configured' || videoCodecRef.current !== codec) {
            if (!await configureVideo(cfg, codec)) return;
          }
          if (configRef.current !== cfg) return;
          waitForKeyframe.current = false;
        }

        if (videoDecoder.current?.state !== 'configured') return;

        if (videoDecoder.current.decodeQueueSize > 5) {
          droppedCounterRef.current++;
          decoderResetsRef.current++;
          setHasVideo(false);
          closeVideoDecoder();
          requestKeyframe('decoder-congestion');
          return;
        }

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
      droppedCounterRef.current++;
      setHasVideo(false);
      closeVideoDecoder();
      setError(`Falha ao processar mídia: ${e?.message ?? e}`);
      requestKeyframe('packet-error');
    }
  }, [closeVideoDecoder, configureVideo, ensureTimeline, requestKeyframe]);

  React.useEffect(() => {
    let active = true;
    discordSdk.ready().then(() => active && setDiscordReady(true)).catch(() => active && setDiscordReady(false));
    return () => { active = false; };
  }, []);

  React.useEffect(() => { liveRef.current = live; }, [live]);
  React.useEffect(() => { relayConnectedRef.current = relayConnected; }, [relayConnected]);
  React.useEffect(() => {
    immersiveRef.current = immersive;
    if (!immersive && remoteCursorVisibleRef.current && cursorRef.current)
      cursorRef.current.style.display = 'block';
  }, [immersive]);

  React.useEffect(() => {
    let disposed = false;
    let reconnectAttempt = 0;

    void probeCapabilities().then(caps => {
      if (disposed) return;
      capabilitiesRef.current = caps;
      setCapabilitiesReady(true);
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(caps));
    });

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(viewerRelayUrl(room, viewerIdRef.current));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
        lastPongRef.current = Date.now();
        relayConnectedRef.current = true;
        setRelayConnected(true);
        setError('');
        if (capabilitiesRef.current) ws.send(JSON.stringify(capabilitiesRef.current));
        lastPingSentAtRef.current = Date.now();
        ws.send('ping');
        requestKeyframe('viewer-connected');
      };

      ws.onmessage = (event) => {
        if (disposed || wsRef.current !== ws) return;
        if (typeof event.data === 'string') {
          if (event.data === 'pong') {
            lastPongRef.current = Date.now();
            // Este "pong" é o auto-response do Worker: responde na borda, sem esperar
            // atrás de vídeo/controle na fila do Durable Object. É por isso que o ping
            // exibido usa este round-trip em vez do "pong" via JSON (que reflete
            // congestionamento do relay, não a rede em si).
            if (lastPingSentAtRef.current > 0)
              setLatency(Math.max(0, Date.now() - lastPingSentAtRef.current));
            return;
          }
          if (event.data.startsWith(TEXT_MEDIA_PREFIX)) {
            try { void processMediaPacket(base64ToArrayBuffer(event.data.slice(TEXT_MEDIA_PREFIX.length))); }
            catch (e: any) { setError(`Falha ao reconstruir mídia: ${e?.message ?? e}`); }
            return;
          }

          try {
            const m = JSON.parse(event.data) as RelayControl;
            if (m.type === 'status') {
              liveRef.current = m.live;
              setLive(m.live);
              if (!m.live) {
                remoteCursorVisibleRef.current = false;
                if (cursorRef.current) cursorRef.current.style.display = 'none';
                configRef.current = null;
                setConfig(null);
                setVideoPackets(0);
                try { audioDecoder.current?.close?.(); } catch { }
                audioDecoder.current = null;
                setHasVideo(false);
                resetTimeline();
                closeVideoDecoder();
              }
            } else if (m.type === 'viewer-count') {
              setViewers(m.count);
            } else if (m.type === 'pong') {
              // Mantido por compatibilidade; não é mais a fonte da latência exibida
              // (veja o "pong" de texto puro em onmessage, que é o RTT sem viés de fila).
              lastPongRef.current = Date.now();
            } else if (m.type === 'stream-config') {
              configRef.current = m;
              setConfig(m);
              lastVideoPacketAtRef.current = Date.now();
              lastDecodedFrameAtRef.current = Date.now();
              setHasVideo(false);
              setError('');
              resetTimeline();
              closeVideoDecoder();
              setVideoPackets(0);
              configureAudio(m);
              requestKeyframe('stream-config');
            } else if (m.type === 'cursor') {
              const el = cursorRef.current;
              if (!el) return;
              const w = m.w ?? 0.016;
              const h = m.h ?? 0.028;
              remoteCursorVisibleRef.current = m.visible;
              el.style.display = m.visible ? 'block' : 'none';
              el.style.left = `${m.x * 100}%`;
              el.style.top = `${m.y * 100}%`;
              el.style.width = `${w * 100}%`;
              el.style.height = `${h * 100}%`;
              el.style.transform = `translate(-${(m.hx ?? 0.05) * 100}%,-${(m.hy ?? 0.05) * 100}%)`;
              if (remoteCursorTimerRef.current) window.clearTimeout(remoteCursorTimerRef.current);
              // Antes, esse temporizador de segurança só era armado em modo imersivo
              // (tela cheia do próprio app). Fora dele, o cursor dependia inteiramente de
              // chegar um pacote "visible:false" do Capture — se o transmissor está
              // exibindo algo em tela cheia (jogo, vídeo) e esse pacote final se perde
              // (rede instável, canal de controle saturado), o cursor fica congelado na
              // tela de quem assiste indefinidamente. Rearmar sempre, independente do
              // modo de exibição, garante que o cursor some no máximo 1.6s depois do
              // último movimento reportado, com ou sem esse pacote.
              if (m.visible) {
                remoteCursorTimerRef.current = window.setTimeout(() => {
                  if (cursorRef.current) cursorRef.current.style.display = 'none';
                }, 1600);
              }
            } else if (m.type === 'latency-probe') {
              if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'latency-probe-ack', sentAt: m.sentAt }));
            } else if (m.type === 'error') {
              setError(m.message);
            }
          } catch { }
          return;
        }

        if (event.data instanceof ArrayBuffer) {
          void processMediaPacket(event.data);
        } else if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then(ab => processMediaPacket(ab)).catch(() => setError('Falha ao ler pacote binário do relay.'));
        }
      };

      ws.onclose = () => {
        if (disposed || wsRef.current !== ws) return;
        relayConnectedRef.current = false;
        remoteCursorVisibleRef.current = false;
        if (cursorRef.current) cursorRef.current.style.display = 'none';
        setRelayConnected(false);
        liveRef.current = false;
        setLive(false);
        setHasVideo(false);
        configRef.current = null;
        setConfig(null);
        setVideoPackets(0);
        resetTimeline();
        closeVideoDecoder();
        try { audioDecoder.current?.close?.(); } catch { }
        audioDecoder.current = null;
        if (!disposed) {
          reconnectsRef.current++;
          const baseDelay = Math.min(10_000, 700 * Math.pow(2, Math.min(reconnectAttempt++, 4)));
          const delay = baseDelay + Math.floor(Math.random() * 350);
          reconnectTimer.current = window.setTimeout(connect, delay);
        }
      };

      ws.onerror = () => { try { ws.close(); } catch { } };
    };

    connect();

    const heartbeat = window.setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - lastPongRef.current > 18_000) {
        try { ws.close(4000, 'heartbeat-timeout'); } catch { }
        return;
      }
      // Auto-response do Durable Object: mantém o socket vivo sem acordar a sala em
      // ociosidade, e o round-trip também alimenta a latência exibida (onmessage 'pong').
      lastPingSentAtRef.current = now;
      ws.send('ping');
    }, 6000);

    const visibility = () => {
      if (document.visibilityState === 'visible') requestKeyframe('viewer-visible');
    };
    document.addEventListener('visibilitychange', visibility);

    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', visibility);
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      if (remoteCursorTimerRef.current) window.clearTimeout(remoteCursorTimerRef.current);
      try { wsRef.current?.close(); } catch { }
      closeVideoDecoder();
      try { audioDecoder.current?.close?.(); } catch { }
      try { audioContext.current?.close(); } catch { }
    };
  }, [closeVideoDecoder, configureAudio, processMediaPacket, requestKeyframe, resetTimeline, room]);

  React.useEffect(() => {
    let healthTick = 0;
    const interval = window.setInterval(() => {
      const now = Date.now();
      const total = packetCounterRef.current;
      const rate = total - packetRateBaseRef.current;
      packetRateBaseRef.current = total;
      const decodedTotal = decodedFrameCounterRef.current;
      const decodedFps = decodedTotal - decodedFrameRateBaseRef.current;
      decodedFrameRateBaseRef.current = decodedTotal;
      const packetAge = lastVideoPacketAtRef.current > 0 ? now - lastVideoPacketAtRef.current : Number.POSITIVE_INFINITY;
      const frameAge = lastDecodedFrameAtRef.current > 0 ? now - lastDecodedFrameAtRef.current : Number.POSITIVE_INFINITY;
      const expectingVideo = relayConnectedRef.current && liveRef.current && configRef.current !== null;
      const packetsStopped = expectingVideo && packetAge > 2600;
      const decoderStopped = expectingVideo && packetAge < 1300 && frameAge > 1900;
      const stalled = packetsStopped || decoderStopped;

      if (stalled && now - lastStallRecoveryAtRef.current > 2400) {
        lastStallRecoveryAtRef.current = now;
        decoderResetsRef.current++;
        setHasVideo(false);
        setError(packetsStopped
          ? 'O vídeo parou de chegar. Solicitando recuperação automática.'
          : 'O vídeo chegou, mas a reprodução travou. Reiniciando o decoder.');
        resetTimeline();
        closeVideoDecoder();
        requestKeyframe(packetsStopped ? 'video-packets-stalled' : 'video-decode-stalled');
      }

      const decodeQueue = Number(videoDecoder.current?.decodeQueueSize ?? 0);
      setDiagnostics({
        packetsPerSec: rate,
        decodedFps,
        decodeQueue,
        codec: videoCodecRef.current || configRef.current?.videoCodecString || '—',
        reconnects: reconnectsRef.current,
        keyframes: keyframeCounterRef.current,
        dropped: droppedCounterRef.current,
        resets: decoderResetsRef.current,
        stalled
      });

      const ws = wsRef.current;
      if ((++healthTick % 2) === 0 && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'viewer-health',
          decodedFps,
          decodeQueue,
          dropped: droppedCounterRef.current,
          resets: decoderResetsRef.current,
          stalled
        }));
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [closeVideoDecoder, requestKeyframe, resetTimeline]);

  React.useEffect(() => {
    try { localStorage.setItem('aktela-volume', String(volume)); } catch { }
    if (gainNode.current) gainNode.current.gain.value = muted ? 0 : volume / 100;
  }, [volume, muted]);

  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDiagnosticsOpen(v => !v);
      } else if (e.key === 'Escape') {
        if (diagnosticsOpen) setDiagnosticsOpen(false);
        else setImmersive(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [diagnosticsOpen]);

  const copy = async () => {
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1000); };
    try { await navigator.clipboard.writeText(room); done(); return; } catch { }
    const t = document.createElement('textarea');
    t.value = room;
    t.style.position = 'fixed';
    t.style.left = '-9999px';
    document.body.appendChild(t);
    t.select();
    try { if (document.execCommand('copy')) done(); } finally { t.remove(); }
  };

  const enterImmersive = React.useCallback(() => {
    setFit('contain');
    setHud(true);
    setImmersive(true);
    if (remoteCursorTimerRef.current) window.clearTimeout(remoteCursorTimerRef.current);
    remoteCursorTimerRef.current = window.setTimeout(() => {
      if (cursorRef.current) cursorRef.current.style.display = 'none';
    }, 1600);
  }, []);

  const toggleImmersive = React.useCallback(() => {
    if (!immersive) {
      setFit('contain');
      if (remoteCursorTimerRef.current) window.clearTimeout(remoteCursorTimerRef.current);
      remoteCursorTimerRef.current = window.setTimeout(() => {
        if (cursorRef.current) cursorRef.current.style.display = 'none';
      }, 1600);
    }
    setImmersive(v => !v);
  }, [immersive]);

  const showHud = React.useCallback(() => {
    if (!immersive) return;
    setHud(true);
    if (hudTimer.current) window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(false), 1700);
  }, [immersive]);

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

      plane.style.width = `${Math.max(1, Math.floor(width))}px`;
      plane.style.height = `${Math.max(1, Math.floor(height))}px`;
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

  const codecError = error.toLowerCase().includes('codec') || error.toLowerCase().includes('decod');
  const status = !discordReady
    ? 'Conectando ao Discord'
    : !relayConnected
      ? 'Reconectando ao relay'
      : codecError
        ? 'Erro de codec'
        : !live
          ? 'Aguardando Capture'
          : !capabilitiesReady
            ? 'Negociando compatibilidade'
            : !hasVideo
              ? (videoPackets > 0 ? 'Preparando vídeo' : 'Aguardando vídeo')
              : config?.compatibilityMode
                ? 'Modo compatibilidade'
                : 'Ao vivo';

  const health = !relayConnected ? 'Offline' : latency === 0 ? 'Conectando' : latency < 120 ? 'Excelente' : latency < 260 ? 'Boa' : latency < 450 ? 'Alta latência' : 'Instável';
  const quality = config ? `${config.height >= 1080 ? '1080p' : '720p'} · ${config.fps} FPS` : '—';

  return <main className="page"><section className={`shell ${immersive ? 'immersive' : ''}`}>
    <header className="topbar">
      <div className="brand"><div className="logo">AK</div><div><h1>AKTela</h1><p>Compartilhamento em baixa latência</p></div></div>
      <button className={`connection ${relayConnected ? 'ok' : ''}`} onClick={() => setDiagnosticsOpen(true)} title="Abrir diagnóstico"><span className="dot"/><span>{status}</span></button>
    </header>

    <div ref={playerRef} className={`player ${immersive && hud ? 'hud-visible' : ''}`} onDoubleClick={toggleImmersive} onPointerMove={showHud}>
      <div className="surface">
        <div ref={videoPlaneRef} className="video-plane">
          <canvas ref={canvasRef} className={hasVideo ? 'frame visible' : 'frame'} width={config?.width ?? 1280} height={config?.height ?? 720}/>
          <div ref={cursorRef} className="remote-cursor" style={{ display: 'none' }}><svg viewBox="0 0 32 32"><path d="M4 2.5v24.2l6.35-5.95 4.45 9.35 4.3-2.05-4.35-9.1h8.95L4 2.5Z"/></svg></div>
        </div>
      </div>

      {!hasVideo && <div className="empty-state"><div className="empty-icon"><Icon name="monitor"/></div><h2>{status}</h2><p>{live ? (videoPackets > 0 ? 'Os dados chegaram; aguardando um quadro-chave decodificável.' : 'A sala está ativa e pronta para o primeiro pacote de vídeo.') : 'Abra o AKTela Capture, use o código abaixo e inicie o compartilhamento.'}</p></div>}

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

    <footer className="bottom"><div className="pair-card"><div><span>Código do Capture</span><strong>{room}</strong></div><button onClick={copy}><Icon name="copy"/><span>{copied ? 'Copiado' : 'Copiar'}</span></button></div><div className="session-stats"><button onClick={() => setDiagnosticsOpen(true)}><span>Conexão</span><strong>{health}</strong></button><div><span>Assistindo</span><strong>{viewers}</strong></div><div><span>Perfil</span><strong>{config?.compatibilityMode ? 'Compatível' : config?.preset ?? '—'}</strong></div></div></footer>

    {diagnosticsOpen && <div className="diagnostics-backdrop" onMouseDown={() => setDiagnosticsOpen(false)}><section className="diagnostics" onMouseDown={e => e.stopPropagation()}>
      <header><div><h2>Diagnóstico</h2><p>Ctrl + Alt + D</p></div><button onClick={() => setDiagnosticsOpen(false)}><Icon name="close"/></button></header>
      <div className="diag-grid">
        <div><span>Relay</span><strong>{relayConnected ? 'Conectado' : 'Desconectado'}</strong></div>
        <div><span>Ping</span><strong>{latency ? `${latency} ms` : '—'}</strong></div>
        <div><span>Codec</span><strong>{diagnostics.codec}</strong></div>
        <div><span>Resolução</span><strong>{config ? `${config.width}×${config.height}` : '—'}</strong></div>
        <div><span>Pacotes/s</span><strong>{diagnostics.packetsPerSec}</strong></div>
        <div><span>FPS reproduzido</span><strong>{diagnostics.decodedFps}</strong></div>
        <div><span>Fila decoder</span><strong>{diagnostics.decodeQueue}</strong></div>
        <div><span>Keyframes</span><strong>{diagnostics.keyframes}</strong></div>
        <div><span>Descartados</span><strong>{diagnostics.dropped}</strong></div>
        <div><span>Resets decoder</span><strong>{diagnostics.resets}</strong></div>
        <div><span>Reconexões</span><strong>{diagnostics.reconnects}</strong></div>
        <div><span>Capacidades</span><strong>{capabilitiesReady ? 'Enviadas' : 'Verificando'}</strong></div>
        <div><span>Transporte</span><strong>WebSocket texto</strong></div>
        <div><span>Reprodução</span><strong>{diagnostics.stalled ? 'Recuperando' : 'Fluindo'}</strong></div>
      </div>
      <button className="request-key" onClick={() => requestKeyframe('manual-diagnostic')}>Solicitar novo quadro-chave</button>
    </section></div>}
  </section></main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App/>);
