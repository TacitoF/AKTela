import assert from 'node:assert/strict';
import {
  DECODER_STALL_ESCALATION_WINDOW_MS,
  VIDEO_PACKET_RECONNECT_MS,
  classifyVideoStall,
  decoderQueueLimits,
  nextDecoderStallCount,
  mediaConfigChanges
} from '../src/media-policy.ts';

assert.deepEqual(decoderQueueLimits(30), { soft: 8, hard: 16 });
assert.deepEqual(decoderQueueLimits(60), { soft: 15, hard: 30 });
assert.equal(classifyVideoStall(false, Infinity, Infinity), null, 'player inativo não pode entrar em recuperação');
assert.equal(classifyVideoStall(true, 3_501, 100), 'packets-stopped', 'falta de rede deve ser distinguida do decoder');
assert.equal(classifyVideoStall(true, 500, 2_501), 'decoder-stopped', 'pacotes recentes com frame velho indicam decoder parado');
assert.equal(classifyVideoStall(true, 2_000, 2_501), null, 'uma oscilação intermediária não deve resetar o player');
assert.equal(VIDEO_PACKET_RECONNECT_MS, 10_000, 'reconexão não deve ocorrer em um pico curto');
assert.equal(nextDecoderStallCount(1, 10_000, 20_000), 2, 'travamentos próximos devem acionar o fallback');
assert.equal(nextDecoderStallCount(4, 10_000, 10_000 + DECODER_STALL_ESCALATION_WINDOW_MS + 1), 1,
  'uma sessão estável deve encerrar a sequência de travamentos');

console.log('Player: limites de fila e recuperação diferenciada validados.');

const config = { width: 1280, height: 720, fps: 60, videoCodec: 'h264', videoCodecString: 'avc1.4D4020',
  audioEnabled: true, audioSampleRate: 48000, audioChannels: 2 };
assert.deepEqual(mediaConfigChanges(null, config), { video: true, audio: true });
assert.deepEqual(mediaConfigChanges(config, { ...config }), { video: false, audio: false });
assert.deepEqual(mediaConfigChanges(config, { ...config, width: 1920, height: 1080 }), { video: true, audio: false },
  'ajustar a resolução não pode reiniciar o áudio');
assert.deepEqual(mediaConfigChanges(config, { ...config, audioEnabled: false }), { video: false, audio: true },
  'alterar somente o áudio não pode reiniciar o vídeo');
assert.deepEqual(mediaConfigChanges(config, { ...config, audioSampleRate: 44100 }), { video: false, audio: true });
console.log('Player: áudio preservado nas mudanças de qualidade e vídeo independente do áudio.');
