require("dotenv").config();

const { Bot, InlineKeyboard } = require("grammy");

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is missing. Add it to the hosting environment variables.");
  process.exit(1);
}

const bot = new Bot(token);
const games = new Map();
const creationDrafts = new Map();
const registeredGroups = new Map();

const DEFAULT_SETTINGS = { firstElimination: 35, nextElimination: 15 };

function getGame(chatId) {
  return games.get(String(chatId));
}

function alivePlayers(game) {
  return [...game.players.values()].filter((player) => player.alive);
}

function playersText(game) {
  const players = [...game.players.values()];
  if (!players.length) return "Пока никто не присоединился.";
  return players.map((p, i) =>
    `${i + 1}. ${p.name} — ${p.alive ? "🟢 в игре" : "❌ выбыл"}`
  ).join("\n");
}

function lobbyKeyboard() {
  return new InlineKeyboard().text("➕ Войти", "sayberg:join");
}

function attendanceKeyboard() {
  return new InlineKeyboard().text("✅ Я на месте", "sayberg:present");
}

function groupPickerKeyboard() {
  const keyboard = new InlineKeyboard();
  for (const [chatId, group] of registeredGroups) {
    keyboard.text(group.title, `sayberg:select:${chatId}`).row();
  }
  return keyboard;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[char]);
}

function playerMention(player) {
  const label = escapeHtml(player.name || "Игрок");
  return player.username
    ? `@${escapeHtml(player.username)}`
    : `<a href="tg://user?id=${player.id}">${label}</a>`;
}

function creatorMention(game) {
  return game.creatorUsername
    ? `@${escapeHtml(game.creatorUsername)}`
    : `<a href="tg://user?id=${game.creatorId}">${escapeHtml(game.creatorName)}</a>`;
}

async function finishArenaDraft(api, user, draft) {
  const chatId = String(draft.targetChatId);
  const game = {
    chatId,
    creatorId: user.id,
    creatorName: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Создатель",
    creatorUsername: user.username || null,
    status: "lobby",
    mode: "sprint",
    round: 0,
    players: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    attendance: draft.attendance,
    description: draft.description,
    maxPlayers: draft.maxPlayers,
    winners: draft.winners,
    prizes: draft.prizes,
    createdAt: Date.now(),
  };
  game.players.set(user.id, {
    id: user.id, name: game.creatorName, username: user.username || null, alive: true, present: false,
  });
  games.set(chatId, game);
  creationDrafts.delete(String(user.id));
  await api.sendMessage(chatId, arenaCard(game), { reply_markup: lobbyKeyboard() });
  await api.sendMessage(chatId, "Управление ареной:", { reply_markup: arenaControlsKeyboard() });
  await api.sendMessage(user.id, `✅ Арена создана в группе «${escapeHtml(registeredGroups.get(chatId)?.title || "группа")}».`);
}

function arenaControlsKeyboard() {
  return new InlineKeyboard()
    .text("📖 Правила", "sayberg:rules")
    .text("🚀 Начало", "sayberg:start");
}

function sprintRules() {
  return [
    "📖 ПРАВИЛА — ⚡ СПРИНТ",
    "",
    "• Все участники играют без ролей и ходов.",
    "• В каждом раунде бот случайно выбирает игроков, которые выбывают.",
    "• В первом раунде выбывает 35% игроков, далее — 15%.",
    "• Раунды идут автоматически с небольшими паузами.",
    "• Побеждает последний оставшийся игрок.",
  ].join("\n");
}

