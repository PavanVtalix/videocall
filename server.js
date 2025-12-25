const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Store room information: roomId -> [socket1, socket2]
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle user joining a room
  socket.on('join-room', (roomId) => {
    console.log(`User ${socket.id} attempting to join room: ${roomId}`);

    // Check if room exists and how many users are in it
    if (!rooms.has(roomId)) {
      rooms.set(roomId, []);
    }

    const room = rooms.get(roomId);

    // Only allow 2 users per room (one-on-one)
    if (room.length >= 2) {
      socket.emit('room-full');
      console.log(`Room ${roomId} is full`);
      return;
    }

    // Add user to room
    room.push(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;

    console.log(`User ${socket.id} joined room ${roomId}. Room size: ${room.length}`);

    // If this is the second user, notify them to start the call
    if (room.length === 2) {
      // Tell the new user (caller) to create an offer
      socket.emit('ready', room[0]); // Send the other peer's ID
      console.log(`Room ${roomId} is ready for WebRTC connection`);
    } else {
      socket.emit('waiting');
    }
  });

  /**
   * WebRTC Signaling Events
   * These events handle the exchange of SDP (Session Description Protocol) 
   * and ICE (Interactive Connectivity Establishment) candidates
   */

  // Handle WebRTC offer
  // The 'offer' contains the caller's media capabilities and connection info
  socket.on('offer', (data) => {
    console.log(`Offer from ${socket.id} to ${data.to}`);
    // Forward the offer to the specific peer
    io.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  // Handle WebRTC answer
  // The 'answer' is the recipient's response containing their media capabilities
  socket.on('answer', (data) => {
    console.log(`Answer from ${socket.id} to ${data.to}`);
    // Forward the answer to the specific peer
    io.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  /**
   * ICE Candidate Exchange
   * ICE candidates are potential network paths (IP addresses and ports) 
   * that WebRTC can use to establish a peer-to-peer connection.
   * 
   * The process:
   * 1. Each peer gathers its own ICE candidates (local, reflexive, relay)
   * 2. Candidates are sent to the remote peer via the signaling server
   * 3. Each peer adds the remote candidates to try establishing connection
   * 4. WebRTC tests all candidate pairs and selects the best path
   * 
   * Types of ICE candidates:
   * - host: Local network addresses
   * - srflx: Server reflexive (your public IP via STUN server)
   * - relay: Relayed through TURN server (fallback for restrictive networks)
   */
  socket.on('ice-candidate', (data) => {
    console.log(`ICE candidate from ${socket.id} to ${data.to}`);
    // Forward the ICE candidate to the specific peer
    io.to(data.to).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // Handle chat messages
  socket.on('chat-message', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      // Broadcast message to all users in the room except sender
      socket.to(roomId).emit('chat-message', {
        message: data.message,
        from: socket.id,
        timestamp: Date.now()
      });
    }
  });

  // Handle media control signals (mute/unmute, video on/off)
  socket.on('media-state', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('peer-media-state', {
        audio: data.audio,
        video: data.video,
        from: socket.id
      });
    }
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const index = room.indexOf(socket.id);
      
      if (index !== -1) {
        room.splice(index, 1);
        
        // Notify the other user that peer left
        socket.to(roomId).emit('peer-left');
        
        // Clean up empty rooms
        if (room.length === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted`);
        }
      }
    }
  });

  // Handle explicit hang-up
  socket.on('hang-up', () => {
    const roomId = socket.roomId;
    if (roomId && rooms.has(roomId)) {
      socket.to(roomId).emit('peer-hung-up');
      socket.leave(roomId);
      
      const room = rooms.get(roomId);
      const index = room.indexOf(socket.id);
      if (index !== -1) {
        room.splice(index, 1);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to start a call`);
});