import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import './style.css';

const CLIENT_ID = '1545406549105713182';
const discordSdk = new DiscordSDK(CLIENT_ID);
const HEADER = 24;

type StreamConfig = {
  type:'stream-config';
  videoCodec:string;
  width:number;
  height:number;
  fps:number;
  videoBitrateMbps:number;
  audioEnabled:boolean;
  audioCodec:string;
  audioSampleRate:number;
  audioChannels:number;
  preset?:string;
  sourceKind?:string;
  audioMode?:string;
  cursorPolicy?:string;
};
type CursorMessage={type:'cursor';x:number;y:number;visible:boolean};
type RelayMessage =
  | {type:'status';live:boolean}
  | {type:'viewer-count';count:number}
  | {type:'error';message:string}
  | {type:'pong';sentAt?:number}
  | CursorMessage
  | StreamConfig;

function roomCodeFromInstanceId(id:string){
  let h=2166136261;
  for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let v=h>>>0,code='';
  for(let i=0;i<6;i++){code+=alphabet[v%alphabet.length];v=(Math.floor(v/alphabet.length)^((h>>>(i+1))&0xffff))>>>0;}
  return code;
}
function relayUrl(room:string){const p=location.protocol==='https:'?'wss:':'ws:';return `${p}//${location.host}/api/ws?role=viewer&room=${encodeURIComponent(room)}`;}

