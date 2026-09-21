export const VIDEO_PACKET_STALL_MS = 3_500;
export const VIDEO_PACKET_RECONNECT_MS = 10_000;
export const VIDEO_DECODER_STALL_MS = 2_500;
export const VIDEO_PACKET_RECENT_MS = 1_800;
export const DECODER_STALL_ESCALATION_WINDOW_MS = 30_000;

export type VideoStall = 'packets-stopped' | 'decoder-stopped' | null;

export function decoderQueueLimits(fps: number) {
  const normalizedFps = Number.isFinite(fps) ? Math.max(1, fps) : 30;
  const soft = Math.max(8, Math.ceil(normalizedFps * 0.25));
  return { soft, hard: soft * 2 };
}

export function classifyVideoStall(expectingVideo: boolean, packetAgeMs: number, frameAgeMs: number): VideoStall {
  if (!expectingVideo) return null;
  if (packetAgeMs > VIDEO_PACKET_STALL_MS) return 'packets-stopped';
  if (packetAgeMs < VIDEO_PACKET_RECENT_MS && frameAgeMs > VIDEO_DECODER_STALL_MS) return 'decoder-stopped';
  return null;
}

export function nextDecoderStallCount(previous: number, lastStallAt: number, now: number) {
  return lastStallAt > 0 && now - lastStallAt <= DECODER_STALL_ESCALATION_WINDOW_MS
    ? previous + 1
    : 1;
}

type MediaConfig = {
  width: number; height: number; fps: number; videoCodec: string; videoCodecString: string;
  audioEnabled: boolean; audioSampleRate: number; audioChannels: number;
};

export function mediaConfigChanges(previous: MediaConfig | null, next: MediaConfig) {
  return {
    video: !previous || previous.width !== next.width || previous.height !== next.height ||
      previous.fps !== next.fps || previous.videoCodec !== next.videoCodec || previous.videoCodecString !== next.videoCodecString,
    audio: !previous || previous.audioEnabled !== next.audioEnabled ||
      previous.audioSampleRate !== next.audioSampleRate || previous.audioChannels !== next.audioChannels
  };
}
