"use strict";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const DAIFUGO_ORDER = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const STORAGE_KEY = "offlineTrumpStats.v1";
const app = document.getElementById("app");
const pageTitle = document.getElementById("pageTitle");
const homeButton = document.getElementById("homeButton");
const restartButton = document.getElementById("restartButton");

let currentGame = null;
let state = {};
let timers = [];

const games = {
  poker: { name: "ドローポーカー", desc: "5枚をホールドして一度だけ交換。役とスコアを狙う一人用ゲーム。", tags: ["一人用", "役判定", "短時間"] },
  memory: { name: "神経衰弱", desc: "CPUは見たカードを記憶。ペアを探して獲得数で勝負します。", tags: ["CPU対戦", "記憶AI", "スコア"] },
  oldmaid: { name: "ババ抜き", desc: "CPU3人とジョーカーを押し付け合う定番ゲーム。最後まで自動進行します。", tags: ["4人戦", "ジョーカー", "順位"] },
  sevens: { name: "七並べ", desc: "7を中心にスートごとの列を伸ばす戦略ゲーム。CPUは場の広げ方を評価します。", tags: ["4人戦", "パス", "評価CPU"] },
  daifugo: { name: "大富豪", desc: "1枚・ペア・3枚組・4枚組対応の簡易大富豪。CPUは候補手を採点します。", tags: ["4人戦", "場流し", "強めCPU"] }
};

homeButton.addEventListener("click", showHome);
restartButton.addEventListener("click", () => currentGame && startGame(currentGame));

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function delay(fn, ms = 700) {
  const id = setTimeout(fn, ms);
  timers.push(id);
}

function createDeck(includeJoker = false) {
  const deck = [];
  SUITS.forEach(suit => RANKS.forEach((rank, index) => {
    deck.push({ suit, rank, value: index + 1, id: `${suit}${rank}` });
  }));
  if (includeJoker) deck.push({ suit: "", rank: "JOKER", value: 99, joker: true, id: "JOKER" });
  return deck;
}

function shuffle(cards) {
  const copy = cards.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function deal(deck, count, players) {
  const hands = Array.from({ length: players }, () => []);
  for (let i = 0; i < count && deck.length; i++) hands[i % players].push(deck.shift());
  return hands;
}

function sortCards(cards, order = RANKS) {
  return cards.slice().sort((a, b) => {
    if (a.joker) return 1;
    if (b.joker) return -1;
    const rankDiff = order.indexOf(a.rank) - order.indexOf(b.rank);
    return rankDiff || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  });
}

function cardText(card) {
  return card.joker ? "JOKER" : `${card.rank}${card.suit}`;
}

function isRed(card) {
  return card.suit === "♥" || card.suit === "♦";
}

function makeCard(card, options = {}) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "card";
  if (options.back) {
    el.classList.add("back");
    el.setAttribute("aria-label", "裏向きカード");
    el.innerHTML = "<span></span><span class='suit'>◆</span><span></span>";
  } else {
    if (isRed(card)) el.classList.add("red");
    if (card.joker) el.classList.add("joker");
    el.setAttribute("aria-label", cardText(card));
    el.innerHTML = `<span class="rank">${escapeHtml(card.rank)}</span><span class="suit">${escapeHtml(card.joker ? "★" : card.suit)}</span><span class="mini">${escapeHtml(card.rank)}</span>`;
  }
  if (options.click) {
    el.classList.add("clickable");
    el.addEventListener("click", options.click);
  } else {
    el.disabled = true;
  }
  if (options.selected) el.classList.add("selected");
  if (options.held) {
    el.classList.add("held");
    el.insertAdjacentHTML("beforeend", "<span class='hold-label'>HOLD</span>");
  }
  if (options.dim) el.classList.add("dim");
  return el;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[s]));
}

