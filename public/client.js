// public/client.js - Version 2.0

document.addEventListener('DOMContentLoaded', () => {
    // 1. Sélection des éléments du DOM
    const loginView = document.getElementById('login-view');
    const chatView = document.getElementById('chat-view');
    const pseudoInput = document.getElementById('pseudo-input');
    const joinBtn = document.getElementById('join-btn');
    const errorBox = document.getElementById('error-box');
    
    const localVideo = document.getElementById('local-video');
    const remoteVideo = document.getElementById('remote-video');
    const statusOverlay = document.getElementById('status-overlay');
    const statusText = document.getElementById('status-text');
    const videoPlaceholder = document.getElementById('video-placeholder');
    const partnerPseudoPlaceholder = document.getElementById('partner-pseudo-placeholder');

    const chatMessages = document.getElementById('chat-messages');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    
    const nextBtn = document.getElementById('next-btn');
    const reportBtn = document.getElementById('report-btn');

    // 2. Variables globales
    let localStream;
    let peerConnection;
    let socket;

    const chatUI = {
        init() {
            chatForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const text = chatInput.value.trim();
                if (!text) return;
                socket.emit('chat:text', { text });
                this.appendMessage({ text, sender: socket.id });
                chatInput.value = '';
            });
            socket.on('chat:text', this.appendMessage.bind(this));
        },
        appendMessage({ text, sender }) {
            const div = document.createElement('div');
            div.className = 'chat-message';
            div.classList.add(sender === socket.id ? 'sent' : 'received');
            div.textContent = text;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    };

    // 3. Configuration WebRTC
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            // En production, ajouter un serveur TURN est crucial
            // { urls: 'turn:your.turn.server', username: 'user', credential: 'password' }
        ]
    };

    // 4. Logique de l'interface utilisateur

    const ui = {
        showError(message) {
            errorBox.textContent = message;
            errorBox.classList.remove('hidden');
        },
        clearError() {
            errorBox.classList.add('hidden');
        },
        showWaiting() {
            statusText.textContent = "Recherche d'un partenaire...";
            statusOverlay.classList.remove('hidden');
            videoPlaceholder.classList.add('hidden');
            remoteVideo.style.display = 'none';
        },
        showConnected(partnerData) {
            statusOverlay.classList.add('hidden');
            videoPlaceholder.classList.remove('hidden');
            const { pseudo, country } = partnerData;
            const tooltip = `En direct ${country.name ? `de ${country.name}` : "d'un lieu secret"}`;
            partnerPseudoPlaceholder.innerHTML = `
                <span class="partner-name">${pseudo}</span>
                <span class="country-badge" data-tooltip="${tooltip}">${country.emoji}</span>
            `;
            if (window.gsap) {
                gsap.from('.country-badge', { scale: 0, rotation: -15, duration: 0.7, ease: "elastic.out(1, 0.5)" });
            }
        },
        showVideo() {
            videoPlaceholder.classList.add('hidden');
            remoteVideo.style.display = 'block';
        },
        showPartnerLeft() {
            cleanupConnection();
            this.showWaiting();
            statusText.textContent = 'Partenaire déconnecté. Recherche en cours...';
        }
    };

    // 5. Logique de connexion
    joinBtn.addEventListener('click', async () => {
        const pseudo = pseudoInput.value.trim();
        if (!pseudo) {
            ui.showError('Veuillez entrer un pseudo.');
            return;
        }
        ui.clearError();
        joinBtn.disabled = true;
        joinBtn.textContent = 'Connexion...';

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;

            loginView.classList.add('hidden');
            chatView.classList.remove('hidden');

            initializeSocket();
            socket.emit('user:join', { pseudo });
            ui.showWaiting();

        } catch (error) {
            console.error('Failed to get media devices:', error);
            ui.showError('Impossible d\'accéder à la caméra/micro. Vérifiez les autorisations.');
            joinBtn.disabled = false;
            joinBtn.textContent = '🚀 Lancer la connexion';
        }
    });
    
    // 6. Initialisation et gestion Socket.IO
    function initializeSocket() {
        socket = io();
        chatUI.init();

        socket.on('connect_error', (err) => {
            console.error("Connection failed:", err.message);
            ui.showError("Impossible de se connecter au serveur.");
        });

        socket.on('app:state-update', handleStateUpdate);
        socket.on('app:partner-left', ui.showPartnerLeft.bind(ui));
        
        // Signalisation WebRTC
        socket.on('webrtc:offer', handleOffer);
        socket.on('webrtc:answer', handleAnswer);
        socket.on('webrtc:ice-candidate', handleIceCandidate);
    }

    async function handleStateUpdate({ state, partner, initiator }) {
        console.log(`[State Update] state: ${state}, initiator: ${initiator}`);
        if (state === 'waiting') {
            ui.showWaiting();
        } else if (state === 'connected') {
            ui.showConnected(partner);
            createPeerConnection();
            if (initiator) {
                try {
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    socket.emit('webrtc:offer', { sdp: peerConnection.localDescription });
                } catch(e) { console.error("Error creating offer:", e); }
            }
        }
    }

    // 7. Fonctions WebRTC

    function createPeerConnection() {
        cleanupConnection();
        peerConnection = new RTCPeerConnection(rtcConfig);

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc:ice-candidate', { candidate: event.candidate });
            }
        };

        peerConnection.ontrack = (event) => {
            console.log('Remote track received');
            if (event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                ui.showVideo();
            }
        };
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    async function handleOffer({ sdp }) {
        if (!peerConnection) createPeerConnection();
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('webrtc:answer', { sdp: peerConnection.localDescription });
        } catch(e) { console.error("Error handling offer:", e); }
    }

    async function handleAnswer({ sdp }) {
        try {
            if (peerConnection && !peerConnection.currentRemoteDescription) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            }
        } catch(e) { console.error("Error handling answer:", e); }
    }

    async function handleIceCandidate({ candidate }) {
        try {
            if (peerConnection && candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch(e) { console.error("Error adding ICE candidate:", e); }
    }

    function cleanupConnection() {
        if (peerConnection) {
            peerConnection.onicecandidate = null;
            peerConnection.ontrack = null;
            peerConnection.close();
            peerConnection = null;
        }
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
        videoPlaceholder.classList.remove('hidden');
        partnerPseudoPlaceholder.textContent = '';
    }

    // 8. Contrôles
    nextBtn.addEventListener('click', () => {
        chatView.classList.add('view-transition');
        socket.emit('user:request-next');
        cleanupConnection();
        ui.showWaiting();
    });

    reportBtn.addEventListener('click', () => {
        if (confirm('Voulez-vous vraiment signaler ce partenaire pour comportement inapproprié ?')) {
            socket.emit('user:report');
            nextBtn.click(); // Passe automatiquement au suivant
        }
    });

    // Nettoyage avant de quitter la page
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.disconnect();
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
    });
});
