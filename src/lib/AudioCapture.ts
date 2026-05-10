export class AudioCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream;
  private workletNode: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  public analyser: AnalyserNode | null = null;

  constructor(stream: MediaStream) {
    this.stream = stream;
  }

  async initialize(voiceIsolation: boolean = false) {
    this.context = new AudioContext({ sampleRate: 16000 });
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = new Int16Array(1024);
          this.offset = 0;
          this.silenceFrames = 0;
          this.noiseThreshold = 0.00;
          this.silenceDelayFrames = 2.0 * (16000 / 128); // Approx frames per process
          
          this.port.onmessage = (e) => {
            if (e.data.noiseThreshold !== undefined) {
              this.noiseThreshold = e.data.noiseThreshold;
            }
            if (e.data.silenceDelay !== undefined) {
              this.silenceDelayFrames = e.data.silenceDelay * (16000 / 128);
            }
          };
        }
        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input && input.length > 0) {
            const channelData = input[0];
            
            // Calculate RMS for this block
            let sumSquare = 0;
            for (let i = 0; i < channelData.length; i++) {
               sumSquare += channelData[i] * channelData[i];
            }
            const rms = Math.sqrt(sumSquare / channelData.length);
            
            if (rms > this.noiseThreshold) {
               this.silenceFrames = 0;
            } else {
               this.silenceFrames++;
            }
            
            const isSilent = this.silenceFrames > this.silenceDelayFrames;

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

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.5;

    this.workletNode = new AudioWorkletNode(this.context, 'pcm-processor');

    if (voiceIsolation) {
      // Advanced Audio Processing Chain for Extreme Noise:
      // 1. Clean High-Pass Filter: Cuts rumble but preserves male voice fundamental frequencies
      const hpf = this.context.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 80; // Changed from 250Hz to 80Hz to preserve deep voices

      // 2. Vocal Presence Boost: Subtle peaking for clarity
      const peaking = this.context.createBiquadFilter();
      peaking.type = 'peaking';
      peaking.frequency.value = 3500; 
      peaking.Q.value = 1.0;
      peaking.gain.value = 4; // Much less aggressive than 12dB

      // 3. Narrow Bandpass Filter: Cuts hiss and very high frequencies
      const lpf = this.context.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 8000; // Increased from 5000Hz to 8000Hz for clearer consonants like 's'

      // 4. Smooth Compressor: Evens out volume without strictly clipping
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-24, this.context.currentTime); // less extreme than -35
      compressor.knee.setValueAtTime(30, this.context.currentTime);
      compressor.ratio.setValueAtTime(8, this.context.currentTime); // less extreme than 20
      compressor.attack.setValueAtTime(0.003, this.context.currentTime); // slower attack to let transients through
      compressor.release.setValueAtTime(0.25, this.context.currentTime);

      // Noise Gate approach: Expanding dynamics or just the compressor + filters.
      // Chain: Source -> HPF -> Peaking -> LPF -> Compressor -> Analyser -> Worklet
      this.source.connect(hpf);
      hpf.connect(peaking);
      peaking.connect(lpf);
      lpf.connect(compressor);
      compressor.connect(this.analyser);
    } else {
      // Standard chain with mild high-pass only and a gentle volume boost for computer audio
      const mildHPF = this.context.createBiquadFilter();
      mildHPF.type = 'highpass';
      mildHPF.frequency.value = 20; // Very mild high-pass for computer audio
      
      // Auto Gain Control / Gentile Compressor to boost lowest volume voices 
      // without distorting normal computer audio volume
      const smoothCompressor = this.context.createDynamicsCompressor();
      smoothCompressor.threshold.setValueAtTime(-50, this.context.currentTime); // Catch quiet voices
      smoothCompressor.knee.setValueAtTime(12, this.context.currentTime);
      smoothCompressor.ratio.setValueAtTime(4, this.context.currentTime); // Gentle ratio
      smoothCompressor.attack.setValueAtTime(0.005, this.context.currentTime);
      smoothCompressor.release.setValueAtTime(0.1, this.context.currentTime);
      
      // Makeup gain to boost the volume of the quiet voices
      const makeupGain = this.context.createGain();
      makeupGain.gain.value = 2.5; 
      
      this.source.connect(mildHPF);
      mildHPF.connect(smoothCompressor);
      smoothCompressor.connect(makeupGain);
      makeupGain.connect(this.analyser);
    }

    this.analyser.connect(this.workletNode);
    
    // Connect worklet node to destination but muted to ensure sustained execution on some browsers
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.workletNode.connect(this.gain);
    this.gain.connect(this.context.destination);
  }

  setVad(threshold: number, delay: number) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        noiseThreshold: threshold,
        silenceDelay: delay
      });
    }
  }

  start(onData: (base64: string) => void) {
    if (!this.workletNode) return;
    this.workletNode.port.onmessage = (e) => {
      // Ignore if it's not a buffer (e.g. from our setVad)
      if (!(e.data instanceof ArrayBuffer)) return;
      
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