function stats() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function saveStats(game, result) {
  const all = stats();
  const item = all[game] || { plays: 0, wins: 0, best: 0, last: "" };
  item.plays += 1;
  if (result.win) item.wins += 1;
  item.best = Math.max(item.best || 0, result.score || 0);
  item.last = new Date().toLocaleString("ja-JP");
  all[game] = item;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function addLog(text) {
  state.logs = [text, ...(state.logs || [])].slice(0, 10);
}

function renderShell(rule, bodyRenderer, controlsRenderer) {
  pageTitle.textContent = games[currentGame].name;
  homeButton.classList.remove("hidden");
  restartButton.classList.remove("hidden");
  app.innerHTML = `
    <section class="game-panel">
      <div class="game-head">
        <div><h2>${games[currentGame].name}</h2><p>${rule}</p></div>
        <div class="message" id="message">${state.message || ""}</div>
      </div>
      <div class="table-layout">
        <div class="play-area">
          <div id="status" class="status-grid"></div>
          <div id="board"></div>
          <div id="controls" class="control-row"></div>
        </div>
        <aside class="side-panel">
          <div class="status-box"><span>行動ログ</span><ul id="logList" class="log-list"></ul></div>
        </aside>
      </div>
    </section>`;
  bodyRenderer(document.getElementById("board"), document.getElementById("status"));
  controlsRenderer(document.getElementById("controls"));
  renderLogs();
}

function renderLogs() {
  const list = document.getElementById("logList");
  if (!list) return;
  list.innerHTML = (state.logs || []).map(log => `<li>${escapeHtml(log)}</li>`).join("");
}

function showHome() {
  clearTimers();
  currentGame = null;
  pageTitle.textContent = "オフライン トランプゲーム集";
  homeButton.classList.add("hidden");
  restartButton.classList.add("hidden");
  const all = stats();
  app.innerHTML = `
    <section class="top-intro">
      <div class="hero-panel">
        <p class="eyebrow">GitHub Pages Ready</p>
        <h2>置くだけで遊べる、ブラウザ完結のカードテーブル。</h2>
        <p>通信なし、外部APIなし、ビルドなし。スマホでもPCでも、5種類のトランプゲームをそのまま遊べます。</p>
      </div>
      <div class="stats-panel">
        <h2>戦績</h2>
        <div class="stats-grid">${Object.keys(games).map(key => statHtml(key, all[key])).join("")}</div>
      </div>
    </section>
    <section class="game-grid">
      ${Object.entries(games).map(([key, game]) => `
        <article class="game-card">
          <h2>${game.name}</h2>
          <p>${game.desc}</p>
          <ul class="tags">${game.tags.map(tag => `<li>${tag}</li>`).join("")}</ul>
          <button class="primary-button" type="button" data-game="${key}">遊ぶ</button>
        </article>`).join("")}
    </section>`;
  document.querySelectorAll("[data-game]").forEach(btn => btn.addEventListener("click", () => startGame(btn.dataset.game)));
}

function statHtml(key, item = {}) {
  return `<div class="stat-box"><span>${games[key].name}</span><strong>${item.plays || 0}戦 / ${item.wins || 0}勝</strong><span>最高 ${item.best || 0} / ${item.last || "未プレイ"}</span></div>`;
}

function startGame(key) {
  clearTimers();
  currentGame = key;
  state = { logs: [], message: "" };
  ({ poker: initPoker, memory: initMemory, oldmaid: initOldMaid, sevens: initSevens, daifugo: initDaifugo }[key])();
}

function showResult(title, rows, result) {
  saveStats(currentGame, result);
  pageTitle.textContent = `${games[currentGame].name} 結果`;
  app.innerHTML = `
    <section class="result-panel">
      <p class="eyebrow">Result</p>
      <h2>${title}</h2>
      <div class="rank-grid">${rows.map(row => `<div class="rank-box">${row}</div>`).join("")}</div>
      <div class="result-actions">
        <button class="primary-button" id="again" type="button">もう一度遊ぶ</button>
        <button class="ghost-button" id="home2" type="button">トップへ戻る</button>
      </div>
    </section>`;
  document.getElementById("again").addEventListener("click", () => startGame(currentGame));
  document.getElementById("home2").addEventListener("click", showHome);
}

function initPoker() {
  state.deck = shuffle(createDeck(false));
  state.hand = sortCards(state.deck.splice(0, 5));
  state.held = new Set();
  state.exchanged = false;
  addLog("5枚配りました。残すカードを選んでください。");
  renderPoker();
}

function renderPoker() {
  renderShell("5枚から残すカードをタップしてHOLD。一度だけ交換すると役を判定します。", (board, status) => {
    status.innerHTML = `<div class="status-box"><span>交換</span><strong>${state.exchanged ? "完了" : "未実行"}</strong></div>`;
    const row = document.createElement("div");
    row.className = "card-row";
    state.hand.forEach((card, i) => row.appendChild(makeCard(card, { held: state.held.has(i), click: state.exchanged ? null : () => { state.held.has(i) ? state.held.delete(i) : state.held.add(i); renderPoker(); } })));
    board.appendChild(row);
  }, controls => {
    controls.innerHTML = `<button class="primary-button" id="exchange" type="button" ${state.exchanged ? "disabled" : ""}>交換</button>`;
    document.getElementById("exchange").addEventListener("click", exchangePoker);
  });
}

function exchangePoker() {
  state.hand = state.hand.map((card, i) => state.held.has(i) ? card : state.deck.shift());
  state.hand = sortCards(state.hand);
  state.exchanged = true;
  const hand = judgePoker(state.hand);
  addLog(`結果は ${hand.name}。${hand.score}点です。`);
  showResult(hand.name, [`<strong>スコア</strong><br>${hand.score}`, `<strong>手札</strong><br>${state.hand.map(cardText).join(" ")}`], { win: hand.score >= 20, score: hand.score });
}

function judgePoker(hand) {
  const counts = countBy(hand, "rank");
  const values = hand.map(c => c.value).sort((a, b) => a - b);
  const groups = Object.values(counts).sort((a, b) => b - a);
  const flush = hand.every(c => c.suit === hand[0].suit);
  const straight = values.every((v, i) => i === 0 || v === values[i - 1] + 1) || values.join(",") === "1,10,11,12,13";
  if (flush && values.join(",") === "1,10,11,12,13") return { name: "ロイヤルストレートフラッシュ", score: 800 };
  if (flush && straight) return { name: "ストレートフラッシュ", score: 500 };
  if (groups[0] === 4) return { name: "フォーカード", score: 250 };
  if (groups[0] === 3 && groups[1] === 2) return { name: "フルハウス", score: 120 };
  if (flush) return { name: "フラッシュ", score: 80 };
  if (straight) return { name: "ストレート", score: 60 };
  if (groups[0] === 3) return { name: "スリーカード", score: 35 };
  if (groups[0] === 2 && groups[1] === 2) return { name: "ツーペア", score: 20 };
  if (groups[0] === 2) return { name: "ワンペア", score: 10 };
  return { name: "ハイカード", score: Math.max(...values) };
}

function countBy(cards, prop) {
  return cards.reduce((acc, card) => { acc[card[prop]] = (acc[card[prop]] || 0) + 1; return acc; }, {});
}

function initMemory() {
  const deck = shuffle(RANKS.slice(0, 12).flatMap(rank => [
    { suit: "♠", rank, value: RANKS.indexOf(rank) + 1, id: `m${rank}a` },
    { suit: "♥", rank, value: RANKS.indexOf(rank) + 1, id: `m${rank}b` }
  ]));
  state.cards = shuffle(deck.map((card, i) => ({ ...card, mid: `${card.rank}-${i}`, open: false, taken: false })));
  state.turn = 0;
  state.scores = [0, 0];
  state.flipped = [];
  state.cpuMemory = {};
  state.lock = false;
  addLog("神経衰弱を開始しました。");
  renderMemory();
}

function renderMemory() {
  renderShell("同じ数字を2枚めくると獲得。CPUは見たカードを高めの確率で記憶します。", (board, status) => {
    status.innerHTML = `<div class="status-box"><span>ターン</span><strong>${state.turn === 0 ? "あなた" : "CPU"}</strong></div><div class="status-box"><span>ペア数</span><strong>あなた ${state.scores[0]} / CPU ${state.scores[1]}</strong></div>`;
    const grid = document.createElement("div");
    grid.className = "memory-grid";
    state.cards.forEach((card, i) => grid.appendChild(makeCard(card, { back: !card.open && !card.taken, dim: card.taken, click: state.turn === 0 && !state.lock && !card.open && !card.taken ? () => flipMemory(i) : null })));
    board.appendChild(grid);
  }, () => {});
  if (state.turn === 1 && !state.lock) delay(cpuMemoryTurn, 700);
}

function flipMemory(index) {
  const card = state.cards[index];
  card.open = true;
  rememberCard(index, card);
  state.flipped.push(index);
  addLog(`あなたが ${card.rank} をめくりました。`);
  if (state.flipped.length === 2) resolveMemory();
  renderMemory();
}

function rememberCard(index, card) {
  if (!state.cpuMemory[card.rank]) state.cpuMemory[card.rank] = [];
  if (!state.cpuMemory[card.rank].includes(index) && Math.random() < .82) state.cpuMemory[card.rank].push(index);
}

function resolveMemory() {
  state.lock = true;
  const [a, b] = state.flipped;
  const match = state.cards[a].rank === state.cards[b].rank;
  delay(() => {
    if (match) {
      state.cards[a].taken = state.cards[b].taken = true;
      state.scores[state.turn] += 1;
      addLog(`${state.turn === 0 ? "あなた" : "CPU"}がペアを取りました。`);
    } else {
      state.cards[a].open = state.cards[b].open = false;
      state.turn = 1 - state.turn;
      addLog("ペアではありません。ターン交代です。");
    }
    state.flipped = [];
    state.lock = false;
    if (state.cards.every(c => c.taken)) finishMemory(); else renderMemory();
  }, 800);
}

function chooseMemoryMove() {
  const alive = state.cards.map((c, i) => ({ c, i })).filter(x => !x.c.taken && !x.c.open);
  const known = Object.values(state.cpuMemory).find(list => list.filter(i => !state.cards[i].taken && !state.cards[i].open).length >= 2);
  if (known && Math.random() < .78) return known.filter(i => !state.cards[i].taken && !state.cards[i].open).slice(0, 2);
  return shuffle(alive).slice(0, 2).map(x => x.i);
}

function cpuMemoryTurn() {
  state.lock = true;
  const picks = chooseMemoryMove();
  picks.forEach(i => {
    state.cards[i].open = true;
    rememberCard(i, state.cards[i]);
    state.flipped.push(i);
    addLog(`CPUが ${state.cards[i].rank} をめくりました。`);
  });
  renderMemory();
  resolveMemory();
}

function finishMemory() {
  const win = state.scores[0] >= state.scores[1];
  showResult(win ? "あなたの勝ち" : "CPUの勝ち", [`あなた ${state.scores[0]}ペア`, `CPU ${state.scores[1]}ペア`], { win, score: state.scores[0] * 10 });
}

function initOldMaid() {
  const hands = deal(shuffle(createDeck(true)), 53, 4).map(h => discardPairs(sortCards(h)));
  state.players = ["あなた", "CPU1", "CPU2", "CPU3"].map((name, i) => ({ name, hand: hands[i], out: hands[i].length === 0 }));
  state.turn = 0;
  state.ranks = [];
  addLog("最初のペアを捨てました。");
  renderOldMaid();
}

function discardPairs(hand) {
  const byRank = {};
  hand.forEach(c => { const k = c.joker ? "JOKER" : c.rank; (byRank[k] ||= []).push(c); });
  const rest = [];
  Object.values(byRank).forEach(list => {
    if (list[0].joker) rest.push(...list);
    else if (list.length % 2 === 1) rest.push(list[0]);
  });
  return shuffle(rest);
}

function nextActive(from, step = 1) {
  for (let n = 1; n <= 4; n++) {
    const i = (from + step * n + 4) % 4;
    if (!state.players[i].out) return i;
  }
  return from;
}

function renderOldMaid() {
  renderShell("隣の人から1枚引き、同じ数字のペアは捨てます。最後にジョーカーを持つ人が負けです。", (board, status) => {
    status.innerHTML = state.players.map((p, i) => `<div class="status-box"><span>${p.name}</span><strong>${p.out ? "上がり" : `${p.hand.length}枚`}</strong>${i === state.turn ? "<span>現在のターン</span>" : ""}</div>`).join("");
    const hand = document.createElement("div");
    hand.className = "card-row";
    state.players[0].hand.forEach(card => hand.appendChild(makeCard(card)));
    board.innerHTML = `<h3>あなたの手札</h3>`;
    board.appendChild(hand);
    const cpus = document.createElement("div");
    cpus.className = "card-row";
    state.players.slice(1).forEach(p => cpus.innerHTML += `<div class="status-box"><span>${p.name}</span><strong>${p.out ? "上がり" : "🂠".repeat(Math.min(p.hand.length, 10))}</strong></div>`);
    board.appendChild(cpus);
  }, controls => {
    const target = nextActive(state.turn);
    controls.innerHTML = state.turn === 0 && !state.players[0].out ? `<button class="primary-button" id="drawOld" type="button">${state.players[target].name}から引く</button>` : "";
    const btn = document.getElementById("drawOld");
    if (btn) btn.addEventListener("click", () => oldMaidDraw(0, target));
  });
  if (state.turn !== 0) delay(() => oldMaidDraw(state.turn, nextActive(state.turn)), 800);
}

function oldMaidDraw(playerIndex, targetIndex) {
  const player = state.players[playerIndex], target = state.players[targetIndex];
  if (!player || !target || player.out || target.out) return;
  target.hand = shuffle(target.hand);
  const card = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1)[0];
  player.hand.push(card);
  player.hand = discardPairs(player.hand);
  [player, target].forEach(p => { if (!p.out && p.hand.length === 0) { p.out = true; state.ranks.push(p.name); addLog(`${p.name}が上がりました。`); } });
  addLog(`${player.name}が${target.name}から1枚引きました。`);
  if (state.players.filter(p => !p.out).length <= 1) return finishOldMaid();
  state.turn = nextActive(playerIndex);
  renderOldMaid();
}

