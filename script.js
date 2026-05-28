"use strict";

// 状態管理
const STORAGE_KEY = "daifugo-table-stats-v1";
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = [
  { label: "3", value: 3 },
  { label: "4", value: 4 },
  { label: "5", value: 5 },
  { label: "6", value: 6 },
  { label: "7", value: 7 },
  { label: "8", value: 8 },
  { label: "9", value: 9 },
  { label: "10", value: 10 },
  { label: "J", value: 11 },
  { label: "Q", value: 12 },
  { label: "K", value: 13 },
  { label: "A", value: 14 },
  { label: "2", value: 15 }
];
const ROLE_BY_PLACE = ["大富豪", "富豪", "平民", "貧民", "大貧民"];
const CPU_SPEEDS = {
  fast: { label: "はやい", min: 500, max: 800 },
  normal: { label: "ふつう", min: 900, max: 1300 },
  slow: { label: "じっくり", min: 1400, max: 2000 }
};

const gameState = {
  phase: "title",
  round: 0,
  players: [],
  currentPlayerIndex: 0,
  currentField: null,
  playedCards: [],
  lastPlayedBy: null,
  selectedCardIds: new Set(),
  ranking: [],
  previousRoles: null,
  exchange: null,
  logs: [],
  stats: null,
  cpuSpeed: "normal",
  dealingTimerIds: [],
  actionToken: 0,
  loopGuard: 0,
  lastResult: null
};

const els = {};

document.addEventListener("DOMContentLoaded", initApp);

// 初期化
function initApp() {
  cacheElements();
  gameState.stats = loadStats();
  gameState.cpuSpeed = gameState.stats.cpuSpeed || "normal";
  bindEvents();
  renderStats();
  renderSpeedSettings();
  render();
}

