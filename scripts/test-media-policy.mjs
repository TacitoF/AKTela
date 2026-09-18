import assert from 'node:assert/strict';
import {
  DECODER_STALL_ESCALATION_WINDOW_MS,
  VIDEO_PACKET_RECONNECT_MS,
  classifyVideoStall,
  decoderQueueLimits,
  nextDecoderStallCount
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
