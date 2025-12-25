/**
 * WebRTC Video Call Application
 * This file handles the client-side WebRTC logic including:
 * - Signaling via Socket.io
 * - Media stream management
 * - ICE candidate exchange
 * - UI controls
 */

// Socket.io connection
const socket = io();

// DOM Elements
const joinModal = document.getElementById('joinModal');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const errorMessage = document.getElementById('errorMessage');
const roomIdDisplay = document.getElementById('roomId');
const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const remoteMutedIndicator = document.getElementById('remoteMutedIndicator');

const toggleAudioBtn = document.getElementById('toggleAudio');
const toggleVideoBtn = document.getElementById('toggleVideo');
const hangUpBtn = document.getElementById('hangUp');
const toggleChatBtn = document.getElementById('toggleChat');

const chatSection = document.getElementById('chatSection');
const closeChat = document.getElementById('closeChat');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendMessage = document.getElementById('sendMessage');

const cameraSelect = document.getElementById('cameraSelect');
const micSelect = document.getElementById('micSelect');

// WebRTC Configuration
/**
 * ICE Servers Configuration
 * - STUN servers help discover your public IP address (NAT traversal)
 * - Google provides free public STUN servers
 * - For production, consider adding TURN servers for better connectivity
 */
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// State variables
let peerConnection = null;
let localStream = null;
let remotePeerId = null;
let currentRoomId = null;
let isAudioEnabled = true;
let isVideoEnabled = true;

/**
 * Initialize the application
 */
function init() {
  // Show join modal on load
  joinModal.style.display = 'flex';

  // Event listeners
  joinBtn.addEventListener('click', joinRoom);
  roomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoom();
  });

  toggleAudioBtn.addEventListener('click', toggleAudio);
  toggleVideoBtn.addEventListener('click', toggleVideo);
  hangUpBtn.addEventListener('click', hangUp);
  toggleChatBtn.addEventListener('click', () => {
    chatSection.classList.toggle('active');
  });
  closeChat.addEventListener('click', () => {
    chatSection.classList.remove('active');
  });

  sendMessage.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  cameraSelect.addEventListener('change', switchCamera);
  micSelect.addEventListener('change', switchMicrophone);

  // Populate device lists
  getDevices();
}

/**
 * Get available media devices and populate select dropdowns
 */
async function getDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    const audioDevices = devices.filter(device => device.kind === 'audioinput');

    // Populate camera select
    cameraSelect.innerHTML = '<option value="">Select Camera</option>';
    videoDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    // Populate microphone select
    micSelect.innerHTML = '<option value="">Select Microphone</option>';
    audioDevices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.text = device.label || `Microphone ${index + 1}`;
      micSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error enumerating devices:', error);
  }
}

/**
 * Join a room
 */
async function joinRoom() {
  const roomId = roomInput.value.trim();
  
  if (!roomId) {
    showError('Please enter a room name');
    return;
  }

  currentRoomId = roomId;
  roomIdDisplay.textContent = `Room: ${roomId}`;

  try {
    // Get local media stream
    await getLocalStream();
    
    // Join the room via Socket.io
    socket.emit('join-room', roomId);
    
    // Hide modal
    joinModal.style.display = 'none';
    
    updateStatus('Waiting for another user to join...', 'waiting');
  } catch (error) {
    console.error('Error joining room:', error);
    showError('Could not access camera/microphone. Please check permissions.');
  }
}

/**
 * Get local media stream (camera and microphone)
 */
async function getLocalStream(videoDeviceId = null, audioDeviceId = null) {
  try {
    const constraints = {
      video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;

    // Update device lists with labels now that we have permission
    await getDevices();

    return localStream;
  } catch (error) {
    console.error('Error accessing media devices:', error);
    throw error;
  }
}

/**
 * Switch camera device
 */
async function switchCamera() {
  const deviceId = cameraSelect.value;
  if (!deviceId || !localStream) return;

  try {
    // Stop current video track
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.stop();
      localStream.removeTrack(videoTrack);
    }

    // Get new video stream
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } }
    });

    const newVideoTrack = newStream.getVideoTracks()[0];
    localStream.addTrack(newVideoTrack);
    localVideo.srcObject = localStream;

    // Replace track in peer connection if exists
    if (peerConnection) {
      const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        sender.replaceTrack(newVideoTrack);
      }
    }
  } catch (error) {
    console.error('Error switching camera:', error);
  }
}