function cacheElements() {
  [
    "titleScreen", "gameScreen", "startButton", "resetStatsButton", "statsList",
    "roundNumber", "stateTitle", "skipDealButton", "backTitleButton",
    "playersArea", "turnBanner", "fieldType", "lastMove", "fieldCards",
    "dealAnimationLayer", "logList", "exchangePanel", "exchangeInfo",
    "exchangeGiven", "exchangeButton", "handPanel", "selectionStatus",
    "illegalReason", "playerHand", "playButton", "passButton",
    "clearSelectionButton", "resultPanel", "resultList", "nextRoundButton",
    "debugInfo"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.startButton.addEventListener("click", startNewGame);
  els.resetStatsButton.addEventListener("click", () => {
    gameState.stats = defaultStats();
    saveStats();
    renderStats();
  });
  document.querySelectorAll("input[name='speed']").forEach((input) => {
    input.addEventListener("change", (event) => {
      gameState.cpuSpeed = event.target.value;
      gameState.stats.cpuSpeed = gameState.cpuSpeed;
      saveStats();
    });
  });
  els.skipDealButton.addEventListener("click", finishDealingAnimation);
  els.backTitleButton.addEventListener("click", () => {
    gameState.actionToken++;
    gameState.phase = "title";
    showTitle();
  });
  els.playButton.addEventListener("click", handlePlayerPlay);
  els.passButton.addEventListener("click", handlePlayerPass);
  els.clearSelectionButton.addEventListener("click", () => {
    gameState.selectedCardIds.clear();
    renderHand();
  });
  els.exchangeButton.addEventListener("click", handleCardExchange);
  els.nextRoundButton.addEventListener("click", startRound);
}

function startNewGame() {
  gameState.round = 0;
  gameState.previousRoles = null;
  gameState.lastResult = null;
  gameState.logs = [];
  gameState.actionToken++;
  setupPlayers();
  showGame();
  startRound();
}

function setupPlayers() {
  gameState.players = [
    { id: 0, name: "あなた", isHuman: true },
    { id: 1, name: "CPU1", isHuman: false },
    { id: 2, name: "CPU2", isHuman: false },
    { id: 3, name: "CPU3", isHuman: false },
    { id: 4, name: "CPU4", isHuman: false }
  ].map((player) => ({
    ...player,
    role: "平民",
    oldRole: "平民",
    hand: [],
    passed: false,
    finished: false,
    place: null
  }));
}

function startRound() {
  gameState.actionToken++;
  const token = gameState.actionToken;
  gameState.round += 1;
  gameState.phase = "dealing";
  gameState.selectedCardIds.clear();
  gameState.currentField = null;
  gameState.playedCards = [];
  gameState.lastPlayedBy = null;
  gameState.ranking = [];
  gameState.exchange = null;
  gameState.loopGuard = 0;
  gameState.players.forEach((player) => {
    player.oldRole = player.role || "平民";
    player.hand = [];
    player.passed = false;
    player.finished = false;
    player.place = null;
  });
  dealCards();
  addLog(`ラウンド${gameState.round}を開始しました`);
  render();
  playDealingAnimation(() => {
    if (token !== gameState.actionToken) return;
    finishDealingAnimation();
  });
}

// カード処理
function createDeck() {
  return RANKS.flatMap((rank) => SUITS.map((suit) => ({
    id: `${rank.label}${suit}`,
    rank: rank.label,
    value: rank.value,
    suit
  })));
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealCards() {
  const deck = shuffleDeck(createDeck());
  deck.forEach((card, index) => {
    gameState.players[index % gameState.players.length].hand.push(card);
  });
  gameState.players.forEach((player) => sortHand(player.hand));
  validateCardIntegrity("dealCards");
}

function sortHand(hand) {
  hand.sort((a, b) => a.value - b.value || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
  return hand;
}

// ルール判定
function getMoveType(cards) {
  if (!cards || cards.length < 1 || cards.length > 4) {
    return { ok: false, reason: "この枚数では出せません" };
  }
  const firstValue = cards[0].value;
  if (!cards.every((card) => card.value === firstValue)) {
    return { ok: false, reason: "同じ数字のカードを選んでください" };
  }
  return {
    ok: true,
    type: ["", "single", "pair", "triple", "quad"][cards.length],
    label: ["", "1枚出し", "ペア", "3枚組", "4枚組"][cards.length],
    count: cards.length,
    value: firstValue,
    cards: [...cards]
  };
}

function isLegalMove(cards, state = gameState) {
  if (state.phase !== "playerTurn" && state.phase !== "cpuTurn") {
    return { ok: false, reason: "今はカードを出せません" };
  }
  const move = getMoveType(cards);
  if (!move.ok) return move;
  if (!state.currentField) return { ok: true, move };
  const comparison = compareMove(move, state.currentField);
  return comparison.ok ? { ok: true, move } : comparison;
}

function getLegalMoves(player, state = gameState) {
  if (player.finished) return [];
  const grouped = groupByValue(player.hand);
  const moves = [];
  const targetCounts = state.currentField ? [state.currentField.count] : [1, 2, 3, 4];
  targetCounts.forEach((count) => {
    grouped.forEach((cards) => {
      if (cards.length >= count) {
        const move = getMoveType(cards.slice(0, count));
        if (move.ok && (!state.currentField || compareMove(move, state.currentField).ok)) {
          moves.push(move);
        }
      }
    });
  });
  return moves.sort((a, b) => a.count - b.count || a.value - b.value);
}

function compareMove(move, currentField) {
  if (!currentField) return { ok: true };
  if (move.count !== currentField.count) {
    return { ok: false, reason: `現在の場は${currentField.label}です` };
  }
  if (move.value <= currentField.value) {
    return { ok: false, reason: "場のカードより強いカードを出してください" };
  }
  return { ok: true };
}

function groupByValue(cards) {
  const map = new Map();
  cards.forEach((card) => {
    if (!map.has(card.value)) map.set(card.value, []);
    map.get(card.value).push(card);
  });
  return [...map.values()].map((group) => sortHand(group));
}

// ターン進行
function beginPlayAfterSetup() {
  resetPasses();
  const starter = getRoundStarter();
  gameState.currentPlayerIndex = starter;
  gameState.phase = gameState.players[starter].isHuman ? "playerTurn" : "cpuTurn";
  addLog(`${gameState.players[starter].name}から始まります`);
  render();
  if (!gameState.players[starter].isHuman) handleCpuTurn();
}

function getRoundStarter() {
  if (gameState.round > 1) {
    const daihinmin = gameState.players.find((player) => player.role === "大貧民");
    if (daihinmin) return daihinmin.id;
  }
  const holder = gameState.players.find((player) =>
    player.hand.some((card) => card.rank === "3" && card.suit === "♦")
  );
  return holder ? holder.id : 0;
}

function nextTurn() {
  if (checkRoundEnd()) return;
  if (clearFieldIfNeeded()) return;
  const next = findNextActivePlayer(gameState.currentPlayerIndex);
  if (next === -1) {
    finishRound();
    return;
  }
  gameState.currentPlayerIndex = next;
  gameState.phase = gameState.players[next].isHuman ? "playerTurn" : "cpuTurn";
  gameState.loopGuard += 1;
  if (gameState.loopGuard > 500) {
    console.error("ターン進行が異常に長く続いたため停止しました", snapshotForDebug());
    finishRound();
    return;
  }
  render();
  if (!gameState.players[next].isHuman) handleCpuTurn();
}

function findNextActivePlayer(fromIndex) {
  for (let step = 1; step <= gameState.players.length; step += 1) {
    const index = (fromIndex + step) % gameState.players.length;
    if (!gameState.players[index].finished) return index;
  }
  return -1;
}

function handlePlayerPlay() {
  const player = gameState.players[0];
  const cards = getSelectedCards(player);
  const legality = isLegalMove(cards);
  if (!legality.ok || gameState.currentPlayerIndex !== 0) {
    renderHand();
    return;
  }
  applyMove(player, legality.move);
  gameState.selectedCardIds.clear();
  render();
  delay(520).then(nextTurn);
}

function handlePlayerPass() {
  if (gameState.phase !== "playerTurn" || gameState.currentPlayerIndex !== 0) return;
  const player = gameState.players[0];
  if (!gameState.currentField) {
    addLog("場が空なのでパスできません");
    return;
  }
  player.passed = true;
  gameState.selectedCardIds.clear();
  addLog("あなたがパスしました");
  render();
  delay(420).then(nextTurn);
}

function handleCpuTurn() {
  const token = gameState.actionToken;
  const player = gameState.players[gameState.currentPlayerIndex];
  if (!player || player.isHuman || player.finished) return;
  const wait = randomDelay();
  render();
  delay(wait).then(() => {
    if (token !== gameState.actionToken || gameState.phase !== "cpuTurn") return;
    const legalMoves = getLegalMoves(player);
    if (shouldCpuPass(player, gameState, legalMoves)) {
      player.passed = true;
      addLog(`${player.name} がパスしました`);
    } else {
      const move = chooseCpuMove(player, gameState);
      if (!move || !isLegalMove(move.cards, gameState).ok) {
        console.error("CPUが合法手を選べませんでした", player, legalMoves, snapshotForDebug());
        player.passed = true;
        addLog(`${player.name} がパスしました`);
      } else {
        applyMove(player, move);
      }
    }
    render();
    return delay(Math.min(650, wait * 0.55));
  }).then(() => {
    if (token !== gameState.actionToken) return;
    nextTurn();
  });
}

function clearFieldIfNeeded() {
  if (!gameState.currentField || gameState.lastPlayedBy === null) return false;
  const active = gameState.players.filter((player) => !player.finished);
  if (active.length <= 1) return false;
  const everyoneElsePassed = active
    .filter((player) => player.id !== gameState.lastPlayedBy)
    .every((player) => player.passed);
  if (!everyoneElsePassed) return false;
  gameState.phase = "fieldClear";
  addLog("場が流れました");
  gameState.playedCards.push(...gameState.currentField.cards);
  gameState.currentField = null;
  resetPasses();
  const parent = gameState.players[gameState.lastPlayedBy];
  if (parent && !parent.finished) {
    gameState.currentPlayerIndex = parent.id;
  } else {
    const next = findNextActivePlayer(gameState.lastPlayedBy);
    gameState.currentPlayerIndex = next === -1 ? 0 : next;
  }
  render();
  delay(820).then(() => {
    if (checkRoundEnd()) return;
    const current = gameState.players[gameState.currentPlayerIndex];
    gameState.phase = current.isHuman ? "playerTurn" : "cpuTurn";
    render();
    if (!current.isHuman) handleCpuTurn();
  });
  return true;
}

function applyMove(player, move) {
  const ids = new Set(move.cards.map((card) => card.id));
  if (gameState.currentField) {
    gameState.playedCards.push(...gameState.currentField.cards);
  }
  player.hand = player.hand.filter((card) => !ids.has(card.id));
  player.passed = false;
  gameState.currentField = {
    cards: move.cards,
    type: move.type,
    label: move.label,
    count: move.count,
    value: move.value,
    playerId: player.id
  };
  gameState.lastPlayedBy = player.id;
  resetOtherPassesAfterPlay(player.id);
  addLog(`${player.name} が ${formatCards(move.cards)} を出しました`);
  if (player.hand.length === 0) {
    markFinished(player);
  }
  validateCardIntegrity("applyMove");
}

function resetOtherPassesAfterPlay(playerId) {
  gameState.players.forEach((player) => {
    if (player.id === playerId) player.passed = false;
  });
}

function resetPasses() {
  gameState.players.forEach((player) => {
    player.passed = false;
  });
}

function markFinished(player) {
  if (player.finished) return;
  player.finished = true;
  player.passed = false;
  gameState.ranking.push(player.id);
  player.place = gameState.ranking.length;
  addLog(`${player.name} が上がりました。現在 ${player.place}位`);
  checkRoundEnd();
}

function checkRoundEnd() {
  const active = gameState.players.filter((player) => !player.finished);
  if (active.length > 1) return false;
  if (active.length === 1 && !gameState.ranking.includes(active[0].id)) {
    gameState.ranking.push(active[0].id);
    active[0].finished = true;
    active[0].place = gameState.ranking.length;
    addLog(`${active[0].name} は${active[0].place}位です`);
  }
  if (gameState.ranking.length === gameState.players.length) {
    finishRound();
    return true;
  }
  return false;
}

// CPU
function chooseCpuMove(player, state = gameState) {
  const legalMoves = getLegalMoves(player, state);
  if (legalMoves.length === 0) return null;
  const scored = legalMoves.map((move) => ({
    move,
    score: scoreCpuMove(move, player, state) + Math.random() * 3
  })).sort((a, b) => b.score - a.score);
  return scored[0].move;
}

function scoreCpuMove(move, player, state = gameState) {
  const remaining = player.hand.length - move.count;
  const strongestOpponentLow = state.players.some((p) => p.id !== player.id && !p.finished && p.hand.length <= 2);
  let score = 0;
  score += move.count * 24;
  score -= move.value * 1.4;
  score -= breaksSetPenalty(move, player) * 12;
  if (state.currentField) score += (20 - (move.value - state.currentField.value) * 3);
  if (remaining === 0) score += 500;
  if (remaining <= 2) score += 55 - move.value;
  if (strongestOpponentLow && move.value >= 13) score += 28;
  if (!state.currentField && move.count >= 2) score += 22;
  if (move.value >= 14 && player.hand.length > 5) score -= 32;
  return score;
}

function shouldCpuPass(player, state = gameState, legalMoves = getLegalMoves(player, state)) {
  if (!state.currentField) return false;
  if (legalMoves.length === 0) return true;
  if (legalMoves.some((move) => player.hand.length - move.count === 0)) return false;
  const best = legalMoves.reduce((top, move) =>
    scoreCpuMove(move, player, state) > scoreCpuMove(top, player, state) ? move : top
  );
  const hasDangerOpponent = state.players.some((p) => p.id !== player.id && !p.finished && p.hand.length <= 2);
  if (hasDangerOpponent) return false;
  if (best.value >= 14 && player.hand.length > 4) return Math.random() < 0.68;
  return false;
}

function breaksSetPenalty(move, player) {
  const same = player.hand.filter((card) => card.value === move.value).length;
  return Math.max(0, same - move.count);
}

// 役職・カード交換
function assignRanks() {
  gameState.ranking.forEach((playerId, index) => {
    const player = gameState.players[playerId];
    player.role = ROLE_BY_PLACE[index];
    player.place = index + 1;
  });
  gameState.previousRoles = Object.fromEntries(gameState.players.map((p) => [p.id, p.role]));
}

function prepareCardExchange() {
  if (gameState.round === 1 || !gameState.previousRoles) return false;
  const daifugo = playerByRole("大富豪");
  const fugo = playerByRole("富豪");
  const hinmin = playerByRole("貧民");
  const daihinmin = playerByRole("大貧民");
  const exchanges = [];
  if (daifugo && daihinmin) exchanges.push({ rich: daifugo.id, poor: daihinmin.id, count: 2 });
  if (fugo && hinmin) exchanges.push({ rich: fugo.id, poor: hinmin.id, count: 1 });
  if (!exchanges.length) return false;

  const humanRich = exchanges.find((item) => item.rich === 0);
  gameState.exchange = {
    pending: exchanges,
    humanNeedsChoice: humanRich || null,
    autoGiven: []
  };

  exchanges.forEach((item) => {
    const poor = gameState.players[item.poor];
    const cards = takeStrongestCards(poor, item.count);
    gameState.exchange.autoGiven.push({ from: poor.id, to: item.rich, cards });
  });

  if (humanRich) {
    gameState.phase = "exchange";
    addLog(`カード交換: ${gameState.players[humanRich.poor].name}から強いカード${humanRich.count}枚を受け取ります`);
    render();
    return true;
  }

  completeExchangeWithRichChoices();
  return false;
}

function handleCardExchange() {
  if (gameState.phase !== "exchange" || !gameState.exchange?.humanNeedsChoice) return;
  const need = gameState.exchange.humanNeedsChoice.count;
  const selected = getSelectedCards(gameState.players[0]);
  if (selected.length !== need) return;
  gameState.exchange.richGiven = [{ from: 0, to: gameState.exchange.humanNeedsChoice.poor, cards: selected }];
  removeCardsFromPlayer(gameState.players[0], selected);
  completeExchangeWithRichChoices();
}

function completeExchangeWithRichChoices() {
  const richGiven = gameState.exchange.richGiven || [];
  gameState.exchange.pending.forEach((item) => {
    if (item.rich === 0 && richGiven.some((gift) => gift.from === 0)) return;
    const rich = gameState.players[item.rich];
    const cards = chooseExchangeCardsForCpu(rich, item.count);
    removeCardsFromPlayer(rich, cards);
    richGiven.push({ from: rich.id, to: item.poor, cards });
  });

  [...gameState.exchange.autoGiven, ...richGiven].forEach((gift) => {
    gameState.players[gift.to].hand.push(...gift.cards);
    sortHand(gameState.players[gift.to].hand);
    addLog(`${gameState.players[gift.from].name} から ${gameState.players[gift.to].name} へ ${formatCards(gift.cards)} を渡しました`);
  });

  gameState.exchange.richGiven = richGiven;
  gameState.selectedCardIds.clear();
  validateCardIntegrity("exchange");
  render();
  delay(1000).then(beginPlayAfterSetup);
}

function takeStrongestCards(player, count) {
  const cards = [...player.hand].sort((a, b) => b.value - a.value || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)).slice(0, count);
  removeCardsFromPlayer(player, cards);
  return cards;
}

function chooseExchangeCardsForCpu(player, count) {
  const groupedSizes = new Map(groupByValue(player.hand).map((group) => [group[0].value, group.length]));
  return [...player.hand]
    .sort((a, b) => {
      const setPenalty = groupedSizes.get(a.value) - groupedSizes.get(b.value);
      return (a.value - b.value) || setPenalty || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    })
    .slice(0, count);
}

function removeCardsFromPlayer(player, cards) {
  const ids = new Set(cards.map((card) => card.id));
  player.hand = player.hand.filter((card) => !ids.has(card.id));
}

function playerByRole(role) {
  return gameState.players.find((player) => player.role === role);
}

// 描画
function render() {
  els.titleScreen.classList.toggle("is-hidden", gameState.phase !== "title");
  els.gameScreen.classList.toggle("is-hidden", gameState.phase === "title");
  els.roundNumber.textContent = String(gameState.round || 1);
  els.stateTitle.textContent = phaseLabel();
  els.skipDealButton.classList.toggle("is-hidden", gameState.phase !== "dealing");
  els.exchangePanel.classList.toggle("is-hidden", gameState.phase !== "exchange");
  els.resultPanel.classList.toggle("is-hidden", gameState.phase !== "roundResult");
  renderPlayers();
  renderField();
  renderHand();
  renderLog();
  renderResult();
  renderExchange();
  renderDebug();
}

function renderPlayers() {
  els.playersArea.innerHTML = "";
  gameState.players.forEach((player) => {
    const seat = document.createElement("article");
    seat.className = `player-seat seat-${player.id}`;
    seat.classList.toggle("is-turn", gameState.currentPlayerIndex === player.id && ["playerTurn", "cpuTurn"].includes(gameState.phase));
    seat.classList.toggle("is-passed", player.passed);
    seat.classList.toggle("is-finished", player.finished);
    seat.innerHTML = `
      <div class="seat-top">
        <span class="player-name">${player.name}</span>
        <span class="role-badge">${player.role || "平民"}</span>
      </div>
      <div class="seat-info">
        <span class="status-chip">手札 ${player.hand.length}</span>
        ${player.passed ? '<span class="status-chip">パス</span>' : ""}
        ${player.finished ? `<span class="status-chip">${player.place}位</span>` : ""}
      </div>
      <div class="seat-info">${player.isHuman ? "あなた" : "CPU"}</div>
    `;
    els.playersArea.appendChild(seat);
  });
}

function renderField() {
  const current = gameState.players[gameState.currentPlayerIndex];
  const thinking = gameState.phase === "cpuTurn" ? " 考え中..." : "";
  els.turnBanner.textContent = current ? `${current.name}の番です${thinking}` : "ラウンド終了";
  if (gameState.phase === "fieldClear") els.turnBanner.textContent = "場が流れました";
  if (gameState.phase === "dealing") els.turnBanner.textContent = "カードを配っています";
  if (gameState.phase === "exchange") els.turnBanner.textContent = "カード交換中";
  els.fieldType.textContent = `場: ${gameState.currentField ? gameState.currentField.label : "なし"}`;
  els.lastMove.textContent = gameState.currentField
    ? `直前: ${gameState.players[gameState.currentField.playerId].name} ${formatCards(gameState.currentField.cards)}`
    : "直前: なし";
  els.fieldCards.innerHTML = "";
  (gameState.currentField?.cards || []).forEach((card) => {
    els.fieldCards.appendChild(cardElement(card));
  });
}

function renderHand() {
  const player = gameState.players[0];
  if (!player) {
    els.playerHand.innerHTML = "";
    els.selectionStatus.textContent = "ゲーム開始を押してください";
    els.illegalReason.textContent = "";
    els.playButton.disabled = true;
    els.passButton.disabled = true;
    els.clearSelectionButton.disabled = true;
    return;
  }
  const isPlayerTurn = gameState.phase === "playerTurn" && gameState.currentPlayerIndex === 0;
  const isExchange = gameState.phase === "exchange" && gameState.exchange?.humanNeedsChoice;
  els.handPanel.classList.toggle("is-active", isPlayerTurn);
  els.playerHand.innerHTML = "";
  const playableIds = playableCardIds(player);
  player.hand.forEach((card) => {
    const cardNode = cardElement(card);
    const selected = gameState.selectedCardIds.has(card.id);
    cardNode.classList.toggle("is-selected", selected);
    cardNode.classList.toggle("is-playable", isPlayerTurn && playableIds.has(card.id));
    cardNode.classList.toggle("is-dim", isPlayerTurn && !playableIds.has(card.id));
    if (isPlayerTurn || isExchange) {
      cardNode.addEventListener("click", () => toggleCardSelection(card.id));
    }
    els.playerHand.appendChild(cardNode);
  });

  const selected = getSelectedCards(player);
  const legality = isPlayerTurn ? isLegalMove(selected) : { ok: false, reason: isExchange ? "" : "自分の番ではありません" };
  if (isExchange) {
    const need = gameState.exchange.humanNeedsChoice.count;
    els.selectionStatus.textContent = `${need}枚選んで交換してください（選択中 ${selected.length}枚）`;
    els.illegalReason.textContent = selected.length === need ? "" : `必要枚数は${need}枚です`;
    els.exchangeButton.disabled = selected.length !== need;
  } else {
    els.selectionStatus.textContent = selected.length ? `選択中: ${formatCards(selected)}` : "カードを選択してください";
    els.illegalReason.textContent = selected.length && !legality.ok ? legality.reason : "";
  }
  els.playButton.disabled = !(isPlayerTurn && selected.length && legality.ok);
  els.passButton.disabled = !(isPlayerTurn && gameState.currentField);
  els.clearSelectionButton.disabled = !selected.length;
}

function renderLog() {
  els.logList.innerHTML = "";
  gameState.logs.slice(0, 10).forEach((log) => {
    const li = document.createElement("li");
    li.textContent = log;
    els.logList.appendChild(li);
  });
}

function renderResult() {
  if (gameState.phase !== "roundResult") return;
  els.resultList.innerHTML = "";
  gameState.ranking.forEach((playerId, index) => {
    const player = gameState.players[playerId];
    const row = document.createElement("div");
    row.className = "result-row";
    const change = player.oldRole === player.role ? "変化なし" : `${player.oldRole} → ${player.role}`;
    row.innerHTML = `<strong>${index + 1}位</strong><span>${player.name}</span><span>${player.role}（${change}）</span>`;
    els.resultList.appendChild(row);
  });
}

function renderExchange() {
  if (gameState.phase !== "exchange" || !gameState.exchange?.humanNeedsChoice) return;
  const item = gameState.exchange.humanNeedsChoice;
  const poorGift = gameState.exchange.autoGiven.find((gift) => gift.to === 0);
  els.exchangeInfo.textContent = `${gameState.players[item.poor].name}へ渡すカードを${item.count}枚選んでください。受け取るカード: ${poorGift ? formatCards(poorGift.cards) : ""}`;
  els.exchangeGiven.innerHTML = "";
  (poorGift?.cards || []).forEach((card) => els.exchangeGiven.appendChild(cardElement(card)));
}

function renderDebug() {
  const counts = gameState.players.map((p) => `${p.name}:${p.hand.length}`).join(" / ");
  els.debugInfo.textContent = [
    `state: ${gameState.phase}`,
    `turn: ${gameState.players[gameState.currentPlayerIndex]?.name || "-"}`,
    `field: ${gameState.currentField?.label || "none"}`,
    `lastPlayedBy: ${gameState.lastPlayedBy === null ? "-" : gameState.players[gameState.lastPlayedBy].name}`,
    `hands: ${counts}`
  ].join("\n");
}

function cardElement(card) {
  const div = document.createElement("button");
  div.type = "button";
  div.className = `card ${["♥", "♦"].includes(card.suit) ? "red" : ""}`;
  div.dataset.corner = `${card.rank}${card.suit}`;
  div.textContent = `${card.rank}${card.suit}`;
  return div;
}

// 保存
function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { ...defaultStats(), ...(raw ? JSON.parse(raw) : {}) };
  } catch (error) {
    console.error("戦績の読み込みに失敗しました", error);
    return defaultStats();
  }
}

