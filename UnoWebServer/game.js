/**
 * game.js — Logique complete du jeu UNO
 * Une instance de UnoGame represente une partie en cours.
 */

const COLORS = ['red', 'green', 'blue', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];

class UnoGame {
    /**
     * @param {number} lobbyId  - identifiant du lobby
     * @param {Array}  players  - [{ socketId, pseudo }, ...]  (2 a 4 joueurs)
     */
    constructor(lobbyId, players) {
        this.lobbyId = lobbyId;
        this.players = players.map(p => ({ socketId: p.socketId, pseudo: p.pseudo, hand: [] }));
        this.deck    = [];
        this.discard = [];
        this.currentPlayerIndex = 0;
        this.direction = 1;       // 1 = sens normal, -1 = sens inverse
        this.currentColor = null; // couleur active (apres un Wild)
        this.pendingDraw  = 0;    // +2 / +4 accumules
        this.status = 'playing';
        this.winner = null;
        this.unoCalled = new Set(); // socketIds ayant crie UNO ce tour

        this._buildDeck();
        this._shuffle();
        this._deal();
        this._startDiscard();
    }

    // ─── Initialisation ──────────────────────────────────────────────────────

    _buildDeck() {
        this.deck = [];
        for (const color of COLORS) {
            for (const value of VALUES) {
                this.deck.push({ color, value });
                if (value !== '0') this.deck.push({ color, value });
            }
        }
        for (let i = 0; i < 4; i++) {
            this.deck.push({ color: 'wild', value: 'wild'  });
            this.deck.push({ color: 'wild', value: 'wild4' });
        }
    }

