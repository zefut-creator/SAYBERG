const { InlineKeyboard } = require("grammy");

const MODES = Object.freeze({
  sprint: "⚡ СПРИНТ",
  rooms: "🚪 КОМНАТЫ",
  rooms2: "🚪 КОМНАТЫ Х2",
  click: "⚡ КЛИК-КЛАК",
  snipers: "👁 ПОИСКОВИКИ",
  wanted: "🔎 РОЗЫСК",
  random: "🎲 ОХУЕБЕРГ",
  dice: "🎯 ТУРНИР КУБИКОВ",
  smart: "🧠 УМНИК"
});
const WINDOW_COUNT = 6;
const ROOM_COUNT = 4;

function modeKeyboard() {
  const keyboard = new InlineKeyboard();
  for (const [id, label] of Object.entries(MODES)) keyboard.text(label, "sayberg:mode:" + id).row();
  return keyboard;
}
function activePlayers(game) {
  return Array.from(game.players.values()).filter(p => (game.lives.get(p.id) || 0) > 0);
}
function actionKeyboard(game) {
  const k = new InlineKeyboard();
  let labels;
  if (game.mode === "wanted") labels = Array.from({ length: WINDOW_COUNT }, (_, i) => "🪟 Окно " + (i + 1));
  else if (["rooms", "rooms2", "snipers"].includes(game.mode)) {
    labels = Array.from({ length: ROOM_COUNT }, (_, i) => "🚪 Комната " + (i + 1));
    if (game.mode === "rooms2") labels.push("🎲 ALL IN");
  } else if (game.mode === "dice") labels = ["⬆️ Больше 3", "⬇️ Меньше 4"];
  else if (game.mode === "smart") labels = ["🅰️", "🅱️", "©️"];
  else if (game.mode === "random" && game.task === "math") labels = ["1️⃣ " + game.answers[0], "2️⃣ " + game.answers[1], "3️⃣ " + game.answers[2]];
  else if (game.mode === "random" && game.task === "coin") labels = ["🔴 Красное", "⚫ Чёрное"];
  else labels = ["⚡ ЖМИ!"];
  labels.forEach((label, i) => k.text(label, "sayberg:pick:" + i).row());
  return k;
}
function rules(game) {
  const texts = {
    sprint: "Перекличка длится 30 секунд. Затем каждые 20 секунд случайно выбывает один игрок. Побеждает последний.",
    rooms: "Каждый выбирает одну из четырёх комнат. Одна комната становится опасной; все выбравшие её теряют жизнь.",
    rooms2: "У каждого две жизни. В каждом третьем раунде опасны две комнаты. ALL IN: безопасный выбор даёт бонус, опасный отнимает обе жизни.",
    click: "После сигнала нажми кнопку быстрее остальных. Самый медленный участник теряет жизнь; самый быстрый получает очко.",
    snipers: "Все прячутся по комнатам. Ведущий раскрывает подсказку о проверяемой комнате; найденные теряют жизнь.",
    wanted: "Каждый раунд появляется подсказка о цели среди шести окон. Угадай окно и получи 3 очка. Всего 10 раундов.",
    random: "Случайные мини-игры: математическая загадка, реакция или угадывание цвета. Верные ответы дают очки.",
    dice: "15 раундов с кубиком. Выбери больше или меньше 4; за верный прогноз начисляется очко. Это игра на очки без ставок.",
    smart: "15 коротких математических вопросов с тремя вариантами. Верный ответ даёт 2 очка, ошибка отнимает 1."
  };
  return texts[game.mode] || texts.sprint;
}
function makeMathQuestion() {
  const a = 2 + Math.floor(Math.random() * 18);
  const b = 2 + Math.floor(Math.random() * 12);
  const op = Math.random() < 0.5 ? "+" : "×";
  const answer = op === "+" ? a + b : a * b;
  const wrong1 = answer + 1 + Math.floor(Math.random() * 5);
  const wrong2 = Math.max(0, answer - 1 - Math.floor(Math.random() * 5));
  const answers = [answer, wrong1, wrong2].sort(() => Math.random() - 0.5);
  return { question: a + " " + op + " " + b + " = ?", answers, correct: answers.indexOf(answer) };
}
function prepareChallenge(game) {
  if (game.mode === "wanted") {
    game.target = Math.floor(Math.random() * WINDOW_COUNT);
    const parity = game.target % 2 === 0 ? "чётном" : "нечётном";
    game.clue = "Цель находится в " + parity + " окне.";
  } else if (game.mode === "snipers") {
    game.target = Math.floor(Math.random() * ROOM_COUNT);
    game.clue = "Проверяется комната " + (game.target + 1) + ".";
  } else if (game.mode === "rooms" || game.mode === "rooms2") {
    const first = Math.floor(Math.random() * ROOM_COUNT);
    game.hazards = new Set([first]);
    if (game.mode === "rooms2" && game.round % 3 === 0) {
      let second = Math.floor(Math.random() * ROOM_COUNT);
      while (second === first) second = Math.floor(Math.random() * ROOM_COUNT);
      game.hazards.add(second);
    }
  } else if (game.mode === "random") {
    const tasks = ["math", "coin", "reaction"];
    game.task = tasks[Math.floor(Math.random() * tasks.length)];
    if (game.task === "math") game.question = makeMathQuestion();
    if (game.task === "coin") game.coin = Math.floor(Math.random() * 2);
  } else if (game.mode === "smart") {
    game.question = makeMathQuestion();
  } else if (game.mode === "dice") {
    game.roll = 1 + Math.floor(Math.random() * 6);
  }
}
async function startMode(api, games, chatId, sprint) {
  const game = games.get(String(chatId));
  if (!game) return;
  if (game.mode === "sprint") return sprint(api, chatId);
  game.round = 0;
  game.scores = new Map(Array.from(game.players.keys(), id => [id, 0]));
  game.lives = new Map(Array.from(game.players.values(), p => [p.id, p.alive === false ? 0 : (["rooms2", "snipers"].includes(game.mode) ? 2 : 1)]));
  game.picks = new Map();
  game.status = "mode-round";
  await api.sendMessage(chatId, MODES[game.mode] + " — НАЧАЛО\n\n" + rules(game) + "\n\nУчастников: " + game.players.size);
  await nextRound(api, games, chatId);
}
async function nextRound(api, games, chatId) {
  const game = games.get(String(chatId));
  if (!game || game.status !== "mode-round") return;
  const active = activePlayers(game);
  if (!["wanted", "dice", "smart", "random"].includes(game.mode) && active.length <= 1) return finish(api, games, chatId);
  game.round++;
  game.picks.clear();
  game.startedAt = Date.now();
  prepareChallenge(game);
  let intro = "Сделай выбор за 15 секунд!";
  if (game.mode === "wanted") intro = "🔍 " + game.clue;
  if (game.mode === "snipers") intro = "🕵️ Игроки выбрали укрытия. " + game.clue;
  if (game.mode === "random") intro = game.task === "math" ? "🧩 " + game.question.question : game.task === "coin" ? "🪙 Угадай цвет монеты!" : "⚡ Кто быстрее нажмёт кнопку?";
  if (game.mode === "smart") intro = "🧠 " + game.question.question;
  if (game.mode === "dice") intro = "🎲 Какое число выпадет: больше 3 или меньше 4?";
  await api.sendMessage(chatId, "🎮 Раунд " + game.round + "\n" + intro, { reply_markup: actionKeyboard(game) });
  game.roundTimer = setTimeout(() => resolveRound(api, games, chatId).catch(console.error), 15000);
}
async function resolveRound(api, games, chatId) {
  const game = games.get(String(chatId));
  if (!game || game.status !== "mode-round") return;
  const active = activePlayers(game);
  const lines = [];
  const addScore = (p, n) => game.scores.set(p.id, (game.scores.get(p.id) || 0) + n);
  const loseLife = p => {
    const left = Math.max(0, (game.lives.get(p.id) || 1) - 1);
    game.lives.set(p.id, left);
    p.alive = left > 0;
    lines.push("❌ " + p.name + (left ? " потерял жизнь. Осталась 1." : " выбыл."));
  };

  if (game.mode === "wanted") {
    active.forEach(p => { if (game.picks.get(p.id) === game.target) addScore(p, 3); });
    lines.push("🎯 Цель была в окне " + (game.target + 1) + ". Верный ответ: +3 очка.");
  } else if (game.mode === "snipers" || game.mode === "rooms" || game.mode === "rooms2") {
    const hazards = game.mode === "snipers" ? new Set([game.target]) : game.hazards;
    lines.push(game.mode === "snipers" ? "🔎 Проверена комната " + (game.target + 1) + "." : "⚠️ Опасные комнаты: " + Array.from(hazards, n => n + 1).join(", ") + ".");
    active.forEach(p => {
      const choice = game.picks.get(p.id);
      if (choice === undefined) { lines.push("⌛ " + p.name + " не выбрал комнату."); return; }
      if (game.mode === "rooms2" && choice === 4) {
        const allInRoom = Math.floor(Math.random() * ROOM_COUNT);
        if (hazards.has(allInRoom)) {
          game.lives.set(p.id, 0);
          p.alive = false;
          lines.push("🎲 " + p.name + " рискнул ALL IN и выбыл.");
        } else {
          addScore(p, 2);
          lines.push("🍀 " + p.name + " прошёл ALL IN и получил +2 очка.");
        }
      } else if (hazards.has(choice)) loseLife(p);
      else addScore(p, 1);
    });
  } else if (game.mode === "click") {
    const submitted = active.filter(p => game.picks.has(p.id)).sort((a, b) => game.picks.get(a.id) - game.picks.get(b.id));
    if (submitted.length) {
      addScore(submitted[0], 1);
      lines.push("⚡ Самый быстрый: " + submitted[0].name + " (+1 очко).");
      if (submitted.length > 1) {
        loseLife(submitted[submitted.length - 1]);
      } else lines.push("Нужен хотя бы второй ответ для штрафа.");
    } else lines.push("Никто не успел нажать кнопку.");
  } else if (game.mode === "dice") {
    active.forEach(p => {
      const choice = game.picks.get(p.id);
      if ((game.roll > 3 && choice === 0) || (game.roll < 4 && choice === 1)) addScore(p, 1);
    });
    lines.push("🎲 Выпало " + game.roll + ". За правильный прогноз +1 очко.");
  } else if (game.mode === "smart" || (game.mode === "random" && game.task === "math")) {
    active.forEach(p => {
      if (!game.picks.has(p.id)) return;
      if (game.picks.get(p.id) === game.question.correct) addScore(p, 2);
      else addScore(p, -1);
    });
    lines.push("🧠 Ответ: " + (game.question.correct + 1) + ". Верно +2, ошибка −1.");
  } else if (game.mode === "random" && game.task === "coin") {
    active.forEach(p => { if (game.picks.get(p.id) === game.coin) addScore(p, 2); });
    lines.push("🪙 Выпал цвет: " + (game.coin === 0 ? "красный" : "чёрный") + ". Верный ответ +2.");
  } else if (game.mode === "random" && game.task === "reaction") {
    const submitted = active.filter(p => game.picks.has(p.id)).sort((a, b) => game.picks.get(a.id) - game.picks.get(b.id));
    if (submitted.length) addScore(submitted[0], 2);
    lines.push(submitted.length ? "⚡ Быстрее всех: " + submitted[0].name + " (+2)." : "Никто не успел.");
  }

  lines.push("", "📊 Таблица:");
  Array.from(game.players.values()).forEach(p => lines.push(p.name + " — " + (game.scores.get(p.id) || 0) + " очк. · " + (game.lives.get(p.id) || 0) + " ❤"));
  await api.sendMessage(chatId, lines.join("\n"));
  if (["wanted", "dice", "smart", "random"].includes(game.mode)) {
    if (game.round >= (game.mode === "wanted" ? 10 : 15)) return finish(api, games, chatId);
  } else if (activePlayers(game).length <= 1) return finish(api, games, chatId);
  game.roundTimer = setTimeout(() => nextRound(api, games, chatId).catch(console.error), 5000);
}
async function finish(api, games, chatId) {
  const game = games.get(String(chatId));
  if (!game || game.status === "finished" || game.status === "stopped") return;
  game.status = "finished";
  if (game.roundTimer) clearTimeout(game.roundTimer);
  const rank = Array.from(game.players.values()).sort((a, b) => (game.scores.get(b.id) || 0) - (game.scores.get(a.id) || 0));
  const places = Math.max(1, Math.min(Number(game.winners) || 1, rank.length));
  const winners = rank.slice(0, places);
  await api.sendMessage(chatId,
    "🏆 ИГРА ЗАВЕРШЕНА — " + MODES[game.mode] + "\n\n" +
    rank.map((p, i) => (i + 1) + ". " + p.name + " — " + (game.scores.get(p.id) || 0) + " очк. · " + (game.lives.get(p.id) || 0) + " ❤").join("\n") +
    "\n\n🏅 Победители:\n" + winners.map((p, i) => (i + 1) + ". " + p.name).join("\n") +
    "\n\n🎁 Заявленные призы: " + String(game.prizes || "не указаны") +
    "\n⚠️ Выдачу призов обеспечивает создатель арены.");
}
async function pick(ctx, games) {
  const game = games.get(String(ctx.chat.id));
  if (!game || game.status !== "mode-round") return ctx.answerCallbackQuery({ text: "Раунд уже завершён." });
  if (!game.players.has(ctx.from.id) || (game.lives.get(ctx.from.id) || 0) <= 0) return ctx.answerCallbackQuery({ text: "Ты не активный участник." });
  if (game.picks.has(ctx.from.id)) return ctx.answerCallbackQuery({ text: "Ты уже сделал выбор." });
  const choice = Number(ctx.match[1]);
  if (!Number.isInteger(choice) || choice < 0 || choice > 5) return ctx.answerCallbackQuery({ text: "Некорректный выбор." });
  game.picks.set(ctx.from.id, game.mode === "click" || (game.mode === "random" && game.task === "reaction") ? Date.now() : choice);
  await ctx.answerCallbackQuery({ text: "Выбор принят!" });
}
module.exports = { MODES, modeKeyboard, rules, startMode, pick, nextRound, finish };
