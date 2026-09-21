import { base64ToArrayBuffer } from './media-transport';

const scope = globalThis as any;
let decoder: any = null;
let decoderId = 0;
let processed = 0;
let outstandingFrames = 0;
const MAX_OUTSTANDING_FRAMES = 4;

function queueState() {
  return { decoderId, processed, queueSize: Number(decoder?.decodeQueueSize ?? 0) };
}

function closeDecoder() {
  try { decoder?.close(); } catch { }
  decoder = null;
  outstandingFrames = 0;
}

scope.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === 'base64') {
      const buffer = base64ToArrayBuffer(message.value);
      scope.postMessage({ type: 'prepared', requestId: message.requestId, buffer }, [buffer]);
    } else if (message.type === 'support') {
      const result = await scope.VideoDecoder.isConfigSupported(message.config);
      scope.postMessage({ type: 'supported', requestId: message.requestId, supported: !!result.supported });
    } else if (message.type === 'configure') {
      closeDecoder();
      decoderId = message.decoderId;
      processed = 0;
      const generation = decoderId;
      decoder = new scope.VideoDecoder({
        output(frame: any) {
          if (generation !== decoderId) { frame.close(); return; }
          if (outstandingFrames >= MAX_OUTSTANDING_FRAMES) {
            frame.close();
            return;
          }
          outstandingFrames++;
          try { scope.postMessage({ type: 'frame', frame, ...queueState() }, [frame]); }
          catch {
            frame.close();
            scope.postMessage({ type: 'fatal', message: 'Não foi possível transferir o vídeo do worker.' });
          }
        },
        error(error: Error) {
          if (generation === decoderId)
            scope.postMessage({ type: 'decoder-error', decoderId, message: error.message });
        }
      });
      decoder.ondequeue = () => {
        if (generation === decoderId) scope.postMessage({ type: 'queue', ...queueState() });
      };
      decoder.configure(message.config);
    } else if (message.type === 'decode' && message.decoderId === decoderId) {
      processed = message.sequence;
      decoder.decode(new scope.EncodedVideoChunk({
        type: message.key ? 'key' : 'delta', timestamp: message.timestamp,
        duration: message.duration, data: message.buffer
      }));
      scope.postMessage({ type: 'queue', ...queueState() });
    } else if (message.type === 'frame-consumed' && message.decoderId === decoderId) {
      outstandingFrames = Math.max(0, outstandingFrames - 1);
    } else if (message.type === 'close' && message.decoderId === decoderId) {
      decoderId = 0;
      closeDecoder();
    }
  } catch (error: any) {
    scope.postMessage({
      type: message.requestId ? 'request-error' : 'decoder-error',
      requestId: message.requestId, decoderId: message.decoderId,
      message: String(error?.message ?? error)
    });
  }
};

scope.postMessage({ type: 'ready', videoSupported: !!scope.VideoDecoder && !!scope.EncodedVideoChunk });
