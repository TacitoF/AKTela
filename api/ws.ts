import { createServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

type Room = {
  publisher?: WebSocket;
  viewers: Set<WebSocket>;
};

const rooms = new Map<string, Room>();
const MAX_BUFFERED_BYTES = 1_500_000;

function getRoom(roomId: string) {
  let room = rooms.get(roomId);
  if (!room) {
    room = { viewers: new Set<WebSocket>() };
    rooms.set(roomId, room);
  }
  return room;
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function updateRoomStatus(roomId: string, room: Room) {
  const live = Boolean(room.publisher && room.publisher.readyState === WebSocket.OPEN);
  const count = room.viewers.size;

  for (const viewer of room.viewers) {
    sendJson(viewer, { type: 'status', live });
    sendJson(viewer, { type: 'viewer-count', count });
  }

  if (room.publisher) {
    sendJson(room.publisher, { type: 'viewer-count', count });
  }

  if (!room.publisher && room.viewers.size === 0) {
    rooms.delete(roomId);
  }
}

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, service: 'AKTela relay' }));
});

const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'https://aktela.invalid');
  const role = url.searchParams.get('role');
  const roomId = (url.searchParams.get('room') ?? '').trim().toUpperCase();

  if (!/^[A-Z2-9]{6}$/.test(roomId) || (role !== 'publisher' && role !== 'viewer')) {
    sendJson(ws, { type: 'error', message: 'Parâmetros de conexão inválidos.' });
    ws.close(1008, 'invalid parameters');
    return;
  }

  const room = getRoom(roomId);

  if (role === 'publisher') {
    if (room.publisher && room.publisher !== ws) {
      try { room.publisher.close(4001, 'publisher replaced'); } catch { /* noop */ }
    }
    room.publisher = ws;
  } else {
    room.viewers.add(ws);
  }

  updateRoomStatus(roomId, room);

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (!isBinary) {
      try {
        const text = data.toString();
        const message = JSON.parse(text) as { type?: string };
        if (message.type === 'ping') sendJson(ws, { type: 'pong' });
      } catch {
        // Mensagens de controle desconhecidas são ignoradas.
      }
      return;
    }

    if (role !== 'publisher' || room.publisher !== ws) return;

    for (const viewer of room.viewers) {
      if (viewer.readyState !== WebSocket.OPEN) continue;
      if (viewer.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      viewer.send(data, { binary: true });
    }
  });

  ws.on('close', () => {
    if (role === 'publisher' && room.publisher === ws) room.publisher = undefined;
    if (role === 'viewer') room.viewers.delete(ws);
    updateRoomStatus(roomId, room);
  });

  ws.on('error', () => {
    try { ws.close(); } catch { /* noop */ }
  });
});

export default server;
