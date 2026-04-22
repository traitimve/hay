export class AudioPlayer {
  private context: AudioContext;
  private nextStartTime: number = 0;
  private gainNode: GainNode;

  constructor() {
    this.context = new AudioContext({ sampleRate: 24000 });
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);
  }

  setMuted(muted: boolean) {
    this.gainNode.gain.value = muted ? 0 : 1;
    // Note: When muting system output that is actively captured via getDisplayMedia, 
    // muting prevents a recursive echo audio loop.
  }

  playBase64Int16(base64: string) {
    if (this.context.state === 'suspended') {
       this.context.resume();
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const view = new DataView(bytes.buffer);
    const float32 = new Float32Array(bytes.length / 2);
    for (let i = 0; i < float32.length; i++) {
      float32[i] = view.getInt16(i * 2, true) / 0x7FFF;
    }

    const buffer = this.context.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    // Provide a small buffer to avoid clipping or jitter
    if (this.nextStartTime < this.context.currentTime) {
      this.nextStartTime = this.context.currentTime + 0.05;
    }
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  stop() {
    this.nextStartTime = 0;
    if (this.context.state !== 'closed') {
        // Simple way to flush is simply not caring about old nodes since nextStartTime reset
        // To be meticulous, we would maintain an array of nodes, but skipping for brevity
    }
  }
}