function saveStats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState.stats));
}

function defaultStats() {
  return {
    playCount: 0,
    firstPlaceCount: 0,
    daifugoCount: 0,
    daifugoStreak: 0,
    bestDaifugoStreak: 0,
    lastPlayedAt: "",
    cpuSpeed: "normal"
  };
}

function renderStats() {
  const stats = gameState.stats;
  const rows = [
    ["プレイ回数", stats.playCount],
    ["1位回数", stats.firstPlaceCount],
    ["大富豪回数", stats.daifugoCount],
    ["連続大富豪", stats.daifugoStreak],
    ["最高連続大富豪", stats.bestDaifugoStreak],
    ["最終プレイ", stats.lastPlayedAt || "-"]
  ];
  els.statsList.innerHTML = rows.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join("");
}

function renderSpeedSettings() {
  const input = document.querySelector(`input[name='speed'][value='${gameState.cpuSpeed}']`);
  if (input) input.checked = true;
}

// 演出・補助
function playDealingAnimation(onDone) {
  clearDealTimers();
  els.dealAnimationLayer.innerHTML = "";
  const seats = [0, 1, 2, 3, 4];
  const total = 28;
  for (let i = 0; i < total; i += 1) {
    const timer = setTimeout(() => {
      const card = document.createElement("div");
      card.className = "deal-card";
      const target = seats[i % seats.length];
      const dx = [0, -250, 0, 250, 210][target];
      const dy = [145, 10, -150, 10, 130][target];
      card.style.setProperty("--dx", `${dx}px`);
      card.style.setProperty("--dy", `${dy}px`);
      card.style.setProperty("--rot", `${(Math.random() * 90 - 45).toFixed(1)}deg`);
      els.dealAnimationLayer.appendChild(card);
      setTimeout(() => card.remove(), 650);
    }, i * 55);
    gameState.dealingTimerIds.push(timer);
  }
  gameState.dealingTimerIds.push(setTimeout(onDone, 1900));
}

