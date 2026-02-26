const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 6;
const GAME_DURATION = 60;
const COUNTDOWN = 5;

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();
let nextPlayerId = 1;

const COLORS = [0x4caf50, 0xff4444, 0x4488ff, 0xffaa00, 0xcc44ff, 0x44dddd];

function createRoom(id) {
  return {
    id,
    players: new Map(),
    state: 'waiting', // waiting | countdown | playing | ended
    timer: null,
    timeLeft: GAME_DURATION,
    countdownLeft: COUNTDOWN,
  };
}

function findOrCreateRoom() {
  for (const [id, room] of rooms) {
    if (room.state === 'waiting' && room.players.size < MAX_PLAYERS) return room;
  }
  const id = 'room-' + Date.now();
  const room = createRoom(id);
  rooms.set(id, room);
  return room;
}

function broadcast(room, msg, exclude) {
  const data = JSON.stringify(msg);
  for (const [pid, p] of room.players) {
    if (pid !== exclude && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  }
}

function sendTo(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function getPlayerList(room) {
  const list = [];
  for (const [id, p] of room.players) {
    list.push({ id, name: p.name, color: p.color, x: p.x, z: p.z, r: p.r, score: p.score, level: p.level });
  }
  return list;
}

function startCountdown(room) {
  room.state = 'countdown';
  room.countdownLeft = COUNTDOWN;
  broadcast(room, { type: 'countdown', seconds: room.countdownLeft });

  room.timer = setInterval(() => {
    room.countdownLeft--;
    if (room.countdownLeft <= 0) {
      clearInterval(room.timer);
      startGame(room);
    } else {
      broadcast(room, { type: 'countdown', seconds: room.countdownLeft });
    }
  }, 1000);
}

function startGame(room) {
  room.state = 'playing';
  room.timeLeft = GAME_DURATION;
  broadcast(room, { type: 'start', duration: GAME_DURATION });

  room.timer = setInterval(() => {
    room.timeLeft--;
    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      endGame(room);
    } else {
      broadcast(room, { type: 'tick', timeLeft: room.timeLeft });
    }
  }, 1000);
}

function endGame(room) {
  room.state = 'ended';
  const scores = [];
  for (const [id, p] of room.players) {
    scores.push({ id, name: p.name, score: p.score, level: p.level });
  }
  scores.sort((a, b) => b.score - a.score);
  broadcast(room, { type: 'end', scores });

  setTimeout(() => {
    room.state = 'waiting';
    for (const [id, p] of room.players) {
      p.score = 0; p.level = 1; p.x = 0; p.z = 0; p.r = 1.2;
    }
  }, 3000);
}

function removePlayer(room, playerId) {
  room.players.delete(playerId);
  broadcast(room, { type: 'playerLeave', id: playerId });

  if (room.players.size === 0) {
    if (room.timer) clearInterval(room.timer);
    rooms.delete(room.id);
  }
}

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;
  let playerRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const room = findOrCreateRoom();
        const colorIdx = room.players.size % COLORS.length;
        const player = {
          ws, name: msg.name || 'Player', color: COLORS[colorIdx],
          x: 0, z: 0, r: 1.2, score: 0, level: 1,
        };
        room.players.set(playerId, player);
        playerRoom = room;

        sendTo(ws, {
          type: 'welcome', id: playerId, room: room.id,
          color: player.color,
          players: getPlayerList(room),
          state: room.state,
          timeLeft: room.timeLeft,
        });

        broadcast(room, {
          type: 'playerJoin', id: playerId,
          name: player.name, color: player.color,
        }, playerId);

        if (room.players.size >= 2 && room.state === 'waiting') {
          startCountdown(room);
        }
        break;
      }

      case 'ready': {
        if (!playerRoom || playerRoom.state !== 'waiting') break;
        if (playerRoom.players.size >= 2) {
          startCountdown(playerRoom);
        }
        break;
      }

      case 'state': {
        if (!playerRoom) break;
        const p = playerRoom.players.get(playerId);
        if (!p) break;
        p.x = msg.x; p.z = msg.z; p.r = msg.r;
        p.score = msg.score; p.level = msg.level;
        broadcast(playerRoom, {
          type: 'state', id: playerId,
          x: msg.x, z: msg.z, r: msg.r,
          score: msg.score, level: msg.level,
        }, playerId);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (playerRoom) removePlayer(playerRoom, playerId);
  });
});

console.log(`Animal Hole server running on port ${PORT}`);
