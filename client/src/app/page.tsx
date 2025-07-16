'use client';

import { useState, useRef, useEffect } from 'react';
import { PipecatClient, RTVIEvent } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';

interface TranscriptItem {
  id: string;
  text: string;
  speaker: 'user' | 'assistant';
  timestamp: Date;
  final: boolean;
}

export default function VoiceChat() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [error, setError] = useState<string | null>(null);
  
  const pcClientRef = useRef<PipecatClient | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
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
        },
        
        onTransportStateChanged: (state: string) => {
          console.log('Transport state:', state);
          setConnectionState(state);
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
              timestamp: new Date(),
              final: true
            };
            
            setTranscripts(prev => [...prev, newTranscript]);
          }
        },
        
        // FIXED: Real-time assistant display with proper spacing
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
            
            // Update the current message in real-time
            setTranscripts(prev => {
              // Remove any existing building message
              const filtered = prev.filter(t => t.id !== currentAssistantIdRef.current);
              
              // Create/update the building message
              if (!currentAssistantIdRef.current) {
                currentAssistantIdRef.current = `assistant-building-${Date.now()}`;
              }
              
              const buildingTranscript: TranscriptItem = {
                id: currentAssistantIdRef.current,
                text: currentAssistantMessageRef.current,
                speaker: 'assistant',
                timestamp: new Date(),
                final: false
              };
              
              return [...filtered, buildingTranscript];
            });
            
            // Set timeout to finalize the message
            assistantMessageTimeoutRef.current = setTimeout(() => {
              finalizeAssistantMessage();
            }, 1000); // Finalize after 1 second of silence
          }
        },
        
        onBotStartedSpeaking: () => {
          console.log('Bot started speaking');
          // Reset for new message
          currentAssistantMessageRef.current = '';
          currentAssistantIdRef.current = '';
          if (assistantMessageTimeoutRef.current) {
            clearTimeout(assistantMessageTimeoutRef.current);
          }
        },
        
        onBotStoppedSpeaking: () => {
          console.log('Bot stopped speaking');
          // Immediately finalize when bot stops speaking
          if (assistantMessageTimeoutRef.current) {
            clearTimeout(assistantMessageTimeoutRef.current);
          }
          finalizeAssistantMessage();
        },
        
        onUserStartedSpeaking: () => {
          console.log('User started speaking');
        },
        
        onUserStoppedSpeaking: () => {
          console.log('User stopped speaking');
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
      setTranscripts(prev => {
        // Remove building message
        const filtered = prev.filter(t => t.id !== currentAssistantIdRef.current);
        
        // Add final message
        const finalTranscript: TranscriptItem = {
          id: `assistant-final-${Date.now()}-${Math.random()}`,
          text: currentAssistantMessageRef.current.trim(),
          speaker: 'assistant',
          timestamp: new Date(),
          final: true
        };
        
        return [...filtered, finalTranscript];
      });
      
      // Reset
      currentAssistantMessageRef.current = '';
      currentAssistantIdRef.current = '';
    }
  };

  // Auto-scroll to bottom when new transcripts are added
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcripts]);

  const handleConnect = async () => {
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
  };

  const handleDisconnect = async () => {
    if (!pcClientRef.current) return;
    
    try {
      await pcClientRef.current.disconnect();
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  };

  const clearTranscripts = () => {
    setTranscripts([]);
    currentAssistantMessageRef.current = '';
    currentAssistantIdRef.current = '';
    if (assistantMessageTimeoutRef.current) {
      clearTimeout(assistantMessageTimeoutRef.current);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Lisa Voice Assistant</h1>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${
                isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}></div>
              <span className="text-sm text-gray-600 capitalize">{connectionState}</span>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center space-x-4 mb-6">
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className={`px-6 py-2 rounded-lg font-medium ${
                  isConnecting
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                {isConnecting ? 'Connecting...' : 'Connect to Lisa'}
              </button>
            ) : (
              <>
                <button
                  onClick={handleDisconnect}
                  className="px-6 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium"
                >
                  Disconnect
                </button>
                
                <button
                  onClick={clearTranscripts}
                  className="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-lg font-medium"
                >
                  Clear Chat
                </button>
              </>
            )}
          </div>

          {/* Hidden Audio Element for Bot Voice */}
          <audio 
            ref={audioRef}
            autoPlay
            style={{ display: 'none' }}
          />

          {/* Transcripts */}
          <div className="border rounded-lg h-96 overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b">
              <h3 className="font-medium text-gray-700">Conversation</h3>
            </div>
            
            <div 
              ref={transcriptContainerRef}
              className="h-full overflow-y-auto p-4 space-y-3"
            >
              {transcripts.length === 0 ? (
                <div className="text-center text-gray-500 mt-8">
                  {isConnected ? 'Start speaking...' : 'Connect to start chatting with Lisa'}
                </div>
              ) : (
                transcripts.map((transcript) => (
                  <div
                    key={transcript.id}
                    className={`flex ${transcript.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        transcript.speaker === 'user'
                          ? transcript.final 
                            ? 'bg-blue-500 text-white' 
                            : 'bg-blue-300 text-white opacity-75'
                          : transcript.final
                            ? 'bg-gray-200 text-gray-800'
                            : 'bg-gray-100 text-gray-600 opacity-75'
                      }`}
                    >
                      <div className="text-sm">
                        {transcript.text}
                        {!transcript.final && transcript.speaker === 'assistant' && (
                          <span className="ml-1 opacity-60 animate-pulse">●</span>
                        )}
                      </div>
                      <div className={`text-xs mt-1 ${
                        transcript.speaker === 'user' ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {transcript.speaker === 'user' ? 'You' : 'Lisa'} • {formatTime(transcript.timestamp)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}