function finishOldMaid() {
  const loser = state.players.find(p => !p.out);
  const rows = [...state.ranks, loser.name].map((name, i) => `${i + 1}位 ${name}`);
  showResult(loser.name === "あなた" ? "あなたの負け" : "あなたの勝ち", rows, { win: loser.name !== "あなた", score: loser.name === "あなた" ? 0 : 30 });
}

function initSevens() {
  const hands = deal(shuffle(createDeck(false)), 52, 4).map(h => sortCards(h));
  state.players = ["あなた", "CPU1", "CPU2", "CPU3"].map((name, i) => ({ name, hand: hands[i], pass: 0, out: false }));
  state.board = Object.fromEntries(SUITS.map(s => [s, { low: 7, high: 7, cards: { 7: true } }]));
  state.players.forEach(p => { p.hand = p.hand.filter(c => { if (c.rank === "7") { addLog(`${p.name}が 7${c.suit} を出しました。`); return false; } return true; }); });
  state.turn = 0;
  state.ranks = [];
  renderSevens();
}

function canPlaySeven(card) {
  const line = state.board[card.suit];
  return card.value === line.low - 1 || card.value === line.high + 1;
}

function playSeven(index, cardIndex) {
  const p = state.players[index], card = p.hand.splice(cardIndex, 1)[0], line = state.board[card.suit];
  if (card.value < 7) line.low = card.value; else line.high = card.value;
  line.cards[card.value] = true;
  addLog(`${p.name}が ${cardText(card)} を出しました。`);
  if (p.hand.length === 0 && !p.out) { p.out = true; state.ranks.push(p.name); addLog(`${p.name}が上がりました。`); }
  advanceSevens();
}

