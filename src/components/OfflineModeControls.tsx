import React, { useState, useEffect, useRef } from "react";
import { Mic, Square, Loader2, DownloadCloud, AlertTriangle, CheckCircle2 } from "lucide-react";
import { OfflineTranslator } from "../lib/OfflineTranslator";

interface Props {
  targetLang: string;
  sourceLang: string;
  onTranslation: (sourceText: string, translatedText: string, speaker: string) => void;
  onError: (msg: string) => void;
}

export function OfflineModeControls({ targetLang, sourceLang, onTranslation, onError }: Props) {
  const [isReady, setIsReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  
  const translatorRef = useRef<OfflineTranslator | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Reset state on unmount
    return () => {
      stopRecording();
      if (translatorRef.current) translatorRef.current.destroy();
    };
  }, []);

  const initTranslator = async () => {
    const src = sourceLang === 'auto' ? 'en' : sourceLang; // Chrome offline AI currently needs explicit source, default 'en' if auto.
    setIsDownloading(true);
    setProgress(0);
    try {
      const translator = new OfflineTranslator();
      const success = await translator.initialize(src, targetLang, (p) => setProgress(p));
      if (success) {
        translatorRef.current = translator;
        setIsReady(true);
      } else {
        onError("Offline translation is not supported by your browser for this language pair, or language pack download failed. Ensure you are using Chrome 131+ and have AI features enabled.");
      }
    } catch (e: any) {
      onError(`Failed to initialize offline models: ${e.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const startRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      onError("Speech Recognition is not supported in this browser. Try Chrome/Edge.");
      return;
    }

    if (!isReady && !translatorRef.current) {
        // Warning: Will only do STT without translation if we don't have translator
        onError("Please download the language model first.");
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = sourceLang === 'auto' ? 'en-US' : sourceLang;

    let finalTranscript = '';

    recognition.onresult = async (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text) {
             if (translatorRef.current) {
                try {
                   const translated = await translatorRef.current.translate(text);
                   onTranslation(text, translated, "Speaker");
                } catch(e) {
                   console.error("Translation fail:", e);
                }
             } else {
                 onTranslation(text, "[No Offline Model] " + text, "Speaker");
             }
          }
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn("Speech Recognition Error:", event.error);
      if (event.error === 'network') {
          onError("Speech Recognition failed due to network. Some OS require network for STT even if translation is offline.");
      }
    };

    recognition.onend = () => {
      // Auto restart if supposedly still recording
      if (isRecordingRef.current) {
         try { recognition.start(); } catch(e) {}
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
      isRecordingRef.current = true;
    } catch (e: any) {
      onError("Could not start microphone: " + e.message);
    }
  };

  const isRecordingRef = useRef(false);

  const stopRecording = () => {
    setIsRecording(false);
    isRecordingRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  return (
    <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-4 animate-in fade-in slide-in-from-top-4">
       {!isReady ? (
         <div className="w-full space-y-4 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex flex-col items-center justify-center mx-auto text-blue-400 mb-2">
               <DownloadCloud className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <p className="text-xl font-medium">Download Offline Language Pack</p>
              <p className="text-sm text-white/50">Run translations entirely on your device without sending data to the cloud.</p>
            </div>
            {isDownloading ? (
              <div className="w-full max-w-sm mx-auto space-y-2 mt-4">
                 <div className="flex justify-between text-xs text-white/70">
                    <span>Downloading AI Model...</span>
                    <span>{Math.round(progress)}%</span>
                 </div>
                 <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                    <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                 </div>
              </div>
            ) : (
              <button 
                onClick={initTranslator}
                className="mt-4 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition-all shadow-lg active:scale-[0.98]"
              >
                Download & Enable Offline Mode
              </button>
            )}
            <div className="mt-4 flex items-start gap-3 bg-blue-900/20 p-4 rounded-xl text-left border border-blue-500/20">
               <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
               <p className="text-xs text-blue-200/70 leading-relaxed">
                 <strong className="text-blue-300 block mb-1">Requirement:</strong>
                 Requires Google Chrome 131+ with Built-in AI features enabled. Open <code className="bg-black/30 px-1 py-0.5 rounded">chrome://flags/#translation-api</code> to enable it manually if not available. Note: Voice-to-text (STT) still uses your OS's speech engine, which may require a small network request depending on your device, but the translation runs entirely local.
               </p>
            </div>
         </div>
       ) : (
         <div className="w-full space-y-4 text-center">
            <div className="flex items-center justify-center gap-2 text-green-400 mb-6">
               <CheckCircle2 className="w-5 h-5" />
               <span className="font-medium">Offline Model Ready</span>
            </div>
            
            {isRecording ? (
               <button
                  onClick={stopRecording}
                  className="flex items-center gap-3 bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-2xl transition-all shadow-lg mx-auto"
               >
                  <Square className="w-5 h-5 fill-current" />
                  <span className="font-medium">Stop Offline Translation</span>
               </button>
            ) : (
               <button
                  onClick={startRecording}
                  className="flex items-center gap-3 bg-white/10 hover:bg-white/20 border border-white/10 px-8 py-4 rounded-2xl transition-all shadow-lg hover:shadow-xl group mx-auto"
               >
                  <div className="bg-white/10 p-2 rounded-full group-hover:bg-white/20 transition-all">
                    <Mic className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="text-left">
                     <p className="font-medium text-white/90">Start Offline Microphone</p>
                     <p className="text-xs text-white/50">Capture your voice without cloud</p>
                  </div>
               </button>
            )}
         </div>
       )}
    </div>
  );
}
