import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import React, { useState, useEffect, useRef } from "react";
import { AudioCapture } from "./lib/AudioCapture";
import { AudioPlayer } from "./lib/AudioPlayer";
import { Mic, Monitor, Volume2, VolumeX, Loader2, Square, Settings, X } from "lucide-react";

// Removed global initialized AI
export default function App() {
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [translations, setTranslations] = useState<string>("");
  const [transcriptions, setTranscriptions] = useState<string>("");
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [voice, setVoice] = useState("Zephyr");
  const [speed, setSpeed] = useState("normal");
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  
  const captureRef = useRef<AudioCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const sessionRef = useRef<any>(null); // To keep a reference to the active session
  const textEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to latest translation
    textEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [translations]);

  const handleStart = async (sourceType: 'mic' | 'system') => {
    setError(null);
    setIsConnecting(true);
    setTranslations("");
    setTranscriptions("");

    try {
      if (!playerRef.current) {
        playerRef.current = new AudioPlayer();
      }
      playerRef.current.setMuted(isMuted);

      let stream: MediaStream;
      if (sourceType === 'system') {
        stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true, 
          audio: {
            echoCancellation: noiseSuppression,
            noiseSuppression: noiseSuppression,
            autoGainControl: noiseSuppression,
          } 
        });
        // We might want to auto-mute the output so it doesn't create feedback
        if (!isMuted) {
           setIsMuted(true);
           playerRef.current.setMuted(true);
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: noiseSuppression,
            noiseSuppression: noiseSuppression,
            autoGainControl: noiseSuppression,
          } 
        });
      }

      if (stream.getAudioTracks().length === 0) {
        throw new Error("No audio track detected. Make sure to share audio.");
      }

      const capture = new AudioCapture(stream);
      captureRef.current = capture;
      
      // Initialize AudioContext completely while browser still acknowledges recent user interaction
      await capture.initialize();

      // Initialize the Google GenAI SDK internally right before call to ensure we pick up fresh keys
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
          inputAudioTranscription: { },
          systemInstruction: `You are an ultra-low latency real-time AI audio translator. Translate incoming audio to Vietnamese IMMEDIATELY as you hear it. 
CRITICAL RULES:
1. TRANSLATE WORD-BY-WORD or by SHORT PHRASES.
2. DO NOT wait for complete sentences. 
3. DO NOT wait for grammatical context. 
4. Sacrifice perfect grammar if necessary to output the translation of the current words instantly. 
5. Output only the direct Vietnamese translation. Do not converse. Speak clearly at a ${speed} speed.`,
        },
        callbacks: {
          onopen: () => {
            setIsConnecting(false);
            setIsLive(true);
            capture.start((base64Data) => {
              sessionPromise.then(session => {
                // Safely apply only active session inputs
                if(sessionRef.current === session) {
                  session.sendRealtimeInput({
                    audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                  });
                }
              });
            });
          },
          onmessage: (message: LiveServerMessage) => {
            // Debug transcription logging
            if (message.serverContent) {
                // Read the transcription of the user's speech
                const inputTranscriptText = message.serverContent?.inputTranscription?.text;
                if (inputTranscriptText) {
                   setTranscriptions(prev => prev + inputTranscriptText);
                }
            }

            // Play incoming translated audio
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              playerRef.current?.playBase64Int16(base64Audio);
            }

            // Accumulate incoming text translation
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              let textChunk = "";
              for (const p of parts) {
                if (p.text) textChunk += p.text;
              }
              if (textChunk) {
                setTranslations(prev => prev + textChunk);
              }
            }
          },
          onclose: () => {
            stopEverything();
          },
          onerror: (err: any) => {
            console.error("Live API Session Error:", err);
            setError("Connection error. Check your API key or network.");
            stopEverything();
          }
        }
      });
      
      sessionPromise.then((session) => {
         sessionRef.current = session;
      }).catch((err) => {
         console.error("Live API Connect Error:", err);
         setError(`Connection Failed: ${err.message}`);
         stopEverything();
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to start audio connection.");
      stopEverything();
    }
  };

  const stopEverything = () => {
    setIsConnecting(false);
    setIsLive(false);
    if (captureRef.current) {
      captureRef.current.stop();
      captureRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop();
      // We don't nullify player so we don't recreate audio context necessarily,
      // but might be safer if user switched devices. Let's keep it alive for better performance.
    }
    if (sessionRef.current) {
      sessionRef.current.close?.(); // Attempt to cleanly close
      sessionRef.current = null;
    }
  };

  const handleMuteToggle = () => {
    const newState = !isMuted;
    setIsMuted(newState);
    if (playerRef.current) {
      playerRef.current.setMuted(newState);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0502] text-white font-sans flex flex-col relative overflow-hidden">
      {/* Background atmosphere */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-60">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#ff4e00] rounded-full blur-[120px] mix-blend-screen opacity-20"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#3a1510] rounded-full blur-[120px] mix-blend-screen opacity-40"></div>
      </div>

      {/* Header */}
      <header className="relative z-10 px-8 py-6 border-b border-white/5 flex items-center justify-between backdrop-blur-md bg-black/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-orange-500 to-red-600">
            <Volume2 className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-xl font-medium tracking-wide">LiveViet Translator</h1>
        </div>
        <div className="flex items-center gap-4">
           {/* Settings Button */}
           <button 
             onClick={() => setShowSettings(true)}
             className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors"
           >
             <Settings className="w-5 h-5 text-white/70" />
           </button>
           <div className="flex items-center gap-4 text-sm text-white/50 bg-white/5 px-4 py-2 rounded-full border border-white/10">
              <span className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : isConnecting ? 'bg-orange-500' : 'bg-red-500'}`}></div>
                {isLive ? 'Live' : isConnecting ? 'Connecting...' : 'Disconnected'}
              </span>
           </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative z-10 p-8 max-w-6xl w-full mx-auto gap-8">
        {error && (
           <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl backdrop-blur-sm">
             {error}
           </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-4 py-4">
           {!isLive && !isConnecting ? (
             <>
                <button
                  onClick={() => handleStart('mic')}
                  className="flex items-center gap-3 bg-white/10 hover:bg-white/20 border border-white/10 px-6 py-4 rounded-2xl transition-all shadow-lg hover:shadow-xl group"
                >
                  <div className="bg-white/10 p-2 rounded-full group-hover:bg-white/20 transition-all">
                    <Mic className="w-5 h-5 text-orange-400" />
                  </div>
                  <div className="text-left">
                     <p className="font-medium text-white/90">Translate Microphone</p>
                     <p className="text-xs text-white/50">Capture your voice</p>
                  </div>
                </button>
                <button
                  onClick={() => handleStart('system')}
                  className="flex items-center gap-3 bg-white/10 hover:bg-white/20 border border-white/10 px-6 py-4 rounded-2xl transition-all shadow-lg hover:shadow-xl group"
                >
                  <div className="bg-white/10 p-2 rounded-full group-hover:bg-white/20 transition-all">
                    <Monitor className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="text-left">
                     <p className="font-medium text-white/90">Translate Computer Audio</p>
                     <p className="text-xs text-white/50">Capture internal sounds / videos</p>
                  </div>
                </button>
             </>
           ) : (
             <button
                onClick={stopEverything}
                className="flex items-center gap-3 bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-2xl transition-all shadow-lg"
             >
                {isConnecting ? <Loader2 className="w-5 h-5 animate-spin"/> : <Square className="w-5 h-5 fill-current" />}
                <span className="font-medium">{isConnecting ? 'Connecting...' : 'Stop Translation'}</span>
             </button>
           )}

           <button
              onClick={handleMuteToggle}
              className={`flex items-center gap-2 px-6 py-4 rounded-2xl border transition-all ${
                isMuted 
                  ? 'bg-red-500/10 border-red-500/30 text-red-400' 
                  : 'bg-green-500/10 border-green-500/30 text-green-400'
              }`}
           >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              <span className="font-medium text-sm text-center">Translation<br />Audio {isMuted ? 'Muted' : 'On'}</span>
           </button>
        </div>

        {/* Output area */}
        <div className="flex-1 min-h-[400px] gap-6 grid grid-cols-1 md:grid-cols-2 relative z-10 w-full">
           
           {/* Source Transcription */}
           <div className="flex relative flex-col bg-white/5 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-xl shadow-2xl">
             <div className="p-4 border-b border-white/10 bg-black/20 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-widest text-white/50">Source Subtitles</h2>
             </div>
             
             <div className="flex-1 p-6 overflow-y-auto whitespace-pre-wrap font-sans text-2xl text-slate-400 leading-snug">
                {transcriptions || (
                  <span className="text-white/20 italic font-sans text-lg">
                    {isLive ? 'Waiting for speech...' : 'Awaiting connection...'}
                  </span>
                )}
                <div ref={textEndRef} />
             </div>
           </div>

           {/* Vietnamese Translation */}
           <div className="flex relative flex-col bg-white/5 border border-white/10 border-t-orange-500/50 border-t-2 rounded-3xl overflow-hidden backdrop-blur-xl shadow-2xl">
             <div className="p-4 border-b border-white/10 bg-black/20 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-widest text-[#ff4e00]">Vietnamese Translation</h2>
                <div className="flex items-center gap-2">
                   <span className="w-2 h-2 rounded-full bg-white/20"></span>
                   <span className="w-2 h-2 rounded-full bg-white/20"></span>
                   <span className="w-2 h-2 rounded-full bg-white/20"></span>
                </div>
             </div>
             
             <div className="flex-1 p-6 overflow-y-auto whitespace-pre-wrap font-serif text-3xl leading-relaxed text-slate-100">
                {translations || (
                  <span className="text-white/20 italic font-sans text-xl">
                    {isLive ? 'Listening & Translating...' : 'Awaiting connection...'}
                  </span>
                )}
             </div>
           </div>

        </div>

      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#151619] border border-white/10 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/10 bg-white/5">
              <h3 className="text-lg font-medium text-white/90 flex items-center gap-2">
                <Settings className="w-5 h-5 text-orange-400" />
                Audio Settings
              </h3>
              <button 
                onClick={() => setShowSettings(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors text-white/50 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
               {/* Voice Selection */}
               <div className="space-y-2">
                 <label className="text-sm font-medium text-white/70">Translation Voice</label>
                 <select 
                   value={voice}
                   onChange={(e) => setVoice(e.target.value)}
                   className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 appearance-none"
                 >
                    <option value="Zephyr">Zephyr (Deep & Calm)</option>
                    <option value="Puck">Puck (Warm & Friendly)</option>
                    <option value="Kore">Kore (Clear & Concise)</option>
                    <option value="Charon">Charon (Authoritative)</option>
                    <option value="Fenrir">Fenrir (Strong & Resonant)</option>
                    <option value="Aoede">Aoede (Soft & Melodic)</option>
                 </select>
               </div>

               {/* Translation Speed */}
               <div className="space-y-2">
                 <label className="text-sm font-medium text-white/70">Reading Speed</label>
                 <select 
                   value={speed}
                   onChange={(e) => setSpeed(e.target.value)}
                   className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 appearance-none"
                 >
                    <option value="slow">Slow</option>
                    <option value="normal">Normal</option>
                    <option value="fast">Fast</option>
                 </select>
               </div>

               {/* Noise Suppression */}
               <div className="space-y-3 pt-2">
                 <div className="flex items-center justify-between">
                   <div>
                     <p className="text-sm font-medium text-white/90">Noise & Echo Suppression</p>
                     <p className="text-xs text-white/50 max-w-[250px]">Turn ON to remove background static for mic translation. Turn OFF if capturing raw PC high-fidelity audio.</p>
                   </div>
                   <label className="relative inline-flex items-center cursor-pointer">
                     <input type="checkbox" checked={noiseSuppression} onChange={(e) => setNoiseSuppression(e.target.checked)} className="sr-only peer"/>
                     <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                   </label>
                 </div>
               </div>
            </div>
            
            <div className="px-6 py-4 border-t border-white/10 bg-white/5 text-xs text-white/40 italic">
               Note: Applying translation config requires stopping and restarting the live connection.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
