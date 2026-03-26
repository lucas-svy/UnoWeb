/**
 * script.js — Client UNO PRO
 * Gere la connexion Socket.IO, l'authentification, les lobbies et le plateau de jeu.
 */

const socket = io();

// ─── Elements UI ──────────────────────────────────────────────────────────────

const landingSection  = document.getElementById('landing-section');
const loginSection    = document.getElementById('login-section');
const gameSection     = document.getElementById('game-section');
const boardSection    = document.getElementById('board-section');
const adminPanel      = document.getElementById('admin-panel');

const goToLoginBtn    = document.getElementById('go-to-login');
const navAccueil      = document.getElementById('nav-accueil');
const navParties      = document.getElementById('nav-parties');
const navConnexion    = document.getElementById('nav-connexion');
const navDeconnexion  = document.getElementById('nav-deconnexion');
const navPseudo       = document.getElementById('nav-pseudo');

const roleSelect      = document.getElementById('role');
const adminPassContainer = document.getElementById('admin-password-container');
const loginBtn        = document.getElementById('auth-btn');
const pseudoInput     = document.getElementById('pseudo');
const passwordInput   = document.getElementById('password');
const adminPassInput  = document.getElementById('admin-password');

const authTitle       = document.getElementById('auth-title');
const authToggleBtn   = document.getElementById('auth-toggle-btn');
const authModeText    = document.getElementById('auth-mode-text');

const statusElement   = document.getElementById('connection-status');
const playerCountEl   = document.getElementById('player-count');
const adminPlayerCount = document.getElementById('admin-total-players');
const adminLobbyCount  = document.getElementById('admin-total-lobbies');

const lobbyListEl     = document.getElementById('lobby-list');
const adminLobbyListEl = document.getElementById('admin-lobby-list');

// Elements du plateau
const boardCurrentPlayer = document.getElementById('board-current-player');
const boardColorDot      = document.getElementById('board-color-dot');
const boardDeckSize      = document.getElementById('board-deck-size');
const boardHand          = document.getElementById('board-hand');
const boardHandCardAMount = document.getElementById('board-hand-cards-amount');
const topCardEl          = document.getElementById('top-card');
const drawPileEl         = document.getElementById('draw-pile');
const btnUno             = document.getElementById('btn-uno');
const btnPass            = document.getElementById('btn-pass');
const boardNotif         = document.getElementById('board-notif');

const colorModal         = document.getElementById('color-modal');
const colorChoices       = document.getElementById('color-choices');
const gameoverModal      = document.getElementById('gameover-modal');
const gameoverTitle      = document.getElementById('gameover-title');
const gameoverMsg        = document.getElementById('gameover-msg');
const gameoverBack       = document.getElementById('gameover-back');

// ─── Etat local ───────────────────────────────────────────────────────────────

let authMode       = 'login';     // 'login' ou 'register'
let myPseudo       = '';
let myHand         = [];          // main privee du joueur
let publicState    = null;        // etat public de la partie
let pendingCardIdx = null;        // index de la carte en attente de couleur (wild)
let canPassTurn    = false;       // apres avoir pioche sans jouer
let myLobbyId     = null;        // lobby actuel du joueur

// ─── Navigation ───────────────────────────────────────────────────────────────

function showSection(name) {
    landingSection.style.display  = 'none';
    loginSection.style.display    = 'none';
    gameSection.style.display     = 'none';
    boardSection.style.display    = 'none';
    adminPanel.style.display      = 'none';

    if (name === 'landing') landingSection.style.display = 'block';
    if (name === 'login')   loginSection.style.display   = 'block';
    if (name === 'game')    gameSection.style.display     = 'block';
    if (name === 'board')   boardSection.style.display    = 'flex';
    if (name === 'admin')   adminPanel.style.display      = 'block';
}

