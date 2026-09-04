import { createServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

type Room={publisher?:WebSocket;viewers:Set<WebSocket>;streamConfig?:string};
type ControlMessage={type?:string;sentAt?:number};
const rooms=new Map<string,Room>();
const MAX_BUFFERED=600_000;
const waitKey=new WeakMap<WebSocket,boolean>();
const roomFor=(id:string)=>{let r=rooms.get(id);if(!r){r={viewers:new Set()};rooms.set(id,r);}return r;};
const json=(ws:WebSocket,p:unknown)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(p));};
const broadcastText=(r:Room,text:string)=>{for(const v of r.viewers)if(v.readyState===WebSocket.OPEN)try{v.send(text);}catch{}};
function update(id:string,r:Room){
  const live=Boolean(r.publisher&&r.publisher.readyState===WebSocket.OPEN),count=r.viewers.size;
  for(const v of r.viewers){json(v,{type:'status',live});json(v,{type:'viewer-count',count});if(r.streamConfig&&live)try{v.send(r.streamConfig);}catch{}}
  if(r.publisher)json(r.publisher,{type:'viewer-count',count});
  if(!r.publisher&&!count)rooms.delete(id);
}

const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,service:'AKTela relay v0.5'}));});
const wss=new WebSocketServer({server,maxPayload:4*1024*1024});
wss.on('connection',(ws,req)=>{
  const u=new URL(req.url??'/','https://aktela.invalid'),role=u.searchParams.get('role'),id=(u.searchParams.get('room')??'').trim().toUpperCase();
  if(!/^[A-Z2-9]{6}$/.test(id)||(role!=='publisher'&&role!=='viewer')){json(ws,{type:'error',message:'Parâmetros inválidos.'});ws.close(1008);return;}
  const r=roomFor(id);
  if(role==='publisher'){
    if(r.publisher&&r.publisher!==ws)try{r.publisher.close(4001,'replaced');}catch{}
    r.publisher=ws;
  }else{
    r.viewers.add(ws);waitKey.set(ws,true);
  }
  update(id,r);

  ws.on('message',(data:RawData,isBinary:boolean)=>{
    if(!isBinary){
      const text=data.toString();
      try{
        const m=JSON.parse(text) as ControlMessage;
        if(m.type==='ping'){json(ws,{type:'pong',sentAt:m.sentAt??0});return;}
        if(role==='publisher'&&m.type==='stream-config'){r.streamConfig=text;broadcastText(r,text);return;}
        if(role==='publisher'&&m.type==='cursor'){broadcastText(r,text);return;}
      }catch{}
      return;
    }
    if(role!=='publisher'||r.publisher!==ws)return;
    const b=Array.isArray(data)?Buffer.concat(data):Buffer.isBuffer(data)?data:Buffer.from(data as ArrayBuffer);
    if(b.length<24||b[0]!==65||b[1]!==75||b[2]!==86||b[3]!==51)return;
    const kind=b[5],key=b[6]===1;
    for(const v of r.viewers){
      if(v.readyState!==WebSocket.OPEN)continue;
      if(v.bufferedAmount>MAX_BUFFERED){if(kind===1)waitKey.set(v,true);continue;}
      if(kind===1&&waitKey.get(v)&&!key)continue;
      if(kind===1&&key)waitKey.set(v,false);
      try{v.send(b,{binary:true});}catch{}
    }
  });

  ws.on('close',()=>{
    if(role==='publisher'&&r.publisher===ws){r.publisher=undefined;r.streamConfig=undefined;}
    if(role==='viewer')r.viewers.delete(ws);
    update(id,r);
  });
  ws.on('error',()=>{try{ws.close();}catch{}});
});

export default server;