/**
 * Switch microphone device
 */
async function switchMicrophone() {
  const deviceId = micSelect.value;
  if (!deviceId || !localStream) return;

  try {
    // Stop current audio track
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.stop();
      localStream.removeTrack(audioTrack);
    }

    // Get new audio stream
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } }
    });

    const newAudioTrack = newStream.getAudioTracks()[0];
    localStream.addTrack(newAudioTrack);

    // Replace track in peer connection if exists
    if (peerConnection) {
      const sender = peerConnection.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) {
        sender.replaceTrack(newAudioTrack);
      }
    }
  } catch (error) {
    console.error('Error switching microphone:', error);
  }
}

/**
 * Create RTCPeerConnection
 * This is the core WebRTC object that manages the peer-to-peer connection
 */
function createPeerConnection(peerId) {
  peerConnection = new RTCPeerConnection(configuration);
  remotePeerId = peerId;

  /**
   * ICE Candidate Event Handler
   * When the browser finds a potential network path (ICE candidate),
   * send it to the remote peer via the signaling server
   * 
   * Why this matters:
   * - WebRTC tries multiple connection methods (direct, via STUN, via TURN)
   * - Each method generates a candidate with IP:port information
   * - Both peers need to exchange ALL candidates to find the best path
   * - This event fires multiple times as new candidates are discovered
   */
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate:', event.candidate);
      socket.emit('ice-candidate', {
        candidate: event.candidate,
        to: peerId
      });
    } else {
      console.log('All ICE candidates have been sent');
    }
  };

  /**
   * Track Event Handler
   * When the remote peer adds a track (audio or video), this event fires
   */
  peerConnection.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind);
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      updateStatus('Connected', 'connected');
    }
  };

  /**
   * ICE Connection State Change Handler
   * Monitor the connection status for debugging
   */
  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
    
    if (peerConnection.iceConnectionState === 'failed') {
      console.error('ICE connection failed - may need TURN servers');
      updateStatus('Connection failed - network issue', 'error');
    } else if (peerConnection.iceConnectionState === 'disconnected') {
      updateStatus('Connection lost', 'error');
    }
  };

  // Add local stream tracks to peer connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  return peerConnection;
}

/**
 * Create and send WebRTC offer
 * The offer contains the caller's media capabilities and connection preferences
 */
async function createOffer(peerId) {
  try {
    createPeerConnection(peerId);
    
    // Create SDP offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    console.log('Sending offer to:', peerId);
    socket.emit('offer', {
      offer: offer,
      to: peerId
    });
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

/**
 * Handle incoming WebRTC offer
 */
async function handleOffer(offer, peerId) {
  try {
    createPeerConnection(peerId);
    
    // Set remote description from offer
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    // Create answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    console.log('Sending answer to:', peerId);
    socket.emit('answer', {
      answer: answer,
      to: peerId
    });
  } catch (error) {
    console.error('Error handling offer:', error);
  }
}

/**
 * Handle incoming WebRTC answer
 */
async function handleAnswer(answer, peerId) {
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('Answer set successfully');
  } catch (error) {
    console.error('Error handling answer:', error);
  }
}

/**
 * Handle incoming ICE candidate
 * Add the remote peer's network path information to our connection
 */
async function handleIceCandidate(candidate) {
  try {
    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('ICE candidate added successfully');
    }
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
}

/**
 * Toggle audio (mute/unmute)
 */
function toggleAudio() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isAudioEnabled = !isAudioEnabled;
      audioTrack.enabled = isAudioEnabled;
      
      toggleAudioBtn.classList.toggle('active', isAudioEnabled);
      toggleAudioBtn.querySelector('.icon').textContent = isAudioEnabled ? '🎤' : '🔇';
      toggleAudioBtn.querySelector('.label').textContent = isAudioEnabled ? 'Mute' : 'Unmute';
      
      // Notify peer
      socket.emit('media-state', {
        audio: isAudioEnabled,
        video: isVideoEnabled
      });
    }
  }
}