function finishDealingAnimation() {
  if (gameState.phase !== "dealing") return;
  clearDealTimers();
  els.dealAnimationLayer.innerHTML = "";
  if (prepareCardExchange()) return;
  beginPlayAfterSetup();
}

function clearDealTimers() {
  gameState.dealingTimerIds.forEach((id) => clearTimeout(id));
  gameState.dealingTimerIds = [];
}

function showTitle() {
  clearDealTimers();
  renderStats();
  renderSpeedSettings();
  render();
}

function showGame() {
  els.titleScreen.classList.add("is-hidden");
  els.gameScreen.classList.remove("is-hidden");
}

function finishRound() {
  if (gameState.phase === "roundResult") return;
  if (gameState.currentField) {
    gameState.playedCards.push(...gameState.currentField.cards);
    gameState.currentField = null;
  }
  assignRanks();
  updateStatsAfterRound();
  gameState.phase = "roundResult";
  addLog(`あなたは${gameState.players[0].role}になりました`);
  validateCardIntegrity("finishRound");
  render();
}

function updateStatsAfterRound() {
  const human = gameState.players[0];
  gameState.stats.playCount += 1;
  if (human.place === 1) gameState.stats.firstPlaceCount += 1;
  if (human.role === "大富豪") {
    gameState.stats.daifugoCount += 1;
    gameState.stats.daifugoStreak += 1;
    gameState.stats.bestDaifugoStreak = Math.max(gameState.stats.bestDaifugoStreak, gameState.stats.daifugoStreak);
  } else {
    gameState.stats.daifugoStreak = 0;
  }
  gameState.stats.lastPlayedAt = new Date().toLocaleString("ja-JP");
  gameState.stats.cpuSpeed = gameState.cpuSpeed;
  saveStats();
  renderStats();
}

