'use strict';
/**
 * El-MEKINA server: HTTP static hosting + Socket.IO lobby & game transport.
 * Every client only ever receives its own hand plus public information.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Game, GameError, MIN_PLAYERS, MAX_PLAYERS } = require('./game');
const { BotBrain, BOT_NAMES } = require('./bots');

// Load .env (simple KEY=VALUE lines; real environment variables take precedence)
try {
  const envFile = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
} catch { /* no .env file — defaults apply */ }

const PORT = Number(process.env.PORT) || 8000;
const ROOM_TTL_MS = 30 * 60 * 1000; // rooms with nobody connected are removed after 30 min

const app = express();
// The browser client is a Vite + React app (client/). `npm run build` writes it to client/dist, which is served here
// together with the static art in public/ (img/, assets/). Without a build we still serve public/ so the API is reachable.
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const hasBuild = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));
if (hasBuild) app.use(express.static(CLIENT_DIST, { index: 'index.html' }));
else console.warn('⚠ client/dist not found — run "npm run build" to build the web client (or "npm run dev:client" for the Vite dev server).');
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 15000 });

/** @type {Map<string, Room>} */
const rooms = new Map();

function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[crypto.randomInt(alphabet.length)];
    if (!rooms.has(code)) return code;
  }
}
const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 16) || 'Player';
const DEFAULT_AVATARS = ['boy-1', 'boy-2', 'boy-3', 'boy-4', 'boy-5', 'boy-6', 'girl-1', 'girl-2', 'girl-3', 'girl-4', 'girl-5', 'girl-6'];
const PALETTE = ['#2f7d32', '#d7a800', '#1e4fb5', '#b3261e', '#4b6b2b', '#5b2d9e', '#b5561a']; // = character colours
const MAX_AVATAR_DATA = 120000; // ~120 KB data URL
/** Sanitize a client-sent profile {avatar, avatarData, color}. */
function cleanProfile(raw) {
  const out = { avatar: null, avatarData: null, color: null };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.avatar === 'custom' && typeof raw.avatarData === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.avatarData) && raw.avatarData.length <= MAX_AVATAR_DATA) {
    out.avatar = 'custom'; out.avatarData = raw.avatarData;
  } else if (DEFAULT_AVATARS.includes(raw.avatar)) out.avatar = raw.avatar;
  if (typeof raw.color === 'string' && PALETTE.includes(raw.color.toLowerCase())) out.color = raw.color.toLowerCase();
  return out;
}