goToLoginBtn.addEventListener('click', () => showSection('login'));
navAccueil.addEventListener('click',   () => showSection('landing'));
navConnexion.addEventListener('click', () => showSection('login'));
navParties.addEventListener('click',   () => showSection('game'));

// ─── Authentification ─────────────────────────────────────────────────────────

authToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (authMode === 'login') {
        authMode = 'register';
        authTitle.textContent = "Inscription";
        loginBtn.textContent  = "S'inscrire";
        authModeText.textContent  = "Vous avez deja un compte ?";
        authToggleBtn.textContent = "Se connecter";
    } else {
        authMode = 'login';
        authTitle.textContent = "Connexion";
        loginBtn.textContent  = "Se connecter";
        authModeText.textContent  = "Pas encore de compte ?";
        authToggleBtn.textContent = "S'inscrire";
    }
});

roleSelect.addEventListener('change', () => {
    adminPassContainer.style.display = roleSelect.value === 'admin' ? 'block' : 'none';
});

loginBtn.addEventListener('click', () => {
    const pseudo        = pseudoInput.value.trim();
    const password      = passwordInput.value.trim();
    const role          = roleSelect.value;
    const adminPassword = adminPassInput.value;

    if (!pseudo || !password) return alert("Pseudo et mot de passe requis.");

    if (authMode === 'register') {
        socket.emit('register', { pseudo, password, role, adminPassword });
    } else {
        socket.emit('login', { pseudo, password });
    }
});

socket.on('register_success', () => {
    alert("Compte cree ! Connectez-vous.");
    // Revenir en mode login
    if (authMode === 'register') authToggleBtn.click();
});

socket.on('login_error', (data) => {
    alert(data.message);
    if (data.reconnect) {
        sessionStorage.removeItem('uno_token');
        window.location.reload();
    }
});

socket.on('login_success', (data) => {
    const { token, role, pseudo } = data;
    myPseudo = pseudo;
    document.title = "UNO - " + pseudo
    navPseudo.textContent = pseudo;

    if (token) sessionStorage.setItem('uno_token', token);

    navConnexion.style.display  = 'none';
    navDeconnexion.style.display = 'block';
    navParties.style.display     = 'block';

    if (role === 'admin') {
        showSection('admin');
    } else {
        showSection('game');
    }
});

function logout() {
    sessionStorage.removeItem('uno_token');
    window.location.reload();
}

document.getElementById('logout-btn').onclick = logout;
navDeconnexion.onclick = logout;

// ─── Socket events generaux ───────────────────────────────────────────────────

socket.on('connect', () => {
    if (statusElement) {
        statusElement.textContent = 'En ligne';
        statusElement.className   = 'connected';
    }
    const token = sessionStorage.getItem('uno_token');
    if (token) socket.emit('verify_token', { token });
});

socket.on('disconnect', () => {
    if (statusElement) {
        statusElement.textContent = 'Hors ligne';
        statusElement.className   = 'disconnected';
    }
});

socket.on('players', (data) => {
    if (playerCountEl)   playerCountEl.textContent   = data.nbPlayers;
    if (adminPlayerCount) adminPlayerCount.textContent = data.nbPlayers;
});

socket.on('lobbies', (data) => {
    updateLobbyUI(data.lobbys);
    if (adminLobbyCount) adminLobbyCount.textContent = data.lobbys.length;
});

socket.on('server_response', (data) => {
    const messages = document.getElementById('messages');
    if (!messages) return;
    const p = document.createElement('p');
    p.style.cssText = "padding:8px;border-left:3px solid var(--primary-color);background:rgba(255,255,255,0.05);margin:5px 0;";
    p.textContent = data.message;
    messages.prepend(p);
});

socket.on('error_message', (data) => alert(data.message));

// ─── Lobbies ──────────────────────────────────────────────────────────────────