/**
 * Toggle video (show/hide)
 */
function toggleVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      isVideoEnabled = !isVideoEnabled;
      videoTrack.enabled = isVideoEnabled;
      
      toggleVideoBtn.classList.toggle('active', isVideoEnabled);
      toggleVideoBtn.querySelector('.icon').textContent = isVideoEnabled ? '📹' : '🚫';
      toggleVideoBtn.querySelector('.label').textContent = isVideoEnabled ? 'Stop Video' : 'Start Video';
      
      // Notify peer
      socket.emit('media-state', {
        audio: isAudioEnabled,
        video: isVideoEnabled
      });
    }
  }
}

/**
 * Hang up the call
 */
function hangUp() {
  socket.emit('hang-up');
  cleanupCall();
  
  // Show join modal again
  joinModal.style.display = 'flex';
  roomInput.value = '';
  updateStatus('Call ended', 'error');
}

/**
 * Cleanup call resources
 */
function cleanupCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remotePeerId = null;
}

/**
 * Send chat message
 */
function sendChatMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  // Display locally
  addChatMessage(message, 'sent');
  
  // Send to peer
  socket.emit('chat-message', { message });
  
  chatInput.value = '';
}

/**
 * Add message to chat
 */
function addChatMessage(message, type) {
  const messageEl = document.createElement('div');
  messageEl.classList.add('chat-message', type);
  
  const textEl = document.createElement('div');
  textEl.textContent = message;
  
  const timeEl = document.createElement('div');
  timeEl.classList.add('timestamp');
  timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  messageEl.appendChild(textEl);
  messageEl.appendChild(timeEl);
  chatMessages.appendChild(messageEl);
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Update status banner
 */
function updateStatus(text, className) {
  statusText.textContent = text;
  statusBanner.className = `status-banner ${className}`;
}

/**
 * Show error message
 */
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
  setTimeout(() => {
    errorMessage.classList.remove('show');
  }, 5000);
}

// Socket.io event handlers
socket.on('waiting', () => {
  updateStatus('Waiting for another user to join...', 'waiting');
});

socket.on('ready', (peerId) => {
  console.log('Room is ready, creating offer for peer:', peerId);
  updateStatus('Connecting...', 'waiting');
  createOffer(peerId);
});

socket.on('room-full', () => {
  showError('Room is full. Please try another room.');
  joinModal.style.display = 'flex';
});

socket.on('offer', async ({ offer, from }) => {
  console.log('Received offer from:', from);
  await handleOffer(offer, from);
});

socket.on('answer', async ({ answer, from }) => {
  console.log('Received answer from:', from);
  await handleAnswer(answer, from);
});

socket.on('ice-candidate', async ({ candidate, from }) => {
  console.log('Received ICE candidate from:', from);
  await handleIceCandidate(candidate);
});

socket.on('chat-message', ({ message, from, timestamp }) => {
  addChatMessage(message, 'received');
});

socket.on('peer-media-state', ({ audio, video, from }) => {
  console.log('Peer media state:', { audio, video });
  remoteMutedIndicator.style.display = audio ? 'none' : 'block';
});

socket.on('peer-left', () => {
  updateStatus('Peer left the call', 'error');
  cleanupCall();
  joinModal.style.display = 'flex';
});

socket.on('peer-hung-up', () => {
  updateStatus('Peer ended the call', 'error');
  cleanupCall();
  joinModal.style.display = 'flex';
});

// Initialize the app when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}