const Icon=({name}:{name:'volume'|'mute'|'fullscreen'|'copy'|'monitor'|'fit'})=>{
  const common={width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  if(name==='volume')return <svg {...common}><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.8 6.5a8 8 0 0 1 0 11"/></svg>;
  if(name==='mute')return <svg {...common}><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 9 5 5M21 9l-5 5"/></svg>;
  if(name==='fullscreen')return <svg {...common}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>;
  if(name==='copy')return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>;
  if(name==='fit')return <svg {...common}><path d="M8 5H5v3M16 5h3v3M8 19H5v-3M16 19h3v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>;
  return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
};

function App(){
  const playerRef=React.useRef<HTMLDivElement>(null);
  const canvasRef=React.useRef<HTMLCanvasElement>(null);
  const wsRef=React.useRef<WebSocket|null>(null);
  const reconnect=React.useRef<number|null>(null);
  const videoDecoder=React.useRef<any>(null),audioDecoder=React.useRef<any>(null);
  const audioContext=React.useRef<AudioContext|null>(null),gainNode=React.useRef<GainNode|null>(null);
  const mediaBaseUs=React.useRef<number|null>(null),perfBaseMs=React.useRef(0),audioBaseSec=React.useRef(0);
  const room=React.useMemo(()=>roomCodeFromInstanceId(discordSdk.instanceId),[]);

  const [discordReady,setDiscordReady]=React.useState(false);
  const [relayConnected,setRelayConnected]=React.useState(false);
  const [live,setLive]=React.useState(false);
  const [viewers,setViewers]=React.useState(0);
  const [copied,setCopied]=React.useState(false);
  const [hasVideo,setHasVideo]=React.useState(false);
  const [audioOn,setAudioOn]=React.useState(false);
  const [muted,setMuted]=React.useState(false);
  const [volume,setVolume]=React.useState(()=>Number(localStorage.getItem('aktela-volume')??'80'));
  const [latency,setLatency]=React.useState(0);
  const [error,setError]=React.useState('');
  const [config,setConfig]=React.useState<StreamConfig|null>(null);
  const [cursor,setCursor]=React.useState({x:0,y:0,visible:false});
  const [fit,setFit]=React.useState<'contain'|'cover'>('contain');

  const resetTimeline=React.useCallback(()=>{mediaBaseUs.current=null;perfBaseMs.current=0;audioBaseSec.current=0;},[]);
  const ensureTimeline=React.useCallback((ts:number)=>{
    if(mediaBaseUs.current===null){
      mediaBaseUs.current=ts;
      perfBaseMs.current=performance.now()+55;
      const ac=audioContext.current;
      audioBaseSec.current=(ac?.currentTime??0)+0.055;
    }
  },[]);

  const configureVideo=React.useCallback((cfg:StreamConfig)=>{
    try{videoDecoder.current?.close?.();}catch{}
    const VD=(window as any).VideoDecoder;
    if(!VD){setError('Esta versão do Discord não oferece WebCodecs para H.264.');return;}
    const decoder=new VD({
      output:(frame:any)=>{
        const ts=Number(frame.timestamp??0);ensureTimeline(ts);
        const due=perfBaseMs.current+(ts-(mediaBaseUs.current??ts))/1000;
        const draw=()=>{
          const c=canvasRef.current;
          if(c){
            if(c.width!==cfg.width)c.width=cfg.width;
            if(c.height!==cfg.height)c.height=cfg.height;
            const ctx=c.getContext('2d',{alpha:false});
            if(ctx){ctx.drawImage(frame,0,0,c.width,c.height);setHasVideo(true);}
          }
          frame.close();
        };
        const wait=Math.max(0,due-performance.now());
        if(wait>3)setTimeout(draw,Math.min(wait,130));else draw();
      },
      error:(e:any)=>setError(`Decoder de vídeo: ${e?.message??e}`)
    });
    decoder.configure({codec:cfg.videoCodec,codedWidth:cfg.width,codedHeight:cfg.height,optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'});
    videoDecoder.current=decoder;
  },[ensureTimeline]);

  const ensureAudioGraph=React.useCallback(()=>{
    let ac=audioContext.current;
    if(!ac){ac=new AudioContext({latencyHint:'interactive',sampleRate:48000});audioContext.current=ac;}
    let gain=gainNode.current;
    if(!gain){gain=ac.createGain();gain.connect(ac.destination);gainNode.current=gain;}
    gain.gain.value=muted?0:Math.max(0,Math.min(1,volume/100));
    return {ac,gain};
  },[muted,volume]);

  const configureAudio=React.useCallback((cfg:StreamConfig)=>{
    try{audioDecoder.current?.close?.();}catch{}
    if(!cfg.audioEnabled)return;
    const AD=(window as any).AudioDecoder;if(!AD)return;
    const decoder=new AD({
      output:(data:any)=>{
        const ac=audioContext.current,gain=gainNode.current;
        if(!ac||!gain||ac.state!=='running'){data.close();return;}
        const ts=Number(data.timestamp??0);ensureTimeline(ts);
        const frames=data.numberOfFrames,channels=data.numberOfChannels;
        const buffer=ac.createBuffer(channels,frames,data.sampleRate);
        for(let ch=0;ch<channels;ch++){
          const arr=new Float32Array(frames);
          try{data.copyTo(arr,{planeIndex:ch,format:'f32-planar'});}catch{data.close();return;}
          buffer.copyToChannel(arr,ch);
        }
        const src=ac.createBufferSource();src.buffer=buffer;src.connect(gain);
        let when=audioBaseSec.current+(ts-(mediaBaseUs.current??ts))/1_000_000;
        if(when<ac.currentTime+0.008)when=ac.currentTime+0.008;
        if(when>ac.currentTime+0.18){audioBaseSec.current-=when-(ac.currentTime+0.06);when=ac.currentTime+0.06;}
        src.start(when);data.close();
      },
      error:()=>{}
    });
    decoder.configure({codec:'opus',sampleRate:cfg.audioSampleRate,numberOfChannels:cfg.audioChannels});
    audioDecoder.current=decoder;
  },[ensureTimeline]);

  React.useEffect(()=>{let active=true;discordSdk.ready().then(()=>active&&setDiscordReady(true)).catch(()=>active&&setDiscordReady(false));return()=>{active=false;};},[]);

  React.useEffect(()=>{
    let disposed=false;
    const connect=()=>{
      if(disposed)return;
      const ws=new WebSocket(relayUrl(room));ws.binaryType='arraybuffer';wsRef.current=ws;
      ws.onopen=()=>{setRelayConnected(true);setError('');ws.send(JSON.stringify({type:'ping',sentAt:Date.now()}));};
      ws.onmessage=(ev)=>{
        if(typeof ev.data==='string'){
          try{
            const m=JSON.parse(ev.data) as RelayMessage;
            if(m.type==='status'){setLive(m.live);if(!m.live){setHasVideo(false);setCursor(c=>({...c,visible:false}));resetTimeline();}}
            else if(m.type==='viewer-count')setViewers(m.count);
            else if(m.type==='stream-config'){setConfig(m);resetTimeline();configureVideo(m);configureAudio(m);}
            else if(m.type==='cursor')setCursor({x:m.x,y:m.y,visible:m.visible});
            else if(m.type==='pong'&&m.sentAt)setLatency(Math.max(0,Date.now()-m.sentAt));
            else if(m.type==='error')setError(m.message);
          }catch{}
          return;
        }
        const ab=ev.data as ArrayBuffer;if(ab.byteLength<HEADER)return;
        const dv=new DataView(ab);
        if(dv.getUint8(0)!==65||dv.getUint8(1)!==75||dv.getUint8(2)!==86||dv.getUint8(3)!==51)return;
        const kind=dv.getUint8(5),key=dv.getUint8(6)===1,ts=Number(dv.getBigInt64(8,true)),duration=dv.getInt32(16,true),len=dv.getInt32(20,true);
        if(len<0||HEADER+len>ab.byteLength)return;
        const payload=new Uint8Array(ab,HEADER,len);ensureTimeline(ts);
        try{
          if(kind===1&&videoDecoder.current?.state==='configured'){
            const C=(window as any).EncodedVideoChunk;
            videoDecoder.current.decode(new C({type:key?'key':'delta',timestamp:ts,duration,data:payload}));setLive(true);
          }else if(kind===2&&audioDecoder.current?.state==='configured'){
            const C=(window as any).EncodedAudioChunk;
            audioDecoder.current.decode(new C({type:'key',timestamp:ts,duration,data:payload}));
          }
        }catch{}
      };
      ws.onclose=()=>{setRelayConnected(false);if(!disposed)reconnect.current=window.setTimeout(connect,900);};
      ws.onerror=()=>{try{ws.close();}catch{}};
    };
    connect();
    const hb=window.setInterval(()=>{if(wsRef.current?.readyState===WebSocket.OPEN)wsRef.current.send(JSON.stringify({type:'ping',sentAt:Date.now()}));},4000);
    return()=>{
      disposed=true;clearInterval(hb);if(reconnect.current)clearTimeout(reconnect.current);
      try{wsRef.current?.close();videoDecoder.current?.close?.();audioDecoder.current?.close?.();audioContext.current?.close();}catch{}
    };
  },[room,configureVideo,configureAudio,ensureTimeline,resetTimeline]);

  React.useEffect(()=>{
    localStorage.setItem('aktela-volume',String(volume));
    if(gainNode.current)gainNode.current.gain.value=muted?0:Math.max(0,Math.min(1,volume/100));
  },[volume,muted]);

  const enableAudio=async()=>{
    try{
      const {ac}=ensureAudioGraph();await ac.resume();setAudioOn(ac.state==='running');resetTimeline();if(config)configureAudio(config);
    }catch{setError('O Discord bloqueou a reprodução de áudio nesta sessão.');}
  };
  const toggleMute=async()=>{if(!audioOn)await enableAudio();setMuted(v=>!v);};
  const copy=async()=>{
    const ok=()=>{setCopied(true);setTimeout(()=>setCopied(false),1200);};
    try{await navigator.clipboard.writeText(room);ok();return;}catch{}
    const t=document.createElement('textarea');t.value=room;t.style.position='fixed';t.style.left='-9999px';document.body.appendChild(t);t.select();
    try{if(document.execCommand('copy'))ok();else prompt('Copie o código:',room);}finally{t.remove();}
  };
  const toggleFullscreen=async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else await playerRef.current?.requestFullscreen();}
    catch{setError('Tela cheia não está disponível nesta janela do Discord.');}
  };

  const status=!discordReady?'Conectando ao Discord':!relayConnected?'Reconectando ao relay':live?'Ao vivo':'Aguardando Capture';
  const health=!relayConnected?'Offline':latency===0?'Conectando':latency<90?'Excelente':latency<160?'Boa':'Instável';
  const quality=config?`${config.height>=1080?'1080p':'720p'} · ${config.fps} FPS`:'—';

  return <main className="page"><section className="shell">
    <header className="topbar">
      <div className="brand"><div className="logo">AK</div><div><h1>AKTela</h1><p>Compartilhamento em baixa latência</p></div></div>
      <div className={`connection ${relayConnected?'ok':''}`}><span className="dot"/><span>{status}</span></div>
    </header>

    <div className="player" ref={playerRef} onDoubleClick={toggleFullscreen}>
      <div className={`surface ${fit}`} style={{aspectRatio:`${config?.width??16}/${config?.height??9}`}}>
        <canvas ref={canvasRef} width={config?.width??1920} height={config?.height??1080} className={hasVideo?'frame visible':'frame'}/>
        {cursor.visible&&hasVideo&&<div className="remote-cursor" style={{left:`${cursor.x*100}%`,top:`${cursor.y*100}%`}}><svg viewBox="0 0 28 34"><path d="M3 2v25l6.5-6.1 4.8 10.3 4.4-2-4.7-10.1H23L3 2Z"/></svg></div>}
      </div>

      {!hasVideo&&<div className="empty-state"><div className="empty-icon"><Icon name="monitor"/></div><h2>{live?'Sincronizando vídeo':'Pronto para receber uma transmissão'}</h2><p>Abra o AKTela Capture, use o código abaixo e inicie o compartilhamento.</p></div>}

      <div className="live-badge"><span className={live?'live-dot active':'live-dot'}/>{live?'AO VIVO':'AGUARDANDO'}</div>
      <div className="stream-meta"><span>{quality}</span>{config?.audioEnabled&&<span>Áudio</span>}<span>{latency?`${latency} ms`:'— ms'}</span></div>

      <div className="player-controls">
        <div className="control-left">
          {config?.audioEnabled&&<>
            <button className="icon-button" onClick={toggleMute} title={muted?'Ativar som':'Silenciar'}><Icon name={muted?'mute':'volume'}/></button>
            <input className="volume" aria-label="Volume" type="range" min="0" max="100" value={muted?0:volume} onChange={e=>{setMuted(false);setVolume(Number(e.target.value));}} onPointerDown={()=>{if(!audioOn)void enableAudio();}}/>
          </>}
        </div>
        <div className="control-right">
          <button className="text-button" onClick={()=>setFit(v=>v==='contain'?'cover':'contain')}><Icon name="fit"/><span>{fit==='contain'?'Ajustar':'Preencher'}</span></button>
          <button className="icon-button" onClick={toggleFullscreen} title="Tela cheia"><Icon name="fullscreen"/></button>
        </div>
      </div>
    </div>

    {error&&<div className="error"><span>{error}</span><button onClick={()=>setError('')}>Fechar</button></div>}

    <footer className="bottom">
      <div className="pair-card"><div><span className="eyebrow">Código do Capture</span><strong>{room}</strong></div><button onClick={copy}><Icon name="copy"/><span>{copied?'Copiado':'Copiar'}</span></button></div>
      <div className="session-stats"><div><span>Conexão</span><strong>{health}</strong></div><div><span>Assistindo</span><strong>{Math.max(viewers,1)}</strong></div><div><span>Perfil</span><strong>{config?.preset??'—'}</strong></div></div>
    </footer>
  </section></main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