function updateLobbyUI(lobbys) {
    if (lobbyListEl) {
        lobbyListEl.innerHTML = '';
        lobbys.forEach(lobby => {
            const card = document.createElement('div');
            card.className = 'lobby-card glass';

            const isFull    = lobby.players.length >= 4;
            const isStarted = lobby.gameStarted;

            const statusLabel = isStarted ? 'En cours' : (isFull ? 'Complet' : 'Rejoindre');
            const statusClass = isStarted ? 'lobby-badge-started' : (isFull ? 'lobby-badge-full' : 'lobby-badge-open');

            const playersList = lobby.players.length > 0
                ? lobby.players.map(p => '<span class="player-chip">' + p + '</span>').join('')
                : '<span style="color:var(--text-dim);font-size:0.85rem;">Aucun joueur</span>';

            card.innerHTML =
                '<div class="lobby-header">' +
                    '<span class="lobby-id">Lobby #' + (lobby.id + 1) + '</span>' +
                    '<span class="player-count ' + statusClass + '">' + lobby.players.length + ' / 4</span>' +
                '</div>' +
                '<div class="lobby-players">' + playersList + '</div>' +
                '<div class="lobby-footer">' +
                    '<button class="join-btn" onclick="joinLobby(' + lobby.id + ')" ' +
                        (isFull || isStarted ? 'disabled' : '') + '>' +
                        statusLabel +
                    '</button>' +
                    (myLobbyId === lobby.id && !isStarted
                        ? '<button class="leave-btn" onclick="leaveLobby()">Quitter</button>'
                        : '') +
                '</div>';

            lobbyListEl.appendChild(card);
        });
    }

    // Admin
    if (adminLobbyListEl) {
        adminLobbyListEl.innerHTML = '';
        lobbys.forEach(lobby => {
            const row = document.createElement('div');
            row.className = 'admin-lobby-row';

            const statusText  = lobby.gameStarted ? 'En cours' : (lobby.players.length > 0 ? 'Actif' : 'Vide');
            const statusColor = lobby.gameStarted ? '#f0883e' : (lobby.players.length > 0 ? '#4ecca3' : '#8b949e');

            row.innerHTML =
                '<span>Lobby #' + (lobby.id + 1) + '</span>' +
                '<span>' + lobby.players.join(', ') + '</span>' +
                '<span>' + lobby.players.length + '/4</span>' +
                '<span style="color:' + statusColor + ';">' + statusText + '</span>' +
                '<div class="admin-lobby-actions">' +
                    (!lobby.gameStarted && lobby.players.length >= 2
                        ? '<button class="btn-sm btn-green" onclick="adminStartGame(' + lobby.id + ')">Demarrer</button>'
                        : '') +
                    (lobby.gameStarted
                        ? '<button class="btn-sm btn-red" onclick="adminEndGame(' + lobby.id + ')">Stopper</button>'
                        : '') +
                '</div>';

            adminLobbyListEl.appendChild(row);
        });
    }
}

function joinLobby(lobbyId) {
    socket.emit('join_lobby', { lobbyId });
}

function leaveLobby() {
    socket.emit('leave_lobby');
}

socket.on('joined_lobby', (data) => {
    myLobbyId = data.lobbyId;
    const messages = document.getElementById('messages');
    if (messages) {
        messages.innerHTML = '<p class="glass" style="padding:10px;color:#3fb950;">Vous avez rejoint le lobby #' + (data.lobbyId + 1) + ' — en attente des autres joueurs...</p>';
    }
});

socket.on('left_lobby', () => {
    myLobbyId = null;
    const messages = document.getElementById('messages');
    if (messages) messages.innerHTML = '';
});

// ─── Jeu : demarrage ─────────────────────────────────────────────────────────

socket.on('game_started', (data) => {
    showSection('board');
    canPassTurn = false;
    showNotif('La partie commence ! Joueurs : ' + (data.players ? data.players.join(', ') : ''), 3000);
});

// ─── Jeu : etat public ───────────────────────────────────────────────────────

