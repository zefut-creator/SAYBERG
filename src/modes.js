const { InlineKeyboard } = require("grammy");

const MODES = {
  sprint: "⚡ СПРИНТ",
  rooms: "🚪 КОМНАТЫ",
  rooms2: "🚪 КОМНАТЫ Х2",
  click: "⚡ КЛИК-КЛАК",
  snipers: "👁 ПОИСКОВИКИ",
  wanted: "🔎 РОЗЫСК",
  random: "🎲 ОХУЕБЕРГ",
  dice: "🎯 ТУРНИР КУБИКОВ",
  smart: "🧠 УМНИК",
};

function modeKeyboard() {
  const k = new InlineKeyboard();
  for (const [id, label] of Object.entries(MODES)) k.text(label, "sayberg:mode:" + id).row();
  return k;
}
function actionKeyboard(game) {
  const k = new InlineKeyboard();
  let labels;
  if (["rooms", "rooms2", "snipers"].includes(game.mode)) labels = ["🚪 Комната 1", "🚪 Комната 2", "🚪 Комната 3", "🚪 Комната 4"];
  else if (game.mode === "wanted") labels = ["🪟 Окно 1", "🪟 Окно 2", "🪟 Окно 3", "🪟 Окно 4", "🪟 Окно 5", "🪟 Окно 6"];
  else if (game.mode === "dice") labels = ["⬆️ Больше 3", "⬇️ Меньше 4"];
  else if (game.mode === "smart") labels = ["🅰️ Вариант А", "🅱️ Вариант Б", "©️ Вариант В"];
  else labels = ["🔴 Красное", "⚫ Чёрное", "⚡ Быстро!"];
  labels.forEach((label, i) => k.text(label, "sayberg:pick:" + i).row());
  return k;
}
function rules(game) {
  const texts = {
    rooms: "Выбери одну из четырёх комнат. После таймера одна комната случайно становится опасной; игроки в ней теряют жизнь.",
    rooms2: "Как в Комнатах, но у каждого две жизни. Первое попадание снимает жизнь, второе выводит из игры.",
    click: "Раунд на реакцию: нажми кнопку. Самый поздний ответивший теряет жизнь.",
    snipers: "Выбери комнату, чтобы спрятаться. После таймера проверяется одна комната; найденные игроки теряют жизнь.",
    wanted: "Угадай окно, за которым скрывается цель. За точное попадание +3 очка. Десять раундов.",
    random: "Случайные мини-испытания: выбор цвета, реакция и угадывание. Игра на очки и жизни.",
    dice: "Турнир кубиков: выбери больше или меньше четырёх. За верный ответ +1 очко, 15 раундов.",
    smart: "Выбери один из вариантов до конца таймера. За каждый ответ +1 очко, 15 раундов."
  };
  return texts[game.mode] || "Каждый раунд случайно выбывает один участник.";
}
async function startMode(api, games, chatId, sprint) {
  const g = games.get(String(chatId));
  if (!g) return;
  if (g.mode === "sprint") return sprint(api, chatId);
  g.round = 0;
  g.scores = new Map(Array.from(g.players.keys(), id => [id, 0]));
  g.lives = new Map(Array.from(g.players.keys(), id => [id, ["rooms2", "snipers"].includes(g.mode) ? 2 : 1]));
  g.picks = new Map();
  g.status = "mode-round";
  await api.sendMessage(chatId, MODES[g.mode] + " — НАЧАЛО\n\n" + rules(g) + "\n\nУчастников: " + g.players.size);
  await nextRound(api, games, chatId);
}
async function nextRound(api, games, chatId) {
  const g = games.get(String(chatId));
  if (!g || g.status !== "mode-round") return;
  const active = Array.from(g.players.values()).filter(p => (g.lives.get(p.id) || 0) > 0);
  if (!["wanted", "dice", "smart"].includes(g.mode) && active.length <= 1) return finish(api, games, chatId);
  g.round++;
  g.picks.clear();
  if (g.mode === "wanted") g.target = Math.floor(Math.random() * 6);
  if (g.mode === "random") g.task = ["Выбери цвет", "Проверь реакцию", "Выбери вариант"][Math.floor(Math.random() * 3)];
  const intro = g.mode === "wanted" ? "Найди цель среди шести окон!" : g.mode === "random" ? g.task : "Сделай выбор за 15 секунд!";
  await api.sendMessage(chatId, "🎮 Раунд " + g.round + "\n" + intro, { reply_markup: actionKeyboard(g) });
  g.roundTimer = setTimeout(() => resolveRound(api, games, chatId).catch(console.error), 15000);
}
async function resolveRound(api, games, chatId) {
  const g = games.get(String(chatId));
  if (!g || g.status !== "mode-round") return;
  const active = Array.from(g.players.values()).filter(p => (g.lives.get(p.id) || 0) > 0);
  const lines = [];
  if (g.mode === "wanted") {
    active.forEach(p => { if (g.picks.get(p.id) === g.target) g.scores.set(p.id, (g.scores.get(p.id) || 0) + 3); });
    lines.push("🎯 Цель была в окне " + (g.target + 1) + ". За точный ответ +3 очка.");
  } else if (g.mode === "dice") {
    const roll = 1 + Math.floor(Math.random() * 6);
    active.forEach(p => { const v = g.picks.get(p.id); if ((roll > 3 && v === 0) || (roll < 4 && v === 1)) g.scores.set(p.id, (g.scores.get(p.id) || 0) + 1); });
    lines.push("🎲 Выпало " + roll + ". Верные ответы получают +1 очко.");
  } else if (g.mode === "smart") {
    active.forEach(p => { if (g.picks.has(p.id)) g.scores.set(p.id, (g.scores.get(p.id) || 0) + 1); });
    lines.push("🧠 Успевшие ответить получают +1 очко.");
  } else {
    let affected = [];
    const hazard = Math.floor(Math.random() * 4);
    if (g.mode === "click") {
      const submitted = active.filter(p => g.picks.has(p.id));
      if (submitted.length) affected = [submitted[submitted.length - 1]];
    } else if (g.mode === "random") {
      const submitted = active.filter(p => g.picks.has(p.id));
      if (submitted.length) affected = [submitted[Math.floor(Math.random() * submitted.length)]];
    } else affected = active.filter(p => g.picks.get(p.id) === hazard);
    lines.push("⚠️ Опасная зона раунда: " + (hazard + 1) + ".");
    affected.forEach(p => {
      const left = Math.max(0, (g.lives.get(p.id) || 1) - 1);
      g.lives.set(p.id, left);
      lines.push("❌ " + p.name + (left ? " — осталась 1 жизнь." : " — выбыл."));
    });
    if (!affected.length) lines.push("✅ В этот раз никто не потерял жизнь.");
  }
  lines.push("", "📊 Таблица:");
  Array.from(g.players.values()).forEach(p => lines.push(p.name + " — " + (g.scores.get(p.id) || 0) + " очк. · " + (g.lives.get(p.id) || 0) + " ❤"));
  await api.sendMessage(chatId, lines.join("\n"));
  if (["wanted", "dice", "smart"].includes(g.mode)) {
    if (g.round >= (g.mode === "wanted" ? 10 : 15)) return finish(api, games, chatId);
  } else if (Array.from(g.players.values()).filter(p => (g.lives.get(p.id) || 0) > 0).length <= 1) return finish(api, games, chatId);
  g.roundTimer = setTimeout(() => nextRound(api, games, chatId).catch(console.error), 5000);
}
async function finish(api, games, chatId) {
  const g = games.get(String(chatId));
  if (!g || g.status === "finished") return;
  g.status = "finished";
  if (g.roundTimer) clearTimeout(g.roundTimer);
  const rank = Array.from(g.players.values()).sort((a, b) => (g.scores.get(b.id) || 0) - (g.scores.get(a.id) || 0));
  await api.sendMessage(chatId, "🏆 ИГРА ЗАВЕРШЕНА — " + MODES[g.mode] + "\n\n" +
    rank.map((p, i) => (i + 1) + ". " + p.name + " — " + (g.scores.get(p.id) || 0) + " очк.").join("\n") +
    "\n\nПобедитель: " + (rank[0] ? rank[0].name : "нет"));
}
async function pick(ctx, games) {
  const g = games.get(String(ctx.chat.id));
  if (!g || g.status !== "mode-round") return ctx.answerCallbackQuery({ text: "Раунд уже завершён." });
  if (!g.players.has(ctx.from.id) || (g.lives.get(ctx.from.id) || 0) <= 0) return ctx.answerCallbackQuery({ text: "Ты не активный участник." });
  g.picks.set(ctx.from.id, Number(ctx.match[1]));
  await ctx.answerCallbackQuery({ text: "Выбор принят!" });
}
module.exports = { MODES, modeKeyboard, rules, startMode, pick };
