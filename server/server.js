const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const rooms = {};

function generateRoomId() {
  let id;
  do {
    id = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms[id]);
  return id;
}

app.use('/pc', express.static(path.join(__dirname, '..', 'client', 'pc', 'dist')));
app.use('/mobile', express.static(path.join(__dirname, '..', 'client', 'mobile', 'dist')));

app.get('/pc*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'pc', 'dist', 'index.html'));
});
app.get('/mobile*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'mobile', 'dist', 'index.html'));
});
app.get('/', (_req, res) => {
  res.redirect('/pc');
});

const TICK_RATE = 20; // 50ms per tick
const K = 0.3;

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('create_room', (callback) => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      players: {},
      position: 0,
      teamACount: 0,
      teamBCount: 0,
      started: false,
      winner: null,
    };
    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = true;
    console.log(`Room created: ${roomId}`);
    callback({ roomId });
  });

  socket.on('join_room', ({ roomId, name }, callback) => {
    const room = rooms[roomId];
    if (!room) {
      callback({ error: '방을 찾을 수 없습니다.' });
      return;
    }
    if (room.winner) {
      callback({ error: '이미 종료된 게임입니다.' });
      return;
    }

    const team = room.teamACount <= room.teamBCount ? 'A' : 'B';
    if (team === 'A') room.teamACount++;
    else room.teamBCount++;

    room.players[socket.id] = {
      name: name || `Player ${Object.keys(room.players).length + 1}`,
      team,
      force: 0,
    };

    socket.join(roomId);
    socket.roomId = roomId;
    socket.team = team;

    console.log(`Player ${socket.id} joined room ${roomId} as team ${team}`);
    callback({ team, name: room.players[socket.id].name });

    io.to(roomId).emit('player_joined', {
      playerCount: Object.keys(room.players).length,
      teamACount: room.teamACount,
      teamBCount: room.teamBCount,
    });
  });

  socket.on('force', ({ value }) => {
    const room = rooms[socket.roomId];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].force = Math.max(-1, Math.min(1, value));
  });

  socket.on('start_game', () => {
    const room = rooms[socket.roomId];
    if (!room || !socket.isHost) return;
    if (Object.keys(room.players).length < 2) return;

    room.started = true;
    room.position = 0;
    room.winner = null;
    io.to(socket.roomId).emit('game_started');
    console.log(`Game started in room ${socket.roomId}`);
  });

  socket.on('reset_game', () => {
    const room = rooms[socket.roomId];
    if (!room || !socket.isHost) return;

    room.position = 0;
    room.winner = null;
    room.started = false;
    Object.values(room.players).forEach((p) => (p.force = 0));
    io.to(socket.roomId).emit('game_reset');
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.id]) {
      const player = room.players[socket.id];
      if (player.team === 'A') room.teamACount--;
      else room.teamBCount--;
      delete room.players[socket.id];

      io.to(socket.roomId).emit('player_joined', {
        playerCount: Object.keys(room.players).length,
        teamACount: room.teamACount,
        teamBCount: room.teamBCount,
      });

      if (Object.keys(room.players).length === 0 && !socket.isHost) {
        delete rooms[socket.roomId];
        console.log(`Room ${socket.roomId} deleted (empty)`);
      }
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

setInterval(() => {
  for (const [roomId, room] of Object.entries(rooms)) {
    if (!room.started || room.winner) continue;

    let forceA = 0;
    let forceB = 0;
    let countA = 0;
    let countB = 0;

    for (const player of Object.values(room.players)) {
      if (player.team === 'A') {
        forceA += player.force;
        countA++;
      } else {
        forceB += player.force;
        countB++;
      }
    }

    const avgA = countA > 0 ? forceA / countA : 0;
    const avgB = countB > 0 ? forceB / countB : 0;
    const delta = (avgA - avgB) * K;
    room.position = Math.max(-100, Math.min(100, room.position + delta));

    let winner = null;
    if (room.position >= 100) winner = 'A';
    else if (room.position <= -100) winner = 'B';

    if (winner) {
      room.winner = winner;
      room.started = false;
      io.to(roomId).emit('game_over', { winner });
    }

    io.to(roomId).emit('game_state', {
      position: room.position,
      forceA: avgA,
      forceB: avgB,
      teamACount: room.teamACount,
      teamBCount: room.teamBCount,
    });
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`PC:     http://localhost:${PORT}/pc`);
  console.log(`Mobile: http://localhost:${PORT}/mobile`);
  console.log(`\nUse a tunnel (e.g. npx localtunnel --port ${PORT}) for mobile HTTPS access`);
});