socket.on('game_state', (state) => {
    publicState = state;
    renderPublicState(state);
});

function renderPublicState(state) {
    boardCurrentPlayer.textContent = state.currentPlayer;
    boardDeckSize.textContent      = state.deckSize;

    // Couleur active + glow
    const colorMap = { red: '#e74c3c', green: '#2ecc71', blue: '#3498db', yellow: '#f1c40f', wild: '#9b59b6' };
    const activeColor = colorMap[state.currentColor] || '#fff';
    boardColorDot.style.background = activeColor;
    boardColorDot.style.boxShadow  = '0 0 14px ' + activeColor;

    // Sens de jeu
    const dirIcon = document.getElementById('board-direction-icon');
    if (dirIcon) dirIcon.textContent = state.direction === 1 ? '↻' : '↺';

    // Carte du dessus
    renderCard(topCardEl, state.topCard, false);
    topCardEl.classList.remove('playable');

    // Distribuer les adversaires dans les zones top / left / right
    const myIndex = state.players.findIndex(p => p.pseudo === myPseudo);
    const others  = [];
    for (let i = 1; i < state.players.length; i++) {
        others.push(state.players[(myIndex + i) % state.players.length]);
    }

    let positions;
    if (others.length === 1)      positions = ['top'];
    else if (others.length === 2) positions = ['left', 'right'];
    else                          positions = ['left', 'top', 'right'];

    ['board-opponent-top', 'board-opponent-left', 'board-opponent-right'].forEach(id => {
        const z = document.getElementById(id);
        if (z) z.innerHTML = '';
    });

    others.forEach((p, i) => {
        const zone = document.getElementById('board-opponent-' + positions[i]);
        if (!zone) return;

        const div = document.createElement('div');
        div.className = 'opponent' + (p.isCurrent ? ' opponent-active' : '');

        const maxShow = Math.min(p.cardCount, 12);
        let backs = '';
        for (let j = 0; j < maxShow; j++) {
            backs += '<div class="card card-img card-mini"><img src="' + CARD_BACK_SRC + '" alt="dos" draggable="false"></div>';
        }
        if (p.cardCount > maxShow) {
            backs += '<span class="card-extra">+' + (p.cardCount - maxShow) + '</span>';
        }

        div.innerHTML =
            '<div class="opponent-cards">' + backs + '</div>' +
            '<div class="opponent-name">' + p.pseudo + (p.isCurrent ? ' &#9654;' : '') + '</div>' +

            '<div class="opponent-count">' + p.cardCount + ' carte' + (p.cardCount > 1 ? 's' : '') + '</div>' +
            (p.cardCount === 1
                ? '<button class="btn-catch" onclick="catchUno(\'' + p.pseudo + '\')">Attraper !</button>'
                : '');

        zone.appendChild(div);
    });

    btnPass.style.display = canPassTurn ? 'inline-block' : 'none';
}

// ─── Jeu : main privee ───────────────────────────────────────────────────────

socket.on('your_hand', (data) => {
    myHand = data.hand;
    renderHand();
});

function renderHand() {
    boardHand.innerHTML = '';

    const isMyTurn = publicState && publicState.currentPlayer === myPseudo;

    myHand.forEach((card, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'card-wrapper';

        const el = document.createElement('div');
        el.className = 'card';
        renderCard(el, card, false);

        if (isMyTurn && canPlayCard(card)) {
            el.classList.add('playable');
            wrapper.addEventListener('click', () => onCardClick(index));
        } else {
            el.classList.add('not-playable');
        }

        wrapper.appendChild(el);
        boardHand.appendChild(wrapper);
    });
    boardHandCardAMount.innerHTML = myHand.length + " cartes";

}

function canPlayCard(card) {
    if (!publicState) return false;
    if (publicState.pendingDraw > 0) {
        // Avec penalite, seul empilement possible
        const top = publicState.topCard;
        return (card.value === 'draw2' && top.value === 'draw2') || card.value === 'wild4';
    }
    if (card.color === 'wild') return true;
    if (card.color === publicState.currentColor) return true;
    if (card.value === publicState.topCard.value) return true;
    return false;
}

