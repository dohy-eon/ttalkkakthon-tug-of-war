const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const rooms = {};
const soloLiveState = {
  active: false,
  sessionId: null,
  nickname: '',
  score: 0,
  combo: 0,
  maxCombo: 0,
  accuracy: 0,
  grade: '-',
  fever: false,
  timeLeftMs: 0,
  updatedAt: 0,
};

const FORBIDDEN_WORDS = ['씨발', '병신', '개새', 'fuck', 'shit', 'bitch'];
const MAX_SOLO_RECORDS = 300;
const DUEL_DURATION_MS = 30000;
const FEVER_THRESHOLD_MS = 5000;
const ROOM_MODE_DUEL = 'duel';
const ROOM_MODE_TEAM = 'team';
const COMBO_THRESHOLD = 0.2;
const FORCE_SMOOTHING_ALPHA = 0.34;
const FORCE_STALE_GRACE_MS = 170;
const FORCE_STALE_DECAY_PER_TICK = 0.9;
const SCORE_CATCHUP_SCALE = 900;
const SCORE_CATCHUP_MAX = 0.12;
const JUDGE_LABELS = new Set(['GOOD', 'GREAT', 'PERFECT', 'MISS']);
const JUDGE_TONES = new Set(['good', 'great', 'perfect', 'miss']);
const JUDGE_VISIBLE_MS = 1200;

function normalizeName(raw) {
  return String(raw || '').trim();
}

function validateNickname(raw) {
  const name = normalizeName(raw);
  if (!name) return { ok: false, message: '닉네임을 입력해주세요.' };
  if (name.length < 2 || name.length > 10) {
    return { ok: false, message: '닉네임은 2~10자여야 합니다.' };
  }
  if (FORBIDDEN_WORDS.some((word) => name.toLowerCase().includes(word))) {
    return { ok: false, message: '사용할 수 없는 닉네임입니다.' };
  }
  return { ok: true, name };
}

function generateRoomId() {
  let id;
  do {
    id = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms[id]);
  return id;
}

function normalizeRoomMode(mode) {
  return mode === ROOM_MODE_TEAM ? ROOM_MODE_TEAM : ROOM_MODE_DUEL;
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
const LATEST_SCHEMA_VERSION = 4;

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'solo-ranking.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentVersion =
    db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get()?.version ?? 0;

  const migrations = [
    {
      version: 1,
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS solo_records (
            id TEXT PRIMARY KEY,
            nickname TEXT NOT NULL,
            score INTEGER NOT NULL,
            max_combo INTEGER NOT NULL,
            accuracy REAL NOT NULL,
            fever_score INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          );
        `);
      },
    },
    {
      version: 2,
      up: () => {
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_solo_records_score_created
          ON solo_records(score DESC, created_at ASC);
        `);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_solo_records_created_at
          ON solo_records(created_at);
        `);
      },
    },
    {
      version: 3,
      up: () => {
        if (!hasColumn('solo_records', 'normalized_nickname')) {
          db.exec(`ALTER TABLE solo_records ADD COLUMN normalized_nickname TEXT`);
        }
        db.exec(`
          UPDATE solo_records
          SET normalized_nickname = lower(nickname)
          WHERE normalized_nickname IS NULL OR normalized_nickname = '';
        `);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_solo_records_normalized_nickname
          ON solo_records(normalized_nickname);
        `);
      },
    },
    {
      version: 4,
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS fame_records (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            mode TEXT NOT NULL,
            display_name TEXT NOT NULL,
            image_data_url TEXT NOT NULL,
            note TEXT,
            created_at INTEGER NOT NULL
          );
        `);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_fame_records_type_created
          ON fame_records(type, created_at DESC);
        `);
      },
    },
  ];

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    const run = db.transaction(() => {
      migration.up();
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(
        migration.version,
        Date.now()
      );
    });
    run();
    console.log(`[DB] migration applied: v${migration.version}`);
  }

  if (currentVersion < LATEST_SCHEMA_VERSION) {
    console.log(`[DB] schema upgraded to v${LATEST_SCHEMA_VERSION}`);
  }
}

