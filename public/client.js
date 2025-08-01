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
    const audioCanvas = document.getElementById('audio-visualizer');
    const icebreakerText = document.getElementById('icebreaker-text');
    const videoPlaceholder = document.getElementById('video-placeholder');
    const partnerPseudoPlaceholder = document.getElementById('partner-pseudo-placeholder');
    
    const nextBtn = document.getElementById('next-btn');
    const reportBtn = document.getElementById('report-btn');
    const muteBtn = document.getElementById('mute-btn');
    const videoBtn = document.getElementById('video-btn');
    const mainControls = document.querySelector('.main-controls');
    const videosContainer = document.querySelector('.videos-container');
    const modalContainer = document.getElementById('modal-container');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    // 2. Variables globales
    let localStream;
    let peerConnection;
    let socket;
    let icebreakerInterval;
    let audioCtx;
    let analyser;
    let dataArray;
    let controlsTimeout;

    const icebreakers = [
        "Quel est ton super pouvoir secret ?",
        "Si tu pouvais voyager dans le temps, où irais-tu ?",
        "Quelle musique écoutes-tu en boucle ?",
        "Ton plat préféré de tous les temps ?",
        "Quel serait ton animal totem ?"
    ];

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
        showConnected(partnerPseudo, countryCode) {
            statusOverlay.classList.add('hidden');
            videoPlaceholder.classList.remove('hidden');
            const flag = countryCode ? countryCode.replace(/./g, c => String.fromCodePoint(c.charCodeAt(0) + 127397)) : '';
            partnerPseudoPlaceholder.textContent = `Connexion avec ${partnerPseudo} ${flag}...`;
        },
        showVideo() {
            videoPlaceholder.classList.add('hidden');
            remoteVideo.style.display = 'block';
        },
        showPartnerLeft() {
            playSound('disconnect');
            cleanupConnection();
            this.showWaiting();
            statusText.textContent = 'Partenaire déconnecté. Recherche en cours...';
        }
    };

    function playSound(type) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.1;
        if (type === 'connect') {
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(1760, ctx.currentTime + 0.15);
        } else {
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.15);
        }
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
        osc.onended = () => ctx.close();
    }

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
            setupAudioVisualizer();

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
            if (!icebreakerInterval) {
                icebreakerInterval = setInterval(() => {
                    const msg = icebreakers[Math.floor(Math.random() * icebreakers.length)];
                    icebreakerText.textContent = msg;
                }, 4000);
            }
        } else if (state === 'connected') {
            playSound('connect');
            clearInterval(icebreakerInterval);
            icebreakerInterval = null;
            icebreakerText.textContent = '';
            ui.showConnected(partner.pseudo, partner.country);
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

    function setupAudioVisualizer() {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(localStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        source.connect(analyser);
        drawVisualizer();
    }

    function drawVisualizer() {
        if (!analyser) return;
        requestAnimationFrame(drawVisualizer);
        analyser.getByteFrequencyData(dataArray);
        const canvasCtx = audioCanvas.getContext('2d');
        const { width, height } = audioCanvas;
        canvasCtx.clearRect(0, 0, width, height);
        const barWidth = width / dataArray.length;
        let sum = 0;
        dataArray.forEach((v, i) => {
            const barHeight = (v / 255) * height;
            canvasCtx.fillStyle = '#bb86fc';
            canvasCtx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
            sum += v;
        });
        const avg = sum / dataArray.length;
        if (avg > 80) {
            document.getElementById('local-video-wrapper').classList.add('speaking');
        } else {
            document.getElementById('local-video-wrapper').classList.remove('speaking');
        }
    }

    function cleanupConnection() {
        if (peerConnection) {
            peerConnection.onicecandidate = null;
            peerConnection.ontrack = null;
            peerConnection.close();
            peerConnection = null;
        }
        if (audioCtx) {
            audioCtx.close();
            audioCtx = null;
        }
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
        videoPlaceholder.classList.remove('hidden');
        partnerPseudoPlaceholder.textContent = '';
        document.getElementById('local-video-wrapper').classList.remove('speaking');
    }

    // 8. Contrôles
    nextBtn.addEventListener('click', () => {
        socket.emit('user:request-next');
        cleanupConnection();
        ui.showWaiting();
        playSound('disconnect');
    });

    muteBtn.addEventListener('click', () => {
        const track = localStream.getAudioTracks()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        muteBtn.classList.toggle('off', !track.enabled);
    });

    videoBtn.addEventListener('click', () => {
        const track = localStream.getVideoTracks()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        videoBtn.classList.toggle('off', !track.enabled);
    });

    reportBtn.addEventListener('click', () => {
        modalContainer.classList.remove('hidden');
    });

    modalCancelBtn.addEventListener('click', () => {
        modalContainer.classList.add('hidden');
    });

    modalConfirmBtn.addEventListener('click', () => {
        socket.emit('user:report');
        modalContainer.classList.add('hidden');
        nextBtn.click();
    });

    videosContainer.addEventListener('mousemove', () => {
        mainControls.style.opacity = '1';
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(() => {
            mainControls.style.opacity = '0';
        }, 3000);
    });

    // Nettoyage avant de quitter la page
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.disconnect();
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        if (audioCtx) {
            audioCtx.close();
        }
    });
});
