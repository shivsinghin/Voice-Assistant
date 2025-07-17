class LisaVoiceAgent {
    constructor() {
        // Initialize state
        this.state = {
            accessToken: localStorage.getItem('lisa_access_token'),
            connected: false,
            connecting: false,
            isListening: false,
            isSpeaking: false,
            currentAssistantMessage: '',
            assistantMessageTimeout: null,
            currentAssistantId: '',
            peerConnection: null,
            dataChannel: null,
            recaptcha: {
                siteKey: null,
                enabled: false
            }
        };

        // Cache DOM elements once
        this.elements = this.cacheElements();
        
        // Configuration
        this.config = {
            iceServers: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302", 
                "stun:stun2.l.google.com:19302"
            ],
            iceGatheringTimeout: 2000,
            errorDisplayTimeout: 5000,
            transcriptClearDelay: 2000,
            assistantMessageTimeout: 1000
        };

        // Bind methods to preserve context
        this.bindMethods();
        
        // Initialize
        this.init();
    }

    cacheElements() {
        const elements = {};
        const elementIds = [
            'error-display', 'login-modal', 'main-app', 'login-form', 'login-error',
            'logout-btn', 'login-btn', 'login-btn-text', 'login-spinner', 'connect-btn',
            'main-container', 'speaking-rings', 'listening-rings', 'audio-el',
            'live-transcript', 'live-transcript-text', 'live-speaker-indicator',
            'connection-indicator', 'initial-message', 'connecting-message',
            'connected-status', 'status-text', 'icon-disconnected', 'icon-idle',
            'icon-listening', 'icon-speaking', 'icon-connecting'
        ];

        elementIds.forEach(id => {
            elements[this.toCamelCase(id)] = document.getElementById(id);
        });

        return elements;
    }

    toCamelCase(str) {
        return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    }

    bindMethods() {
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.login = this.login.bind(this);
        this.logout = this.logout.bind(this);
        this.handleConnectClick = this.handleConnectClick.bind(this);
        this.handleLoginSubmit = this.handleLoginSubmit.bind(this);
        this.onConnected = this.onConnected.bind(this);
        this.onDisconnected = this.onDisconnected.bind(this);
    }

    // ==================== INITIALIZATION ====================
    
    async init() {
        try {
            lucide.createIcons();
            await this.loadRecaptchaConfig();
            await this.initializeAuthentication();
            this.setupEventListeners();
            this.updateUI();
        } catch (error) {
            console.error('App initialization error:', error);
            this.ui.showLoginModal();
            this.ui.showError('Failed to initialize app. Please refresh the page.');
        }
    }

    setupEventListeners() {
        this.elements.connectBtn.addEventListener('click', this.handleConnectClick);
        this.elements.loginForm.addEventListener('submit', this.handleLoginSubmit);
        this.elements.logoutBtn.addEventListener('click', this.logout);
    }

    // ==================== UI MANAGEMENT ====================
    
    get ui() {
        return {
            showError: (message) => {
                this.elements.errorDisplay.textContent = message;
                this.elements.errorDisplay.classList.remove('hidden');
                setTimeout(() => this.elements.errorDisplay.classList.add('hidden'), this.config.errorDisplayTimeout);
            },

            showLoginError: (message) => {
                this.elements.loginError.textContent = message;
                this.elements.loginError.classList.remove('hidden');
            },

            hideLoginError: () => {
                this.elements.loginError.classList.add('hidden');
            },

            showLoginLoading: () => {
                this.elements.loginBtn.disabled = true;
                this.elements.loginBtnText.classList.add('hidden');
                this.elements.loginSpinner.classList.remove('hidden');
            },

            hideLoginLoading: () => {
                this.elements.loginBtn.disabled = false;
                this.elements.loginBtnText.classList.remove('hidden');
                this.elements.loginSpinner.classList.add('hidden');
            },

            showLoginModal: () => {
                this.elements.loginModal.classList.remove('hidden');
                this.elements.mainApp.classList.add('hidden');
            },

            showMainApp: () => {
                this.elements.loginModal.classList.add('hidden');
                this.elements.mainApp.classList.remove('hidden');
            },

            showLiveTranscript: (text, speaker, isInterim = false) => {
                this.elements.liveTranscriptText.textContent = text;
                this.elements.liveSpeakerIndicator.textContent = speaker === 'user' ? 'You' : 'Lisa';
                
                const baseClasses = 'text-md sm:text-md md:text-md font-light leading-relaxed break-words mb-1';
                const speakerClasses = 'text-sm sm:text-base font-medium opacity-60';
                
                if (speaker === 'user') {
                    this.elements.liveTranscriptText.className = `${baseClasses} text-blue-400`;
                    this.elements.liveSpeakerIndicator.className = `${speakerClasses} text-blue-400`;
                } else {
                    this.elements.liveTranscriptText.className = `${baseClasses} text-white`;
                    this.elements.liveSpeakerIndicator.className = `${speakerClasses} text-purple-400`;
                }
                
                if (isInterim && speaker === 'assistant') {
                    this.elements.liveTranscriptText.classList.add('animate-pulse');
                    this.elements.liveTranscriptText.innerHTML = text + '<span class="ml-2 inline-block w-0.5 h-6 sm:h-7 bg-white animate-pulse"></span>';
                } else {
                    this.elements.liveTranscriptText.classList.remove('animate-pulse');
                    this.elements.liveTranscriptText.textContent = text;
                }
                
                this.elements.liveTranscript.classList.remove('hidden');
            },

            hideLiveTranscript: () => {
                this.elements.liveTranscript.classList.add('hidden');
            }
        };
    }

    // ==================== STATE MANAGEMENT ====================
    
    getAnimationState() {
        if (this.state.connecting) return 'connecting';
        if (this.state.isSpeaking) return 'speaking';
        if (this.state.isListening) return 'listening';
        if (this.state.connected) return 'idle';
        return 'disconnected';
    }

    updateAnimationState() {
        const state = this.getAnimationState();
        const icons = [
            this.elements.iconDisconnected, this.elements.iconIdle, 
            this.elements.iconListening, this.elements.iconSpeaking, 
            this.elements.iconConnecting
        ];

        // Reset UI
        icons.forEach(el => el.classList.add('hidden'));
        this.elements.speakingRings.classList.add('hidden');
        this.elements.listeningRings.classList.add('hidden');

        const baseClasses = 'relative w-16 h-16 sm:w-16 sm:h-16 md:w-16 md:h-16 lg:w-16 lg:h-16 rounded-full transition-all duration-500 cursor-pointer overflow-hidden';
        this.elements.mainContainer.className = baseClasses;

        const stateConfig = {
            disconnected: {
                classes: ['bg-stone-700', 'hover:bg-stone-800', 'shadow-2xl'],
                icon: this.elements.iconDisconnected
            },
            connecting: {
                classes: ['bg-stone-700', 'shadow-2xl'],
                icon: this.elements.iconConnecting
            },
            idle: {
                classes: ['bg-stone-700', 'hover:bg-stone-800', 'shadow-2xl', 'shadow-white/10'],
                icon: this.elements.iconIdle
            },
            listening: {
                classes: ['bg-blue-500/30', 'shadow-2xl'],
                icon: this.elements.iconListening,
                animation: this.elements.listeningRings
            },
            speaking: {
                classes: ['bg-purple-500/30', 'shadow-2xl'],
                icon: this.elements.iconSpeaking,
                animation: this.elements.speakingRings
            }
        };

        const config = stateConfig[state];
        this.elements.mainContainer.classList.add(...config.classes);
        config.icon.classList.remove('hidden');
        if (config.animation) config.animation.classList.remove('hidden');
    }

    updateStatusDisplay() {
        const statusElements = [
            this.elements.initialMessage, this.elements.connectingMessage, 
            this.elements.connectedStatus
        ];
        
        statusElements.forEach(el => el.classList.add('hidden'));

        if (!this.state.connected && !this.state.connecting) {
            this.elements.initialMessage.classList.remove('hidden');
        } else if (this.state.connecting) {
            this.elements.connectingMessage.classList.remove('hidden');
        } else if (this.state.connected && (this.state.isListening || this.state.isSpeaking)) {
            this.elements.connectedStatus.classList.remove('hidden');
        }
    }

    updateConnectionIndicator(state) {
        const stateClasses = {
            connected: 'w-2 h-2 rounded-full bg-green-700 shadow-lg',
            connecting: 'w-2 h-2 rounded-full bg-yellow-700 shadow-lg animate-pulse',
            disconnected: 'w-2 h-2 rounded-full bg-red-700 shadow-lg'
        };
        
        this.elements.connectionIndicator.className = stateClasses[state] || stateClasses.disconnected;
    }

    updateUI() {
        this.updateAnimationState();
        this.updateStatusDisplay();
        this.updateConnectionIndicator(this.state.connected ? 'connected' : 'disconnected');
    }

    // ==================== RECAPTCHA ====================
    
    async loadRecaptchaConfig() {
        try {
            const response = await fetch('/api/recaptcha-config');
            const config = await response.json();
            
            this.state.recaptcha.siteKey = config.site_key;
            this.state.recaptcha.enabled = config.enabled;
            
            if (this.state.recaptcha.enabled && this.state.recaptcha.siteKey) {
                this.loadRecaptchaScript();
                console.log('reCAPTCHA enabled and script loaded');
            } else {
                console.warn('reCAPTCHA not configured - skipping bot protection');
            }
        } catch (error) {
            console.error('Failed to load reCAPTCHA config:', error);
            this.state.recaptcha.enabled = false;
        }
    }

    loadRecaptchaScript() {
        const script = document.createElement('script');
        script.src = `https://www.google.com/recaptcha/api.js?render=${this.state.recaptcha.siteKey}`;
        document.head.appendChild(script);
    }

    async executeRecaptcha() {
        if (!this.state.recaptcha.enabled || !this.state.recaptcha.siteKey) {
            return 'disabled';
        }

        return new Promise((resolve) => {
            if (typeof grecaptcha === 'undefined') {
                console.warn('reCAPTCHA not loaded, using fallback');
                resolve('fallback');
                return;
            }

            grecaptcha.ready(() => {
                grecaptcha.execute(this.state.recaptcha.siteKey, {action: 'login'})
                    .then(resolve)
                    .catch((error) => {
                        console.error('reCAPTCHA execution failed:', error);
                        resolve('error');
                    });
            });
        });
    }

    // ==================== AUTHENTICATION ====================
    
    async initializeAuthentication() {
        const isTokenValid = await this.verifyToken();
        
        if (isTokenValid) {
            this.ui.showMainApp();
        } else {
            this.ui.showLoginModal();
            if (this.state.accessToken) {
                localStorage.removeItem('lisa_access_token');
                this.state.accessToken = null;
            }
        }
    }

    async login(username, password) {
        this.ui.showLoginLoading();
        this.ui.hideLoginError();
        
        try {
            const recaptchaToken = await this.executeRecaptcha();
            
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, recaptcha_token: recaptchaToken })
            });

            if (response.ok) {
                const data = await response.json();
                this.state.accessToken = data.access_token;
                localStorage.setItem('lisa_access_token', this.state.accessToken);
                this.ui.showMainApp();
                console.log('Login successful');
            } else {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.detail || `Login failed (${response.status})`;
                this.ui.showLoginError(errorMessage);
            }
        } catch (error) {
            console.error('Login error:', error);
            this.handleLoginError(error);
        } finally {
            this.ui.hideLoginLoading();
        }
    }

    handleLoginError(error) {
        let message = `Network error: ${error.message}`;
        
        if (error instanceof TypeError && error.message.includes('fetch')) {
            message = 'Cannot connect to server. Please check if the server is running.';
        } else if (error.name === 'AbortError') {
            message = 'Request timeout. Please try again.';
        }
        
        this.ui.showLoginError(message);
    }

    async verifyToken() {
        if (!this.state.accessToken) return false;

        try {
            const response = await fetch('/api/verify-token', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.state.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.ok;
        } catch (error) {
            console.error('Token verification error:', error);
            return false;
        }
    }

    logout() {
        this.state.accessToken = null;
        localStorage.removeItem('lisa_access_token');
        this.ui.showLoginModal();
        if (this.state.connected) {
            this.disconnect();
        }
    }

    // ==================== WEBRTC CONNECTION ====================
    
    async connect() {
        this.state.connecting = true;
        this.elements.connectBtn.disabled = true;
        this.updateUI();
        this.updateConnectionIndicator('connecting');
        
        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({audio: true});
            this.state.peerConnection = await this.createWebRTCConnection(audioStream.getAudioTracks()[0]);
        } catch (error) {
            console.error('Connection failed:', error);
            this.ui.showError('Failed to connect: ' + error.message);
            this.onDisconnected();
        }
    }

    async createWebRTCConnection(audioTrack) {
        const config = {
            iceServers: this.config.iceServers.map(url => ({ urls: [url] }))
        };
        
        const pc = new RTCPeerConnection(config);
        this.addPeerConnectionEventListeners(pc);
        
        pc.ontrack = e => this.elements.audioEl.srcObject = e.streams[0];
        
        this.state.dataChannel = pc.createDataChannel("rtvi", { ordered: true });
        this.setupDataChannel(this.state.dataChannel);
        
        pc.addTransceiver(audioTrack, { direction: 'sendrecv' });
        pc.addTransceiver('video', { direction: 'sendrecv' });
        
        await pc.setLocalDescription(await pc.createOffer());
        await this.waitForIceGatheringComplete(pc);
        
        const offer = pc.localDescription;
        const response = await fetch('/api/offer', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.state.accessToken}`
            },
            body: JSON.stringify({ sdp: offer.sdp, type: offer.type })
        });
        
        const answer = await response.json();
        await pc.setRemoteDescription(answer);
        
        return pc;
    }

    async waitForIceGatheringComplete(pc, timeoutMs = this.config.iceGatheringTimeout) {
        if (pc.iceGatheringState === 'complete') return;
        
        return new Promise((resolve) => {
            let timeoutId;
            
            const cleanup = () => {
                pc.removeEventListener('icegatheringstatechange', checkState);
                clearTimeout(timeoutId);
            };
            
            const checkState = () => {
                if (pc.iceGatheringState === 'complete') {
                    cleanup();
                    resolve();
                }
            };
            
            const onTimeout = () => {
                console.warn(`ICE gathering timed out after ${timeoutMs} ms.`);
                cleanup();
                resolve();
            };
            
            pc.addEventListener('icegatheringstatechange', checkState);
            timeoutId = setTimeout(onTimeout, timeoutMs);
            checkState();
        });
    }

    addPeerConnectionEventListeners(pc) {
        pc.oniceconnectionstatechange = () => {
            console.log("ICE connection state:", pc?.iceConnectionState);
        };
        
        pc.onconnectionstatechange = () => {
            console.log("Connection state:", pc?.connectionState);
            const state = pc?.connectionState;
            if (state === 'connected') {
                this.onConnected();
            } else if (state === 'disconnected') {
                this.onDisconnected();
            }
        };
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log("New ICE candidate:", event.candidate);
            }
        };
        
        pc.ondatachannel = (event) => {
            const channel = event.channel;
            if (channel.label === "rtvi") {
                this.setupDataChannel(channel);
                this.state.dataChannel = channel;
            }
        };
    }

    setupDataChannel(channel) {
        channel.onopen = () => {
            console.log("Data channel opened");
            this.sendRTVIMessage({
                type: "client-ready",
                data: {
                    version: "1.0",
                    about: {
                        library: "custom-client",
                        library_version: "1.0.0",
                        platform: "web"
                    }
                }
            });
        };

        channel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleRTVIMessage(message);
            } catch (error) {
                console.error("Error parsing RTVI message:", error);
            }
        };

        channel.onerror = (error) => console.error("Data channel error:", error);
        channel.onclose = () => console.log("Data channel closed");
    }

    sendRTVIMessage(message) {
        if (this.state.dataChannel?.readyState === 'open') {
            const rtviMessage = {
                id: this.generateId(),
                label: "rtvi-ai",
                ...message
            };
            this.state.dataChannel.send(JSON.stringify(rtviMessage));
            console.log("Sent RTVI message:", rtviMessage);
        }
    }

    handleRTVIMessage(message) {
        console.log("Received RTVI message:", message);
        
        const handlers = {
            "bot-ready": () => console.log("Bot is ready"),
            
            "user-started-speaking": () => {
                this.state.isListening = true;
                this.state.isSpeaking = false;
                this.ui.hideLiveTranscript();
                this.updateUI();
            },
            
            "user-stopped-speaking": () => {
                this.state.isListening = false;
                this.updateUI();
            },
            
            "bot-started-speaking": () => {
                this.state.isSpeaking = true;
                this.state.isListening = false;
                this.ui.hideLiveTranscript();
                this.resetAssistantMessage();
                this.updateUI();
            },
            
            "bot-stopped-speaking": () => {
                this.state.isSpeaking = false;
                this.finalizeAssistantMessage();
                this.updateUI();
                setTimeout(() => this.ui.hideLiveTranscript(), this.config.transcriptClearDelay);
            },
            
            "user-transcription": (data) => {
                if (data.text?.trim() && data.final) {
                    this.ui.showLiveTranscript(data.text.trim(), 'user', false);
                }
            },
            
            "bot-transcription": (data) => {
                if (data.text?.trim() && !this.state.isSpeaking) {
                    this.ui.showLiveTranscript(data.text.trim(), 'assistant', false);
                }
            },
            
            "bot-tts-text": (data) => this.handleBotTtsText(data)
        };

        const handler = handlers[message.type];
        if (handler) {
            handler(message.data);
        } else {
            console.log("Unhandled RTVI message type:", message.type);
        }
    }

    handleBotTtsText(data) {
        if (data.text?.trim()) {
            const textToAdd = this.state.currentAssistantMessage ? ` ${data.text}` : data.text;
            this.state.currentAssistantMessage += textToAdd;
            
            if (this.state.assistantMessageTimeout) {
                clearTimeout(this.state.assistantMessageTimeout);
            }
            
            if (!this.state.currentAssistantId) {
                this.state.currentAssistantId = `assistant-building-${Date.now()}`;
            }
            
            this.ui.showLiveTranscript(this.state.currentAssistantMessage, 'assistant', true);
            
            this.state.assistantMessageTimeout = setTimeout(() => {
                this.finalizeAssistantMessage();
            }, this.config.assistantMessageTimeout);
        }
    }

    resetAssistantMessage() {
        this.state.currentAssistantMessage = '';
        this.state.currentAssistantId = '';
        if (this.state.assistantMessageTimeout) {
            clearTimeout(this.state.assistantMessageTimeout);
        }
    }

    finalizeAssistantMessage() {
        if (this.state.currentAssistantMessage.trim()) {
            this.ui.showLiveTranscript(this.state.currentAssistantMessage.trim(), 'assistant', false);
            this.resetAssistantMessage();
        }
    }

    disconnect() {
        if (!this.state.peerConnection) return;
        
        if (this.state.dataChannel) {
            this.state.dataChannel.close();
            this.state.dataChannel = null;
        }
        
        this.state.peerConnection.close();
        this.state.peerConnection = null;
        this.onDisconnected();
    }

    onConnected() {
        this.state.connecting = false;
        this.state.connected = true;
        this.elements.connectBtn.disabled = false;
        this.updateUI();
        this.updateConnectionIndicator('connected');
    }

    onDisconnected() {
        Object.assign(this.state, {
            connecting: false,
            connected: false,
            isListening: false,
            isSpeaking: false
        });
        this.elements.connectBtn.disabled = false;
        this.ui.hideLiveTranscript();
        this.updateUI();
        this.updateConnectionIndicator('disconnected');
    }

    // ==================== EVENT HANDLERS ====================
    
    async handleConnectClick() {
        if (!this.state.connected && !this.state.connecting) {
            await this.connect();
        } else {
            this.disconnect();
        }
    }

    async handleLoginSubmit(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        if (username && password) {
            await this.login(username, password);
        }
    }

    // ==================== UTILITIES ====================
    
    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
}

// Initialize the application
const app = new LisaVoiceAgent();