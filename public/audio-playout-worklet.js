// Quatro blocos Opus de 20 ms absorvem pausas curtas do Chromium/Discord sem
// mascarar congestionamento real. Áudio e vídeo usam a mesma margem de 80 ms.
const DEFAULT_TARGET_MS = 80;
const DEFAULT_MAX_MS = 220;
const FADE_MS = 5;

class AKTelaAudioPlayoutProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channelCount = 2;
    this.targetFrames = this.msToFrames(DEFAULT_TARGET_MS);
    this.capacityFrames = this.msToFrames(DEFAULT_MAX_MS);
    this.fadeFrames = Math.max(1, this.msToFrames(FADE_MS));
    this.buffers = [];
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.startDelayFrames = 0;
    this.playing = false;
    this.fadeInRemaining = 0;
    this.fadeOutRemaining = 0;
    this.lastOutput = [0, 0];
    this.lastQueued = [0, 0];
    this.underflows = 0;
    this.droppedFrames = 0;
    this.reportCountdown = Math.max(1, Math.round(sampleRate / 4));
    this.allocateBuffers();

    this.port.onmessage = event => this.handleMessage(event.data);
  }

  msToFrames(milliseconds) {
    return Math.max(1, Math.round(sampleRate * milliseconds / 1000));
  }

  allocateBuffers() {
    this.buffers = Array.from(
      { length: this.channelCount },
      () => new Float32Array(this.capacityFrames)
    );
  }

  reset() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.startDelayFrames = 0;
    this.playing = false;
    this.fadeInRemaining = 0;
    this.fadeOutRemaining = 0;
    this.lastOutput.fill(0);
    this.lastQueued.fill(0);
  }

  configure(message) {
    const nextChannels = Math.max(1, Math.min(2, Number(message.channels) || 2));
    const nextTarget = this.msToFrames(Math.max(20, Math.min(120, Number(message.targetMs) || DEFAULT_TARGET_MS)));
    const nextCapacity = this.msToFrames(Math.max(80, Math.min(300, Number(message.maxMs) || DEFAULT_MAX_MS)));
    this.channelCount = nextChannels;
    this.targetFrames = Math.min(nextTarget, nextCapacity);
    this.capacityFrames = nextCapacity;
    this.allocateBuffers();
    this.reset();
  }

  handleMessage(message) {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'reset') {
      this.reset();
      return;
    }
    if (message.type === 'configure') {
      this.configure(message);
      return;
    }
    if (message.type === 'stats') {
      this.reportStats();
      return;
    }
    if (message.type !== 'push' || !Array.isArray(message.channels)) return;

    const planes = message.channels.filter(plane => plane instanceof Float32Array);
    if (planes.length === 0) return;
    const frameCount = Math.max(0, Math.min(Number(message.frames) || 0, ...planes.map(plane => plane.length)));
    if (frameCount === 0) return;

    if (!this.playing && this.availableFrames === 0) {
      this.startDelayFrames = Math.max(this.startDelayFrames, Math.max(0, Number(message.startDelayFrames) || 0));
    }

    const gapFrames = Math.max(0, Math.min(this.capacityFrames, Number(message.gapFrames) || 0));
    if (gapFrames > 0) this.pushGap(gapFrames);
    this.pushPlanes(planes, frameCount, gapFrames > 0);
  }

  makeRoom(frameCount) {
    if (frameCount >= this.capacityFrames) {
      const alreadyDropped = this.availableFrames;
      this.readIndex = 0;
      this.writeIndex = 0;
      this.availableFrames = 0;
      this.droppedFrames += alreadyDropped + frameCount - this.capacityFrames;
      return frameCount - this.capacityFrames;
    }

    const required = this.availableFrames + frameCount - this.capacityFrames;
    if (required > 0) {
      this.readIndex = (this.readIndex + required) % this.capacityFrames;
      this.availableFrames -= required;
      this.droppedFrames += required;
    }
    return 0;
  }

  pushGap(frameCount) {
    const skip = this.makeRoom(frameCount);
    const written = frameCount - skip;
    const left = this.lastQueued[0] || 0;
    const right = this.lastQueued[Math.min(1, this.channelCount - 1)] || 0;
    for (let frame = skip; frame < frameCount; frame++) {
      const gain = Math.max(0, 1 - frame / this.fadeFrames);
      const index = (this.writeIndex + frame - skip) % this.capacityFrames;
      for (let channel = 0; channel < this.channelCount; channel++) {
        const value = (channel === 0 ? left : right) * gain;
        this.buffers[channel][index] = value;
        this.lastQueued[channel] = value;
      }
    }
    this.writeIndex = (this.writeIndex + written) % this.capacityFrames;
    this.availableFrames += written;
  }

  pushPlanes(planes, frameCount, fadeIn) {
    const skip = this.makeRoom(frameCount);
    const written = frameCount - skip;
    for (let frame = skip; frame < frameCount; frame++) {
      const gain = fadeIn ? Math.min(1, (frame - skip + 1) / this.fadeFrames) : 1;
      const index = (this.writeIndex + frame - skip) % this.capacityFrames;
      for (let channel = 0; channel < this.channelCount; channel++) {
        const plane = planes[Math.min(channel, planes.length - 1)];
        const value = (plane[frame] || 0) * gain;
        this.buffers[channel][index] = value;
        this.lastQueued[channel] = value;
      }
    }
    this.writeIndex = (this.writeIndex + written) % this.capacityFrames;
    this.availableFrames += written;
  }

  beginPlaybackIfReady() {
    if (this.playing || this.startDelayFrames > 0 || this.availableFrames < this.targetFrames) return;
    this.playing = true;
    this.fadeInRemaining = this.fadeFrames;
    this.fadeOutRemaining = 0;
  }

  reportStats() {
    this.port.postMessage({
      type: 'stats',
      bufferedFrames: this.availableFrames,
      bufferedMs: Math.round(this.availableFrames * 1000 / sampleRate),
      underflows: this.underflows,
      droppedFrames: this.droppedFrames,
      playing: this.playing
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const quantumFrames = output[0].length;
    for (const channel of output) channel.fill(0);

    let offset = 0;
    if (this.startDelayFrames > 0) {
      const waiting = Math.min(quantumFrames, this.startDelayFrames);
      this.startDelayFrames -= waiting;
      offset = waiting;
    }

    this.beginPlaybackIfReady();

    for (let frame = offset; frame < quantumFrames; frame++) {
      if (this.playing && this.availableFrames === 0) {
        this.playing = false;
        this.fadeOutRemaining = this.fadeFrames;
        this.underflows++;
      }

      if (this.playing) {
        const fadeGain = this.fadeInRemaining > 0
          ? 1 - this.fadeInRemaining-- / this.fadeFrames
          : 1;
        for (let channel = 0; channel < output.length; channel++) {
          const sourceChannel = Math.min(channel, this.channelCount - 1);
          const value = this.buffers[sourceChannel][this.readIndex] * fadeGain;
          output[channel][frame] = value;
          this.lastOutput[sourceChannel] = value;
        }
        this.readIndex = (this.readIndex + 1) % this.capacityFrames;
        this.availableFrames--;
      } else if (this.fadeOutRemaining > 0) {
        const fadeGain = this.fadeOutRemaining-- / this.fadeFrames;
        for (let channel = 0; channel < output.length; channel++) {
          const sourceChannel = Math.min(channel, this.channelCount - 1);
          output[channel][frame] = this.lastOutput[sourceChannel] * fadeGain;
        }
      }
    }

    this.reportCountdown -= quantumFrames;
    if (this.reportCountdown <= 0) {
      this.reportCountdown = Math.max(1, Math.round(sampleRate / 4));
      this.reportStats();
    }
    return true;
  }
}

registerProcessor('aktela-audio-playout', AKTelaAudioPlayoutProcessor);
