import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright';

const server = await preview({ preview: { host: '127.0.0.1', port: 4179, strictPort: true } });
let browser;
const origin = 'http://127.0.0.1:4179';
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.route('**/worker-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Worker test</title>' }));
  await page.goto(`${origin}/worker-test`);
  const workerFile = fs.readdirSync(new URL('../dist/assets/', import.meta.url)).find(name => /^media-worker-.*\.js$/.test(name));
  assert.ok(workerFile, 'o build precisa publicar o worker');
  const decoded = await page.evaluate(async workerUrl => {
    const worker = new Worker(workerUrl, { type: 'module' });
    const frames = [];
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    let completed;
    let failed;
    const result = new Promise((resolve, reject) => { completed = resolve; failed = reject; });
    const timeout = setTimeout(() => failed(new Error('Worker não decodificou o vídeo em 8s.')), 8000);
    worker.onerror = error => failed(new Error(error.message));
    worker.onmessage = event => {
      const message = event.data;
      if (message.type === 'ready') ready(message.videoSupported);
      if (message.type === 'decoder-error' || message.type === 'fatal') failed(new Error(message.message));
      if (message.type === 'frame') {
        frames.push({ width: message.frame.codedWidth, timestamp: message.frame.timestamp });
        message.frame.close();
        worker.postMessage({ type: 'frame-consumed', decoderId: message.decoderId });
        if (frames.length === 2) completed(frames);
      }
    };
    try {
      if (!await started) throw new Error('WebCodecs ausente no worker.');
      worker.postMessage({ type: 'configure', decoderId: 1, config: { codec: 'vp8', codedWidth: 32, codedHeight: 32 } });
      let sequence = 0;
      const encoder = new VideoEncoder({
        output(chunk) {
          const buffer = new ArrayBuffer(chunk.byteLength);
          chunk.copyTo(buffer);
          worker.postMessage({ type: 'decode', decoderId: 1, sequence: ++sequence, key: chunk.type === 'key',
            timestamp: chunk.timestamp, duration: 33333, buffer }, [buffer]);
        }, error: failed
      });
      encoder.configure({ codec: 'vp8', width: 32, height: 32, bitrate: 100000, framerate: 30, latencyMode: 'realtime' });
      const canvas = new OffscreenCanvas(32, 32);
      canvas.getContext('2d').fillRect(0, 0, 32, 32);
      for (const timestamp of [0, 33333]) {
        const frame = new VideoFrame(canvas, { timestamp });
        encoder.encode(frame, { keyFrame: timestamp === 0 });
        frame.close();
      }
      await encoder.flush();
      encoder.close();
      return await result;
    } finally { clearTimeout(timeout); worker.terminate(); }
  }, `${origin}/assets/${workerFile}`);
  assert.deepEqual(decoded, [{ width: 32, timestamp: 0 }, { width: 32, timestamp: 33333 }]);
  await page.close();
  console.log('Browser: worker publicado decodifica e transfere VideoFrames reais.');

  for (const blockWorker of [false, true]) {
    const context = await browser.newContext();
    await context.addInitScript(({ blockWorker }) => {
      window.__sockets = [];
      window.__audioDecoders = [];
      if (blockWorker) window.Worker = class { constructor() { throw new Error('Worker bloqueado neste cliente.'); } };
      window.__config = { type: 'stream-config', protocol: 5, qualityKey: '720p30', videoCodec: 'vp8',
        videoProfile: 'compatibility', videoCodecString: 'vp8', width: 1280, height: 720, fps: 30,
        bitrateMbps: 4, audioEnabled: true, audioSampleRate: 48000, audioChannels: 2, preset: 'Jogo', compatibilityMode: false };
      window.AudioDecoder = class {
        static async isConfigSupported() { return { supported: true }; }
        state = 'unconfigured';
        decodeQueueSize = 0;
        constructor(callbacks) { this.callbacks = callbacks; window.__audioDecoders.push(this); }
        configure() { this.state = 'configured'; }
        decode() {}
        close() { this.state = 'closed'; }
      };
      window.WebSocket = class {
        static OPEN = 1;
        readyState = 0;
        sent = [];
        constructor(url) {
          this.url = url;
          this.params = new URL(url).searchParams;
          window.__sockets.push(this);
          queueMicrotask(() => {
            this.readyState = 1;
            this.onopen?.();
            if (this.params.has('observe')) this.emit({ type: 'stream-list', streams: [
              { id: 'first', slot: 1, label: 'Tela 1', publisherName: 'Primeiro' },
              { id: 'second', slot: 2, label: 'Tela 2', publisherName: 'Segundo' }
            ] });
            else { this.emit({ type: 'status', live: true }); this.emit(window.__config); }
          });
        }
        emit(value) { this.onmessage?.({ data: value instanceof ArrayBuffer ? value : JSON.stringify(value) }); }
        send(value) {
          this.sent.push(value);
          if (value === 'ping') queueMicrotask(() => this.onmessage?.({ data: 'pong' }));
        }
        close() { if (this.readyState === 3) return; this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
      };
    }, { blockWorker });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?frame_id=test&instance_id=test&platform=desktop`);
    await page.waitForFunction(() => window.__sockets.filter(s => s.params.get('streamId') && s.readyState === 1).length === 2);
    await page.locator('.focus-player').first().click();
    await page.waitForFunction(() => {
      const socket = window.__sockets.find(s => s.params.get('streamId') === 'first');
      return socket.sent.some(value => value.includes('"maxModeKey":"1080p60"'));
    });
    const before = await page.evaluate(() => ({
      connections: window.__sockets.filter(s => s.params.get('streamId') === 'first').length,
      audio: window.__audioDecoders.length
    }));
    assert.equal(before.connections, 1, 'destacar não pode reconectar o player');
    await page.evaluate(() => {
      const socket = window.__sockets.find(s => s.params.get('streamId') === 'first');
      socket.emit({ ...window.__config, width: 1920, height: 1080, fps: 60 });
    });
    assert.equal(await page.evaluate(() => window.__audioDecoders.length), before.audio,
      'alterar o vídeo não pode reconstruir o decoder de áudio');
    await page.evaluate(() => {
      const decoder = window.__audioDecoders.find(value => value.state === 'configured');
      decoder.state = 'closed';
      decoder.callbacks.error(new Error('falha simulada no áudio'));
      const bytes = new Uint8Array(25);
      bytes.set([65, 75, 86, 53, 5, 2, 1]);
      const view = new DataView(bytes.buffer);
      view.setInt32(16, 20000, true);
      view.setInt32(20, 1, true);
      window.__sockets.find(s => s.params.get('streamId') === 'first').emit(bytes.buffer);
    });
    await page.waitForFunction(count => window.__audioDecoders.length === count + 1, before.audio);
    await page.locator('.back-grid').click();
    assert.equal(await page.evaluate(() => window.__sockets.filter(s => s.params.get('streamId') === 'first').length), 1,
      'voltar à grade não pode reconectar a tela preservada');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Browser: destaque, áudio contínuo e recuperação isolada ${blockWorker ? 'com fallback sem worker' : 'com worker'}.`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
