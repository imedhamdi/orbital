// public/client.js - Version 3.0 (Ultimate)

document.addEventListener('DOMContentLoaded', () => {
    // 1. Sélection des éléments du DOM
    const loginView = document.getElementById('login-view');
    const chatView = document.getElementById('chat-view');
    const pseudoInput = document.getElementById('pseudo-input');
    const joinBtn = document.getElementById('join-btn');
    const errorBox = document.getElementById('error-box');
    
    // Éléments vidéo
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    const statusOverlay = document.getElementById('status-overlay');
    const statusText = document.getElementById('status-text');
    const videoPlaceholder = document.getElementById('video-placeholder');
    const dashboardView = document.getElementById('dashboard-view');
    const dashboardUserPseudo = document.getElementById('dashboard-user-pseudo');
    const dashboardPartnerInfo = document.getElementById('dashboard-partner-info');
    let connectionStatus = document.getElementById('connection-status');
    let connectionPing = document.getElementById('connection-ping');
    const userPseudoDisplay = document.getElementById('user-pseudo');
    
    // Contrôles vidéo
    const toggleVideoBtn = document.getElementById('toggle-video');
    const toggleAudioBtn = document.getElementById('toggle-audio');
    
    // Chat
    const chatMessages = document.getElementById('chat-messages');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const toggleChatBtn = document.getElementById('toggle-chat');
    const textChat = document.getElementById('text-chat');
    
    // Contrôles principaux
    const nextBtn = document.getElementById('next-btn');
    const reportBtn = document.getElementById('report-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    // Modal paramètres
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings');
    const saveSettingsBtn = document.getElementById('save-settings');
    const videoSelect = document.getElementById('video-input');
    const audioSelect = document.getElementById('audio-input');
    const audioOutputSelect = document.getElementById('audio-output');
    const mirrorToggle = document.getElementById('mirror-toggle');
    
    // 2. Variables globales
    let localStream;
    let peerConnection;
    let socket;
    let pingInterval;
    let lastPingTime;
    let currentPartnerId = null;
    let isVideoEnabled = true;
    let isAudioEnabled = true;
    let isChatExpanded = true;
    
    // 3. Initialisation de l'interface utilisateur
    const ui = {
        showError(message) {
            errorBox.textContent = message;
            errorBox.classList.add('show');
            setTimeout(() => {
                errorBox.classList.remove('show');
            }, 5000);
        },
        
        clearError() {
            errorBox.classList.remove('show');
        },
        
        showWaiting() {
            statusText.textContent = "Recherche d'un partenaire...";
            statusOverlay.classList.remove('hidden');
            videoPlaceholder.classList.add('hidden');
            remoteVideo.style.display = 'none';
            if (connectionStatus) {
                connectionStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Connexion en cours';
            }
            if (connectionPing) {
                connectionPing.textContent = '';
            }
        },
        
        showConnected(partnerData) {
            statusOverlay.classList.add('hidden');
            videoPlaceholder.classList.remove('hidden');
            
            const { pseudo, country } = partnerData;
            const tooltip = country.name ? `En direct de ${country.name}` : "D'origine inconnue";

            dashboardPartnerInfo.innerHTML = `
                <h4>Partenaire</h4>
                <p id="partner-pseudo-placeholder">${pseudo} <span class="country-badge" data-tooltip="${tooltip}">${country.emoji}</span></p>
                <div class="connection-info">
                    <span id="connection-status"><i class="fas fa-circle-check"></i> Connecté</span>
                    <span id="connection-ping"></span>
                </div>
            `;

            // Mettre à jour les références après insertion
            connectionStatus = document.getElementById('connection-status');
            connectionPing = document.getElementById('connection-ping');
            
            if (window.gsap) {
                gsap.from('.country-badge', { 
                    scale: 0, 
                    rotation: -15, 
                    duration: 0.7, 
                    ease: "elastic.out(1, 0.5)" 
                });
            }
            
            // Démarrer le ping
            startPing();
        },
        
        showVideo() {
            videoPlaceholder.classList.add('hidden');
            remoteVideo.style.display = 'block';
        },
        
        showPartnerLeft() {
            this.showWaiting();
            statusText.textContent = 'Partenaire déconnecté. Recherche en cours...';
            connectionStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Recherche en cours';
            connectionPing.textContent = '';
            dashboardPartnerInfo.innerHTML = '';
            stopPing();
            cleanupConnection();
        },
        
        updatePing(ping) {
            connectionPing.textContent = `${ping}ms`;
            
            // Couleur en fonction de la latence
            if (ping < 100) {
                connectionPing.style.color = 'var(--success-color)';
            } else if (ping < 200) {
                connectionPing.style.color = 'var(--warning-color)';
            } else {
                connectionPing.style.color = 'var(--error-color)';
            }
        },
        
        toggleChat() {
            isChatExpanded = !isChatExpanded;
            textChat.classList.toggle('collapsed');
            toggleChatBtn.innerHTML = isChatExpanded ? 
                '<i class="fas fa-chevron-up"></i>' : 
                '<i class="fas fa-chevron-down"></i>';
        },
        
        toggleVideo() {
            isVideoEnabled = !isVideoEnabled;
            localStream.getVideoTracks().forEach(track => {
                track.enabled = isVideoEnabled;
            });
            
            toggleVideoBtn.classList.toggle('active', !isVideoEnabled);
            toggleVideoBtn.innerHTML = isVideoEnabled ? 
                '<i class="fas fa-video"></i>' : 
                '<i class="fas fa-video-slash"></i>';
        },
        
        toggleAudio() {
            isAudioEnabled = !isAudioEnabled;
            localStream.getAudioTracks().forEach(track => {
                track.enabled = isAudioEnabled;
            });
            
            toggleAudioBtn.classList.toggle('active', !isAudioEnabled);
            toggleAudioBtn.innerHTML = isAudioEnabled ? 
                '<i class="fas fa-microphone"></i>' : 
                '<i class="fas fa-microphone-slash"></i>';
        },
        
        showSettingsModal() {
            settingsModal.classList.add('show');
            document.body.style.overflow = 'hidden';
        },
        
        hideSettingsModal() {
            settingsModal.classList.remove('show');
            document.body.style.overflow = '';
        },
        
        updateDeviceLists(devices) {
            videoSelect.innerHTML = '';
            audioSelect.innerHTML = '';
            audioOutputSelect.innerHTML = '';
            
            // Caméras
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            videoDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Caméra ${videoSelect.length + 1}`;
                videoSelect.appendChild(option);
            });
            
            // Microphones
            const audioDevices = devices.filter(d => d.kind === 'audioinput');
            audioDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microphone ${audioSelect.length + 1}`;
                audioSelect.appendChild(option);
            });
            
            // Haut-parleurs
            const outputDevices = devices.filter(d => d.kind === 'audiooutput');
            outputDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Haut-parleur ${audioOutputSelect.length + 1}`;
                audioOutputSelect.appendChild(option);
            });
        }
    };
    
    // 4. Gestion du chat
    const chatUI = {
        init() {
            chatForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.sendMessage();
            });
            
            socket.on('chat:text', (message) => {
                this.appendMessage(message);
            });
            
            toggleChatBtn.addEventListener('click', () => {
                ui.toggleChat();
            });
        },
        
        sendMessage() {
            const text = chatInput.value.trim();
            if (!text) return;
            
            const message = {
                text,
                sender: socket.id,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            
            socket.emit('chat:text', message);
            this.appendMessage({ ...message, isLocal: true });
            chatInput.value = '';
        },
        
        appendMessage({ text, sender, timestamp, isLocal = false }) {
            const div = document.createElement('div');
            div.className = 'chat-message';
            div.classList.add(isLocal || sender === socket.id ? 'sent' : 'received');
            
            div.innerHTML = `
                <div class="message-content">${text}</div>
                <span class="timestamp">${timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            `;
            
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            // Animation pour les nouveaux messages
            if (window.gsap) {
                gsap.from(div, {
                    opacity: 0,
                    y: 10,
                    duration: 0.3,
                    ease: "power1.out"
                });
            }
        },
        
        clearMessages() {
            chatMessages.innerHTML = '';
        }
    };
    
    // 5. Configuration WebRTC
    const rtcConfig = {
        iceServers: [
            // TODO: Les identifiants du serveur TURN doivent être récupérés
            // de manière dynamique et sécurisée depuis le serveur.
            { urls: 'turn:your-turn-server.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
    };
    
    // 6. Fonctions utilitaires
    function startPing() {
        stopPing();
        lastPingTime = Date.now();
        
        pingInterval = setInterval(() => {
            lastPingTime = Date.now();
            socket.emit('ping');
        }, 5000);
    }
    
    function stopPing() {
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
    }
    
    function cleanupConnection() {
        if (peerConnection) {
            peerConnection.onicecandidate = null;
            peerConnection.ontrack = null;
            peerConnection.close();
            peerConnection = null;
        }
        
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
        
        remoteVideo.style.display = 'none';
        videoPlaceholder.classList.remove('hidden');
        dashboardPartnerInfo.innerHTML = '';
        currentPartnerId = null;
        
        chatUI.clearMessages();
    }
    
    async function getMediaDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            ui.updateDeviceLists(devices);
            return devices;
        } catch (error) {
            console.error('Error enumerating devices:', error);
            return [];
        }
    }
    
    async function updateLocalStream(constraints) {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        try {
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            localVideo.srcObject = localStream;
            
            // Mettre à jour les contrôles
            isVideoEnabled = true;
            isAudioEnabled = true;
            toggleVideoBtn.classList.remove('active');
            toggleAudioBtn.classList.remove('active');
            
            // Si déjà connecté, recréer la connexion
            if (peerConnection) {
                createPeerConnection();
                if (currentPartnerId) {
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    socket.emit('webrtc:offer', { sdp: peerConnection.localDescription });
                }
            }
            
            return true;
        } catch (error) {
            console.error('Error updating media:', error);
            ui.showError('Erreur lors de l\'accès aux périphériques');
            return false;
        }
    }
    
    // 7. Gestion des connexions

    async function startJoin(pseudo) {
        localStorage.setItem('orbital-pseudo', pseudo);

        if (!pseudo) {
            ui.showError('Veuillez entrer un pseudo.');
            return;
        }

        ui.clearError();
        joinBtn.disabled = true;
        joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion...';

        try {
            // Obtenir les permissions média
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            localVideo.srcObject = localStream;
            userPseudoDisplay.textContent = pseudo;

            // Initialiser la liste des périphériques
            await getMediaDevices();

            // Basculer vers la vue chat
            loginView.classList.add('hidden');
            chatView.classList.remove('hidden');
            dashboardView.classList.remove('hidden');
            dashboardUserPseudo.textContent = pseudo;

            // Initialiser la connexion Socket.IO
            initializeSocket();

            // Envoyer la demande de connexion
            socket.emit('user:join', { pseudo });
            ui.showWaiting();

        } catch (error) {
            console.error('Failed to get media devices:', error);

            let errorMessage = 'Impossible d\'accéder à la caméra/microphone.';
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Permission refusée. Veuillez autoriser l\'accès à la caméra et au microphone.';
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'Aucun périphérique média trouvé.';
            }

            ui.showError(errorMessage);
            joinBtn.disabled = false;
            joinBtn.innerHTML = '<i class="fas fa-rocket"></i> Démarrer';
        }
    }

    joinBtn.addEventListener('click', async () => {
        await startJoin(pseudoInput.value.trim());
    });
    
    function initializeSocket() {
        socket = io({
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            timeout: 20000
        });
        
        // Initialiser l'UI du chat
        chatUI.init();
        
        // Gestion des erreurs
        socket.on('connect_error', (err) => {
            console.error("Connection failed:", err.message);
            ui.showError("Impossible de se connecter au serveur. Reconnexion en cours...");
        });
        
        socket.on('disconnect', (reason) => {
            if (reason === 'io server disconnect') {
                ui.showError("Déconnecté par le serveur. Reconnexion...");
                socket.connect();
            }
        });
        
        socket.on('reconnect_failed', () => {
            ui.showError("Échec de la reconnexion. Veuillez rafraîchir la page.");
        });
        
        // Ping/pong pour mesurer la latence
        socket.on('pong', () => {
            const ping = Date.now() - lastPingTime;
            ui.updatePing(ping);
        });
        
        // Gestion des états
        socket.on('app:state-update', handleStateUpdate);
        socket.on('app:partner-left', ui.showPartnerLeft.bind(ui));
        socket.on('app:banned', () => {
            ui.showError("Vous avez été temporairement banni pour comportement inapproprié.");
            cleanupConnection();
        });
        
        // Signalisation WebRTC
        socket.on('webrtc:offer', handleOffer);
        socket.on('webrtc:answer', handleAnswer);
        socket.on('webrtc:ice-candidate', handleIceCandidate);
    }
    
    async function handleStateUpdate({ state, partner, initiator }) {
        console.log(`[State Update] state: ${state}, initiator: ${initiator}`);
        
        if (state === 'waiting') {
            ui.showWaiting();
            currentPartnerId = null;
        } 
        else if (state === 'connected') {
            currentPartnerId = partner.socketId;
            ui.showConnected(partner);
            
            // Créer la connexion WebRTC
            createPeerConnection();
            
            // Si initiateur, créer une offre
            if (initiator) {
                try {
                    const offer = await peerConnection.createOffer({
                        offerToReceiveAudio: true,
                        offerToReceiveVideo: true
                    });
                    
                    await peerConnection.setLocalDescription(offer);
                    socket.emit('webrtc:offer', { 
                        sdp: peerConnection.localDescription,
                        to: currentPartnerId
                    });
                } catch (error) {
                    console.error("Error creating offer:", error);
                    ui.showError("Erreur lors de l'établissement de la connexion");
                }
            }
        }
    }
    
    // 8. Fonctions WebRTC
    function createPeerConnection() {
        cleanupConnection();
        
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        // Gestion des candidats ICE
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && currentPartnerId) {
                socket.emit('webrtc:ice-candidate', {
                    candidate: event.candidate,
                    to: currentPartnerId
                });
            }
        };
        
        // Quand une piste distante est reçue
        peerConnection.ontrack = (event) => {
            console.log('Remote track received');
            if (event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                ui.showVideo();
            }
        };
        
        // Gestion des changements d'état de la connexion
        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', peerConnection.iceConnectionState);
            
            if (peerConnection.iceConnectionState === 'disconnected' ||
                peerConnection.iceConnectionState === 'failed') {
                ui.showPartnerLeft();
            }
        };
        
        // Ajouter les pistes locales
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }
    }
    
    async function handleOffer({ sdp, from }) {
        if (!peerConnection) createPeerConnection();
        
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('webrtc:answer', {
                sdp: peerConnection.localDescription,
                to: from
            });
        } catch (error) {
            console.error("Error handling offer:", error);
            ui.showError("Erreur lors de l'établissement de la connexion");
        }
    }
    
    async function handleAnswer({ sdp }) {
        try {
            if (peerConnection && !peerConnection.currentRemoteDescription) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            }
        } catch (error) {
            console.error("Error handling answer:", error);
        }
    }
    
    async function handleIceCandidate({ candidate, from }) {
        try {
            if (peerConnection && candidate && from === currentPartnerId) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error("Error adding ICE candidate:", error);
        }
    }
    
    // 9. Gestion des contrôles
    nextBtn.addEventListener('click', () => {
        if (currentPartnerId) {
            socket.emit('user:request-next');
            cleanupConnection();
            ui.showWaiting();
        }
    });
    
    reportBtn.addEventListener('click', () => {
        if (confirm('Voulez-vous signaler cet utilisateur pour comportement inapproprié ?')) {
            socket.emit('user:report');
            nextBtn.click();
        }
    });
    
    toggleVideoBtn.addEventListener('click', () => {
        ui.toggleVideo();
    });
    
    toggleAudioBtn.addEventListener('click', () => {
        ui.toggleAudio();
    });
    
    settingsBtn.addEventListener('click', () => {
        ui.showSettingsModal();
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('orbital-pseudo');
        if (socket) {
            socket.disconnect();
        }
        window.location.reload();
    });
    
    closeSettingsBtn.addEventListener('click', () => {
        ui.hideSettingsModal();
    });
    
    saveSettingsBtn.addEventListener('click', async () => {
        const constraints = {
            video: {
                deviceId: videoSelect.value ? { exact: videoSelect.value } : undefined,
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            },
            audio: {
                deviceId: audioSelect.value ? { exact: audioSelect.value } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
        
        const success = await updateLocalStream(constraints);
        
        if (success) {
            // Appliquer la sortie audio si prise en charge
            if (audioOutputSelect.value && 'setSinkId' in remoteVideo) {
                remoteVideo.setSinkId(audioOutputSelect.value)
                    .catch(err => console.error('Error setting audio output:', err));
            }
            
            // Appliquer l'effet miroir
            localVideo.style.transform = mirrorToggle.checked ? 'scaleX(-1)' : 'scaleX(1)';
            
            ui.hideSettingsModal();
        }
    });
    
    mirrorToggle.addEventListener('change', () => {
        localVideo.style.transform = mirrorToggle.checked ? 'scaleX(-1)' : 'scaleX(1)';
    });

    function attemptAutoLogin() {
        const savedPseudo = localStorage.getItem('orbital-pseudo');
        if (savedPseudo) {
            pseudoInput.value = savedPseudo;
            startJoin(savedPseudo);
        }
    }
    
    // 10. Nettoyage avant de quitter
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.emit('user:leave');
            socket.disconnect();
        }
        
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        stopPing();
        cleanupConnection();
    });

    // 11. Détection des changements de périphériques
    navigator.mediaDevices.addEventListener('devicechange', getMediaDevices);

    attemptAutoLogin();
});