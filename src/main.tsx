import React from 'react';
import ReactDOM from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import './style.css';

const CLIENT_ID = '1545406549105713182';
const discordSdk = new DiscordSDK(CLIENT_ID);
const HEADER = 24;

type StreamConfig = { type:'stream-config'; videoCodec:string; width:number; height:number; fps:number; videoBitrateMbps:number; audioEnabled:boolean; audioCodec:string; audioSampleRate:number; audioChannels:number };
type RelayMessage = {type:'status';live:boolean}|{type:'viewer-count';count:number}|{type:'error';message:string}|{type:'pong'}|StreamConfig;

function roomCodeFromInstanceId(id:string){let h=2166136261;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let v=h>>>0,c='';for(let i=0;i<6;i++){c+=a[v%a.length];v=(Math.floor(v/a.length)^((h>>>(i+1))&0xffff))>>>0;}return c;}
function relayUrl(room:string){const p=location.protocol==='https:'?'wss:':'ws:';return `${p}//${location.host}/api/ws?role=viewer&room=${encodeURIComponent(room)}`;}

function App(){
  const canvasRef=React.useRef<HTMLCanvasElement>(null); const wsRef=React.useRef<WebSocket|null>(null); const reconnect=React.useRef<number|null>(null);
  const videoDecoder=React.useRef<any>(null), audioDecoder=React.useRef<any>(null), audioContext=React.useRef<AudioContext|null>(null);
  const mediaBaseUs=React.useRef<number|null>(null), perfBaseMs=React.useRef(0), audioBaseSec=React.useRef(0);
  const room=React.useMemo(()=>roomCodeFromInstanceId(discordSdk.instanceId),[]);
  const [discordReady,setDiscordReady]=React.useState(false),[relayConnected,setRelayConnected]=React.useState(false),[live,setLive]=React.useState(false),[viewers,setViewers]=React.useState(0),[copied,setCopied]=React.useState(false),[hasVideo,setHasVideo]=React.useState(false),[audioOn,setAudioOn]=React.useState(false),[error,setError]=React.useState('');
  const [config,setConfig]=React.useState<StreamConfig|null>(null);

  const resetTimeline=React.useCallback(()=>{mediaBaseUs.current=null;perfBaseMs.current=0;audioBaseSec.current=0;},[]);
  const ensureTimeline=(ts:number)=>{if(mediaBaseUs.current===null){mediaBaseUs.current=ts;perfBaseMs.current=performance.now()+70; const ac=audioContext.current; audioBaseSec.current=(ac?.currentTime??0)+0.07;}};

  const configureVideo=React.useCallback((cfg:StreamConfig)=>{
    try{videoDecoder.current?.close?.();}catch{}
    const VD=(window as any).VideoDecoder; if(!VD){setError('Esta versão do Discord não oferece WebCodecs para H.264.');return;}
    const decoder=new VD({output:(frame:any)=>{const ts=Number(frame.timestamp??0);ensureTimeline(ts);const due=perfBaseMs.current+(ts-(mediaBaseUs.current??ts))/1000;const draw=()=>{const c=canvasRef.current;if(c){const ctx=c.getContext('2d',{alpha:false});if(ctx){ctx.drawImage(frame,0,0,c.width,c.height);setHasVideo(true);}}frame.close();};const wait=Math.max(0,due-performance.now());if(wait>3)setTimeout(draw,Math.min(wait,180));else draw();},error:(e:any)=>{setError(`Decoder de vídeo: ${e?.message??e}`);}});
    decoder.configure({codec:cfg.videoCodec,codedWidth:cfg.width,codedHeight:cfg.height,optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'}); videoDecoder.current=decoder;
  },[]);

  const configureAudio=React.useCallback((cfg:StreamConfig)=>{
    try{audioDecoder.current?.close?.();}catch{}
    if(!cfg.audioEnabled)return; const AD=(window as any).AudioDecoder; if(!AD)return;
    const decoder=new AD({output:(data:any)=>{const ac=audioContext.current;if(!ac||ac.state!=='running'){data.close();return;}const ts=Number(data.timestamp??0);ensureTimeline(ts);const frames=data.numberOfFrames,channels=data.numberOfChannels;const buffer=ac.createBuffer(channels,frames,data.sampleRate);for(let ch=0;ch<channels;ch++){const arr=new Float32Array(frames);try{data.copyTo(arr,{planeIndex:ch,format:'f32-planar'});}catch{data.close();return;}buffer.copyToChannel(arr,ch);}const src=ac.createBufferSource();src.buffer=buffer;src.connect(ac.destination);let when=audioBaseSec.current+(ts-(mediaBaseUs.current??ts))/1_000_000;if(when<ac.currentTime+0.01)when=ac.currentTime+0.01;if(when>ac.currentTime+0.22){audioBaseSec.current-=when-(ac.currentTime+0.08);when=ac.currentTime+0.08;}src.start(when);data.close();},error:()=>{}});decoder.configure({codec:'opus',sampleRate:cfg.audioSampleRate,numberOfChannels:cfg.audioChannels});audioDecoder.current=decoder;
  },[]);

  React.useEffect(()=>{let active=true;discordSdk.ready().then(()=>active&&setDiscordReady(true)).catch(()=>active&&setDiscordReady(false));return()=>{active=false;};},[]);
  React.useEffect(()=>{let disposed=false;const connect=()=>{if(disposed)return;const ws=new WebSocket(relayUrl(room));ws.binaryType='arraybuffer';wsRef.current=ws;ws.onopen=()=>{setRelayConnected(true);setError('');};ws.onmessage=(ev)=>{if(typeof ev.data==='string'){try{const m=JSON.parse(ev.data) as RelayMessage;if(m.type==='status'){setLive(m.live);if(!m.live){setHasVideo(false);resetTimeline();}}else if(m.type==='viewer-count')setViewers(m.count);else if(m.type==='stream-config'){setConfig(m);resetTimeline();configureVideo(m);configureAudio(m);}else if(m.type==='error')setError(m.message);}catch{}return;}const ab=ev.data as ArrayBuffer;if(ab.byteLength<HEADER)return;const dv=new DataView(ab);if(dv.getUint8(0)!==65||dv.getUint8(1)!==75||dv.getUint8(2)!==86||dv.getUint8(3)!==51)return;const kind=dv.getUint8(5),key=dv.getUint8(6)===1,ts=Number(dv.getBigInt64(8,true)),duration=dv.getInt32(16,true),len=dv.getInt32(20,true);if(len<0||HEADER+len>ab.byteLength)return;const payload=new Uint8Array(ab,HEADER,len);ensureTimeline(ts);try{if(kind===1&&videoDecoder.current?.state==='configured'){const C=(window as any).EncodedVideoChunk;videoDecoder.current.decode(new C({type:key?'key':'delta',timestamp:ts,duration,data:payload}));setLive(true);}else if(kind===2&&audioDecoder.current?.state==='configured'){const C=(window as any).EncodedAudioChunk;audioDecoder.current.decode(new C({type:'key',timestamp:ts,duration,data:payload}));}}catch{}};ws.onclose=()=>{setRelayConnected(false);if(!disposed)reconnect.current=window.setTimeout(connect,1000);};ws.onerror=()=>{try{ws.close();}catch{}};};connect();const hb=window.setInterval(()=>{if(wsRef.current?.readyState===WebSocket.OPEN)wsRef.current.send('{"type":"ping"}');},20000);return()=>{disposed=true;clearInterval(hb);if(reconnect.current)clearTimeout(reconnect.current);try{wsRef.current?.close();videoDecoder.current?.close?.();audioDecoder.current?.close?.();audioContext.current?.close();}catch{}};},[room,configureVideo,configureAudio,resetTimeline]);

  const enableAudio=async()=>{try{let ac=audioContext.current;if(!ac){ac=new AudioContext({latencyHint:'interactive',sampleRate:48000});audioContext.current=ac;}await ac.resume();setAudioOn(ac.state==='running');resetTimeline();if(config)configureAudio(config);}catch{setError('O Discord bloqueou a reprodução de áudio nesta sessão.');}};
  const copy=async()=>{const ok=()=>{setCopied(true);setTimeout(()=>setCopied(false),1200);};try{await navigator.clipboard.writeText(room);ok();return;}catch{}const t=document.createElement('textarea');t.value=room;t.style.position='fixed';t.style.left='-9999px';document.body.appendChild(t);t.select();try{if(document.execCommand('copy'))ok();else prompt('Copie o código:',room);}finally{t.remove();}};
  const status=!discordReady?'Conectando ao Discord…':!relayConnected?'Conectando ao relay…':live?'Transmissão ao vivo':'Aguardando Capture';

  return <main className="page"><section className="shell"><header className="topbar"><div className="brand"><div className="logo">AK</div><div><h1>AKTela</h1><p>1080p • baixa latência</p></div></div><div className={`connection ${relayConnected?'ok':''}`}><span className="dot"/>{status}</div></header>
    <div className="player"><canvas ref={canvasRef} width={1920} height={1080} className={hasVideo?'frame visible':'frame'}/>{!hasVideo&&<div className="empty-state"><div className="empty-icon">▣</div><h2>{live?'Sincronizando vídeo…':'Nenhuma tela sendo compartilhada'}</h2><p>Abra o AKTela Capture, cole o código abaixo e ligue o compartilhamento.</p></div>}<div className="quality"><span>1080p</span><span>{config?.fps??'—'} FPS</span>{config?.audioEnabled&&<span>Áudio</span>}</div></div>
    {error&&<div className="error">{error}</div>}
    <footer className="bottom"><div className="pair-card"><div><span className="eyebrow">Código do Capture</span><strong>{room}</strong></div><button onClick={copy}>{copied?'Copiado':'Copiar código'}</button></div><div className="actions">{config?.audioEnabled&&<button className={audioOn?'audio active':'audio'} onClick={enableAudio}>{audioOn?'Áudio ligado':'Ativar áudio'}</button>}<div className="viewer-pill">{Math.max(viewers,1)} na Activity</div></div></footer></section></main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