    _shuffle() {
        const arr = this.deck;
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    _deal() {
        for (let i = 0; i < 7; i++) {
            for (const player of this.players) {
                player.hand.push(this.deck.pop());
            }
        }
    }

    _startDiscard() {
        let card;
        do {
            card = this.deck.pop();
            if (card.color === 'wild') {
                this.deck.unshift(card);
                this._shuffle();
            }
        } while (card.color === 'wild');

        this.discard.push(card);
        this.currentColor = card.color;

        // Effet immediat de la carte de depart
        if (card.value === 'skip') {
            this.currentPlayerIndex = this._nextIndex(this.currentPlayerIndex);
        } else if (card.value === 'reverse') {
            this.direction = -1;
            if (this.players.length === 2) {
                this.currentPlayerIndex = this._nextIndex(this.currentPlayerIndex);
            }
        } else if (card.value === 'draw2') {
            this.pendingDraw = 2;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    _nextIndex(from, steps) {
        if (steps === undefined) steps = 1;
        const n = this.players.length;
        return ((from + this.direction * steps) % n + n) % n;
    }

    _advanceTurn(skipExtra) {
        if (skipExtra === undefined) skipExtra = 0;
        this.unoCalled.clear();
        this.currentPlayerIndex = this._nextIndex(this.currentPlayerIndex, 1 + skipExtra);
    }

    _drawCards(player, n) {
        for (let i = 0; i < n; i++) {
            if (this.deck.length === 0) this._rechargeDeck();
            if (this.deck.length > 0) player.hand.push(this.deck.pop());
        }
    }

    _rechargeDeck() {
        if (this.discard.length <= 1) return;
        const top = this.discard.pop();
        this.deck = this.discard.splice(0);
        this.discard.push(top);
        this._shuffle();
    }

    _canPlay(card) {
        const top = this.discard[this.discard.length - 1];
        if (card.color === 'wild') return true;
        if (card.color === this.currentColor) return true;
        if (card.value === top.value) return true;
        return false;
    }

    // ─── Actions publiques ────────────────────────────────────────────────────

    /**
     * Joue une carte depuis la main du joueur courant.
     * @param {string} socketId
     * @param {number} cardIndex
     * @param {string|null} chosenColor - couleur choisie si Wild
     * @returns {{ ok: boolean, error?: string, effect?: string }}
     */
    playCard(socketId, cardIndex, chosenColor) {
        if (chosenColor === undefined) chosenColor = null;

        if (this.status !== 'playing') {
            return { ok: false, error: 'La partie est terminee.' };
        }

        const currentPlayer = this.players[this.currentPlayerIndex];
        if (currentPlayer.socketId !== socketId) {
            return { ok: false, error: "Ce n'est pas votre tour." };
        }

        const card = currentPlayer.hand[cardIndex];
        if (!card) return { ok: false, error: 'Carte invalide.' };

        // Avec des penalites en attente, seul un empilement est permis
        if (this.pendingDraw > 0) {
            const top = this.discard[this.discard.length - 1];
            const canStack =
                (card.value === 'draw2' && top.value === 'draw2') ||
                (card.value === 'wild4');
            if (!canStack) {
                return { ok: false, error: 'Vous devez piocher ' + this.pendingDraw + ' cartes.' };
            }
        }

        if (!this._canPlay(card)) {
            return { ok: false, error: 'Vous ne pouvez pas jouer cette carte.' };
        }
        if (card.color === 'wild' && !chosenColor) {
            return { ok: false, error: 'Veuillez choisir une couleur.' };
        }

        // Retirer la carte de la main et poser sur la defausse
        currentPlayer.hand.splice(cardIndex, 1);
        this.discard.push(card);
        this.currentColor = card.color === 'wild' ? chosenColor : card.color;

        // Victoire
        if (currentPlayer.hand.length === 0) {
            this.status = 'finished';
            this.winner = currentPlayer.pseudo;
            return { ok: true, effect: 'win', winner: currentPlayer.pseudo };
        }

        // Effets des cartes speciales
        let effect = 'normal';
        let skipNext = 0;

        if (card.value === 'skip') {
            effect = 'skip';
            skipNext = 1;

        } else if (card.value === 'reverse') {
            this.direction = -this.direction;
            effect = 'reverse';
            if (this.players.length === 2) skipNext = 1;

        } else if (card.value === 'draw2') {
            this.pendingDraw += 2;
            effect = 'draw2';
            this._advanceTurn();
            const victim2 = this.players[this.currentPlayerIndex];
            this._drawCards(victim2, this.pendingDraw);
            this.pendingDraw = 0;
            this._advanceTurn();
            return { ok: true, effect };

        } else if (card.value === 'wild4') {
            this.pendingDraw += 4;
            effect = 'wild4';
            this._advanceTurn();
            const victim4 = this.players[this.currentPlayerIndex];
            this._drawCards(victim4, this.pendingDraw);
            this.pendingDraw = 0;
            this._advanceTurn();
            return { ok: true, effect };

        } else if (card.value === 'wild') {
            effect = 'wild';
        }

        this._advanceTurn(skipNext);
        return { ok: true, effect };
    }

    /**
     * Le joueur courant pioche une carte.
     * @param {string} socketId
     * @returns {{ ok: boolean, card?: object, canPlay?: boolean, drewPenalty?: boolean }}
     */
    drawCard(socketId) {
        if (this.status !== 'playing') {
            return { ok: false, error: 'La partie est terminee.' };
        }
        const currentPlayer = this.players[this.currentPlayerIndex];
        if (currentPlayer.socketId !== socketId) {
            return { ok: false, error: "Ce n'est pas votre tour." };
        }

        // Penalite en attente : on pioche tout d'un coup
        if (this.pendingDraw > 0) {
            this._drawCards(currentPlayer, this.pendingDraw);
            this.pendingDraw = 0;
            this._advanceTurn();
            return { ok: true, drewPenalty: true };
        }

        if (this.deck.length === 0) this._rechargeDeck();
        if (this.deck.length === 0) return { ok: false, error: 'La pioche est vide.' };

        const card = this.deck.pop();
        currentPlayer.hand.push(card);
        const canPlay = this._canPlay(card);
        return { ok: true, card, canPlay };
    }

    /**
     * Passe le tour apres avoir pioche sans pouvoir jouer.
     * @param {string} socketId
     */
    passTurn(socketId) {
        if (this.status !== 'playing') return { ok: false };
        const currentPlayer = this.players[this.currentPlayerIndex];
        if (currentPlayer.socketId !== socketId) return { ok: false };
        this._advanceTurn();
        return { ok: true };
    }

    /**
     * Un joueur crie UNO. Valide si sa main a exactement 1 carte.
     * Sinon, penalite de 2 cartes.
     * @param {string} socketId
     */
    sayUno(socketId) {
        const player = this.players.find(p => p.socketId === socketId);
        if (!player) return { ok: false };
        if (player.hand.length === 1) {
            this.unoCalled.add(socketId);
            return { ok: true };
        }
        this._drawCards(player, 2);
        return { ok: false, penalty: true };
    }

    /**
     * Attrape un joueur qui a 1 carte sans avoir crie UNO.
     * @param {string} catcherSocketId
     * @param {string} targetSocketId
     */
    catchUno(catcherSocketId, targetSocketId) {
        const target = this.players.find(p => p.socketId === targetSocketId);
        if (!target) return { ok: false };
        if (target.hand.length === 1 && !this.unoCalled.has(targetSocketId)) {
            this._drawCards(target, 2);
            return { ok: true, caught: target.pseudo };
        }
        return { ok: false };
    }

    // ─── Serialisation ────────────────────────────────────────────────────────

    /** Etat public (sans les mains privees). */
    getPublicState() {
        return {
            lobbyId:            this.lobbyId,
            status:             this.status,
            winner:             this.winner,
            currentPlayerIndex: this.currentPlayerIndex,
            currentPlayer:      this.players[this.currentPlayerIndex].pseudo,
            currentColor:       this.currentColor,
            direction:          this.direction,
            pendingDraw:        this.pendingDraw,
            topCard:            this.discard[this.discard.length - 1],
            deckSize:           this.deck.length,
            players: this.players.map((p, i) => ({
                pseudo:    p.pseudo,
                cardCount: p.hand.length,
                isCurrent: i === this.currentPlayerIndex
            }))
        };
    }

    /** Main privee d'un joueur. */
    getPlayerHand(socketId) {
        const player = this.players.find(p => p.socketId === socketId);
        return player ? player.hand : [];
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }
}

module.exports = UnoGame;
