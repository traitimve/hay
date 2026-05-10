import { GoogleGenAI, LiveServerMessage, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";
import React, { useState, useEffect, useRef } from "react";
import { AudioCapture } from "./lib/AudioCapture";
import { AudioPlayer } from "./lib/AudioPlayer";
import { Mic, Monitor, Volume2, VolumeX, Loader2, Square, Settings, X, Activity, FileUp, Upload, CheckCircle2, UserCog, UserPlus, Trash2, Globe } from "lucide-react";
import { AudioVisualizer } from "./components/AudioVisualizer";
import { OfflineModeControls } from "./components/OfflineModeControls";

// Removed global initialized AI
export default function App() {
  const [mode, setMode] = useState<'live' | 'batch' | 'offline'>('live');
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchProgress, setBatchProgress] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [translations, setTranslations] = useState<string>("");
  const [speakerSegments, setSpeakerSegments] = useState<{speaker: string, text: string, timestamp: string}[]>([]);
  const [transcriptions, setTranscriptions] = useState<string>("");
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [voiceIsolation, setVoiceIsolation] = useState(() => localStorage.getItem("gemini_voice_isolation") === "true");
  const [ttsEngine, setTtsEngine] = useState(() => localStorage.getItem("gemini_tts_engine") || "native");
  const [sourceLang, setSourceLang] = useState(() => localStorage.getItem("gemini_source_lang") || "auto");
  const [targetLang, setTargetLang] = useState(() => localStorage.getItem("gemini_target_lang") || "vi-VN");

  useEffect(() => {
    localStorage.setItem("gemini_source_lang", sourceLang);
  }, [sourceLang]);
  useEffect(() => {
    localStorage.setItem("gemini_voice_isolation", voiceIsolation.toString());
  }, [voiceIsolation]);
  const [voice, setVoice] = useState(() => localStorage.getItem("gemini_voice") || "Zephyr");
  const [nativeVoiceURI, setNativeVoiceURI] = useState(() => localStorage.getItem("native_voice_uri") || "");
  const [nativePitch, setNativePitch] = useState(() => Number(localStorage.getItem("native_pitch") || "1.0"));
  const [nativeRate, setNativeRate] = useState(() => Number(localStorage.getItem("native_rate") || "1.0"));
  const [nativeGender, setNativeGender] = useState(() => localStorage.getItem("native_gender") || "auto");
  const [speed, setSpeed] = useState(() => localStorage.getItem("gemini_speed") || "normal");
  const [noiseSuppression, setNoiseSuppression] = useState(() => {
    const saved = localStorage.getItem("gemini_noise_suppression");
    return saved !== null ? saved === "true" : true;
  });
  const [noiseThreshold, setNoiseThreshold] = useState(() => Number(localStorage.getItem("gemini_noise_threshold") || "0.00"));
  const [silenceDelay, setSilenceDelay] = useState(() => Number(localStorage.getItem("gemini_silence_delay") || "2.0"));
  const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem("gemini_selected_mic") || "");
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [isTestMode, setIsTestMode] = useState(() => localStorage.getItem("gemini_test_mode") === "true");
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  
  const [promptDialog, setPromptDialog] = useState<{
    isOpen: boolean;
    type: 'prompt' | 'confirm';
    title: string;
    defaultValue?: string;
    onConfirm: (val?: string) => void;
  } | null>(null);

  useEffect(() => {
    localStorage.setItem("gemini_test_mode", isTestMode.toString());
  }, [isTestMode]);

  useEffect(() => {
    localStorage.setItem("gemini_tts_engine", ttsEngine);
  }, [ttsEngine]);

  useEffect(() => {
    localStorage.setItem("gemini_target_lang", targetLang);
  }, [targetLang]);

  useEffect(() => {
    localStorage.setItem("gemini_voice", voice);
  }, [voice]);

  useEffect(() => {
    localStorage.setItem("native_voice_uri", nativeVoiceURI);
  }, [nativeVoiceURI]);

  useEffect(() => {
    localStorage.setItem("native_pitch", String(nativePitch));
  }, [nativePitch]);

  useEffect(() => {
    localStorage.setItem("native_rate", String(nativeRate));
  }, [nativeRate]);

  useEffect(() => {
    localStorage.setItem("native_gender", nativeGender);
  }, [nativeGender]);

  useEffect(() => {
    localStorage.setItem("gemini_speed", speed);
  }, [speed]);

  useEffect(() => {
    localStorage.setItem("gemini_selected_mic", selectedMic);
  }, [selectedMic]);

  const refreshMics = async (forcePermission = false) => {
    try {
      if (forcePermission) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioMics = devices.filter(d => d.kind === 'audioinput');
      setAvailableMics(audioMics);
      
      // If we only have generic labels and haven't tried forcePermission, maybe warn?
      // But usually we just wait until the user starts the app.
    } catch (e: any) {
      if (e.name !== 'NotAllowedError' && !e.message?.toLowerCase().includes('permission denied')) {
        console.warn("Mic list access info:", e);
      }
    }
  };

  useEffect(() => {
    refreshMics();
  }, []);

  useEffect(() => {
    localStorage.setItem("gemini_noise_suppression", String(noiseSuppression));
  }, [noiseSuppression]);

  useEffect(() => {
    localStorage.setItem("gemini_noise_threshold", String(noiseThreshold));
    if (captureRef.current) captureRef.current.setVad(noiseThreshold, silenceDelay);
  }, [noiseThreshold, silenceDelay]);

  useEffect(() => {
    localStorage.setItem("gemini_silence_delay", String(silenceDelay));
  }, [silenceDelay]);
  
  const captureRef = useRef<AudioCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const sessionRef = useRef<any>(null); // To keep a reference to the active session
  const textEndRef = useRef<HTMLDivElement>(null);
  
  // TTS processing references
  const spokenTextRef = useRef<string>("");
  const pendingTextRef = useRef<string>("");
  const [availableNativeVoices, setAvailableNativeVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const langPrefix = targetLang.split('-')[0];
      setAvailableNativeVoices(voices.filter(v => v.lang.includes(langPrefix)));
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [targetLang]);
  
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("gemini_speaker_names");
    return saved ? JSON.parse(saved) : {};
  });

  const [speakerGenders, setSpeakerGenders] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("gemini_speaker_genders");
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem("gemini_speaker_names", JSON.stringify(speakerNames));
  }, [speakerNames]);

  useEffect(() => {
    localStorage.setItem("gemini_speaker_genders", JSON.stringify(speakerGenders));
  }, [speakerGenders]);

  const updateSpeakerName = (id: string, newName: string) => {
    setSpeakerNames(prev => ({ ...prev, [id]: newName }));
  };

  const updateSpeakerGender = (id: string, gender: string) => {
    setSpeakerGenders(prev => ({ ...prev, [id]: gender }));
  };

  const mergeSpeakers = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    
    // Update mapping: anything mapped to sourceId now maps to targetId
    setSpeakerNames(prev => {
      const next = { ...prev };
      next[sourceId] = prev[targetId] || targetId;
      return next;
    });

    setSpeakerGenders(prev => {
      const next = { ...prev };
      if (prev[targetId]) {
         next[sourceId] = prev[targetId];
      } else if (prev[sourceId]) {
         next[targetId] = prev[sourceId];
         next[sourceId] = prev[sourceId];
      }
      return next;
    });

    // Update segments in-place for immediate UI feedback
    setSpeakerSegments(prev => prev.map(seg => 
      seg.speaker === sourceId ? { ...seg, speaker: targetId } : seg
    ));
    
    // We also need to handle the translations string context if we want to be perfect, 
    // but updating segments is usually enough for the transcript view.
  };

  useEffect(() => {
    // Auto-scroll to latest translation or transcript
    textEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [translations, transcriptions]);

   // Hook to process pending text for Native System Voice
   useEffect(() => {
     if (ttsEngine === "native" && isLive && !isMuted) {
        // Iterate through segments to find what needs to be spoken
        // We track spoken per-segment to ensure we don't repeat
        const lastSegments = speakerSegments.slice(-2); // Watch latest 2 for overlaps
        lastSegments.forEach(seg => {
           // We'll use a simple heuristic: if the segment text has grown significantly, speak the new part
           // But since speakNative clears previous, we might want a better system.
           // For this demo, let's process the raw translations string and find the latest speaker context.
        });

        const unprocessed = translations.substring(spokenTextRef.current.length);
        if (unprocessed.trim().length > 0) {
           // Detect speaker context in the current chunk
           const speakerMatch = translations.substring(0, spokenTextRef.current.length + unprocessed.length).match(/\[(Speaker [A-Z])\]/g);
           const currentSpeaker = speakerMatch ? speakerMatch[speakerMatch.length - 1].replace(/[\[\]]/g, "") : "Speaker A";

           // Check if we hit a punctuation mark or a few words
           const match = unprocessed.match(/(.*?)([.?!,:\n]+)(.*)/s);
           if (match) {
              const rawSentence = match[1] + match[2]; 
              // Strip labels for speech
              const speechText = rawSentence.replace(/\[Speaker [A-Z]\]:\s*/g, "").trim();
              spokenTextRef.current += rawSentence;
              if (speechText) speakNative(speechText, currentSpeaker);
           } else {
              const words = unprocessed.trim().split(/\s+/);
              if (words.length >= 3 && (unprocessed.endsWith(" ") || unprocessed.endsWith("　"))) {
                 const speechText = unprocessed.replace(/\[Speaker [A-Z]\]:\s*/g, "").trim();
                 spokenTextRef.current += unprocessed;
                 if (speechText) speakNative(speechText, currentSpeaker);
              }
           }
        }
     }
   }, [translations, speakerSegments, ttsEngine, isLive, isMuted]);

  const speakNative = (text: string, speakerLabel?: string) => {
    if (!text || text.length === 0) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = targetLang;
    
    const voices = window.speechSynthesis.getVoices();
    
    // Base pitch from settings
    let finalPitch = nativePitch;
    
    // Use specific gender if set for the speaker, else fallback to global nativeGender
    const resolvedGender = speakerLabel && speakerGenders[speakerLabel] ? speakerGenders[speakerLabel] : nativeGender;

    // Apply gender simulation based on speaker label (Diarization)
    if (resolvedGender === "auto") {
      // Rotate pitches based on character code to handle infinite speakers (A, B, C...)
      const speakerChar = speakerLabel?.replace("Speaker ", "").charCodeAt(0) || 65;
      const offset = (speakerChar - 65) % 4; // Use 4 distinct pitch offsets
      const pitchMap = [0.85, 1.25, 0.7, 1.4];
      finalPitch *= pitchMap[offset];
    } else if (resolvedGender === "male") {
      finalPitch *= 0.8;
    } else if (resolvedGender === "female") {
      finalPitch *= 1.4;
    }

    // Voice selection
    if (nativeVoiceURI) {
       const exactVoice = voices.find(v => v.voiceURI === nativeVoiceURI);
       if (exactVoice) utterance.voice = exactVoice;
    } else {
       // Automatic selection based on language and guessed gender
       const langPrefix = targetLang.split('-')[0];
       let preferredVoice: SpeechSynthesisVoice | undefined;
       
       if (resolvedGender === "male" || (resolvedGender === "auto" && speakerLabel?.includes("Speaker A"))) {
          preferredVoice = voices.find(v => v.lang.includes(langPrefix) && (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('david') || v.name.toLowerCase().includes('nam')));
       } else if (resolvedGender === "female" || (resolvedGender === "auto" && speakerLabel?.includes("Speaker B"))) {
          preferredVoice = voices.find(v => v.lang.includes(langPrefix) && (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('zira') || v.name.toLowerCase().includes('nu')));
       }
       
       utterance.voice = preferredVoice || voices.find(v => v.lang.includes(langPrefix)) || null;
    }
    
    utterance.pitch = Math.max(0.1, Math.min(2.0, finalPitch));
    
    // Rate selection
    if (nativeRate !== 1.0) {
      utterance.rate = nativeRate;
    } else if (speed === "fast") {
      utterance.rate = 1.3;
    } else if (speed === "slow") {
      utterance.rate = 0.8;
    } else {
      utterance.rate = 1.0;
    }

    window.speechSynthesis.speak(utterance);
  };

  const handleStart = async (sourceType: 'mic' | 'system') => {
    setError(null);
    setIsConnecting(true);
    setTranslations("");
    setSpeakerSegments([]);
    setTranscriptions("");
    spokenTextRef.current = "";
    pendingTextRef.current = "";
    window.speechSynthesis.cancel(); // clear previous speech

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
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } 
        });
        // We might want to auto-mute the output so it doesn't create feedback
        if (!isMuted) {
           setIsMuted(true);
           playerRef.current.setMuted(true);
        }
      } else {
        const audioConstraints: any = {
          echoCancellation: noiseSuppression,
          noiseSuppression: noiseSuppression,
          autoGainControl: noiseSuppression,
          // Experimental: support for voice isolation on some browsers
          voiceIsolation: noiseSuppression
        };

        if (selectedMic) {
          audioConstraints.deviceId = { exact: selectedMic };
        }

        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: audioConstraints
        });
      }

      if (stream.getAudioTracks().length === 0) {
        throw new Error("No audio track detected. Make sure to share audio.");
      }

      const capture = new AudioCapture(stream);
      captureRef.current = capture;
      
      // Initialize AudioContext completely while browser still acknowledges recent user interaction
      await capture.initialize(voiceIsolation);
      capture.setVad(noiseThreshold, silenceDelay);
      setAnalyser(capture.analyser);
      
      // Refresh mic list now that we definitely have permission
      refreshMics().catch(() => {});

      // Initialize the Google GenAI SDK internally right before call to ensure we pick up fresh keys
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const langNames: Record<string, string> = {
         "vi-VN": "Vietnamese",
         "zh-CN": "Simplified Chinese",
         "km-KH": "Khmer",
         "lo-LA": "Lao"
      };
      const targetLangName = langNames[targetLang] || "Vietnamese";

      const paceInstruction = speed === "slow" ? "Speak slowly and clearly." : speed === "fast" ? "Speak at a fast, energetic pace." : "Speak at a natural, normal pace.";

      const autoDetectInstruction = sourceLang === 'auto'
        ? "3. AUTOMATIC LANGUAGE DETECTION: You must automatically identify the speaker's language."
        : `3. SOURCE LANGUAGE: The speaker is speaking in ${sourceLang}. Do not translate from other languages.`;

      const standardLabelFormat = sourceLang === 'auto'
        ? "Every single verbal turn MUST be prefixed with its assigned speaker label in brackets AND the detected language in curly braces if you are sure about it. Example: \"[Speaker A] {Japanese}: Hello\"."
        : "Every single verbal turn MUST be prefixed with its assigned speaker label in brackets. Example: \"[Speaker A]: Hello\".";

      const interpreterLabelFormat = sourceLang === 'auto'
        ? "8. EVERY turn MUST be prefixed with speaker label if available, AND the detected language in curly braces if you are sure about it. Example: \"[Speaker A] {Japanese}: ...\"."
        : "8. EVERY turn MUST be prefixed with speaker label if available. Example: \"[Speaker A]: ...\".";

      const standardSystemInstruction = `You are an advanced real-time AI audio translator.
1. SPEECH ISOLATION: Focus strictly on human dialogue and accurately transcribe every spoken word, even if there is background noise. Do not drop or skip any valid speech.
2. MUSIC & SINGING FILTER: Treat background music (even if loud) as non-speech. Do not translate music unless it is a clear human conversation.
${autoDetectInstruction}
4. EXPERT DIARIZATION: You are an expert at identifying individual voices. Distinguish between different speakers (Speaker A, Speaker B, etc.) based on their unique pitch, timber, and rhythm. ${standardLabelFormat}
5. DIARIZATION STICKINESS: Once you assign a speaker label, stick to it. If the same person speaks again after a gap, use the same label. Do not create new labels for existing speakers.
6. TRANSLATE TO ${targetLangName}: Provide high-quality real-time, accurate translation without summarizing. Keep every detail.
7. NO REPETITION: Do not repeat already translated segments. Only provide translation for new audio input.
8. NO LOOPING: Ensure the output does not loop or repeat the same phrases redundantly.
9. CONTINUITY: Only translate new audio content. Do not re-translate or go back to previous segments.
10. CONTEXTUAL RECONSTRUCTION: If a part of a sentence is mumbled or covered by noise, use the surrounding context to reconstruct the most likely intended words, but prioritize transcribing exactly what you hear.
11. EXPLICIT CONTENT: You MUST translate everything accurately exactly as spoken, including profanity, slang, curses, and vulgar words. Do not filter or censor any part of the speech.
12. PACE: ${paceInstruction}
13. LATENCY: ULTRA LOW LATENCY. Output translation in immediate, short chunks. Do not wait for a full sentence to finish. This is for AI Headphone real-time audio playback so speed is critical.`;

      const interpreterSystemInstruction = `Vai trò: Bạn là một trợ lý dịch thuật cabin (Real-time Interpreter) chuyên nghiệp. Nhiệm vụ của bạn là dịch các đoạn phụ đề từ ngôn ngữ gốc sang Tiếng Việt siêu tốc.

Luồng xử lý dữ liệu (Input & Output):
1. Dữ liệu đầu vào (Input) của bạn là đoạn âm thanh và văn bản.
2. DỊCH SIÊU TỐC TRONG THỜI GIAN THỰC: Bạn phải dịch NGAY LẬP TỨC khi vừa nghe thấy, KHÔNG CẦN KẾT THÚC CÂU. Đóng vai trò làm phiên dịch viên cho tai nghe AI, tốc độ là yếu tố sống còn.
3. Nếu Input có vẻ bị ngắt quãng giữa chừng, cứ dịch phần có ý nghĩa rồi dịch tiếp, không chần chừ.
4. Trả về duy nhất nội dung đã được dịch sang Tiếng Việt.
5. KHÔNG LẶP LẠI: Tuyệt đối không lặp lại đoạn đã dịch. Chỉ dịch tiếp phần thông tin mới.
6. KHÔNG VÒNG LẶP: Đảm bảo bản dịch không bị lặp lại.
7. STATE: Dịch tiếp nối (Continue).
8. EXPLICIT CONTENT: Dịch ĐÚNG VÀ ĐẦY ĐỦ tất cả các từ ngữ, bao gồm cả từ tục tĩu (profanity), tiếng lóng (slang), hoặc câu chửi thề. Tuyệt đối không kiểm duyệt hay tự ý che giấu.
${interpreterLabelFormat}

Phong cách dịch: Rõ ràng, siêu nhanh, phù hợp để nghe qua tai nghe AI và đọc trên màn hình.
PACE: ${paceInstruction}`;

      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO], 
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}, 
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          ],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
          systemInstruction: isTestMode ? interpreterSystemInstruction : standardSystemInstruction,
        },
        callbacks: {
          onopen: () => {
            setIsConnecting(false);
            setIsLive(true);
            capture.start((base64Data) => {
              sessionPromise.then(session => {
                if(sessionRef.current === session) {
                  session.sendRealtimeInput({
                    audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                  });
                }
              }).catch(e => console.error("Error sending audio:", e));
            });
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.goAway) {
              console.log("GoAway signal received (session duration limit). Closing gracefully.");
              setError("Thời lượng phiên dịch đã hết. Vui lòng bắt đầu lại nếu cần thiết.");
              sessionPromise.then(session => session.close()).catch(() => {});
              return;
            }
            if (message.serverContent) {
                // Read transcriptions if available
                const inputTranscriptText = message.serverContent.inputTranscription?.text;
                if (inputTranscriptText) setTranscriptions(prev => prev + inputTranscriptText);
                
                const outputTranscriptText = message.serverContent.outputTranscription?.text;
                if (outputTranscriptText) {
                   // We trust modelTurn parts more for real-time text, but this is a good backup
                }

                // Handle model turns
                const modelTurn = message.serverContent.modelTurn;
                if (modelTurn?.parts) {
                  let textChunk = "";
                  for (const part of modelTurn.parts) {
                    if (part.text) {
                      textChunk += part.text;
                    }
                    if (part.inlineData?.data && ttsEngine === "gemini") {
                      playerRef.current?.playBase64Int16(part.inlineData.data);
                    }
                  }

                  if (textChunk) {
                    setTranslations(prev => {
                       const full = prev + textChunk;

                       // Auto-save/Log logic for every 10 characters increment
                       const oldCount = Math.floor(prev.length / 10);
                       const newCount = Math.floor(full.length / 10);
                       if (newCount > oldCount) {
                         console.log(`[Sync] Total characters reached ${newCount * 10}. Performing data backup...`);
                         // Simulated API call:
                         // fetch('/api/log-char-milestone', { method: 'POST', body: JSON.stringify({ length: full.length }) });
                       }

                       // Improved Speaker Diarization Parsing
                       // This handles splitting the text into blocks labeled by Speaker
                       const labelRegex = /\[(Speaker [A-Z])\](?:[\s]*\{([^}]+)\})?:/g;
                       const segments: {speaker: string, text: string, timestamp: string}[] = [];
                       let lastIndex = 0;
                       let currentSpeaker = "Speaker A";
                       let foundLang = "";
                       
                       let match;
                       while ((match = labelRegex.exec(full)) !== null) {
                         const matchIndex = match.index;
                         // If there was text before this label, it belongs to the previous speaker
                         if (matchIndex > lastIndex) {
                           const partText = full.substring(lastIndex, matchIndex).trim();
                           if (partText) {
                             segments.push({
                               speaker: currentSpeaker,
                               text: partText.replace(/\[Speaker [A-Z]\](?:[\s]*\{[^}]+\})?:\s*/g, "").trim(),
                               timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                             });
                           }
                         }
                         currentSpeaker = match[1];
                         if (match[2]) {
                           foundLang = match[2];
                         }
                         lastIndex = matchIndex;
                       }
                       
                       // Add the trailing segment (currently active speaker)
                       const trailingText = full.substring(lastIndex).trim();
                       if (trailingText) {
                         segments.push({
                           speaker: currentSpeaker,
                           text: trailingText.replace(/\[Speaker [A-Z]\](?:[\s]*\{[^}]+\})?:\s*/g, "").trim(),
                           timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                         });
                       }

                       if (segments.length > 0) {
                         setSpeakerSegments(segments);
                       }
                       
                       if (foundLang) {
                         setDetectedLang((prev) => prev !== foundLang ? foundLang : prev);
                       }
                       
                       return full;
                    });
                  }
                }

                if (message.serverContent.interrupted) {
                  playerRef.current?.stop();
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
         let errMsg = err.message || "";
         if (errMsg.toLowerCase().includes('permission denied')) {
           setError("Connection Failed: Lỗi xác thực hoặc hết hạn API Key.");
         } else {
           console.error("Live API Connect Error:", err);
           setError(`Connection Failed: ${errMsg}`);
         }
         stopEverything();
      });

    } catch (err: any) {
      let errorMessage = err.message || "Failed to start audio connection.";
      
      if (err.name === 'NotAllowedError' || errorMessage.toLowerCase().includes('permission denied')) {
        errorMessage = sourceType === 'system' 
          ? "Bạn cần cấp quyền Chia sẻ Âm thanh Hệ thống (Share Audio) trên cửa sổ bật lên để có thể dịch video/máy tính."
          : "Bạn cần cấp quyền sử dụng Micro (Allow Microphone) trên trình duyệt để ghi âm giọng nói.";
      } else if (errorMessage.toLowerCase().includes('permissions policy')) {
        errorMessage = "Tính năng 'Dịch tiếng máy tính' (Screen Share) bị chặn bởi chính sách bảo mật của trình duyệt khi chạy trong khung thu nhỏ. Vui lòng nhấn vào nút 'Mở trong tab mới' (Open in new tab) ở góc trên bên phải để sử dụng tính năng này.";
      } else {
        console.error(err);
      }
      
      setError(errorMessage);
      stopEverything();
    }
  };

  const stopEverything = () => {
    setIsConnecting(false);
    setIsLive(false);
    setAnalyser(null);
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

  const handleBatchTranslate = async () => {
    if (!batchFile) return;
    setError(null);
    setIsProcessingBatch(true);
    setTranslations("");
    setSpeakerSegments([]);
    setTranscriptions("Processing file... Please wait.");
    setBatchProgress(10);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const fileData = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result?.toString().split(',')[1] || "");
        reader.readAsDataURL(batchFile);
      });

      setBatchProgress(40);

      const langNames: Record<string, string> = {
          "vi-VN": "Vietnamese",
          "zh-CN": "Simplified Chinese",
          "km-KH": "Khmer",
          "lo-LA": "Lao",
          "es-ES": "Spanish",
          "fr-FR": "French",
          "de-DE": "German"
      };
      const targetLangName = langNames[targetLang] || "Vietnamese";

      const promptText = `Analyze this ${batchFile.type.startsWith('video') ? 'video' : 'audio'} file and translate it into ${targetLangName}. 
      1. AUTOMATIC LANGUAGE DETECTION: Identify the spoken language(s).
      2. SPEECH RECOGNITION: Accurately transcribe every spoken word, even with background noise. Do not drop or miss clear words.
      3. EXPERT DIARIZATION: Distinguish between different speakers (Speaker A, Speaker B, etc.).
      4. TRANSLATION: Provide a high-quality word-by-word translation, keeping every detail intact without arbitrary summarizing.
      5. EXPLICIT CONTENT: You MUST translate everything accurately exactly as spoken, including profanity, slang, curses, and vulgar words. Do not filter or censor any part of the speech.
      6. FORMAT: Prefix every turn with its speaker label. Example: [Speaker A]: Hello.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: batchFile.type,
                  data: fileData
                }
              },
              { text: promptText }
            ]
          }
        ]
      });

      setBatchProgress(80);
      const text = response.text || "";
      
      setTranslations(text);
      setBatchProgress(100);
      setIsProcessingBatch(false);
      
      // Parse segments for UI
      const labelRegex = /\[(Speaker [A-Z])\]:\s*([^\[]+)/g;
      const segments: {speaker: string, text: string, timestamp: string}[] = [];
      let match;
      while ((match = labelRegex.exec(text)) !== null) {
        segments.push({
          speaker: match[1],
          text: match[2].trim(),
          timestamp: "Batch Mode"
        });
      }
      if (segments.length > 0) setSpeakerSegments(segments);
      setTranscriptions("Batch processing complete.");

    } catch (err: any) {
      console.error(err);
      setError("Batch processing failed: " + err.message);
      setIsProcessingBatch(false);
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
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-orange-500 to-red-600 shadow-lg shadow-orange-500/20">
              <Volume2 className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-xl font-medium tracking-wide">Live AI Translator</h1>
          </div>
          
          <nav className="flex p-1 bg-white/5 rounded-xl border border-white/10 ml-4">
            <button 
              onClick={() => setMode('live')}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === 'live' ? 'bg-orange-500 text-white shadow-lg' : 'text-white/40 hover:text-white/70'}`}
            >
              Real-time
            </button>
            <button 
              onClick={() => setMode('batch')}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === 'batch' ? 'bg-orange-500 text-white shadow-lg' : 'text-white/40 hover:text-white/70'}`}
            >
              Batch Mode
            </button>
            <button 
              onClick={() => {
                setMode('offline');
                stopEverything();
              }}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === 'offline' ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white/70'}`}
            >
              Offline Mode
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-4">
           {/* Language Selector */}
           <div className="flex items-center gap-2">
             <select 
               value={targetLang}
               onChange={(e) => setTargetLang(e.target.value)}
               className="bg-white/5 border border-white/10 text-white rounded-full px-4 py-2 outline-none focus:border-orange-500/50 text-sm appearance-none cursor-pointer"
             >
                <option value="vi-VN">🇻🇳 Vietnamese</option>
                <option value="zh-CN">🇨🇳 Chinese</option>
                 <option value="km-KH">🇰🇭 Khmer</option>
                 <option value="lo-LA">🇱🇦 Lao</option>
                <option value="es-ES">🇪🇸 Spanish</option>
                <option value="fr-FR">🇫🇷 French</option>
                <option value="de-DE">🇩🇪 German</option>
             </select>
           </div>
           
           {/* Settings Button */}
           <button 
             onClick={() => setShowSettings(true)}
             className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors"
           >
             <Settings className="w-5 h-5 text-white/70" />
           </button>
           
           {detectedLang && sourceLang === 'auto' && (
             <div className="flex items-center gap-2 text-sm text-blue-400 bg-blue-500/10 px-4 py-2 rounded-full border border-blue-500/20">
               <Globe className="w-4 h-4" />
               <span className="font-medium">{detectedLang}</span>
             </div>
           )}

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
           {mode === 'live' ? (
             !isLive && !isConnecting ? (
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
             )
           ) : mode === 'offline' ? (
              <OfflineModeControls 
                 targetLang={targetLang}
                 sourceLang={sourceLang}
                 onTranslation={(src, tgt, speaker) => {
                    setTranscriptions(prev => prev + " " + src);
                    setTranslations(prev => prev + " " + tgt);
                    setSpeakerSegments(prev => [...prev, { speaker, text: tgt, timestamp: new Date().toLocaleTimeString() }]);
                    
                    if (!isMuted) {
                      const utterance = new SpeechSynthesisUtterance(tgt);
                      utterance.lang = targetLang;
                      if (nativeRate !== 1.0) utterance.rate = nativeRate;
                      if (nativePitch !== 1.0) utterance.pitch = nativePitch;
                      if (nativeVoiceURI) {
                         const voices = window.speechSynthesis.getVoices();
                         const selected = voices.find(v => v.voiceURI === nativeVoiceURI);
                         if (selected) utterance.voice = selected;
                      }
                      window.speechSynthesis.speak(utterance);
                    }
                 }}
                 onError={(err) => setError(err)}
              />
           ) : (
             /* Batch Mode Controls */
             <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-4 animate-in fade-in slide-in-from-top-4">
                {isProcessingBatch ? (
                  <div className="w-full space-y-4 text-center">
                    <Loader2 className="w-8 h-8 text-orange-500 animate-spin mx-auto" />
                    <div className="space-y-1">
                      <p className="text-lg font-medium">Processing Batch Audio...</p>
                      <p className="text-sm text-white/50">This may take a minute for larger files</p>
                    </div>
                    <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                       <div className="bg-orange-500 h-full transition-all duration-500" style={{ width: `${batchProgress}%` }}></div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-full flex items-center justify-between mb-2">
                       <div className="flex items-center gap-2 text-white/70">
                         <FileUp className="w-5 h-5" />
                         <span className="font-medium">Batch Translation</span>
                       </div>
                       {batchFile && (
                         <button onClick={() => setBatchFile(null)} className="text-xs text-red-400 hover:underline">Remove</button>
                       )}
                    </div>
                    
                    {!batchFile ? (
                      <label className="w-full border-2 border-dashed border-white/10 rounded-xl py-12 flex flex-col items-center justify-center gap-3 bg-white/[0.02] hover:bg-white/[0.05] transition-all cursor-pointer group">
                        <input 
                           type="file" 
                           accept="audio/*,video/mp4,.mp4" 
                           className="hidden" 
                           onChange={(e) => setBatchFile(e.target.files?.[0] || null)}
                        />
                        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Upload className="w-6 h-6 text-white/50" />
                        </div>
                        <div className="text-center">
                          <p className="font-medium">Click to upload audio or MP4 video</p>
                          <p className="text-xs text-white/30 px-4 mt-1">Supports MP3, WAV, AAC, MP4 up to 50MB</p>
                        </div>
                      </label>
                    ) : (
                      <div className="w-full flex flex-col items-center gap-4">
                         <div className="w-full bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-4">
                           <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                             <Volume2 className="w-6 h-6 text-orange-500" />
                           </div>
                           <div className="flex-1 overflow-hidden">
                             <p className="font-medium truncate">{batchFile.name}</p>
                             <p className="text-xs text-white/40">{(batchFile.size / 1024 / 1024).toFixed(2)} MB • Ready to process</p>
                           </div>
                           <CheckCircle2 className="w-5 h-5 text-green-500" />
                         </div>
                         <button
                           onClick={handleBatchTranslate}
                           className="w-full bg-orange-500 hover:bg-orange-600 text-white py-4 rounded-xl font-bold tracking-wide transition-all shadow-lg active:scale-[0.98]"
                         >
                           START BATCH TRANSLATION
                         </button>
                      </div>
                    )}
                  </>
                )}
             </div>
           )}

           <button
              onClick={handleMuteToggle}
              className={`flex items-center gap-2 px-6 py-4 rounded-2xl border transition-all ${
                isMuted 
                  ? 'bg-red-500/10 border-red-500/30 text-red-400' 
                  : 'bg-green-500/10 border-green-500/30 text-green-400'
              } ${mode === 'batch' ? 'hidden md:flex' : ''}`}
           >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              <span className="font-medium text-sm text-center">Translation<br />Audio {isMuted ? 'Muted' : 'On'}</span>
           </button>
        </div>

        {/* Output area - Vertical Stack */}
        <div className="flex-1 min-h-[500px] gap-8 flex flex-col relative z-10 w-full overflow-hidden">
           


           {/* Target Translation */}
           <div className="flex-[3] flex relative flex-col bg-white/5 border border-white/10 border-t-orange-500/50 border-t-2 rounded-3xl overflow-hidden backdrop-blur-xl shadow-2xl min-h-[300px]">
             <div className="p-4 border-b border-white/10 bg-black/20 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-widest text-[#ff4e00]">Bản Dịch ({targetLang === 'vi-VN' ? 'Vietnamese' : targetLang === 'zh-CN' ? 'Chinese' : targetLang === 'lo-LA' ? 'Lao' : 'Khmer'})</h2>
                <div className="flex items-center gap-4">
                   <AudioVisualizer analyser={analyser} isActive={isLive} />
                   <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-white/20"></span>
                      <span className="w-2 h-2 rounded-full bg-white/20"></span>
                      <span className="w-2 h-2 rounded-full bg-white/20"></span>
                   </div>
                </div>
             </div>
             
             <div className="flex-1 p-6 overflow-y-auto font-serif text-slate-100 space-y-4">
                {speakerSegments.length > 0 ? (
                   speakerSegments.map((seg, i) => {
                     const speakerColors: Record<string, string> = {
                       'Speaker A': 'blue',
                       'Speaker B': 'pink',
                       'Speaker C': 'emerald',
                       'Speaker D': 'amber',
                       'Speaker E': 'violet'
                     };
                     const speakerId = seg.speaker;
                     const displayName = speakerNames[speakerId] || speakerId;
                     
                     return (
                       <div key={i} className={`group flex flex-col gap-1 p-3 rounded-2xl border transition-all duration-300 animate-in slide-in-from-bottom-2 ${
                         speakerId === 'Speaker A' ? 'bg-blue-500/10 border-blue-500/20' : 
                         speakerId === 'Speaker B' ? 'bg-pink-500/10 border-pink-500/20' : 
                         speakerId === 'Speaker C' ? 'bg-emerald-500/10 border-emerald-500/20' :
                         speakerId === 'Speaker D' ? 'bg-amber-500/10 border-amber-500/20' :
                         'bg-slate-500/10 border-slate-500/20'
                       }`}>
                          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-sans font-bold">
                             <div className="flex items-center gap-4">
                               <button 
                                 onClick={() => {
                                   setPromptDialog({ isOpen: true, type: 'prompt', title: `Đổi tên cho ${speakerId}:`, defaultValue: displayName, onConfirm: (n) => { if (n) updateSpeakerName(speakerId, n); } });
                                 }}
                                 className={`flex items-center gap-2 hover:opacity-70 transition-opacity cursor-pointer ${
                                   speakerId === 'Speaker A' ? 'text-blue-400' : 
                                   speakerId === 'Speaker B' ? 'text-pink-400' :
                                   speakerId === 'Speaker C' ? 'text-emerald-400' :
                                   'text-slate-400'
                                 }`}
                               >
                                 <div className={`w-1.5 h-1.5 rounded-full ${i === speakerSegments.length - 1 ? 'animate-pulse' : ''} ${
                                   speakerId === 'Speaker A' ? 'bg-blue-400' : 
                                   speakerId === 'Speaker B' ? 'bg-pink-400' :
                                   'bg-slate-400'
                                 }`}></div>
                                 {displayName}
                               </button>

                               <button 
                                 onClick={() => {
                                   const others = (Array.from(new Set(speakerSegments.map(s => s.speaker))) as string[]).filter(s => s !== speakerId);
                                   setPromptDialog({ 
                                     isOpen: true, 
                                     type: 'prompt', 
                                     title: `Merge ${displayName} into which speaker? (${others.join(', ')})`, 
                                     defaultValue: others[0] || "", 
                                     onConfirm: (t) => { 
                                       if (t && others.includes(t)) {
                                         // Show confirmation before merging
                                         setTimeout(() => {
                                            setPromptDialog({
                                              isOpen: true,
                                              type: 'confirm',
                                              title: `Are you sure you want to merge ${displayName} into ${t}?`,
                                              onConfirm: () => mergeSpeakers(speakerId, t)
                                            });
                                         }, 100);
                                       } 
                                     } 
                                   });
                                 }}
                                 className="opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white/5 hover:bg-white/10 rounded flex items-center gap-1 text-[8px] text-white/40"
                                 title="Merge Speaker"
                               >
                                 <UserPlus className="w-3 h-3" />
                                 <span>GỘP</span>
                               </button>
                             </div>
                             <span className="text-white/20">{seg.timestamp}</span>
                          </div>
                          <p className="text-2xl leading-relaxed">{seg.text}</p>
                       </div>
                     );
                   })
                ) : (
                  <span className="text-white/20 italic font-sans text-xl">
                    {translations || (isLive ? 'Listening & Translating...' : 'Awaiting connection...')}
                  </span>
                )}
             </div>
           </div>

        </div>

         {/* Source Subtitles (Bottom - Secondary View) */}
         <div className="flex-1 max-h-[160px] flex relative flex-col bg-white/5 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-xl shadow-2xl mt-4">
           <div className="p-3 border-b border-white/10 bg-black/20 flex items-center justify-between">
              <h2 className="text-[10px] font-medium uppercase tracking-widest text-white/30 flex items-center gap-2">
                <Activity className="w-3 h-3" /> Real-time Subtitles (Original Transcript)
              </h2>
              {isLive && (
                <div className="flex gap-1">
                  <div className="w-1 h-1 bg-orange-500 rounded-full animate-bounce"></div>
                  <div className="w-1 h-1 bg-orange-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-1 h-1 bg-orange-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                </div>
              )}
           </div>
           
           <div className="flex-1 p-5 overflow-y-auto whitespace-pre-wrap font-sans text-lg text-white/40 leading-relaxed italic">
              {transcriptions ? transcriptions.replace(/\[(Speaker [A-Z])\]/g, (match, speaker) => `[${speakerNames[speaker] || speaker}]`) : (
                <span className="text-white/10 italic text-sm">
                  {isLive ? 'Listening for source audio...' : 'Awaiting connection...'}
                </span>
              )}
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
                Cài đặt Âm thanh
              </h3>
              <button 
                onClick={() => setShowSettings(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors text-white/50 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
               {/* Language Detection / Source selection */}
               <div className="space-y-2">
                 <label className="text-sm font-medium text-white/70">Ngôn ngữ Nguồn (Source Language)</label>
                 <select 
                   value={sourceLang}
                   onChange={(e) => setSourceLang(e.target.value)}
                   className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-orange-500/50 appearance-none"
                 >
                    <option value="auto">✨ Tự động nhận diện (Auto Detect)</option>
                    <option value="en-US">Tiếng Anh (English)</option>
                    <option value="zh-CN">Tiếng Trung (Chinese)</option>
                    <option value="ja-JP">Tiếng Nhật (Japanese)</option>
                    <option value="ko-KR">Tiếng Hàn (Korean)</option>
                    <option value="es-ES">Tiếng Tây Ban Nha (Spanish)</option>
                    <option value="fr-FR">Tiếng Pháp (French)</option>
                    <option value="de-DE">Tiếng Đức (German)</option>
                    <option value="lo-LA">Tiếng Lào (Lao)</option>
                 </select>
                 <p className="text-[10px] text-white/30 italic">Tự động nhận diện tốt nhất cho môi trường ít tạp âm.</p>
               </div>

               {/* Voice Isolation Toggle */}
               <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
                 <div className="flex items-center gap-3">
                   <div className="bg-orange-500/10 p-2 rounded-lg">
                     <Activity className="w-4 h-4 text-orange-400" />
                   </div>
                   <div>
                     <p className="text-sm font-medium">Cô lập giọng nói (Voice Isolation)</p>
                     <p className="text-[10px] text-white/40">Lọc bỏ tiếng ồn cực mạnh & làm rõ lời nói</p>
                   </div>
                 </div>
                 <button 
                   onClick={() => setVoiceIsolation(!voiceIsolation)}
                   className={`w-12 h-6 rounded-full p-1 transition-all duration-300 ${voiceIsolation ? 'bg-orange-500' : 'bg-white/10'}`}
                 >
                   <div className={`w-4 h-4 rounded-full bg-white transition-all duration-300 ${voiceIsolation ? 'translate-x-6' : 'translate-x-0'}`}></div>
                 </button>
               </div>

               {/* Reader Model / TTS Engine Selection */}
               <div className="space-y-2">
                 <label className="text-sm font-medium text-white/70">TTS Engine</label>
                 <select 
                   value={ttsEngine}
                   onChange={(e) => setTtsEngine(e.target.value)}
                   className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 appearance-none"
                 >
                    <option value="gemini">Gemini Cloud Voice (Fast response, natural)</option>
                    <option value="native">Native Browser Voice (Local TTS, clear)</option>
                 </select>
               </div>

               {/* Voice Selection (Only applicable to Gemini) */}
               {ttsEngine === "gemini" && (
                 <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                   <label className="text-sm font-medium text-white/70">Gemini Voice Model</label>
                   <select 
                     value={voice}
                     onChange={(e) => setVoice(e.target.value)}
                     className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 appearance-none"
                   >
                      <option value="Zephyr">Zephyr</option>
                      <option value="Puck">Puck</option>
                      <option value="Kore">Kore</option>
                      <option value="Charon">Charon</option>
                      <option value="Fenrir">Fenrir</option>

                   </select>
                 </div>
               )}

               {/* Voice Selection (Only applicable to Native System) */}
               {ttsEngine === "native" && (
                 <div className="space-y-4 animate-in fade-in slide-in-from-top-2 border-l-2 border-orange-500/30 pl-4 py-1">
                   <div className="space-y-2">
                     <label className="text-sm font-medium text-white/70">Browser Voice Selection</label>
                     <select 
                       value={nativeVoiceURI}
                       onChange={(e) => setNativeVoiceURI(e.target.value)}
                       className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-orange-500/50 appearance-none"
                     >
                        <option value="">-- Auto-select based on language --</option>
                        {availableNativeVoices.map((v) => (
                          <option key={v.voiceURI} value={v.voiceURI}>
                            {v.name}
                          </option>
                        ))}
                     </select>
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-2 relative">
                       <label className="text-sm font-medium text-white/70">Pitch: {nativePitch.toFixed(1)}</label>
                       <input 
                         type="range" 
                         min="0.5" 
                         max="2.0" 
                         step="0.1" 
                         value={nativePitch} 
                         onChange={(e) => setNativePitch(Number(e.target.value))}
                         className="w-full accent-orange-500 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                       />
                     </div>
                     <div className="space-y-2 relative">
                       <label className="text-sm font-medium text-white/70">Rate: {nativeRate.toFixed(1)}</label>
                       <input 
                         type="range" 
                         min="0.5" 
                         max="2.5" 
                         step="0.1" 
                         value={nativeRate} 
                         onChange={(e) => setNativeRate(Number(e.target.value))}
                         className="w-full accent-orange-500 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                       />
                     </div>
                     <div className="space-y-2 col-span-2">
                       <label className="text-sm font-medium text-white/70">Simulate Gender (Diarization)</label>
                       <div className="grid grid-cols-4 gap-2">
                         {['auto', 'male', 'female', 'neutral'].map((g) => (
                           <button
                             key={g}
                             onClick={() => setNativeGender(g)}
                             className={`px-1 py-2 rounded-xl border text-[10px] font-medium transition-all uppercase ${
                               nativeGender === g 
                                 ? 'bg-orange-500 border-orange-500 text-white shadow-lg' 
                                 : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                             }`}
                           >
                             {g}
                           </button>
                         ))}
                       </div>
                     </div>
                   </div>
                 </div>
               )}

               {/* Translation Speed */}
               <div className="space-y-3">
                 <div className="flex justify-between items-center">
                   <label className="text-sm font-medium text-white/70">Voice Generation Pace</label>
                   <span className="text-xs font-mono text-orange-400 uppercase tracking-widest">
                     {speed === 'slow' ? 'Slow' : speed === 'fast' ? 'Fast' : 'Normal'}
                   </span>
                 </div>
                 <div className="relative px-2">
                   <input 
                     type="range" 
                     min="0" 
                     max="2" 
                     step="1"
                     value={speed === 'slow' ? 0 : speed === 'fast' ? 2 : 1}
                     onChange={(e) => {
                       const val = Number(e.target.value);
                       setSpeed(val === 0 ? 'slow' : val === 2 ? 'fast' : 'normal');
                     }}
                     className="w-full accent-orange-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                   />
                   <div className="flex justify-between mt-1 px-0.5">
                      <div className="w-1 h-1 rounded-full bg-white/20"></div>
                      <div className="w-1 h-1 rounded-full bg-white/20"></div>
                      <div className="w-1 h-1 rounded-full bg-white/20"></div>
                   </div>
                 </div>
               </div>

               {/* Microphone Selection */}
               {availableMics.length > 1 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white/70">Chọn Microphone</label>
                    <select 
                      value={selectedMic}
                      onChange={(e) => setSelectedMic(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-orange-500/50 appearance-none text-sm"
                    >
                       <option value="">Microphone mặc định</option>
                       {availableMics.map((mic) => (
                         <option key={mic.deviceId} value={mic.deviceId}>
                           {mic.label || `Mic ${mic.deviceId.slice(0, 5)}`}
                         </option>
                       ))}
                    </select>
                  </div>
               )}

               {/* Speaker Management */}
               <div className="space-y-3 pt-2 border-t border-white/10 mt-4">
                 <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                   <UserCog className="w-4 h-4 text-orange-400" />
                   Quản lý Người nói (Speakers)
                 </div>
                 <div className="max-h-32 overflow-y-auto space-y-2 pr-2">
                   {Object.keys(speakerNames).length > 0 || Array.from(new Set(speakerSegments.map(s => s.speaker))).length > 0 ? (
                     Array.from(new Set([...Object.keys(speakerNames), ...speakerSegments.map(s => s.speaker)])).map(id => (
                       <div key={id} className="flex items-center justify-between bg-white/5 p-2 rounded-lg text-xs">
                         <div className="flex items-center gap-2">
                           <div className={`w-2 h-2 rounded-full ${id === 'Speaker A' ? 'bg-blue-400' : id === 'Speaker B' ? 'bg-pink-400' : 'bg-slate-400'}`}></div>
                           <span className="font-mono text-white/40">{id}:</span>
                           <span className="font-medium text-white/80">{speakerNames[id] || id}</span>
                         </div>
                         <div className="flex items-center gap-2">
                            {ttsEngine === 'native' && (
                              <select 
                                value={speakerGenders[id] || 'auto'}
                                onChange={(e) => updateSpeakerGender(id, e.target.value)}
                                className="bg-black/50 border border-white/10 text-white/70 rounded px-1 py-0.5 text-[10px] outline-none"
                              >
                                <option value="auto">Auto</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="neutral">Neutral</option>
                              </select>
                            )}
                            <div className="flex items-center gap-1">
                               <button 
                                 onClick={() => {
                                   setPromptDialog({
                                     isOpen: true,
                                     type: 'prompt',
                                     title: `Rename ${id}:`,
                                     defaultValue: speakerNames[id] || id,
                                     onConfirm: (newName) => {
                                       if (newName) updateSpeakerName(id, newName);
                                     }
                                   });
                                 }}
                                 className="p-1 hover:bg-white/10 rounded transition-colors text-white/50 hover:text-white"
                               >
                                 <UserPlus className="w-3 h-3" />
                               </button>
                               <button 
                                 onClick={() => {
                                   setPromptDialog({ isOpen: true, type: 'confirm', title: `Reset settings for ${id}?`, onConfirm: () => {
                                     setSpeakerNames(prev => {
                                       const next = { ...prev };
                                       delete next[id];
                                       return next;
                                     });
                                     setSpeakerGenders(prev => {
                                       const next = { ...prev };
                                       delete next[id];
                                       return next;
                                     });
                                   }});
                                 }}
                                 className="p-1 hover:bg-red-500/20 rounded transition-colors text-white/30 hover:text-red-400"
                               >
                                 <Trash2 className="w-3 h-3" />
                               </button>
                            </div>
                         </div>
                       </div>
                     ))
                   ) : (
                     <p className="text-[10px] text-white/20 italic">Chưa phát hiện người nói nào.</p>
                   )}
                 </div>
                 {Object.keys(speakerNames).length > 0 && (
                   <button 
                     onClick={() => {
                       setPromptDialog({ isOpen: true, type: 'confirm', title: "Xóa tất cả bộ nhớ về tên người nói?", onConfirm: () => {
                         setSpeakerNames({});
                         localStorage.removeItem("gemini_speaker_names");
                       }});
                     }}
                     className="text-[10px] text-red-500/70 hover:text-red-400 flex items-center gap-1 transition-colors mt-1"
                   >
                     <Trash2 className="w-3 h-3" /> Reset tất cả tên người nói
                   </button>
                 )}
               </div>

                {/* TEST Section - Professional Interpreter Mode */}
                <div className="space-y-3 pb-4 border-b border-white/10 mb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="bg-blue-500/20 p-2 rounded-lg">
                        <Activity className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-blue-400 uppercase tracking-tight">MỤC TEST (Cabin Mode)</p>
                        <p className="text-[10px] text-white/40 italic">Chế độ trợ lý dịch thuật Cabin chuyên nghiệp</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={isTestMode} onChange={(e) => setIsTestMode(e.target.checked)} className="sr-only peer"/>
                      <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 shadow-[0_0_15px_-3px_rgba(37,99,235,0.4)]"></div>
                    </label>
                  </div>
                  {isTestMode && (
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-[10px] text-blue-300/70 space-y-1.5 animate-in fade-in zoom-in-95 leading-relaxed">
                      <p>✨ <strong className="text-blue-400">Cabin Pro:</strong> Dịch tự nhiên, chuẩn ngữ pháp & ngữ cảnh.</p>
                      <p>✨ <strong className="text-blue-400">Ý nghĩa:</strong> Chỉ dịch khi nhận đủ cụm ý nghĩa hoàn chỉnh.</p>
                      <p>✨ <strong className="text-blue-400">Liên tục:</strong> Thêm "..." nếu câu bị ngắt quãng.</p>
                      <p>✨ <strong className="text-blue-400">Tinh gọn:</strong> Không giải thích, không bình luận cá nhân.</p>
                    </div>
                  )}
                </div>

               {/* Noise Suppression */}
               <div className="space-y-3 pt-2">
                 <div className="flex items-center justify-between">
                   <div>
                     <p className="text-sm font-medium text-white/90">Lọc ồn & Khử vang</p>
                     <p className="text-xs text-white/50 max-w-[250px]">BẬT để lọc tạp âm khi xài Micro. TẮT nếu muốn dịch tiếng nội bộ máy tính chất lượng cao (không bị mất dải âm).</p>
                   </div>
                   <label className="relative inline-flex items-center cursor-pointer">
                     <input type="checkbox" checked={noiseSuppression} onChange={(e) => setNoiseSuppression(e.target.checked)} className="sr-only peer"/>
                     <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                   </label>
                 </div>
               </div>

               {/* VAD Settings */}
               <div className="space-y-4 pt-4 border-t border-white/10">
                 <div>
                   <p className="text-sm font-medium text-white/90 mb-1 flex justify-between">
                     <span>Noise Threshold (VAD)</span>
                     <span className="text-orange-400">{noiseThreshold.toFixed(2)}</span>
                   </p>
                   <p className="text-xs text-white/50 mb-2">Ignore sounds below this volume. Higher = ignores more noise.</p>
                   <input 
                     type="range" 
                     min="0.0" 
                     max="0.5" 
                     step="0.01" 
                     value={noiseThreshold} 
                     onChange={(e) => setNoiseThreshold(Number(e.target.value))}
                     className="w-full accent-orange-500 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                   />
                 </div>
                 <div>
                   <p className="text-sm font-medium text-white/90 mb-1 flex justify-between">
                     <span>Silence Delay</span>
                     <span className="text-orange-400">{silenceDelay.toFixed(1)}s</span>
                   </p>
                   <p className="text-xs text-white/50 mb-2">How long to wait after silence before pausing audio input to AI.</p>
                   <input 
                     type="range" 
                     min="0.5" 
                     max="5.0" 
                     step="0.1" 
                     value={silenceDelay} 
                     onChange={(e) => setSilenceDelay(Number(e.target.value))}
                     className="w-full accent-orange-500 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                   />
                 </div>
               </div>
            </div>




             

            
            <div className="px-6 py-4 border-t border-white/10 bg-white/5 text-xs text-white/40 italic">
               Lưu ý: Bạn cần Nhấn Dừng và Kết nối lại để các thay đổi cài đặt này có hiệu lực.
            </div>
          </div>
        </div>
      )}
      
      {/* Prompt / Confirm Dialog Modal */}
      {promptDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#151619] border border-white/10 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-5">
              <h3 className="text-lg font-medium text-white mb-4">{promptDialog.title}</h3>
              {promptDialog.type === 'prompt' && (
                <input
                  type="text"
                  defaultValue={promptDialog.defaultValue}
                  className="w-full bg-black/50 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-orange-500/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      promptDialog.onConfirm(e.currentTarget.value);
                      setPromptDialog(null);
                    }
                    if (e.key === 'Escape') setPromptDialog(null);
                  }}
                  id="prompt-input"
                />
              )}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setPromptDialog(null)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-white/70 hover:bg-white/10 transition-colors"
                >
                  Hủy (Cancel)
                </button>
                <button
                  onClick={() => {
                    if (promptDialog.type === 'prompt') {
                      const val = (document.getElementById('prompt-input') as HTMLInputElement)?.value;
                      promptDialog.onConfirm(val);
                    } else {
                      promptDialog.onConfirm();
                    }
                    setPromptDialog(null);
                  }}
                  className={`px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors ${promptDialog.type === 'confirm' && promptDialog.title.includes('Xóa') ? 'bg-red-500 hover:bg-red-600' : 'bg-orange-500 hover:bg-orange-600'}`}
                >
                  Xác nhận (OK)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
