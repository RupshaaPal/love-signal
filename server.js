const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve static assets from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room storage
// Rooms will map a roomId string to an object containing information about active clients
const rooms = new Map();

// Helper to get local network IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Look for IPv4 that is not loopback
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prefer standard home networks (192.168.x.x, 10.x.x.x, 172.x.x.x)
        if (iface.address.startsWith('192.168.') || 
            iface.address.startsWith('10.') || 
            iface.address.startsWith('172.')) {
          return iface.address;
        }
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIpAddress();
const BASE_URL = "https://love-signal.vercel.app";;

console.log('--------------------------------------------------');
console.log(`HeartSync Server Initializing...`);
console.log(`Local Network Address: ${BASE_URL}`);
console.log('--------------------------------------------------');

// Socket.io Real-Time Coordination
io.on('connection', (socket) => {
  let currentRoomId = null;

  console.log(`Client connected: ${socket.id}`);

  // Handle Room Creation
  socket.on('create-room', async (callback) => {
    try {
      // Generate a unique 4-digit code
      let roomId;
      let attempts = 0;
      do {
        roomId = Math.floor(1000 + Math.random() * 9000).toString();
        attempts++;
      } while (rooms.has(roomId) && attempts < 100);

      // Create room record
      rooms.set(roomId, {
        creator: socket.id,
        clients: new Set([socket.id])
      });

      currentRoomId = roomId;
      socket.join(roomId);

      // Generate a pairing URL
      const pairingUrl = `${BASE_URL}/?room=${roomId}`;
      
      // Generate QR Code Base64 image
      const qrCodeDataUrl = await QRCode.toDataURL(pairingUrl, {
        margin: 2,
        width: 300,
        color: {
          dark: '#ff2d55', // Deep pink
          light: '#0b0914' // Matching background
        }
      });

      console.log(`Room [${roomId}] created by client ${socket.id}`);

      // Respond to creator
      if (typeof callback === 'function') {
        callback({
          success: true,
          roomId,
          pairingUrl,
          qrCodeDataUrl
        });
      }
    } catch (err) {
      console.error('Error in create-room:', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Failed to create room.' });
      }
    }
  });

  // Handle Joining Room
  socket.on('join-room', (roomId, callback) => {
    roomId = roomId.trim();
    if (!rooms.has(roomId)) {
      console.log(`Client ${socket.id} failed to join room [${roomId}] - Room not found`);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Room code not found.' });
      }
      return;
    }

    const room = rooms.get(roomId);
    
    // Check client limit (limit to 2 players for intimate dual interaction)
    if (room.clients.size >= 2) {
      console.log(`Client ${socket.id} failed to join room [${roomId}] - Room full`);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'This room is already full!' });
      }
      return;
    }

    room.clients.add(socket.id);
    currentRoomId = roomId;
    socket.join(roomId);

    console.log(`Client ${socket.id} successfully joined room [${roomId}]`);
    
    // Notify all participants that pairing is complete!
    io.to(roomId).emit('pairing-success', {
      roomId,
      memberCount: room.clients.size
    });

    if (typeof callback === 'function') {
      callback({ success: true, roomId });
    }
  });

  // Handle Heart Emoji Sending
  // data: { type: 'classic' | 'sparkle' | 'fire' | 'broken', intensity: number, combo: number }
  socket.on('send-heart', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    
    // Broadcast heart to the other device in the room
    socket.to(currentRoomId).emit('heart-received', {
      type: data.type,
      intensity: data.intensity || 1,
      combo: data.combo || 1,
      textNote: data.textNote ||"",
      senderId: socket.id
    });
  });

  // Handle Synced Heartbeat continuous touch and hold
  socket.on('heartbeat-hold', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    socket.to(currentRoomId).emit('heartbeat-hold-received', { senderId: socket.id });
  });

  socket.on('heartbeat-release', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    socket.to(currentRoomId).emit('heartbeat-release-received', { senderId: socket.id });
  });

  // Handle connection drop
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      room.clients.delete(socket.id);
      
      // Notify partner
      socket.to(currentRoomId).emit('partner-disconnected');

      // Clean up room if empty
      if (room.clients.size === 0) {
        rooms.delete(currentRoomId);
        console.log(`Room [${currentRoomId}] destroyed (all clients left)`);
      }
    }
  });
});

// Start the server
server.listen(PORT, () => {
  console.log('--------------------------------------------------');
  console.log(`HeartSync server is running!`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`Network Access: ${BASE_URL}`);
  console.log('--------------------------------------------------');
});