function toggleCardSelection(cardId) {
  if (gameState.selectedCardIds.has(cardId)) {
    gameState.selectedCardIds.delete(cardId);
  } else {
    gameState.selectedCardIds.add(cardId);
  }
  renderHand();
}

function getSelectedCards(player) {
  return sortHand(player.hand.filter((card) => gameState.selectedCardIds.has(card.id)));
}

function playableCardIds(player) {
  const ids = new Set();
  if (gameState.phase !== "playerTurn" || gameState.currentPlayerIndex !== player.id) return ids;
  if (!gameState.currentField) {
    player.hand.forEach((card) => ids.add(card.id));
    return ids;
  }
  const need = gameState.currentField.count;
  groupByValue(player.hand).forEach((group) => {
    if (group.length >= need && group[0].value > gameState.currentField.value) {
      group.forEach((card) => ids.add(card.id));
    }
  });
  return ids;
}

function phaseLabel() {
  return {
    title: "タイトル",
    dealing: "配布中",
    exchange: "カード交換",
    playerTurn: "あなたの番",
    cpuTurn: "CPUの番",
    fieldClear: "場流し",
    roundResult: "結果"
  }[gameState.phase] || gameState.phase;
}

function fieldCardsFlat() {
  return gameState.currentField?.cards || [];
}

