import { Mic, X, CornerUpLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { pcmToBase64, base64ToFloat32Array } from './lib/audio';

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState("Tap microphone to start");
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  const playbackNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);

  const stopPlaybackAndClearQueue = () => {
    playbackNodesRef.current.forEach((node) => {
      try { node.stop(); } catch (e) { /* already stopped */ }
    });
    playbackNodesRef.current = [];
    if (audioCtxRef.current) {
      nextStartTimeRef.current = audioCtxRef.current.currentTime;
    }
  };

  const playAudioChunk = (base64Audio: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const float32Data = base64ToFloat32Array(base64Audio);
    // The Live API outputs audio at 24kHz
    const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    
    playbackNodesRef.current.push(source);

    if (nextStartTimeRef.current < ctx.currentTime) {
      nextStartTimeRef.current = ctx.currentTime;
    }
    
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
    
    source.onended = () => {
      playbackNodesRef.current = playbackNodesRef.current.filter((n) => n !== source);
    };
  };

  const startListening = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
      nextStartTimeRef.current = audioCtxRef.current.currentTime;
    }
    const audioCtx = audioCtxRef.current;
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    setStatus("Connecting...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/live`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("Listening...");
        setIsListening(true);
        
        const source = audioCtx.createMediaStreamSource(stream);
        // Using ScriptProcessorNode as per guidelines (deprecated but works without AudioWorklet server config)
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        
        source.connect(processor);
        processor.connect(audioCtx.destination);
        
        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const pcmData = e.inputBuffer.getChannelData(0);
            const base64 = pcmToBase64(pcmData);
            ws.send(JSON.stringify({ audio: base64 }));
          }
        };

        sourceRef.current = source;
        processorRef.current = processor;
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.audio) {
          playAudioChunk(msg.audio);
          setStatus("Speaking...");
        }
        if (msg.interrupted) {
          stopPlaybackAndClearQueue();
          setStatus("Listening...");
        }
      };

      ws.onclose = () => {
        stopSession();
      };
      
      ws.onerror = () => {
        setStatus("Connection Error");
        stopSession();
      };

    } catch (err) {
      console.error(err);
      setStatus("Microphone access denied");
    }
  };

  const stopSession = () => {
    setIsListening(false);
    setStatus("Tap microphone to start");

    if (processorRef.current) {
       try { processorRef.current.disconnect(); } catch (e) {}
       processorRef.current = null;
    }
    if (sourceRef.current) {
       try { sourceRef.current.disconnect(); } catch (e) {}
       sourceRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    
    stopPlaybackAndClearQueue();
  };

  useEffect(() => {
    return () => stopSession();
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] bg-[#004BB5] items-center justify-center p-4 sm:p-8">
      {/* Top Header outside the mobile frame */}
      <div className="text-center mb-6">
        <h1 className="text-white text-3xl sm:text-4xl font-bold tracking-tight mb-2 uppercase">
          Ask AI
          <br className="sm:hidden" /> By Voice
        </h1>
      </div>

      {/* Mobile Frame Container */}
      <div className="w-full max-w-[400px] bg-white rounded-[2.5rem] h-[80vh] min-h-[600px] shadow-2xl overflow-hidden flex flex-col relative py-12 px-6">
        
        {/* Top App Header */}
        <div className="flex justify-between items-center w-full absolute top-6 left-0 px-8 text-black font-semibold text-sm">
          <span className="tabular-nums">9:41</span>
          <div className="flex items-center gap-1.5">
            <div className="flex gap-1 items-end">
               <div className="w-1 h-3 bg-black rounded-sm" />
               <div className="w-1 h-3.5 bg-black rounded-sm" />
               <div className="w-1 h-2.5 bg-black rounded-sm" />
               <div className="w-1 h-1.5 bg-black opacity-30 rounded-sm" />
            </div>
            <div className="w-4 h-4 rounded-full border-[1.5px] border-black flex items-center justify-center">
              <div className="w-1 h-1 bg-black rounded-full" />
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="flex flex-col items-center mt-6 flex-grow">
          <h2 className="text-[28px] font-medium text-slate-800 mb-2">Voice Analysis</h2>
          <p className="text-slate-500 text-lg mb-12">{status}</p>

          {/* Central Animated Orb/Bars */}
          <div className="relative flex-grow flex items-center justify-center w-full max-w-[280px]">
            {/* Outer Glowing Rings */}
            <AnimatePresence>
              {isListening && (
                 <>
                   <motion.div
                     initial={{ scale: 0.8, opacity: 0 }}
                     animate={{ scale: 1.5, opacity: [0, 0.2, 0] }}
                     transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
                     className="absolute inset-0 m-auto w-48 h-48 rounded-full bg-blue-300"
                   />
                   <motion.div
                     initial={{ scale: 0.8, opacity: 0 }}
                     animate={{ scale: 1.2, opacity: [0, 0.4, 0] }}
                     transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                     className="absolute inset-0 m-auto w-56 h-56 rounded-full bg-blue-400"
                   />
                 </>
              )}
            </AnimatePresence>
            
            {/* Inner Ring and Bars */}
            <div className="relative z-10 flex items-center justify-center w-64 h-64 rounded-full border-[12px] border-blue-50/50 shadow-[0_0_40px_rgba(59,130,246,0.3)] bg-gradient-to-tr from-blue-100 to-white">
              <div className="absolute inset-2 rounded-full border-4 border-blue-500 shadow-[inset_0_0_20px_rgba(59,130,246,0.4)]" />
              
              {/* Pill with bars */}
              <div className="bg-slate-700/80 backdrop-blur-md px-6 py-5 rounded-full flex items-center gap-2 z-20">
                 {/* 4 bars with varying heights */}
                 <motion.div
                   animate={isListening ? { height: ["16px", "32px", "16px"] } : { height: "24px" }}
                   transition={{ duration: 1, repeat: Infinity, delay: 0.0 }}
                   className="w-[6px] h-6 bg-white rounded-full opacity-90"
                 />
                 <motion.div
                   animate={isListening ? { height: ["24px", "48px", "24px"] } : { height: "36px" }}
                   transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                   className="w-[6px] h-9 bg-white rounded-full opacity-90"
                 />
                 <motion.div
                   animate={isListening ? { height: ["32px", "40px", "20px"] } : { height: "48px" }}
                   transition={{ duration: 0.9, repeat: Infinity, delay: 0.4 }}
                   className="w-[6px] h-12 bg-white rounded-full opacity-90"
                 />
                 <motion.div
                   animate={isListening ? { height: ["12px", "28px", "12px"] } : { height: "20px" }}
                   transition={{ duration: 1.1, repeat: Infinity, delay: 0.1 }}
                   className="w-[6px] h-5 bg-white rounded-full opacity-90"
                 />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="flex flex-col items-center mt-auto w-full">
           <div className="h-16 flex items-center justify-center mb-6">
              {isListening ? (
                <p className="text-slate-400 text-center text-lg max-w-[250px] leading-snug">
                   NEXUS is listening...
                </p>
              ) : (
                <p className="text-slate-300 text-center text-lg max-w-[250px] leading-snug">
                   Ready when you are...
                </p>
              )}
           </div>

           {/* Controls */}
           <div className="flex items-center justify-between w-full max-w-[260px] pb-4">
              <button className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors shadow-sm">
                 <CornerUpLeft size={20} strokeWidth={2.5} />
              </button>
              
              <button 
                 onClick={isListening ? stopSession : startListening}
                 className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/30 hover:scale-105 active:scale-95 transition-all text-white border-4 border-blue-100 relative group"
              >
                  {/* Subtle pulse behind the mic button */}
                  {isListening && (
                     <div className="absolute inset-0 rounded-full bg-blue-500 scale-150 opacity-20 animate-ping" />
                  )}
                 <Mic size={32} strokeWidth={2.5} className="z-10" />
              </button>
              
              <button 
                onClick={stopSession}
                className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors shadow-sm"
              >
                 <X size={24} strokeWidth={2.5} />
              </button>
           </div>
        </div>

      </div>
    </div>
  );
}