function passSeven(index) {
  const p = state.players[index];
  p.pass += 1;
  addLog(`${p.name}がパスしました。`);
  advanceSevens();
}

function advanceSevens() {
  if (state.players.filter(p => !p.out).length <= 1) return finishSevens();
  state.turn = nextActive(state.turn);
  renderSevens();
}

function chooseShichinarabeMove(player) {
  const candidates = player.hand.map((card, index) => ({ card, index })).filter(x => canPlaySeven(x.card));
  if (!candidates.length) return null;
  const danger = Math.min(...state.players.filter(p => p !== player && !p.out).map(p => p.hand.length));
  return candidates.map(x => {
    const line = state.board[x.card.suit];
    let score = 20 - Math.abs(x.card.value - 7);
    if (player.hand.some(c => c.suit === x.card.suit && Math.abs(c.value - x.card.value) === 1)) score += 8;
    if (x.card.value === line.low - 1 || x.card.value === line.high + 1) score += 3;
    if (danger <= 2 && Math.abs(x.card.value - 7) > 3) score -= 8;
    if (player.hand.length <= 3) score += 18;
    return { ...x, score };
  }).sort((a, b) => b.score - a.score)[0];
}

function renderSevens() {
  renderShell("7から左右につながるカードだけ出せます。出せない時はパス。CPUは場を広げすぎないよう評価します。", (board, status) => {
    status.innerHTML = state.players.map((p, i) => `<div class="status-box"><span>${p.name}</span><strong>${p.out ? "上がり" : `${p.hand.length}枚`}</strong><span>パス ${p.pass} / ${i === state.turn ? "ターン" : ""}</span></div>`).join("");
    board.innerHTML = `<div class="seven-board">${SUITS.map(s => `<div class="suit-line"><strong>${s}</strong><div class="slot-row">${RANKS.map((r, i) => `<div class="slot ${state.board[s].cards[i + 1] ? "filled" : ""}">${state.board[s].cards[i + 1] ? r : ""}</div>`).join("")}</div></div>`).join("")}</div><h3>あなたの手札</h3>`;
    const hand = document.createElement("div");
    hand.className = "card-row";
    state.players[0].hand.forEach((card, i) => hand.appendChild(makeCard(card, { dim: !canPlaySeven(card), click: state.turn === 0 && canPlaySeven(card) ? () => playSeven(0, i) : null })));
    board.appendChild(hand);
  }, controls => {
    controls.innerHTML = state.turn === 0 && !state.players[0].out ? `<button class="danger-button" id="passSeven" type="button">パス</button>` : "";
    const btn = document.getElementById("passSeven");
    if (btn) btn.addEventListener("click", () => passSeven(0));
  });
  if (state.turn !== 0) delay(() => {
    const move = chooseShichinarabeMove(state.players[state.turn]);
    move ? playSeven(state.turn, move.index) : passSeven(state.turn);
  }, 750);
}