function validateCardIntegrity(context, allowPlayedGone = false) {
  const visible = gameState.players
    .flatMap((player) => player.hand)
    .concat(fieldCardsFlat())
    .concat(gameState.playedCards);
  const ids = visible.map((card) => card.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    console.error(`カード重複を検出しました: ${context}`, ids.filter((id, index) => ids.indexOf(id) !== index), snapshotForDebug());
  }
  if (!allowPlayedGone && ids.length !== 52) {
    console.error(`カード総数が52枚ではありません: ${context}`, ids.length, snapshotForDebug());
  }
  if (!allowPlayedGone && unique.size !== 52) {
    console.error(`未知のカード数異常: ${context}`, snapshotForDebug());
  }
}

function snapshotForDebug() {
  return {
    phase: gameState.phase,
    currentPlayerIndex: gameState.currentPlayerIndex,
    currentField: gameState.currentField,
    lastPlayedBy: gameState.lastPlayedBy,
    players: gameState.players.map((p) => ({
      id: p.id,
      name: p.name,
      hand: p.hand.map((card) => card.id),
      passed: p.passed,
      finished: p.finished,
      role: p.role,
      place: p.place
    }))
  };
}

function addLog(message) {
  gameState.logs.unshift(message);
  gameState.logs = gameState.logs.slice(0, 40);
}

function formatCards(cards) {
  return cards.map((card) => `${card.rank}${card.suit}`).join(" ");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  const speed = CPU_SPEEDS[gameState.cpuSpeed] || CPU_SPEEDS.normal;
  return Math.round(speed.min + Math.random() * (speed.max - speed.min));
}