// ─── Jeu : interactions ───────────────────────────────────────────────────────

function onCardClick(cardIndex) {
    const card = myHand[cardIndex];
    if (!card) return;

    if (card.color === 'wild') {
        // Demander la couleur
        pendingCardIdx = cardIndex;
        colorModal.style.display = 'flex';
    } else {
        socket.emit('play_card', { cardIndex, chosenColor: null });
        canPassTurn = false;
    }
}

// Choix de couleur pour les wilds
colorChoices.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        colorModal.style.display = 'none';
        if (pendingCardIdx !== null) {
            socket.emit('play_card', { cardIndex: pendingCardIdx, chosenColor: color });
            pendingCardIdx = null;
            canPassTurn = false;
        }
    });
});

// Piocher
drawPileEl.addEventListener('click', () => {
    if (!publicState || publicState.currentPlayer !== myPseudo) return;
    if (canPassTurn) return; // deja pioche, doit passer
    socket.emit('draw_card');
});

// Apres avoir pioche une carte jouable, le serveur peut proposer de la jouer
socket.on('can_play_drawn', (data) => {
    canPassTurn = true;
    btnPass.style.display = 'inline-block';
    showNotif('Vous avez pioche : ' + cardLabel(data.card) + (data.card && canPlayCardRaw(data.card) ? ' — vous pouvez la jouer !' : ''), 3000);
    renderHand(); // re-rendre pour mettre en evidence la carte piochee
});

function canPlayCardRaw(card) {
    if (!publicState) return false;
    if (card.color === 'wild') return true;
    if (card.color === publicState.currentColor) return true;
    if (card.value === publicState.topCard.value) return true;
    return false;
}

// Passer le tour
btnPass.addEventListener('click', () => {
    socket.emit('pass_turn');
    canPassTurn = false;
    btnPass.style.display = 'none';
});

// UNO !
btnUno.addEventListener('click', () => {
    socket.emit('say_uno');
});

// Attraper un adversaire sans UNO
function catchUno(targetPseudo) {
    socket.emit('catch_uno', { targetPseudo });
}

// ─── Jeu : evenements serveur ─────────────────────────────────────────────────

socket.on('uno_called', (data) => {
    showNotif(data.pseudo + ' crie UNO !', 2500);
});

socket.on('uno_caught', (data) => {
    showNotif(data.caught + ' est attrape sans UNO ! +2 cartes.', 3000);
});

socket.on('game_error', (data) => {
    showNotif(data.message, 2500, true);
});

socket.on('game_over', (data) => {
    boardSection.style.display = 'none';
    gameoverModal.style.display = 'flex';

    if (data.adminEnded) {
        gameoverTitle.textContent   = 'Partie arretee';
        gameoverMsg.textContent     = "L'administrateur a mis fin a la partie.";
        document.getElementById('gameover-emoji').textContent = 'X';
    } else if (!data.winner) {
        gameoverTitle.textContent   = 'Partie terminee';
        gameoverMsg.textContent     = 'Personne n\'a gagne.';
    } else if (data.winner === myPseudo) {
        gameoverTitle.textContent   = 'Victoire !';
        gameoverMsg.textContent     = 'Felicitations, vous avez gagne !';
        document.getElementById('gameover-emoji').textContent = '\uD83C\uDF89';
    } else {
        gameoverTitle.textContent   = 'Defaite';
        gameoverMsg.textContent     = data.winner + ' a remporte la partie.';
        document.getElementById('gameover-emoji').textContent = '\uD83D\uDE22';
    }

    myHand      = [];
    publicState = null;
    myLobbyId   = null;
    canPassTurn = false;
});

gameoverBack.addEventListener('click', () => {
    gameoverModal.style.display = 'none';
    showSection('game');
});

