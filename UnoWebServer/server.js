const express   = require('express');
const http      = require('http');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const sqlite3   = require('sqlite3').verbose();
const { Server } = require('socket.io');
const UnoGame   = require('./game.js');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT         = process.env.PORT || 3000;
const JWT_SECRET   = 'uno-secret-key-42';
const ADMIN_SECRET = 'admin123';
const MIN_PLAYERS  = 2; // joueurs minimum pour lancer une partie

// ─── Base de donnees ──────────────────────────────────────────────────────────

const db = new sqlite3.Database('./database.sqlite');
db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, pseudo TEXT UNIQUE, password TEXT, role TEXT)');
});

app.use(express.static(__dirname + '/public'));
server.listen(PORT, () => console.log('UNO serveur demarre sur le port ' + PORT));

// ─── Etat global ──────────────────────────────────────────────────────────────

let users  = {};  // socketId -> { pseudo, role }
let lobbys = [];  // liste des lobbies
let games  = {};  // lobbyId -> UnoGame

function createLobby() {
    const lobby = { id: lobbys.length, players: [], gameStarted: false };
    lobbys.push(lobby);
    return lobby;
}

createLobby(); createLobby(); createLobby(); createLobby();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function broadcastStats() {
    const pseudos = new Set();
    Object.values(users).forEach(u => { if (u.role === 'player') pseudos.add(u.pseudo); });
    io.emit('players', { nbPlayers: pseudos.size });
    io.emit('lobbies', { lobbys: lobbys.map(serializeLobby) });
}

function serializeLobby(lobby) {
    return {
        id:          lobby.id,
        players:     lobby.players.map(p => p.pseudo),
        gameStarted: lobby.gameStarted
    };
}

function broadcastGameState(lobbyId) {
    const game = games[lobbyId];
    if (!game) return;

    const state = game.getPublicState();
    io.to('lobby_' + lobbyId).emit('game_state', state);

    game.players.forEach(p => {
        io.to(p.socketId).emit('your_hand', { hand: game.getPlayerHand(p.socketId) });
    });
}

function startGame(lobbyId) {
    const lobby = lobbys.find(l => l.id === lobbyId);
    if (!lobby || lobby.gameStarted || lobby.players.length < MIN_PLAYERS) return;

    lobby.gameStarted = true;
    games[lobbyId] = new UnoGame(lobbyId, lobby.players);
    console.log('Partie demarree — lobby ' + lobbyId);

    io.to('lobby_' + lobbyId).emit('game_started', {
        players: lobby.players.map(p => p.pseudo)
    });

    broadcastGameState(lobbyId);
    broadcastStats();
}

// ─── Connexions Socket.IO ─────────────────────────────────────────────────────

