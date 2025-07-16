'use client';

import { useState, useRef, useEffect } from 'react';
import { PipecatClient, RTVIEvent } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';
import { Mic, MicOff, Volume2, Waves } from 'lucide-react';

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

  // Enhanced Siri-like animation component
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
          {/* Main Container */}
          <div className={`
            relative w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 
            rounded-full transition-all duration-500 cursor-pointer overflow-hidden
            ${animationState === 'disconnected' ? 'bg-gray-700 hover:bg-gray-800 border-1 border-gray-700' : ''}
            ${animationState === 'connecting' ? 'bg-gray-700 border-1 border-gray-700' : ''}
            ${animationState === 'idle' ? 'bg-gray-700 hover:bg-gray-800 border-1 border-gray-700 shadow-lg shadow-white/10' : ''}
            ${animationState === 'listening' ? 'bg-blue-500/30 ' : ''}
            ${animationState === 'speaking' ? 'bg-purple-500/30 ' : ''}
          `}>
            
            {/* Speaking Animation - Pulsing Rings */}
            {animationState === 'speaking' && (
              <>
                <div className="absolute inset-0 rounded-full bg-purple-400/20 animate-ping opacity-60"></div>
                <div className="absolute inset-2 rounded-full bg-purple-300/30 animate-ping opacity-70 animation-delay-200"></div>
                <div className="absolute inset-4 rounded-full bg-purple-200/40 animate-ping opacity-80 animation-delay-400"></div>
              </>
            )}
            
            {/* Listening Animation - Breathing Effect */}
            {animationState === 'listening' && (
              <>
                <div className="absolute inset-0 rounded-full bg-blue-400/20 animate-pulse opacity-50"></div>
                <div className="absolute inset-3 rounded-full bg-blue-300/30 animate-pulse opacity-70 animation-delay-300"></div>
              </>
            )}
            
            {/* Icons */}
            <div className="absolute inset-0 flex items-center justify-center z-10">
              {animationState === 'disconnected' && (
                <MicOff className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-white/70" />
              )}
              {(animationState === 'idle') && (
                <Mic className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-white" />
              )}
              {animationState === 'listening' && (
                <div className="flex items-center space-x-1">
                  <div className="w-1 h-6 sm:h-8 bg-white rounded animate-pulse"></div>
                  <div className="w-1 h-4 sm:h-6 bg-white rounded animate-pulse animation-delay-100"></div>
                  <div className="w-1 h-8 sm:h-10 bg-white rounded animate-pulse animation-delay-200"></div>
                  <div className="w-1 h-3 sm:h-4 bg-white rounded animate-pulse animation-delay-300"></div>
                  <div className="w-1 h-5 sm:h-7 bg-white rounded animate-pulse animation-delay-400"></div>
                </div>
              )}
              {animationState === 'speaking' && (
                <Volume2 className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-white animate-pulse" />
              )}
              {animationState === 'connecting' && (
                <Waves className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-white animate-pulse" />
              )}
            </div>
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center relative px-4 sm:px-6 lg:px-8">
      {/* Error Display - positioned at top */}
      {error && (
        <div className="absolute top-4 sm:top-6 left-4 right-4 sm:left-6 sm:right-6 p-3 sm:p-4 bg-red-500/20 border border-red-500/30 text-red-200 rounded-lg backdrop-blur-sm z-10 text-sm sm:text-base">
          {error}
        </div>
      )}

      {/* Main Content - Centered */}
      <div className="flex flex-col items-center justify-center flex-1 w-full max-w-4xl mx-auto">
        {/* Siri Animation */}
        <div className="mb-8 sm:mb-12 md:mb-16">
          <SiriAnimation />
        </div>

        {/* Transcription Area - Single location for current speaker */}
        {currentTranscript && (
          <div className="w-full max-w-3xl mx-auto px-4 sm:px-6">
            <div className="text-center">
              <div className={`
                text-base sm:text-lg md:text-xl font-light leading-relaxed
                ${currentTranscript.speaker === 'user' ? 'text-blue-300' : 'text-white'}
                ${!currentTranscript.final && currentTranscript.speaker === 'assistant' ? 'animate-pulse' : ''}
                break-words
              `}>
                {currentTranscript.text}
                {!currentTranscript.final && currentTranscript.speaker === 'assistant' && (
                  <span className="ml-2 inline-block w-0.5 h-4 sm:h-5 bg-white animate-pulse"></span>
                )}
              </div>
              
              {/* Speaker indicator */}
              <div className="mt-2 sm:mt-3">
                <span className={`
                  text-xs sm:text-sm font-medium opacity-60
                  ${currentTranscript.speaker === 'user' ? 'text-blue-400' : 'text-purple-400'}
                `}>
                  {currentTranscript.speaker === 'user' ? 'You' : 'Assistant'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Status Text when no transcript */}
        {!currentTranscript && isConnected && (
          <div className="text-center text-white/60 max-w-md px-4">
            <p className="text-sm sm:text-base md:text-lg font-light mb-2">
              {isListening && "Listening..."}
              {isSpeaking && "Speaking..."}
              {!isListening && !isSpeaking && ""}
            </p>
          </div>
        )}

        {/* Initial state */}
        {!isConnected && !isConnecting && (
          <div className="text-center text-white/60 max-w-md px-4">
            <p className="text-xs sm:text-lg opacity-80">
              Tap to connect
            </p>
          </div>
        )}

        {isConnecting && (
          <div className="text-center text-white/80 max-w-md px-4">
            <p className="text-sm sm:text-base md:text-lg font-light">
              Connecting...
            </p>
          </div>
        )}
      </div>

      {/* Connection Status - Bottom corner */}
      <div className="absolute bottom-4 sm:bottom-6 right-4 sm:right-6">
        <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${
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