'use client';

import { useState, useRef, useEffect } from 'react';
import { PipecatClient, RTVIEvent } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';

interface TranscriptItem {
  id: string;
  text: string;
  speaker: 'user' | 'assistant';
  final: boolean;
}

export default function VoiceChat() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState<TranscriptItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const pcClientRef = useRef<PipecatClient | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  // Track current building messages
  const currentAssistantMessageRef = useRef<string>('');
  const assistantMessageTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentAssistantIdRef = useRef<string>('');

  useEffect(() => {
    const transport = new SmallWebRTCTransport({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      waitForICEGathering: false
    });

    pcClientRef.current = new PipecatClient({
      transport,
      enableMic: true,
      enableCam: false,
      callbacks: {
        onConnected: () => {
          console.log('Connected to transport');
          setIsConnected(true);
          setError(null);
        },
        
        onDisconnected: () => {
          console.log('Disconnected from transport');
          setIsConnected(false);
          setIsConnecting(false);
          setIsListening(false);
          setIsSpeaking(false);
          setCurrentTranscript(null);
        },
        
        onTransportStateChanged: (state: string) => {
          console.log('Transport state:', state);
        },
        
        onBotReady: () => {
          console.log('Bot is ready!');
          setIsConnecting(false);
        },
        
        onTrackStarted: (track: MediaStreamTrack, participant: any) => {
          console.log('Track started:', track.kind, participant);
          if (track.kind === 'audio' && participant?.id !== 'local' && audioRef.current) {
            const stream = new MediaStream([track]);
            audioRef.current.srcObject = stream;
            audioRef.current.play().catch(e => console.error('Audio play failed:', e));
          }
        },
        
        // User transcripts - only final ones
        onUserTranscript: (data: any) => {
          console.log('User transcript:', data);
          
          if (data.text && data.text.trim() && data.final) {
            const newTranscript: TranscriptItem = {
              id: `user-${Date.now()}-${Math.random()}`,
              text: data.text.trim(),
              speaker: 'user',
              final: true
            };
            
            setCurrentTranscript(newTranscript);
          }
        },
        
        // Real-time assistant display with proper spacing
        onBotTtsText: (data: any) => {
          console.log('Bot TTS text:', data);
          
          if (data.text && data.text.trim()) {
            // Add space before new text (except for first word)
            const textToAdd = currentAssistantMessageRef.current ? ` ${data.text}` : data.text;
            currentAssistantMessageRef.current += textToAdd;
            
            // Clear existing timeout
            if (assistantMessageTimeoutRef.current) {
              clearTimeout(assistantMessageTimeoutRef.current);
            }
            
            // Create/update the building message
            if (!currentAssistantIdRef.current) {
              currentAssistantIdRef.current = `assistant-building-${Date.now()}`;
            }
            
            const buildingTranscript: TranscriptItem = {
              id: currentAssistantIdRef.current,
              text: currentAssistantMessageRef.current,
              speaker: 'assistant',
              final: false
            };
            
            setCurrentTranscript(buildingTranscript);
            
            // Set timeout to finalize the message
            assistantMessageTimeoutRef.current = setTimeout(() => {
              finalizeAssistantMessage();
            }, 1000);
          }
        },
        
        onBotStartedSpeaking: () => {
          console.log('Bot started speaking');
          setIsSpeaking(true);
          setIsListening(false);
          // Clear user transcript when assistant starts speaking
          setCurrentTranscript(null);
          // Reset for new message
          currentAssistantMessageRef.current = '';
          currentAssistantIdRef.current = '';
          if (assistantMessageTimeoutRef.current) {
            clearTimeout(assistantMessageTimeoutRef.current);
          }
        },
        
        onBotStoppedSpeaking: () => {
          console.log('Bot stopped speaking');
          setIsSpeaking(false);
          // Immediately finalize when bot stops speaking
          if (assistantMessageTimeoutRef.current) {
            clearTimeout(assistantMessageTimeoutRef.current);
          }
          finalizeAssistantMessage();
          // Clear transcript after speaking is done
          setTimeout(() => {
            setCurrentTranscript(null);
          }, 2000);
        },
        
        onUserStartedSpeaking: () => {
          console.log('User started speaking');
          setIsListening(true);
          setIsSpeaking(false);
          // Clear assistant transcript when user starts speaking
          setCurrentTranscript(null);
        },
        
        onUserStoppedSpeaking: () => {
          console.log('User stopped speaking');
          setIsListening(false);
        },
        
        onError: (message: any) => {
          console.error('RTVI Error:', message);
          let errorMessage = 'An error occurred';
          if (message?.data && typeof message.data === 'object') {
            errorMessage = message.data.message || message.data.error || message.message || errorMessage;
          } else if (message?.message) {
            errorMessage = message.message;
          }
          setError(errorMessage);
          setIsConnecting(false);
        },

        onMessageError: (message: any) => {
          console.error('Message Error:', message);
          let errorMessage = 'Message error occurred';
          if (message?.data && typeof message.data === 'object') {
            errorMessage = message.data.message || message.data.error || message.message || errorMessage;
          } else if (message?.message) {
            errorMessage = message.message;
          }
          setError(errorMessage);
        },
      }
    });

    return () => {
      if (pcClientRef.current) {
        pcClientRef.current.disconnect();
      }
      if (assistantMessageTimeoutRef.current) {
        clearTimeout(assistantMessageTimeoutRef.current);
      }
    };
  }, []);

  // Helper function to finalize assistant message
  const finalizeAssistantMessage = () => {
    if (currentAssistantMessageRef.current.trim()) {
      const finalTranscript: TranscriptItem = {
        id: `assistant-final-${Date.now()}-${Math.random()}`,
        text: currentAssistantMessageRef.current.trim(),
        speaker: 'assistant',
        final: true
      };
      
      setCurrentTranscript(finalTranscript);
      
      // Reset
      currentAssistantMessageRef.current = '';
      currentAssistantIdRef.current = '';
    }
  };

  const handleToggleConnection = async () => {
    if (isConnected) {
      // Disconnect
      if (pcClientRef.current) {
        try {
          await pcClientRef.current.disconnect();
        } catch (err) {
          console.error('Disconnect failed:', err);
        }
      }
    } else {
      // Connect
      if (!pcClientRef.current) return;
      
      setIsConnecting(true);
      setError(null);
      
      try {
        await pcClientRef.current.connect({
          connectionUrl: 'http://localhost:8000/api/offer'
        });
      } catch (err: any) {
        console.error('Connection failed:', err);
        setError(err?.message || 'Failed to connect to the server');
        setIsConnecting(false);
      }
    }
  };

  // Siri-like animation component
  const SiriAnimation = () => {
    const getAnimationState = () => {
      if (isConnecting) return 'connecting';
      if (isSpeaking) return 'speaking';
      if (isListening) return 'listening';
      if (isConnected) return 'idle';
      return 'disconnected';
    };

    const animationState = getAnimationState();

    return (
      <div className="flex items-center justify-center">
        <button
          onClick={handleToggleConnection}
          disabled={isConnecting}
          className="relative focus:outline-none group"
        >
          {/* Main Circle */}
          <div className={`
            w-32 h-32 rounded-full transition-all duration-500 cursor-pointer relative overflow-hidden
            ${animationState === 'disconnected' ? 'bg-white/20 hover:bg-white/30 border-2 border-white/40' : ''}
            ${animationState === 'connecting' ? 'bg-white/30 animate-pulse border-2 border-white/60' : ''}
            ${animationState === 'idle' ? 'bg-white/25 hover:bg-white/35 border-2 border-white/50 shadow-lg shadow-white/20' : ''}
            ${animationState === 'listening' ? 'bg-white/30 border-2 border-white/70' : ''}
            ${animationState === 'speaking' ? 'bg-white/35 border-2 border-white/80' : ''}
          `}>
            {/* Animated Rings for Speaking */}
            {animationState === 'speaking' && (
              <>
                <div className="absolute inset-0 rounded-full bg-white/20 animate-ping opacity-40"></div>
                <div className="absolute inset-2 rounded-full bg-white/15 animate-ping opacity-50 animation-delay-200"></div>
                <div className="absolute inset-4 rounded-full bg-white/10 animate-ping opacity-60 animation-delay-400"></div>
              </>
            )}
            
            {/* Animated Rings for Listening */}
            {animationState === 'listening' && (
              <>
                <div className="absolute inset-0 rounded-full bg-white/15 animate-pulse opacity-50"></div>
                <div className="absolute inset-3 rounded-full bg-white/10 animate-pulse opacity-70 animation-delay-300"></div>
              </>
            )}
            
            {/* Icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              {(animationState === 'disconnected' || animationState === 'connecting' || animationState === 'idle') && (
                <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              )}
              {animationState === 'listening' && (
                <div className="flex items-center space-x-1">
                  <div className="w-1 h-8 bg-white rounded animate-pulse"></div>
                  <div className="w-1 h-6 bg-white rounded animate-pulse animation-delay-100"></div>
                  <div className="w-1 h-10 bg-white rounded animate-pulse animation-delay-200"></div>
                  <div className="w-1 h-4 bg-white rounded animate-pulse animation-delay-300"></div>
                  <div className="w-1 h-7 bg-white rounded animate-pulse animation-delay-400"></div>
                </div>
              )}
              {animationState === 'speaking' && (
                <div className="flex items-center space-x-1">
                  <div className="w-1 h-4 bg-white rounded animate-bounce"></div>
                  <div className="w-1 h-8 bg-white rounded animate-bounce animation-delay-100"></div>
                  <div className="w-1 h-6 bg-white rounded animate-bounce animation-delay-200"></div>
                  <div className="w-1 h-10 bg-white rounded animate-bounce animation-delay-300"></div>
                  <div className="w-1 h-5 bg-white rounded animate-bounce animation-delay-400"></div>
                </div>
              )}
            </div>
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center relative">
      {/* Error Display - positioned at top */}
      {error && (
        <div className="absolute top-6 left-6 right-6 p-4 bg-red-500/20 border border-red-500/30 text-red-200 rounded-lg backdrop-blur-sm z-10">
          {error}
        </div>
      )}

      {/* Main Content - Centered */}
      <div className="flex flex-col items-center justify-center flex-1">
        {/* Siri Animation */}
        <div className="mb-16">
          <SiriAnimation />
        </div>

        {/* Transcription Area - Single location for current speaker */}
        {currentTranscript && (
          <div className="fixed inset-x-6 top-1/2 transform -translate-y-1/2 mt-32 flex justify-center">
            <div className="max-w-4xl w-full text-center">
              <div className={`
                text-xl md:text-2xl lg:text-3xl xl:text-4xl font-light leading-relaxed
                ${currentTranscript.speaker === 'user' ? 'text-white/90' : 'text-white'}
                ${!currentTranscript.final && currentTranscript.speaker === 'assistant' ? 'animate-pulse' : ''}
              `}>
                {currentTranscript.text}
                {!currentTranscript.final && currentTranscript.speaker === 'assistant' && (
                  <span className="ml-2 inline-block w-1 h-6 bg-white animate-pulse"></span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connection Status - Bottom corner */}
      <div className="absolute bottom-6 right-6">
        <div className={`w-3 h-3 rounded-full ${
          isConnected ? 'bg-green-400' : 'bg-red-400'
        }`}></div>
      </div>

      {/* Hidden Audio Element */}
      <audio 
        ref={audioRef}
        autoPlay
        style={{ display: 'none' }}
      />
      
      {/* Custom CSS for animation delays */}
      <style jsx>{`
        .animation-delay-100 { animation-delay: 0.1s; }
        .animation-delay-200 { animation-delay: 0.2s; }
        .animation-delay-300 { animation-delay: 0.3s; }
        .animation-delay-400 { animation-delay: 0.4s; }
      `}</style>
    </div>
  );
}