io.on('connection', (socket) => {

    // ── Inscription ──────────────────────────────────────────────────────────
    socket.on('register', async (data) => {
        const { pseudo, password, role, adminPassword } = data;
        if (role === 'admin' && adminPassword !== ADMIN_SECRET) {
            return socket.emit('login_error', { message: 'Code secret admin invalide.' });
        }
        try {
            const hash = await bcrypt.hash(password, 10);
            db.run('INSERT INTO users (pseudo, password, role) VALUES (?, ?, ?)', [pseudo, hash, role], (err) => {
                if (err) {
                    const msg = err.message.includes('UNIQUE') ? 'Ce pseudo existe deja.' : 'Erreur inscription.';
                    return socket.emit('login_error', { message: msg });
                }
                socket.emit('register_success');
            });
        } catch (e) {
            socket.emit('login_error', { message: 'Erreur serveur.' });
        }
    });

    // ── Connexion ────────────────────────────────────────────────────────────
    socket.on('login', (data) => {
        const { pseudo, password } = data;
        db.get('SELECT * FROM users WHERE pseudo = ?', [pseudo], async (err, user) => {
            if (err || !user) return socket.emit('login_error', { message: 'Utilisateur non trouve.' });
            const match = await bcrypt.compare(password, user.password);
            if (!match) return socket.emit('login_error', { message: 'Mot de passe incorrect.' });

            const token = jwt.sign({ pseudo: user.pseudo, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
            users[socket.id] = { pseudo: user.pseudo, role: user.role };
            socket.emit('login_success', { role: user.role, token, pseudo: user.pseudo });
            broadcastStats();
        });
    });

    // ── Verification de token ────────────────────────────────────────────────
    socket.on('verify_token', (data) => {
        const { token } = data;
        if (!token) return;
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            users[socket.id] = { pseudo: decoded.pseudo, role: decoded.role };
            socket.emit('login_success', { role: decoded.role, pseudo: decoded.pseudo, token });
            broadcastStats();

            // Rejoindre les rooms de ses lobbies actifs
            lobbys.forEach(lobby => {
                const inLobby = lobby.players.find(p => p.pseudo === decoded.pseudo);
                if (inLobby) {
                    inLobby.socketId = socket.id;
                    socket.join('lobby_' + lobby.id);
                    if (lobby.gameStarted && games[lobby.id]) {
                        const gp = games[lobby.id].players.find(p => p.pseudo === decoded.pseudo);
                        if (gp) gp.socketId = socket.id;
                        socket.emit('game_started', { players: lobby.players.map(p => p.pseudo) });
                        broadcastGameState(lobby.id);
                    }
                }
            });
        } catch (err) {
            socket.emit('login_error', { message: 'Session expiree.', reconnect: true });
        }
    });

    // ── Rejoindre un lobby ───────────────────────────────────────────────────
    socket.on('join_lobby', (data) => {
        const user = users[socket.id];
        if (!user || user.role !== 'player') return;

        const lobby = lobbys.find(l => l.id === data.lobbyId);
        if (!lobby) return socket.emit('error_message', { message: 'Lobby introuvable.' });
        if (lobby.gameStarted) return socket.emit('error_message', { message: 'La partie a deja commence.' });
        if (lobby.players.length >= 4) return socket.emit('error_message', { message: 'Ce lobby est complet.' });

        // Quitter les autres lobbies
        lobbys.forEach(l => {
            const idx = l.players.findIndex(p => p.socketId === socket.id);
            if (idx !== -1) { l.players.splice(idx, 1); socket.leave('lobby_' + l.id); }
        });

        lobby.players.push({ socketId: socket.id, pseudo: user.pseudo });
        socket.join('lobby_' + lobby.id);
        socket.emit('joined_lobby', { lobbyId: lobby.id });
        broadcastStats();

        if (lobby.players.length === 4) startGame(lobby.id);
    });

    // ── Quitter un lobby ─────────────────────────────────────────────────────
    socket.on('leave_lobby', () => {
        lobbys.forEach(lobby => {
            if (!lobby.gameStarted) {
                const idx = lobby.players.findIndex(p => p.socketId === socket.id);
                if (idx !== -1) { lobby.players.splice(idx, 1); socket.leave('lobby_' + lobby.id); }
            }
        });
        socket.emit('left_lobby');
        broadcastStats();
    });

    // ─── Actions de jeu ──────────────────────────────────────────────────────

    socket.on('play_card', (data) => {
        const lobby = lobbys.find(l => l.players.some(p => p.socketId === socket.id) && l.gameStarted);
        if (!lobby) return;
        const game = games[lobby.id];
        if (!game) return;

        const result = game.playCard(socket.id, data.cardIndex, data.chosenColor || null);
        if (!result.ok) return socket.emit('game_error', { message: result.error });

        if (result.effect === 'win') {
            broadcastGameState(lobby.id);
            io.to('lobby_' + lobby.id).emit('game_over', { winner: result.winner });
            lobby.gameStarted = false;
            delete games[lobby.id];
            lobby.players = [];
            broadcastStats();
        } else {
            broadcastGameState(lobby.id);
        }
    });

    socket.on('draw_card', () => {
        const lobby = lobbys.find(l => l.players.some(p => p.socketId === socket.id) && l.gameStarted);
        if (!lobby) return;
        const game = games[lobby.id];
        if (!game) return;

        const result = game.drawCard(socket.id);
        if (!result.ok) return socket.emit('game_error', { message: result.error });

        broadcastGameState(lobby.id);

        if (result.card && result.canPlay) {
            const hand = game.getPlayerHand(socket.id);
            socket.emit('can_play_drawn', { card: result.card, cardIndex: hand.length - 1 });
        }
    });

    socket.on('pass_turn', () => {
        const lobby = lobbys.find(l => l.players.some(p => p.socketId === socket.id) && l.gameStarted);
        if (!lobby) return;
        const game = games[lobby.id];
        if (!game) return;
        const result = game.passTurn(socket.id);
        if (result.ok) broadcastGameState(lobby.id);
    });

    socket.on('say_uno', () => {
        const lobby = lobbys.find(l => l.players.some(p => p.socketId === socket.id) && l.gameStarted);
        if (!lobby) return;
        const game = games[lobby.id];
        if (!game) return;
        const user = users[socket.id];
        const result = game.sayUno(socket.id);
        if (result.ok) {
            io.to('lobby_' + lobby.id).emit('uno_called', { pseudo: user ? user.pseudo : '?' });
        } else if (result.penalty) {
            socket.emit('game_error', { message: 'Penalite UNO : +2 cartes !' });
        }
        broadcastGameState(lobby.id);
    });

    socket.on('catch_uno', (data) => {
        const lobby = lobbys.find(l => l.players.some(p => p.socketId === socket.id) && l.gameStarted);
        if (!lobby) return;
        const game = games[lobby.id];
        if (!game) return;
        const target = lobby.players.find(p => p.pseudo === data.targetPseudo);
        if (!target) return;
        const result = game.catchUno(socket.id, target.socketId);
        if (result.ok) {
            io.to('lobby_' + lobby.id).emit('uno_caught', { caught: result.caught });
            broadcastGameState(lobby.id);
        }
    });

    // ─── Actions Admin ────────────────────────────────────────────────────────

    socket.on('admin_start_game', (data) => {
        if (users[socket.id]?.role !== 'admin') return;
        const lobby = lobbys.find(l => l.id === data.lobbyId);
        if (!lobby) return socket.emit('error_message', { message: 'Lobby introuvable.' });
        if (lobby.players.length < MIN_PLAYERS) {
            return socket.emit('error_message', { message: 'Il faut au moins ' + MIN_PLAYERS + ' joueurs.' });
        }
        startGame(data.lobbyId);
    });

    socket.on('admin_end_game', (data) => {
        if (users[socket.id]?.role !== 'admin') return;
        const lobby = lobbys.find(l => l.id === data.lobbyId);
        if (!lobby || !lobby.gameStarted) return;
        io.to('lobby_' + lobby.id).emit('game_over', { winner: null, adminEnded: true });
        lobby.gameStarted = false;
        delete games[lobby.id];
        lobby.players = [];
        broadcastStats();
    });

    socket.on('reset_lobbies', () => {
        if (users[socket.id]?.role !== 'admin') return;
        Object.keys(games).forEach(lobbyId => {
            io.to('lobby_' + lobbyId).emit('game_over', { winner: null, adminEnded: true });
            delete games[lobbyId];
        });
        lobbys = [];
        createLobby(); createLobby(); createLobby(); createLobby();
        broadcastStats();
    });

    socket.on('broadcast_msg', (data) => {
        if (users[socket.id]?.role !== 'admin') return;
        io.emit('server_response', { message: '[ADMIN] ' + data.message });
    });

    socket.on('create_lobby', () => {
        createLobby();
        broadcastStats();
    });

    // ─── Deconnexion ──────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (!user) return;
        lobbys.forEach(lobby => {
            if (!lobby.gameStarted) {
                const idx = lobby.players.findIndex(p => p.socketId === socket.id);
                if (idx !== -1) lobby.players.splice(idx, 1);
            }
        });
        delete users[socket.id];
        broadcastStats();
    });
});