// ─── Rendu des cartes ─────────────────────────────────────────────────────────

const COLOR_HEX = {
    red:    '#e74c3c',
    green:  '#2ecc71',
    blue:   '#3498db',
    yellow: '#f1c40f',
    wild:   'linear-gradient(135deg, #e74c3c 25%, #2ecc71 25%, #2ecc71 50%, #3498db 50%, #3498db 75%, #f1c40f 75%)'
};

const VALUE_LABEL = {
    skip:    'S',
    reverse: 'R',
    draw2:   '+2',
    wild:    'W',
    wild4:   '+4'
};

function cardLabel(card) {
    if (!card) return '?';
    const v = VALUE_LABEL[card.value] || card.value;
    return card.color !== 'wild' ? card.color[0].toUpperCase() + v : v;
}

const CARD_COLOR_FOLDER = { red: 'UNO_rouges', blue: 'UNO_bleus', green: 'UNO_verts', yellow: 'UNO_jaunes' };
const CARD_COLOR_LABEL  = { red: 'Rouge',      blue: 'Bleu',     green: 'Vert',      yellow: 'Jaune'      };
const CARD_VALUE_FILE   = { draw2: '+2', reverse: 'Change Tour', skip: 'Skip' };
const CARD_BACK_SRC     = '/static/images/UNO_others/Verso.png';
const CARD_WILD_SRC     = {
    wild:  '/static/images/UNO_others/Change%20couleur.png',
    wild4: '/static/images/UNO_others/%2B4.png'
};

function getCardImageSrc(card) {
    if (CARD_WILD_SRC[card.value]) return CARD_WILD_SRC[card.value];
    const folder = CARD_COLOR_FOLDER[card.color];
    if (!folder) return null;
    const cname = CARD_COLOR_LABEL[card.color];
    const vname = CARD_VALUE_FILE[card.value] !== undefined ? CARD_VALUE_FILE[card.value] : card.value;
    return '/static/images/' + folder + '/' + encodeURIComponent(vname + ' ' + cname + '.png');
}

function renderCard(el, card, isBack) {
    el.innerHTML     = '';
    el.className     = 'card card-img';
    el.style.cssText = '';

    if (!card || isBack) {
        el.innerHTML = '<img src="' + CARD_BACK_SRC + '" alt="dos" draggable="false">';
        return;
    }

    el.classList.add('card-color-' + card.color);
    const imgSrc = getCardImageSrc(card);
    el.innerHTML = '<img src="' + imgSrc + '" alt="' + card.color + ' ' + card.value + '" draggable="false">';
}

// ─── Notifications ────────────────────────────────────────────────────────────

let notifTimer = null;
function showNotif(msg, duration, isError) {
    if (duration === undefined) duration = 2500;
    boardNotif.textContent  = msg;
    boardNotif.className    = 'board-notif-show' + (isError ? ' board-notif-error' : '');
    clearTimeout(notifTimer);
    notifTimer = setTimeout(() => {
        boardNotif.className = '';
    }, duration);
}

// ─── Actions Admin ────────────────────────────────────────────────────────────

document.getElementById('reset-lobbies').onclick = () => {
    if (confirm("Reinitialiser tous les lobbies ?")) socket.emit('reset_lobbies');
};

document.getElementById('broadcast-msg').onclick = () => {
    const msg = prompt("Message global pour tous les joueurs :");
    if (msg) socket.emit('broadcast_msg', { message: msg });
};

document.getElementById('create-lobby-admin').onclick = () => {
    socket.emit('create_lobby');
};

function adminStartGame(lobbyId) {
    socket.emit('admin_start_game', { lobbyId });
}

function adminEndGame(lobbyId) {
    if (confirm("Stopper la partie du lobby #" + (lobbyId + 1) + " ?")) {
        socket.emit('admin_end_game', { lobbyId });
    }
}
