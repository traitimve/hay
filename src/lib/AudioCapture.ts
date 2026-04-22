export class AudioCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream;
  private workletNode: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  async initialize() {
    this.context = new AudioContext({ sampleRate: 16000 });
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = new Int16Array(1024);
          this.offset = 0;
        }
        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input && input.length > 0) {
            const channelData = input[0];
            for (let i = 0; i < channelData.length; i++) {
              this.buffer[this.offset++] = Math.max(-1, Math.min(1, channelData[i])) * 0x7FFF;
              if (this.offset >= this.buffer.length) {
                const out = new Int16Array(this.buffer);
                this.port.postMessage(out.buffer, [out.buffer]);
                this.offset = 0;
              }
            }
          }
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await this.context.audioWorklet.addModule(url);

    this.source = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.context, 'pcm-processor');

    this.source.connect(this.workletNode);
    // Connect worklet node to destination but muted to ensure sustained execution on some browsers
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.workletNode.connect(this.gain);
    this.gain.connect(this.context.destination);
  }

  start(onData: (base64: string) => void) {
    if (!this.workletNode) return;
    this.workletNode.port.onmessage = (e) => {
      const buffer = new Uint8Array(e.data);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < buffer.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(buffer.subarray(i, i + chunk)));
      }
      onData(btoa(binary));
    };
  }

  stop() {
    if (this.workletNode) {
      this.workletNode.disconnect();
    }
    if (this.source) {
      this.source.disconnect();
    }
    if (this.gain) {
      this.gain.disconnect();
    }
    if (this.context && this.context.state !== 'closed') {
      this.context.close();
    }
    this.stream.getTracks().forEach(t => t.stop());
  }
}