runMigrations();

const insertSoloStmt = db.prepare(`
  INSERT INTO solo_records (
    id,
    nickname,
    normalized_nickname,
    score,
    max_combo,
    accuracy,
    fever_score,
    created_at
  )
  VALUES (
    @id,
    @nickname,
    @normalizedNickname,
    @score,
    @maxCombo,
    @accuracy,
    @feverScore,
    @createdAt
  )
`);

const pruneSoloStmt = db.prepare(`
  DELETE FROM solo_records
  WHERE id IN (
    SELECT id
    FROM solo_records
    ORDER BY score DESC, created_at ASC
    LIMIT -1 OFFSET @limit
  )
`);

const insertFameStmt = db.prepare(`
  INSERT INTO fame_records (
    id,
    type,
    mode,
    display_name,
    image_data_url,
    note,
    created_at
  )
  VALUES (
    @id,
    @type,
    @mode,
    @displayName,
    @imageDataUrl,
    @note,
    @createdAt
  )
`);

function normalizeFameType(type) {
  return type === 'shame' ? 'shame' : 'honor';
}

function saveSoloRecord(record) {
  const transaction = db.transaction((payload) => {
    insertSoloStmt.run(payload);
    pruneSoloStmt.run({ limit: MAX_SOLO_RECORDS });
  });
  transaction(record);
}

function getFameRecords({ type = 'honor', limit = 30 } = {}) {
  const safeLimit = clampInt(limit, 1, 60);
  const normalizedType = normalizeFameType(type);
  const stmt = db.prepare(`
    SELECT
      id,
      type,
      mode,
      display_name AS displayName,
      image_data_url AS imageDataUrl,
      note,
      created_at AS createdAt
    FROM fame_records
    WHERE type = @type
    ORDER BY created_at DESC
    LIMIT @limit
  `);
  return stmt.all({ type: normalizedType, limit: safeLimit });
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function emitSoloLiveState() {
  io.emit('solo_live_state', { ...soloLiveState });
}

function serializePlayers(room) {
  return Object.entries(room.players).map(([socketId, p]) => ({
    socketId,
    name: p.name,
    team: p.team,
    ready: p.ready,
    sensorGranted: p.sensorGranted,
    calibrated: p.calibrated,
    contribution: Math.round(p.contribution),
    maxCombo: p.maxCombo,
    avgAccuracy: p.accuracyCount > 0 ? Number((p.accuracySum / p.accuracyCount).toFixed(3)) : 0,
  }));
}

function emitRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('room_state', {
    roomId,
    mode: room.mode,
    started: room.started,
    countdown: room.countdown,
    teamACount: room.teamACount,
    teamBCount: room.teamBCount,
    playerCount: Object.keys(room.players).length,
    players: serializePlayers(room),
  });
}

function finishGame(roomId, winner, reason = 'line_reached') {
  const room = rooms[roomId];
  if (!room || room.winner) return;
  room.winner = winner;
  room.started = false;
  room.countdown = null;
  clearInterval(room.countdownInterval);
  room.countdownInterval = null;

  io.to(roomId).emit('game_over', {
    winner,
    reason,
    position: room.position,
    players: serializePlayers(room),
  });
  emitRoomState(roomId);
}

