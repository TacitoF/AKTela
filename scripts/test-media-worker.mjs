import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { base64ToArrayBuffer } from '../src/media-transport.ts';

const source = fs.readFileSync(new URL('../src/media-worker.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const posted = [];
const frames = [];
const decoders = [];
class Decoder {
  static async isConfigSupported() { return { supported: true }; }
  decodeQueueSize = 0;
  state = 'unconfigured';
  constructor(callbacks) { this.callbacks = callbacks; decoders.push(this); }
  configure() { this.state = 'configured'; }
  decode(chunk) {
    if (this.state !== 'configured') throw new Error('closed');
    const frame = { timestamp: chunk.timestamp, closed: false, close() { this.closed = true; } };
    frames.push(frame);
    this.callbacks.output(frame);
  }
  close() { this.state = 'closed'; }
}
const scope = vm.createContext({ exports: {}, require: () => ({ base64ToArrayBuffer }),
  VideoDecoder: Decoder, EncodedVideoChunk: class { constructor(value) { Object.assign(this, value); } },
  postMessage: message => posted.push(message) });
vm.runInContext(code, scope);
const send = data => scope.onmessage({ data });
assert.equal(posted[0].videoSupported, true);
await send({ type: 'base64', requestId: 1, value: Buffer.from([0, 255, 17, 65]).toString('base64') });
assert.deepEqual([...new Uint8Array(posted.at(-1).buffer)], [0, 255, 17, 65]);
await send({ type: 'configure', decoderId: 10, config: {} });
for (let sequence = 1; sequence <= 10; sequence++)
  await send({ type: 'decode', decoderId: 10, sequence, timestamp: sequence, buffer: new ArrayBuffer(1) });
assert.equal(posted.filter(message => message.type === 'frame').length, 4,
  'uma interface travada não pode acumular superfícies de vídeo sem limite');
assert.equal(frames.filter(frame => frame.closed).length, 6);
await send({ type: 'frame-consumed', decoderId: 10 });
await send({ type: 'decode', decoderId: 10, sequence: 11, timestamp: 11, buffer: new ArrayBuffer(1) });
assert.equal(posted.filter(message => message.type === 'frame').length, 5);
await send({ type: 'configure', decoderId: 20, config: {} });
const late = { closed: false, close() { this.closed = true; } };
decoders[0].callbacks.output(late);
assert.equal(late.closed, true, 'frames de um decoder substituído precisam ser liberados');
await send({ type: 'close', decoderId: 10 });
assert.equal(decoders[1].state, 'configured', 'fechamento atrasado não pode encerrar o decoder novo');
decoders[1].callbacks.error(new Error('driver failed'));
assert.equal(posted.at(-1).type, 'decoder-error');
assert.equal(posted.at(-1).decoderId, 20);
await send({ type: 'close', decoderId: 20 });
assert.equal(decoders[1].state, 'closed');
console.log('Worker: mídia, descarte sob pressão, gerações e falhas isoladas validados.');