function finishSevens() {
  const last = state.players.find(p => !p.out);
  const names = last ? [...state.ranks, last.name] : state.ranks.slice();
  const rows = names.map((name, i) => `${i + 1}位 ${name}`);
  const rank = names.indexOf("あなた");
  showResult(names[0] === "あなた" ? "あなたの勝ち" : "順位確定", rows, { win: names[0] === "あなた", score: Math.max(0, 40 - rank * 10) });
}

function initDaifugo() {
  const hands = deal(shuffle(createDeck(false)), 52, 4).map(h => sortCards(h, DAIFUGO_ORDER));
  state.players = ["あなた", "CPU1", "CPU2", "CPU3"].map((name, i) => ({ name, hand: hands[i], out: false }));
  state.turn = 0;
  state.lastMove = null;
  state.passes = new Set();
  state.ranks = [];
  state.selected = new Set();
  addLog("簡易大富豪を開始しました。");
  renderDaifugo();
}

function daifugoValue(card) {
  return DAIFUGO_ORDER.indexOf(card.rank);
}

function validateMove(cards) {
  if (!cards.length) return { ok: false, reason: "カードを選んでください" };
  if (!cards.every(c => c.rank === cards[0].rank)) return { ok: false, reason: "同じ数字だけ出せます" };
  if (cards.length > 4) return { ok: false, reason: "4枚までです" };
  if (state.lastMove && (cards.length !== state.lastMove.cards.length || daifugoValue(cards[0]) <= daifugoValue(state.lastMove.cards[0]))) return { ok: false, reason: "場と同じ枚数で、より強いカードが必要です" };
  return { ok: true, reason: "出せます" };
}

