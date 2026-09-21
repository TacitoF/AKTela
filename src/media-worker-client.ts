type DecoderCallbacks = { output: (frame: any) => void; error: (error: Error) => void };
type PendingRequest = { resolve: (value: any) => void; reject: (error: Error) => void; timeout: number };

class WorkerVideoDecoder {
  state = 'unconfigured';
  decodeQueueSize = 0;
  private submitted = 0;
  readonly id: number;
  private client: MediaWorkerClient;
  private callbacks: DecoderCallbacks;

  constructor(client: MediaWorkerClient, callbacks: DecoderCallbacks) {
    this.client = client;
    this.callbacks = callbacks;
    this.id = client.nextId();
  }

  configure(config: unknown) {
    this.state = 'configured';
    this.client.send({ type: 'configure', decoderId: this.id, config });
  }

  decodePacket(key: boolean, timestamp: number, duration: number, payload: Uint8Array) {
    if (this.state !== 'configured') throw new Error('Decoder de vídeo indisponível.');
    const buffer = payload.slice().buffer;
    this.decodeQueueSize++;
    this.client.send({ type: 'decode', decoderId: this.id, sequence: ++this.submitted, key, timestamp, duration, buffer }, [buffer]);
  }

  accept(message: any) {
    if (Number.isFinite(message.processed))
      this.decodeQueueSize = Math.max(0, this.submitted - message.processed) + (message.queueSize ?? 0);
    if (message.type === 'frame') this.callbacks.output(message.frame);
    if (message.type === 'decoder-error') {
      this.state = 'closed';
      this.callbacks.error(new Error(message.message));
    }
  }

  close() {
    this.state = 'closed';
    this.decodeQueueSize = 0;
    this.client.send({ type: 'close', decoderId: this.id });
  }
}

export class MediaWorkerClient {
  videoSupported = false;
  onFailure: (() => void) | null = null;
  private worker: Worker;
  private sequence = 0;
  private decoder: WorkerVideoDecoder | null = null;
  private pending = new Map<number, PendingRequest>();
  private disposed = false;

  private constructor(worker: Worker) { this.worker = worker; }

  static create(): Promise<MediaWorkerClient | null> {
    return new Promise(resolve => {
      let worker: Worker;
      try { worker = new Worker(new URL('./media-worker.ts', import.meta.url), { type: 'module' }); }
      catch { resolve(null); return; }
      const client = new MediaWorkerClient(worker);
      const timeout = window.setTimeout(() => { client.dispose(); resolve(null); }, 1500);
      const fail = () => {
        window.clearTimeout(timeout);
        client.onFailure?.();
        client.dispose();
        resolve(null);
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.onmessage = event => {
        const message = event.data;
        if (message.type === 'ready') {
          window.clearTimeout(timeout);
          client.videoSupported = message.videoSupported;
          resolve(client);
        } else client.receive(message);
      };
    });
  }

  nextId() { return ++this.sequence; }

  send(message: unknown, transfers: Transferable[] = []) {
    if (!this.disposed) this.worker.postMessage(message, transfers);
  }

  private request(type: string, value: Record<string, unknown>) {
    if (this.disposed || this.pending.size >= 12)
      return Promise.reject(new Error('O processamento de mídia não acompanhou a transmissão.'));
    const requestId = this.nextId();
    return new Promise<any>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.onFailure?.();
        this.dispose();
      }, 3000);
      this.pending.set(requestId, { resolve, reject, timeout });
      try { this.send({ type, requestId, ...value }); }
      catch (error) {
        window.clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  prepareBase64(value: string): Promise<ArrayBuffer> { return this.request('base64', { value }); }
  isVideoConfigSupported(config: unknown): Promise<boolean> { return this.request('support', { config }); }

  createVideoDecoder(callbacks: DecoderCallbacks) {
    this.decoder?.close();
    this.decoder = new WorkerVideoDecoder(this, callbacks);
    return this.decoder;
  }

  private receive(message: any) {
    if (this.disposed) { message.frame?.close(); return; }
    if (message.type === 'fatal') {
      this.onFailure?.();
      this.dispose();
      return;
    }
    if (message.requestId) {
      const pending = this.pending.get(message.requestId);
      this.pending.delete(message.requestId);
      if (pending) window.clearTimeout(pending.timeout);
      if (message.type === 'request-error') pending?.reject(new Error(message.message));
      else pending?.resolve(message.type === 'prepared' ? message.buffer : message.supported);
      return;
    }
    const decoder = this.decoder;
    if (decoder && message.decoderId === decoder.id && decoder.state !== 'closed') {
      try { decoder.accept(message); }
      finally {
        if (message.type === 'frame') this.send({ type: 'frame-consumed', decoderId: message.decoderId });
      }
    } else if (message.type === 'frame') {
      message.frame.close();
      this.send({ type: 'frame-consumed', decoderId: message.decoderId });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(new Error('Processamento de mídia encerrado.'));
    }
    this.pending.clear();
  }
}