function handleForfeitIfNeeded(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started || room.winner) return;
  const teamAAlive = Object.values(room.players).some((p) => p.team === 'A');
  const teamBAlive = Object.values(room.players).some((p) => p.team === 'B');
  if (!teamAAlive && teamBAlive) finishGame(roomId, 'B', 'forfeit');
  else if (!teamBAlive && teamAAlive) finishGame(roomId, 'A', 'forfeit');
}

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('create_room', (payload, callback) => {
    let params = payload;
    let cb = callback;
    if (typeof payload === 'function') {
      cb = payload;
      params = {};
    }
    if (typeof cb !== 'function') return;

    const mode = normalizeRoomMode(params?.mode);
    const roomId = generateRoomId();
    rooms[roomId] = {
      mode,
      hostSocketId: socket.id,
      players: {},
      position: 0,
      scoreA: 0,
      scoreB: 0,
      comboA: 0,
      comboB: 0,
      maxComboA: 0,
      maxComboB: 0,
      gainA: 0,
      gainB: 0,
      teamACount: 0,
      teamBCount: 0,
      started: false,
      winner: null,
      countdown: null,
      countdownInterval: null,
      startedAt: null,
      gameEndsAt: null,
    };
    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = true;
    console.log(`Room created: ${roomId}`);
    cb({ roomId, mode });
    emitRoomState(roomId);
  });

  socket.on('join_room', ({ roomId, name }, callback) => {
    const room = rooms[roomId];
    if (!room) {
      callback({ error: '방을 찾을 수 없습니다.' });
      return;
    }
    if (room.started || room.countdown) {
      callback({ error: '이미 시작된 방입니다.' });
      return;
    }
    const validation = validateNickname(name);
    if (!validation.ok) {
      callback({ error: validation.message });
      return;
    }

    const totalCount = Object.keys(room.players).length;
    if (room.mode === ROOM_MODE_DUEL && totalCount >= 2) {
      callback({ error: '2인 모드는 최대 2명까지 입장 가능합니다.' });
      return;
    }
    if (room.mode === ROOM_MODE_TEAM && totalCount >= 6) {
      callback({ error: '팀전 모드는 최대 6명까지 입장 가능합니다.' });
      return;
    }

    let team = 'A';
    if (room.mode === ROOM_MODE_DUEL) {
      team = room.teamACount === 0 ? 'A' : 'B';
    } else {
      // team mode: keep balanced and cap each side at 3
      if (room.teamACount >= 3 && room.teamBCount < 3) team = 'B';
      else if (room.teamBCount >= 3 && room.teamACount < 3) team = 'A';
      else team = room.teamACount <= room.teamBCount ? 'A' : 'B';
    }
    if (team === 'A') room.teamACount += 1;
    else room.teamBCount += 1;

    room.players[socket.id] = {
      name: validation.name,
      team,
      force: 0,
      smoothedForce: 0,
      lastForceAt: 0,
      accuracy: 0,
      ready: false,
      sensorGranted: false,
      calibrated: false,
      calibrationBaseline: 0,
      contribution: 0,
      combo: 0,
      maxCombo: 0,
      accuracySum: 0,
      accuracyCount: 0,
      rhythmJudge: '',
      rhythmJudgeTone: '',
      rhythmJudgeAt: 0,
    };

    socket.join(roomId);
    socket.roomId = roomId;
    socket.team = team;

    console.log(`Player ${socket.id} joined room ${roomId} as team ${team}`);
    callback({ team, name: room.players[socket.id].name, mode: room.mode });
    emitRoomState(roomId);
  });

  socket.on('set_ready', ({ sensorGranted, calibrated, baselineGamma }) => {
    const room = rooms[socket.roomId];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].sensorGranted = !!sensorGranted;
    room.players[socket.id].calibrated = !!calibrated;
    room.players[socket.id].ready = !!sensorGranted && !!calibrated;
    room.players[socket.id].calibrationBaseline = Number(baselineGamma) || 0;
    emitRoomState(socket.roomId);
  });

  socket.on('force', ({ value, accuracy, judge, judgeTone, judgeAt }) => {
    const room = rooms[socket.roomId];
    if (!room || !room.players[socket.id] || !room.started) return;

    const player = room.players[socket.id];
    const clampedForce = Math.max(-1, Math.min(1, Number(value) || 0));
    const clampedAcc = Math.max(0, Math.min(1, Number(accuracy) || 0));
    player.force = clampedForce;
    player.lastForceAt = Date.now();
    player.accuracy = clampedAcc;
    player.contribution += Math.abs(clampedForce);
    player.accuracySum += clampedAcc;
    player.accuracyCount += 1;
    if (JUDGE_LABELS.has(judge)) {
      player.rhythmJudge = judge;
      player.rhythmJudgeTone = JUDGE_TONES.has(judgeTone) ? judgeTone : 'good';
      player.rhythmJudgeAt = Number.isFinite(judgeAt) ? Number(judgeAt) : Date.now();
    }

    if (Math.abs(clampedForce) > 0.16 && clampedAcc > 0.38) {
      player.combo += 1;
      player.maxCombo = Math.max(player.maxCombo, player.combo);
    } else {
      player.combo = 0;
    }
  });

  socket.on('start_game', () => {
    const room = rooms[socket.roomId];
    if (!room || !socket.isHost) return;
    if (room.countdown || room.started) return;

    const totalPlayers = Object.keys(room.players).length;
    if (room.mode === ROOM_MODE_DUEL && totalPlayers < 2) return;
    if (room.mode === ROOM_MODE_TEAM) {
      if (totalPlayers < 4) return;
      if (room.teamACount < 2 || room.teamBCount < 2) return;
    }

    const everyoneReady = Object.values(room.players).every((p) => p.ready);
    if (!everyoneReady) return;

    room.countdown = 3;
    io.to(socket.roomId).emit('game_countdown', { seconds: room.countdown });
    emitRoomState(socket.roomId);

    room.countdownInterval = setInterval(() => {
      const currentRoom = rooms[socket.roomId];
      if (!currentRoom) return;

      currentRoom.countdown -= 1;
      if (currentRoom.countdown > 0) {
        io.to(socket.roomId).emit('game_countdown', { seconds: currentRoom.countdown });
        emitRoomState(socket.roomId);
        return;
      }

      clearInterval(currentRoom.countdownInterval);
      currentRoom.countdownInterval = null;
      currentRoom.countdown = null;
      currentRoom.started = true;
      currentRoom.position = 0;
      currentRoom.scoreA = 0;
      currentRoom.scoreB = 0;
      currentRoom.comboA = 0;
      currentRoom.comboB = 0;
      currentRoom.maxComboA = 0;
      currentRoom.maxComboB = 0;
      currentRoom.gainA = 0;
      currentRoom.gainB = 0;
      currentRoom.winner = null;
      currentRoom.startedAt = Date.now();
      currentRoom.gameEndsAt = currentRoom.startedAt + DUEL_DURATION_MS;
      Object.values(currentRoom.players).forEach((p) => {
        p.force = 0;
        p.smoothedForce = 0;
        p.lastForceAt = 0;
        p.contribution = 0;
        p.combo = 0;
        p.maxCombo = 0;
        p.accuracySum = 0;
        p.accuracyCount = 0;
        p.rhythmJudge = '';
        p.rhythmJudgeTone = '';
        p.rhythmJudgeAt = 0;
      });
      io.to(socket.roomId).emit('game_started');
      emitRoomState(socket.roomId);
      console.log(`Game started in room ${socket.roomId}`);
    }, 1000);
  });

  socket.on('reset_game', () => {
    const room = rooms[socket.roomId];
    if (!room || !socket.isHost) return;

    room.position = 0;
    room.scoreA = 0;
    room.scoreB = 0;
    room.comboA = 0;
    room.comboB = 0;
    room.maxComboA = 0;
    room.maxComboB = 0;
    room.gainA = 0;
    room.gainB = 0;
    room.winner = null;
    room.started = false;
    room.startedAt = null;
    room.gameEndsAt = null;
    room.countdown = null;
    clearInterval(room.countdownInterval);
    room.countdownInterval = null;
    Object.values(room.players).forEach((p) => {
      p.force = 0;
      p.smoothedForce = 0;
      p.lastForceAt = 0;
      p.rhythmJudge = '';
      p.rhythmJudgeTone = '';
      p.rhythmJudgeAt = 0;
    });
    io.to(socket.roomId).emit('game_reset');
    emitRoomState(socket.roomId);
  });

  socket.on('get_fame_records', (payload, callback) => {
    let params = payload;
    let cb = callback;
    if (typeof payload === 'function') {
      cb = payload;
      params = {};
    }
    if (typeof cb !== 'function') return;

    const type = normalizeFameType(params?.type);
    const records = getFameRecords({
      type,
      limit: params?.limit ?? 30,
    });
    cb({ type, records });
  });

  socket.on('submit_solo_result', (payload, callback) => {
    const validation = validateNickname(payload?.nickname);
    if (!validation.ok) {
      callback({ error: validation.message });
      return;
    }

    const score = Math.max(0, Math.floor(Number(payload?.score) || 0));
    const maxCombo = Math.max(0, Math.floor(Number(payload?.maxCombo) || 0));
    const accuracy = Math.max(0, Math.min(100, Number(payload?.accuracy) || 0));
    const feverScore = Math.max(0, Math.floor(Number(payload?.feverScore) || 0));
    const record = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      nickname: validation.name,
      normalizedNickname: validation.name.toLowerCase(),
      score,
      maxCombo,
      accuracy: Number(accuracy.toFixed(1)),
      feverScore,
      createdAt: Date.now(),
    };

    saveSoloRecord(record);
    if (soloLiveState.sessionId && soloLiveState.nickname === validation.name) {
      soloLiveState.active = false;
      soloLiveState.score = score;
      soloLiveState.combo = 0;
      soloLiveState.maxCombo = Math.max(soloLiveState.maxCombo, maxCombo);
      soloLiveState.accuracy = Number(accuracy.toFixed(1));
      soloLiveState.grade = 'END';
      soloLiveState.timeLeftMs = 0;
      soloLiveState.updatedAt = Date.now();
      emitSoloLiveState();
    }

    callback({ ok: true });
  });

  socket.on('submit_fame_record', (payload, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const validation = validateNickname(payload?.displayName);
    if (!validation.ok) {
      cb({ error: validation.message });
      return;
    }

    const type = normalizeFameType(payload?.type);
    const mode = payload?.mode === ROOM_MODE_TEAM ? ROOM_MODE_TEAM : ROOM_MODE_DUEL;
    const imageDataUrl = String(payload?.imageDataUrl || '');
    if (!imageDataUrl.startsWith('data:image/')) {
      cb({ error: '이미지 파일을 선택해주세요.' });
      return;
    }
    if (imageDataUrl.length > 1_600_000) {
      cb({ error: '이미지 용량이 너무 큽니다. 더 작은 이미지를 사용해주세요.' });
      return;
    }

    const record = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type,
      mode,
      displayName: validation.name,
      imageDataUrl,
      note: String(payload?.note || '').slice(0, 80),
      createdAt: Date.now(),
    };
    insertFameStmt.run(record);
    cb({ ok: true, recordId: record.id });
  });

  socket.on('solo_live_start', (payload) => {
    const validation = validateNickname(payload?.nickname);
    if (!validation.ok) return;

    soloLiveState.active = true;
    soloLiveState.sessionId = String(payload?.sessionId || `${Date.now()}`);
    soloLiveState.nickname = validation.name;
    soloLiveState.score = 0;
    soloLiveState.combo = 0;
    soloLiveState.maxCombo = 0;
    soloLiveState.accuracy = 0;
    soloLiveState.grade = 'START';
    soloLiveState.fever = false;
    soloLiveState.timeLeftMs = DUEL_DURATION_MS;
    soloLiveState.updatedAt = Date.now();
    emitSoloLiveState();
  });

  socket.on('solo_live_update', (payload) => {
    if (!soloLiveState.sessionId) return;
    const sessionId = String(payload?.sessionId || '');
    if (!sessionId || sessionId !== soloLiveState.sessionId) return;

    soloLiveState.active = true;
    soloLiveState.score = Math.max(0, Math.floor(Number(payload?.score) || 0));
    soloLiveState.combo = Math.max(0, Math.floor(Number(payload?.combo) || 0));
    soloLiveState.maxCombo = Math.max(0, Math.floor(Number(payload?.maxCombo) || 0));
    soloLiveState.accuracy = Math.max(0, Math.min(100, Number(payload?.accuracy) || 0));
    soloLiveState.grade = String(payload?.grade || '-').slice(0, 16);
    soloLiveState.fever = !!payload?.fever;
    soloLiveState.timeLeftMs = Math.max(0, Math.floor(Number(payload?.timeLeftMs) || 0));
    soloLiveState.updatedAt = Date.now();
    emitSoloLiveState();
  });

  socket.on('solo_live_end', (payload) => {
    if (!soloLiveState.sessionId) return;
    const sessionId = String(payload?.sessionId || '');
    if (!sessionId || sessionId !== soloLiveState.sessionId) return;

    soloLiveState.active = false;
    soloLiveState.score = Math.max(0, Math.floor(Number(payload?.score) || soloLiveState.score));
    soloLiveState.combo = 0;
    soloLiveState.maxCombo = Math.max(0, Math.floor(Number(payload?.maxCombo) || soloLiveState.maxCombo));
    soloLiveState.accuracy = Math.max(0, Math.min(100, Number(payload?.accuracy) || soloLiveState.accuracy));
    soloLiveState.grade = 'END';
    soloLiveState.fever = false;
    soloLiveState.timeLeftMs = 0;
    soloLiveState.updatedAt = Date.now();
    emitSoloLiveState();
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (!room) {
      console.log(`Disconnected: ${socket.id}`);
      return;
    }

    if (socket.isHost && room.hostSocketId === socket.id) {
      io.to(socket.roomId).emit('room_closed', { reason: 'host_disconnected' });
      clearInterval(room.countdownInterval);
      delete rooms[socket.roomId];
      console.log(`Room ${socket.roomId} deleted (host disconnected)`);
      console.log(`Disconnected: ${socket.id}`);
      return;
    }

    if (room.players[socket.id]) {
      const player = room.players[socket.id];
      if (player.team === 'A') room.teamACount--;
      else room.teamBCount--;
      delete room.players[socket.id];

      handleForfeitIfNeeded(socket.roomId);
      emitRoomState(socket.roomId);

      if (Object.keys(room.players).length === 0) {
        clearInterval(room.countdownInterval);
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

    const now = Date.now();
    let forceA = 0;
    let forceB = 0;
    let effectiveA = 0;
    let effectiveB = 0;
    let countA = 0;
    let countB = 0;

    for (const player of Object.values(room.players)) {
      const elapsedMs = now - (player.lastForceAt || 0);
      let staleDecay = 1;
      if (player.lastForceAt > 0 && elapsedMs > FORCE_STALE_GRACE_MS) {
        const staleTicks = (elapsedMs - FORCE_STALE_GRACE_MS) / (1000 / TICK_RATE);
        staleDecay = Math.pow(FORCE_STALE_DECAY_PER_TICK, Math.max(0, staleTicks));
      }
      const targetForce = player.force * staleDecay;
      player.smoothedForce += (targetForce - player.smoothedForce) * FORCE_SMOOTHING_ALPHA;

      // client already applies posture accuracy to value; avoid double penalty on server.
      const weightedForce = player.smoothedForce;
      if (player.team === 'A') {
        forceA += weightedForce;
        effectiveA += Math.max(0, -weightedForce);
        countA++;
      } else {
        forceB += weightedForce;
        effectiveB += Math.max(0, weightedForce);
        countB++;
      }
    }

    const avgA = countA > 0 ? forceA / countA : 0; // raw signed
    const avgB = countB > 0 ? forceB / countB : 0; // raw signed
    const pullA = countA > 0 ? effectiveA / countA : 0; // team-relative positive pull
    const pullB = countB > 0 ? effectiveB / countB : 0; // team-relative positive pull
    const timeLeftMs = Math.max(0, room.gameEndsAt - Date.now());
    const fever = timeLeftMs <= FEVER_THRESHOLD_MS;
    const delta = (pullA - pullB) * (fever ? K * 1.25 : K);
    room.position = Math.max(-100, Math.min(100, room.position + delta));

    if (pullA >= COMBO_THRESHOLD) {
      room.comboA += 1;
      room.maxComboA = Math.max(room.maxComboA, room.comboA);
    } else {
      room.comboA = 0;
    }
    if (pullB >= COMBO_THRESHOLD) {
      room.comboB += 1;
      room.maxComboB = Math.max(room.maxComboB, room.comboB);
    } else {
      room.comboB = 0;
    }

    // Softer combo scaling to reduce early snowball while preserving rhythm rewards.
    const comboBonusA = room.comboA > 1 ? Math.log1p(Math.min(room.comboA, 20)) * 0.12 : 0;
    const comboBonusB = room.comboB > 1 ? Math.log1p(Math.min(room.comboB, 20)) * 0.12 : 0;
    const scoreGapAB = room.scoreB - room.scoreA;
    const scoreGapBA = room.scoreA - room.scoreB;
    const catchupA = 1 + Math.min(Math.max(0, scoreGapAB) / SCORE_CATCHUP_SCALE, SCORE_CATCHUP_MAX);
    const catchupB = 1 + Math.min(Math.max(0, scoreGapBA) / SCORE_CATCHUP_SCALE, SCORE_CATCHUP_MAX);
    const gainA = pullA > 0.12 ? Math.round(pullA * 3.0 * (1 + comboBonusA) * (fever ? 1.17 : 1) * catchupA) : 0;
    const gainB = pullB > 0.12 ? Math.round(pullB * 3.0 * (1 + comboBonusB) * (fever ? 1.17 : 1) * catchupB) : 0;
    room.gainA = gainA;
    room.gainB = gainB;
    room.scoreA += gainA;
    room.scoreB += gainB;
    const playerJudges = Object.entries(room.players)
      .map(([socketId, player]) => ({
        socketId,
        name: player.name,
        team: player.team,
        judge: player.rhythmJudge,
        tone: player.rhythmJudgeTone || 'good',
        at: player.rhythmJudgeAt || 0,
      }))
      .filter((entry) => entry.judge && now - entry.at <= JUDGE_VISIBLE_MS);

    let winner = null;
    if (room.position >= 100) winner = 'A';
    else if (room.position <= -100) winner = 'B';

    if (winner) {
      finishGame(roomId, winner, 'line_reached');
      continue;
    }

    if (timeLeftMs <= 0) {
      const timeoutWinner = room.position > 0 ? 'A' : room.position < 0 ? 'B' : 'DRAW';
      finishGame(roomId, timeoutWinner, 'timeout');
      continue;
    }

    io.to(roomId).emit('game_state', {
      position: room.position,
      forceA: pullA,
      forceB: pullB,
      rawForceA: avgA,
      rawForceB: avgB,
      teamACount: room.teamACount,
      teamBCount: room.teamBCount,
      scoreA: room.scoreA,
      scoreB: room.scoreB,
      comboA: room.comboA,
      comboB: room.comboB,
      maxComboA: room.maxComboA,
      maxComboB: room.maxComboB,
      gainA: room.gainA,
      gainB: room.gainB,
      playerJudges,
      timeLeftMs,
      fever,
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

process.on('exit', () => {
  db.close();
});