function gameSummary(game) {
  return [
    "⚡ SAYBERG — СПРИНТ",
    "",
    `Раунд: ${game.round}`,
    `Игроков в игре: ${alivePlayers(game).length}/${game.players.size}`,
    "",
    playersText(game),
  ].join("\n");
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} мин.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч. ${rest} мин.` : `${hours} ч.`;
}

function arenaCard(game) {
  return [
    "⚡ SAYBERG — НОВАЯ АРЕНА",
    "",
    `📝 Описание: ${game.description}`,
    `👥 Максимум игроков: ${game.maxPlayers}`,
    `🏆 Победителей: ${game.winners}`,
    `🎁 Призы: ${game.prizes}`,
    `👤 Создатель: ${game.creatorName}`,
    `📣 Перекличка: ${game.attendance ? "включена" : "выключена"}`,
    "",
    `Участников: ${game.players.size}/${game.maxPlayers}`,
    "Нажимайте «Войти», чтобы участвовать.",
  ].join("\n");
}

async function publishArena(api, chatId) {
  const game = getGame(chatId);
  if (!game || game.status !== "lobby") return;
  game.status = "running";
  if (game.startTimer) clearTimeout(game.startTimer);

  if (game.players.size < 2) {
    game.status = "finished";
    await api.sendMessage(chatId, "⏹ Арена закрыта: для начала нужно минимум 2 игрока.");
    return;
  }

  await startSprint(api, chatId);
}

async function promptNext(ctx, draft) {
  const prompts = {
    description: "📝 Отправь описание арены:",
    maxPlayers: "👥 Укажи максимальное количество игроков (от 2 до 100):",
    winners: "🏆 Сколько будет победителей? Укажи число:",
    prizes: "🎁 Напиши призы:",
  };
  if (prompts[draft.step]) await ctx.reply(prompts[draft.step]);
}

bot.on("message:text", async (ctx, next) => {
  const draftKey = ctx.chat.type === "private" ? String(ctx.from.id) : String(ctx.chat.id);
  const draft = creationDrafts.get(draftKey);
  if (!draft || ctx.from.id !== draft.creatorId || ctx.message.text.startsWith("/")) {
    return next();
  }

  if (draft.step === "attendance") {
    await ctx.reply("Выбери перекличку кнопкой выше.");
    return;
  }

  const value = ctx.message.text.trim();
  if (!value) {
    await ctx.reply("Пустое значение не подходит. Попробуй ещё раз.");
    return;
  }

  if (draft.step === "description") {
    draft.description = value.slice(0, 500);
    draft.step = "maxPlayers";
  } else if (draft.step === "maxPlayers") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 2 || n > 100) {
      await ctx.reply("Нужно целое число от 2 до 100.");
      return;
    }
    draft.maxPlayers = n;
    draft.step = "winners";
  } else if (draft.step === "winners") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > draft.maxPlayers) {
      await ctx.reply(`Укажи число от 1 до ${draft.maxPlayers}.`);
      return;
    }
    draft.winners = n;
    draft.step = "prizes";
  } else if (draft.step === "prizes") {
    draft.prizes = value.slice(0, 300);
    draft.step = "attendance";
    await ctx.reply("📣 Включить перекличку перед первым раундом?\nУчастникам дадут 30 секунд нажать кнопку. Кто не отметится — выбывает.", {
      reply_markup: new InlineKeyboard()
        .text("✅ Включить", "sayberg:attendance:on")
        .text("❌ Выключить", "sayberg:attendance:off"),
    });
    return;
  }

  await promptNext(ctx, draft);
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "⚡ Привет! Я SayBerg — ведущий групповых игр.\n\n" +
    "Чтобы создать арену, напиши мне в личку /game.\n" +
    "Сначала добавь меня в нужную группу и выполни там /register."
  );
});

bot.command("register", async (ctx) => {
  if (ctx.chat.type === "private") {
    return ctx.reply("Эту команду нужно отправить в группе, где будет проходить игра.");
  }
  registeredGroups.set(String(ctx.chat.id), { title: ctx.chat.title || "Группа" });
  await ctx.reply("✅ Группа сохранена. Теперь создатель может открыть личку с SayBerg, написать /game и выбрать эту группу.");
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Команды SayBerg:\n" +
    "/game — создать арену в личке с выбором группы\n" +
    "/register — добавить эту группу в список для выбора\n" +
    "/join — присоединиться\n" +
    "/startgame — начать игру (создатель)\n" +
    "/status — состояние арены\n" +
    "/stopgame — остановить арену\n" +
    "/cancel — отменить создание арены"
  );
});

bot.command("game", async (ctx) => {
  if (ctx.chat.type !== "private") {
    return ctx.reply("Создание теперь проходит в личке с SayBerg. Открой бота и напиши /game.");
  }
  if (creationDrafts.has(String(ctx.from.id))) {
    return ctx.reply("Ты уже создаёшь арену. Продолжай отвечать на вопросы или напиши /cancel.");
  }
  if (!registeredGroups.size) {
    return ctx.reply("Пока нет доступных групп. Добавь меня в нужную группу и отправь там /register, затем вернись сюда и напиши /game.");
  }
  const available = [];
  for (const [chatId, group] of registeredGroups) {
    const existing = getGame(chatId);
    if (!existing || ["finished", "stopped"].includes(existing.status)) available.push([chatId, group]);
  }
  if (!available.length) return ctx.reply("Во всех зарегистрированных группах уже идут арены.");
  const keyboard = new InlineKeyboard();
  for (const [chatId, group] of available) keyboard.text(group.title, `sayberg:select:${chatId}`).row();
  await ctx.reply("🎮 Выбери группу, в которой провести арену:", { reply_markup: keyboard });
});

bot.callbackQuery(/^sayberg:select:(-?\d+)$/, async (ctx) => {
  const chatId = ctx.match[1];
  const group = registeredGroups.get(chatId);
  if (!group) return ctx.answerCallbackQuery({ text: "Группа не найдена. Зарегистрируй её заново командой /register.", show_alert: true });
  const existing = getGame(chatId);
  if (existing && !["finished", "stopped"].includes(existing.status)) {
    return ctx.answerCallbackQuery({ text: "В этой группе уже идёт арена.", show_alert: true });
  }
  const member = await ctx.api.getChatMember(chatId, ctx.from.id).catch(() => null);
  if (member && ["left", "kicked"].includes(member.status)) {
    return ctx.answerCallbackQuery({ text: "Ты должен состоять в этой группе, чтобы создать там арену.", show_alert: true });
  }
  const draft = { creatorId: ctx.from.id, targetChatId: chatId, step: "description" };
  creationDrafts.set(String(ctx.from.id), draft);
  await ctx.answerCallbackQuery({ text: "Группа выбрана!" });
  await ctx.editMessageText(`✅ Выбрана группа: «${escapeHtml(group.title)}»`);
  await ctx.reply("⚡ Создание арены в личке. Напиши /cancel, если передумал.");
  await promptNext(ctx, draft);
});

bot.callbackQuery(/^sayberg:attendance:(on|off)$/, async (ctx) => {
  const draft = creationDrafts.get(String(ctx.from.id));
  if (!draft || draft.step !== "attendance") {
    return ctx.answerCallbackQuery({ text: "Этап создания уже завершён.", show_alert: true });
  }
  draft.attendance = ctx.match[1] === "on";
  await ctx.answerCallbackQuery({ text: draft.attendance ? "Перекличка включена" : "Перекличка выключена" });
  await ctx.editMessageText(draft.attendance
    ? "📣 Перекличка включена."
    : "📣 Перекличка выключена.");
  await finishArenaDraft(ctx.api, ctx.from, draft);
});

bot.command("cancel", async (ctx) => {
  const draftKey = ctx.chat.type === "private" ? String(ctx.from.id) : String(ctx.chat.id);
  const draft = creationDrafts.get(draftKey);
  if (draft && draft.creatorId === ctx.from.id) {
    creationDrafts.delete(draftKey);
    return ctx.reply("Создание арены отменено.");
  }
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (game && game.status === "lobby" && game.creatorId === ctx.from.id) {
    if (game.startTimer) clearTimeout(game.startTimer);
    game.status = "stopped";
    return ctx.reply("Арена отменена создателем.");
  }
  await ctx.reply("Нет твоего создания или ожидающей арены для отмены.");
});

async function joinGame(ctx) {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status !== "lobby") {
    return ctx.answerCallbackQuery({ text: "Сейчас нет открытой арены." });
  }
  const user = ctx.from;
  if (game.players.has(user.id)) {
    return ctx.answerCallbackQuery({ text: "Ты уже участвуешь." });
  }
  if (game.players.size >= game.maxPlayers) {
    return ctx.answerCallbackQuery({ text: "Мест больше нет." });
  }
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Игрок";
  game.players.set(user.id, { id: user.id, name, username: user.username || null, alive: true, present: false });
  await ctx.answerCallbackQuery({ text: "Ты в арене!" });
  await ctx.editMessageText(arenaCard(game), { reply_markup: lobbyKeyboard() }).catch(() => {});
}

bot.callbackQuery("sayberg:join", joinGame);

bot.callbackQuery("sayberg:rules", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(sprintRules());
});

bot.callbackQuery("sayberg:start", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status !== "lobby") {
    return ctx.answerCallbackQuery({ text: "Арена уже началась или закрыта." });
  }
  if (ctx.from.id !== game.creatorId) {
    return ctx.answerCallbackQuery({ text: "Запустить арену может только создатель.", show_alert: true });
  }
  if (game.players.size < 2) {
    return ctx.answerCallbackQuery({ text: "Нужно минимум 2 игрока.", show_alert: true });
  }
  await ctx.answerCallbackQuery({ text: "Запускаю арену!" });
  await publishArena(ctx.api, chatId);
});

bot.command("join", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status !== "lobby") return ctx.reply("Сейчас нет открытой арены. Напиши /game.");
  const user = ctx.from;
  if (game.players.has(user.id)) return ctx.reply("Ты уже участвуешь.");
  if (game.players.size >= game.maxPlayers) return ctx.reply("Мест больше нет.");
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Игрок";
  game.players.set(user.id, { id: user.id, name, username: user.username || null, alive: true, present: false });
  await ctx.reply(`➕ ${name} присоединился. Игроков: ${game.players.size}/${game.maxPlayers}`);
});

bot.command("startgame", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status !== "lobby") return ctx.reply("Нет ожидающей арены.");
  if (ctx.from.id !== game.creatorId) return ctx.reply("Начать игру может только создатель.");
  await publishArena(ctx.api, chatId);
});

async function startSprint(api, chatId) {
  const game = getGame(chatId);
  if (!game || game.status !== "running") return;
  await api.sendMessage(chatId,
    `⚡ СПРИНТ — НАЧАЛО\n\nУчастников (${game.players.size}/${game.maxPlayers})`);
  if (game.attendance) {
    game.status = "attendance";
    await api.sendMessage(chatId, "📣 ПЕРЕКЛИЧКА! У вас есть 30 секунд, чтобы подтвердить участие:", {
      reply_markup: attendanceKeyboard(),
    });
    game.attendanceTimer = setTimeout(() => finishAttendance(api, chatId).catch((err) => console.error("Attendance error:", err)), 30000);
  } else {
    setTimeout(() => runSprintRound(api, chatId).catch((err) => console.error("Sprint round error:", err)), 20000);
  }
}

bot.callbackQuery("sayberg:present", async (ctx) => {
  const game = getGame(ctx.chat.id);
  if (!game || game.status !== "attendance") {
    return ctx.answerCallbackQuery({ text: "Перекличка уже закончилась." });
  }
  const player = game.players.get(ctx.from.id);
  if (!player || !player.alive) {
    return ctx.answerCallbackQuery({ text: "Ты не участвуешь в этой арене." });
  }
  player.present = true;
  await ctx.answerCallbackQuery({ text: "Отметка принята!" });
});

async function finishAttendance(api, chatId) {
  const game = getGame(chatId);
  if (!game || game.status !== "attendance") return;
  game.status = "running";
  const absent = alivePlayers(game).filter((player) => !player.present);
  absent.forEach((player) => { player.alive = false; });
  await api.sendMessage(chatId, absent.length
    ? `📣 Перекличка завершена.\n❌ Не отметились и выбыли: ${absent.map(playerMention).join(", ")}`
    : "📣 Перекличка завершена. Все участники на месте!");
  if (alivePlayers(game).length <= 1) return finishSprint(api, chatId);
  setTimeout(() => runSprintRound(api, chatId).catch((err) => console.error("Sprint round error:", err)), 20000);
}

async function finishSprint(api, chatId) {
  const game = getGame(chatId);
  if (!game || game.status === "finished" || game.status === "stopped") return;
  game.status = "finished";
  const winner = alivePlayers(game)[0];
  const text = winner
    ? [
        `🏆 Победитель — ${playerMention(winner)} !!!`,
        "",
        `👤 Создатель арены — ${creatorMention(game)}`,
        `🎁 Приз — ${escapeHtml(game.prizes)}`,
        "",
        "⚠️ Напоминание: SayBerg лишь ведущий игр и не отвечает за выдачу призов.",
      ].join("\n")
    : "Игра завершена. Победителя нет.";
  await api.sendMessage(chatId, text, { parse_mode: "HTML" });
}

async function runSprintRound(api, chatId) {
  const game = getGame(chatId);
  if (!game || game.status !== "running") return;
  const alive = alivePlayers(game);
  if (alive.length <= 1) return finishSprint(api, chatId);
  game.round += 1;
  const victim = alive[Math.floor(Math.random() * alive.length)];
  victim.alive = false;
  await api.sendMessage(chatId, [
    `⚡ Раунд ${game.round}`,
    `❌ Убиты: ${playerMention(victim)}`,
    `🟢 Осталось: ${alivePlayers(game).length}`,
  ].join("\n"), { parse_mode: "HTML" });
  if (alivePlayers(game).length <= 1) return finishSprint(api, chatId);
  setTimeout(() => runSprintRound(api, chatId).catch((err) => console.error("Sprint round error:", err)), 20000);
}

bot.command("status", async (ctx) => {
  const game = getGame(ctx.chat.id);
  if (!game) return ctx.reply("В этой группе сейчас нет арены. Напиши /game.");
  await ctx.reply(game.status === "lobby" ? arenaCard(game) : gameSummary(game));
});

bot.command("endgame", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status === "finished" || game.status === "stopped") {
    return ctx.reply("Активной игры нет.");
  }
  if (ctx.from.id !== game.creatorId) {
    return ctx.reply("Завершить игру командой /endgame может только её создатель.");
  }
  if (game.startTimer) clearTimeout(game.startTimer);
  game.status = "finished";
  await ctx.reply("🏁 Создатель завершил игру. Игра окончена.");
});

bot.command("stopgame", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status === "finished" || game.status === "stopped") {
    return ctx.reply("Активной арены нет.");
  }
  const member = await ctx.getChatMember(ctx.from.id).catch(() => null);
  const isAdmin = member && ["administrator", "creator"].includes(member.status);
  if (ctx.from.id !== game.creatorId && !isAdmin) {
    return ctx.reply("Остановить арену может создатель или администратор группы.");
  }
  if (game.startTimer) clearTimeout(game.startTimer);
  game.status = "stopped";
  await ctx.reply("⏹ Арена остановлена.");
});

bot.catch((err) => console.error("Bot error:", err));

bot.start({
  onStart: (info) => console.log(`SayBerg started as @${info.username}`),
});