class Room {
  constructor(code) {
    this.code = code;
    this.hostId = null;
    this.players = []; // {id, name, token, socketId, ready, connected}
    this.game = null;
    this.brain = new BotBrain(this);
    this.lastActivity = Date.now();
  }
  player(id) { return this.players.find(p => p.id === id); }
  get humans() { return this.players.filter(p => !p.isBot); }
  /** Fill missing avatar/colour with the first unused defaults (deterministic, not random). */
  applyDefaults(player) {
    if (!player.avatar) { const used = new Set(this.players.filter(p => p !== player).map(p => p.avatar)); player.avatar = DEFAULT_AVATARS.find(a => !used.has(a)) || DEFAULT_AVATARS[this.players.indexOf(player) % DEFAULT_AVATARS.length]; }
    if (!player.color) { const used = new Set(this.players.filter(p => p !== player).map(p => p.color)); player.color = PALETTE.find(c => !used.has(c)) || PALETTE[this.players.indexOf(player) % PALETTE.length]; }
  }
  setProfile(player, raw) {
    const pr = cleanProfile(raw);
    if (pr.avatar) { player.avatar = pr.avatar; player.avatarData = pr.avatarData; }
    if (pr.color) player.color = pr.color;
    this.applyDefaults(player);
    if (this.game) this.game.setProfile(player.id, { avatar: player.avatar, color: player.color });
    this.broadcastLobby();
  }
  addBot() {
    if (this.players.length >= MAX_PLAYERS) throw new GameError('Room is full');
    const used = new Set(this.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || `Machine·${this.players.length + 1}`;
    const bot = { id: crypto.randomUUID(), name, token: null, socketId: null, ready: true, connected: true, isBot: true, avatar: null, avatarData: null, color: null };
    this.players.push(bot);
    this.applyDefaults(bot);
    return bot;
  }
  removeBot() {
    const idx = this.players.map(p => p.isBot).lastIndexOf(true);
    if (idx < 0) throw new GameError('No bot to remove');
    this.players.splice(idx, 1);
  }
  get phase() { return this.game ? this.game.phase : 'lobby'; }

  lobbyView(forId) {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      you: forId,
      minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
      players: this.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, connected: p.connected, isHost: p.id === this.hostId, isBot: !!p.isBot, avatar: p.avatar, avatarData: p.avatar === 'custom' ? p.avatarData : null, color: p.color })),
      canStart: this.phase === 'lobby' && this.players.length >= MIN_PLAYERS && this.players.every(p => p.ready || p.id === this.hostId) && this.players.filter(p => p.connected).length >= MIN_PLAYERS,
    };
  }
  broadcastLobby() {
    for (const p of this.players) if (p.socketId) io.to(p.socketId).emit('room', this.lobbyView(p.id));
  }
  broadcastState() {
    if (!this.game) return;
    for (const p of this.players) if (p.socketId) io.to(p.socketId).emit('state', this.game.viewFor(p.id));
  }
  sendAll(p) {
    if (!p.socketId) return;
    io.to(p.socketId).emit('room', this.lobbyView(p.id));
    if (this.game) io.to(p.socketId).emit('state', this.game.viewFor(p.id));
  }
  startGame() {
    if (this.game && this.game.phase === 'playing') throw new GameError('Game already running');
    const seated = this.players.filter(p => p.connected);
    if (seated.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} connected players`);
    // Drop players who left in the lobby
    this.players = seated;
    if (!this.player(this.hostId)) this.hostId = (this.humans[0] || this.players[0]).id;
    this.brain.reset();
    for (const p of this.players) this.applyDefaults(p);
    this.game = new Game(this.players.map(p => ({ id: p.id, name: p.name, connected: p.connected, isBot: !!p.isBot, avatar: p.avatar, color: p.color })), {
      onUpdate: () => { this.broadcastState(); this.brain.tick(); },
    });
    this.broadcastLobby();
    this.game.start();
  }
  backToLobby() {
    this.brain.reset();
    if (this.game) this.game.destroy();
    this.game = null;
    this.players = this.players.filter(p => p.connected);
    for (const p of this.players) p.ready = false;
    if (!this.player(this.hostId) && this.players.length) this.hostId = (this.humans[0] || this.players[0]).id;
    this.broadcastLobby();
  }
  removePlayer(id) {
    this.players = this.players.filter(p => p.id !== id);
    if (this.hostId === id && this.players.length) this.hostId = (this.humans[0] || this.players[0]).id;
  }
}

// Periodic cleanup of abandoned rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.players.some(p => p.connected && !p.isBot);
    if (!anyone && now - room.lastActivity > ROOM_TTL_MS) {
      room.brain.destroy();
      if (room.game) room.game.destroy();
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

function reply(cb, payload) { if (typeof cb === 'function') cb(payload); }
function fail(cb, message) { reply(cb, { ok: false, error: message }); }

io.on('connection', (socket) => {
  socket.data.code = null;
  socket.data.playerId = null;

  const currentRoom = () => (socket.data.code ? rooms.get(socket.data.code) : null);

  function attach(room, player) {
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    player.socketId = socket.id;
    player.connected = true;
    room.lastActivity = Date.now();
    socket.join(room.code);
  }

  socket.on('create_room', (data, cb) => {
    try {
      if (currentRoom()) return fail(cb, 'Leave your current room first');
      const room = new Room(genCode());
      rooms.set(room.code, room);
      const player = { id: crypto.randomUUID(), name: cleanName(data && data.name), token: crypto.randomBytes(16).toString('hex'), socketId: null, ready: false, connected: true, ...cleanProfile(data && data.profile) };
      room.players.push(player);
      room.hostId = player.id;
      room.applyDefaults(player);
      attach(room, player);
      reply(cb, { ok: true, code: room.code, playerId: player.id, token: player.token });
      room.broadcastLobby();
    } catch (e) { fail(cb, e.message); }
  });

  socket.on('solo', (data, cb) => {
    try {
      if (currentRoom()) return fail(cb, 'Leave your current room first');
      const room = new Room(genCode());
      rooms.set(room.code, room);
      const player = { id: crypto.randomUUID(), name: cleanName(data && data.name), token: crypto.randomBytes(16).toString('hex'), socketId: null, ready: true, connected: true, ...cleanProfile(data && data.profile) };
      room.players.push(player);
      room.hostId = player.id;
      room.applyDefaults(player);
      attach(room, player);
      const n = Math.max(1, Math.min(MAX_PLAYERS - 1, Number(data && data.bots) || 3));
      for (let i = 0; i < n; i++) room.addBot();
      reply(cb, { ok: true, code: room.code, playerId: player.id, token: player.token });
      room.startGame();
    } catch (e) { fail(cb, e.message); }
  });

  socket.on('add_bot', (_data, cb) => {
    const room = currentRoom(); if (!room) return fail(cb, 'Not in a room');
    if (room.hostId !== socket.data.playerId) return fail(cb, 'Only the host can add bots');
    if (room.phase !== 'lobby') return fail(cb, 'Game in progress');
    try { room.addBot(); reply(cb, { ok: true }); room.broadcastLobby(); } catch (e) { fail(cb, e.message); }
  });
  socket.on('remove_bot', (_data, cb) => {
    const room = currentRoom(); if (!room) return fail(cb, 'Not in a room');
    if (room.hostId !== socket.data.playerId) return fail(cb, 'Only the host can remove bots');
    if (room.phase !== 'lobby') return fail(cb, 'Game in progress');
    try { room.removeBot(); reply(cb, { ok: true }); room.broadcastLobby(); } catch (e) { fail(cb, e.message); }
  });

  socket.on('join_room', (data, cb) => {
    try {
      if (currentRoom()) return fail(cb, 'Leave your current room first');
      const code = String((data && data.code) || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return fail(cb, 'Room not found');
      if (room.phase !== 'lobby') return fail(cb, 'That game has already started');
      if (room.players.length >= MAX_PLAYERS) return fail(cb, 'Room is full');
      let name = cleanName(data && data.name);
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) name = `${name.slice(0, 13)}#${room.players.length + 1}`;
      const player = { id: crypto.randomUUID(), name, token: crypto.randomBytes(16).toString('hex'), socketId: null, ready: false, connected: true, ...cleanProfile(data && data.profile) };
      room.players.push(player);
      room.applyDefaults(player);
      attach(room, player);
      reply(cb, { ok: true, code: room.code, playerId: player.id, token: player.token });
      room.broadcastLobby();
    } catch (e) { fail(cb, e.message); }
  });

  socket.on('rejoin', (data, cb) => {
    try {
      const code = String((data && data.code) || '').toUpperCase();
      const room = rooms.get(code);
      const player = room && room.players.find(p => p.id === data.playerId && p.token === data.token);
      if (!room || !player) return fail(cb, 'Session expired');
      if (player.socketId && player.socketId !== socket.id) {
        const old = io.sockets.sockets.get(player.socketId);
        if (old) { old.data.code = null; old.data.playerId = null; old.emit('kicked', 'Connected from another tab'); }
      }
      attach(room, player);
      if (room.game) room.game.setConnected(player.id, true);
      reply(cb, { ok: true, code: room.code, playerId: player.id, token: player.token });
      room.broadcastLobby();
      room.sendAll(player);
    } catch (e) { fail(cb, e.message); }
  });

  socket.on('set_profile', (data, cb) => {
    const room = currentRoom(); if (!room) return fail(cb, 'Not in a room');
    const p = room.player(socket.data.playerId); if (!p) return fail(cb, 'Not in a room');
    room.setProfile(p, data && data.profile);
    reply(cb, { ok: true });
  });

  socket.on('toggle_ready', (_data, cb) => {
    const room = currentRoom(); if (!room) return fail(cb, 'Not in a room');
    const p = room.player(socket.data.playerId); if (!p) return fail(cb, 'Not in a room');
    if (room.phase !== 'lobby') return fail(cb, 'Game in progress');
    p.ready = !p.ready;
    reply(cb, { ok: true, ready: p.ready });
    room.broadcastLobby();
  });

  socket.on('start_game', (_data, cb) => {
    const room = currentRoom(); if (!room) return fail(cb, 'Not in a room');
    if (room.hostId !== socket.data.playerId) return fail(cb, 'Only the host can start');
    const view = room.lobbyView(socket.data.playerId);
    if (!view.canStart) return fail(cb, 'Everyone must be ready (2–6 players)');
    try { room.startGame(); reply(cb, { ok: true }); } catch (e) { fail(cb, e.message); }
  });

  socket.on('back_to_lobby', (_data, cb) => {
    const room = currentRoom(); if (!room) return fail(cb, 'Not in a room');
    if (room.hostId !== socket.data.playerId) return fail(cb, 'Only the host can do that');
    if (room.game && room.game.phase === 'playing') return fail(cb, 'Game still running');
    room.backToLobby();
    reply(cb, { ok: true });
  });

  socket.on('new_game', (_data, cb) => {
    const room = currentRoom(); if (!room) return fail(cb, 'Not in a room');
    if (room.hostId !== socket.data.playerId) return fail(cb, 'Only the host can start a new game');
    if (room.game && room.game.phase === 'playing') return fail(cb, 'Game still running');
    try {
      room.backToLobby();            // reset seats/ready flags, drop players who left
      if (room.players.filter(p => p.connected).length < MIN_PLAYERS) return fail(cb, 'Need at least 2 connected players — back to the lobby');
      room.startGame();
      reply(cb, { ok: true });
    } catch (e) { fail(cb, e.message); }
  });

  socket.on('leave_room', (_data, cb) => {
    const room = currentRoom();
    if (room) {
      const pid = socket.data.playerId;
      if (room.game && room.game.phase === 'playing') {
        // Leaving mid-game: treated as a disconnect (turns auto-skip); seat stays until game ends.
        const p = room.player(pid); if (p) { p.socketId = null; p.connected = false; }
        room.game.setConnected(pid, false);
      } else {
        room.removePlayer(pid);
      }
      socket.leave(room.code);
      socket.data.code = null; socket.data.playerId = null;
      if (room.humans.length === 0) { room.brain.destroy(); if (room.game) room.game.destroy(); rooms.delete(room.code); }
      else room.broadcastLobby();
    }
    reply(cb, { ok: true });
  });

  // ── game events ──
  const gameCall = (fn) => (data, cb) => {
    const room = currentRoom();
    if (!room || !room.game) return fail(cb, 'No game running');
    try {
      fn(room.game, socket.data.playerId, data || {});
      room.lastActivity = Date.now();
      reply(cb, { ok: true });
    } catch (e) {
      if (e instanceof GameError) return fail(cb, e.message);
      console.error('[game] error', e);
      fail(cb, 'Server error');
    }
  };
  socket.on('game_action', gameCall((g, pid, d) => g.declareAction(pid, d)));
  socket.on('game_challenge', gameCall((g, pid) => g.challenge(pid)));
  socket.on('game_block', gameCall((g, pid) => g.block(pid)));
  socket.on('game_pass', gameCall((g, pid) => g.pass(pid)));
  socket.on('game_decision', gameCall((g, pid, d) => g.decide(pid, d)));

  socket.on('disconnect', () => {
    const room = currentRoom();
    if (!room) return;
    const p = room.player(socket.data.playerId);
    if (!p || p.socketId !== socket.id) return;
    p.socketId = null;
    p.connected = false;
    room.lastActivity = Date.now();
    if (room.game && room.game.phase === 'playing') {
      room.game.setConnected(p.id, false);
      room.broadcastLobby();
    } else if (room.game) {
      room.broadcastLobby();
    } else {
      // In the lobby, a disconnected player keeps their seat for a short grace period (can rejoin), then is removed.
      setTimeout(() => {
        const r = rooms.get(room.code);
        if (!r) return;
        const pp = r.player(p.id);
        if (pp && !pp.connected) {
          r.removePlayer(p.id);
          if (r.humans.length === 0) { r.brain.destroy(); rooms.delete(r.code); } else r.broadcastLobby();
        }
      }, 20000).unref();
      room.broadcastLobby();
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ Port ${PORT} is already in use by another program.`);
    console.error(`  • See who holds it:   lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    console.error(`  • Or run on another port:  PORT=${PORT + 1} npm start   (or edit PORT in .env)\n`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => {
  console.log(`El-MEKINA server running → http://localhost:${PORT}`);
});