function enumerateDaifugoMoves(player) {
  const grouped = Object.values(player.hand.reduce((acc, c) => { (acc[c.rank] ||= []).push(c); return acc; }, {}));
  const moves = [];
  grouped.forEach(list => {
    for (let n = 1; n <= Math.min(4, list.length); n++) {
      const cards = list.slice(0, n);
      if (validateCandidate(cards)) moves.push({ cards });
    }
  });
  return moves;
}

function validateCandidate(cards) {
  if (!state.lastMove) return true;
  return cards.length === state.lastMove.cards.length && daifugoValue(cards[0]) > daifugoValue(state.lastMove.cards[0]);
}

function scoreDaifugoMove(move, player) {
  const value = daifugoValue(move.cards[0]);
  const remaining = player.hand.length - move.cards.length;
  const minEnemy = Math.min(...state.players.filter(p => p !== player && !p.out).map(p => p.hand.length));
  let score = 60 - value * 3 + move.cards.length * 18 - remaining;
  if (remaining === 0) score += 999;
  if (player.hand.length > 8 && value >= 10) score -= 35;
  if (player.hand.length <= 4) score += value * 3;
  if (minEnemy <= 2) score += value * 2 + move.cards.length * 10;
  const sameRankCount = player.hand.filter(c => c.rank === move.cards[0].rank).length;
  if (sameRankCount > move.cards.length) score -= 12;
  if (state.lastMove) score -= value;
  return score;
}

