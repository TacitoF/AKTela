import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let Processor;
const reports = [];

class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage: message => reports.push(message)
    };
  }
}

const context = vm.createContext({
  AudioWorkletProcessor: MockAudioWorkletProcessor,
  Float32Array,
  Array,
  Math,
  Number,
  sampleRate: 48_000,
  registerProcessor(name, implementation) {
    assert.equal(name, 'aktela-audio-playout');
    Processor = implementation;
  }
});

const source = await readFile(new URL('../public/audio-playout-worklet.js', import.meta.url), 'utf8');
vm.runInContext(source, context, { filename: 'audio-playout-worklet.js' });
assert.ok(Processor, 'o processador precisa ser registrado');

const processor = new Processor();
assert.equal(processor.targetFrames, 3_840, 'a reserva padrão deve absorver pausas curtas do cliente');
assert.equal(processor.capacityFrames, 10_560, 'o limite padrão não deve deixar o áudio acumular atraso');
processor.port.onmessage({ data: { type: 'configure', channels: 2, targetMs: 20, maxMs: 80 } });

const left = new Float32Array(960).fill(0.5);
const right = new Float32Array(960).fill(-0.5);
processor.port.onmessage({ data: { type: 'push', channels: [left, right], frames: 960, startDelayFrames: 128 } });

const first = [[new Float32Array(128), new Float32Array(128)]];
processor.process([], first);
assert.ok(first[0][0].every(value => value === 0), 'o início agendado deve ser respeitado');

const second = [[new Float32Array(128), new Float32Array(128)]];
processor.process([], second);
assert.ok(second[0][0].some(value => value > 0), 'o áudio deve começar após formar a reserva');
assert.ok(second[0][1].some(value => value < 0), 'os dois canais devem ser preservados');

for (let index = 0; index < 7; index++) {
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
}
const underflow = [[new Float32Array(128), new Float32Array(128)]];
processor.process([], underflow);
assert.ok(underflow[0][0][0] > 0, 'uma microfalta deve receber fade-out em vez de um corte seco');

processor.port.onmessage({ data: { type: 'stats' } });
const stats = reports.at(-1);
assert.equal(stats.type, 'stats');
assert.equal(stats.underflows, 1);

processor.port.onmessage({ data: { type: 'reset' } });
processor.port.onmessage({ data: { type: 'configure', channels: 2, targetMs: 20, maxMs: 80 } });
const oversized = new Float32Array(5_000).fill(0.25);
processor.port.onmessage({ data: { type: 'push', channels: [oversized, oversized], frames: oversized.length } });
processor.port.onmessage({ data: { type: 'stats' } });
assert.ok(reports.at(-1).droppedFrames > 0, 'o buffer deve limitar atraso excessivo');

console.log('AudioWorklet: buffer, canais, suavização e limite validados.');