function chooseDaifugoMove(cpuPlayer) {
  const moves = enumerateDaifugoMoves(cpuPlayer);
  if (!moves.length) return null;
  const scored = moves.map(move => ({ ...move, score: scoreDaifugoMove(move, cpuPlayer) })).sort((a, b) => b.score - a.score);
  return scored.find(m => m.score >= scored[0].score - 5 && Math.random() < .35) || scored[0];
}

function playDaifugo(index, cards) {
  const p = state.players[index];
  p.hand = p.hand.filter(c => !cards.includes(c));
  state.lastMove = { player: index, cards };
  state.passes = new Set();
  addLog(`${p.name}が ${cards.map(cardText).join(" ")} を出しました。`);
  if (p.hand.length === 0 && !p.out) { p.out = true; state.ranks.push(p.name); addLog(`${p.name}が上がりました。`); }
  state.selected.clear();
  if (state.players.filter(p => !p.out).length <= 1) return finishDaifugo();
  state.turn = nextActive(index);
  renderDaifugo();
}

function passDaifugo(index) {
  state.passes.add(index);
  addLog(`${state.players[index].name}がパスしました。`);
  const activeOthers = state.players.filter((p, i) => !p.out && i !== state.lastMove?.player);
  if (state.lastMove && activeOthers.every((p, i) => state.passes.has(state.players.indexOf(p)))) {
    addLog("場が流れました。");
    state.turn = state.lastMove.player;
    state.lastMove = null;
    state.passes = new Set();
  } else {
    state.turn = nextActive(index);
  }
  renderDaifugo();
}

function renderDaifugo() {
  const selectedCards = [...state.selected].map(i => state.players[0].hand[i]);
  const valid = validateMove(selectedCards);
  renderShell("1枚、ペア、3枚組、4枚組を出せます。同じ枚数でより強いカードを出し、自分以外全員がパスすると場流しです。", (board, status) => {
    status.innerHTML = state.players.map((p, i) => `<div class="status-box"><span>${p.name}</span><strong>${p.out ? "上がり" : `${p.hand.length}枚`}</strong>${i === state.turn ? "<span>ターン</span>" : ""}</div>`).join("") + `<div class="status-box"><span>場</span><strong>${state.lastMove ? state.lastMove.cards.map(cardText).join(" ") : "なし"}</strong></div>`;
    board.innerHTML = `<p class="message">${state.turn === 0 ? valid.reason : ""}</p><h3>あなたの手札</h3>`;
    const hand = document.createElement("div");
    hand.className = "card-row";
    state.players[0].hand.forEach((card, i) => hand.appendChild(makeCard(card, { selected: state.selected.has(i), click: state.turn === 0 ? () => { state.selected.has(i) ? state.selected.delete(i) : state.selected.add(i); renderDaifugo(); } : null })));
    board.appendChild(hand);
  }, controls => {
    controls.innerHTML = state.turn === 0 && !state.players[0].out ? `<button class="primary-button" id="playD" type="button" ${valid.ok ? "" : "disabled"}>出す</button><button class="danger-button" id="passD" type="button">パス</button>` : "";
    const play = document.getElementById("playD");
    const pass = document.getElementById("passD");
    if (play) play.addEventListener("click", () => playDaifugo(0, selectedCards));
    if (pass) pass.addEventListener("click", () => passDaifugo(0));
  });
  if (state.turn !== 0) delay(() => {
    const move = chooseDaifugoMove(state.players[state.turn]);
    move ? playDaifugo(state.turn, move.cards) : passDaifugo(state.turn);
  }, 750);
}

function finishDaifugo() {
  const last = state.players.find(p => !p.out);
  const names = last ? [...state.ranks, last.name] : state.ranks.slice();
  const rows = names.map((name, i) => `${i + 1}位 ${name}`);
  const rank = names.indexOf("あなた");
  showResult(names[0] === "あなた" ? "あなたの勝ち" : "順位確定", rows, { win: names[0] === "あなた", score: Math.max(0, 50 - rank * 12) });
}

showHome();
