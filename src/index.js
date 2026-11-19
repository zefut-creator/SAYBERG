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
  ].join("\\n");
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
    `⏳ Старт через: ${formatDuration(game.startMinutes)}`,
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

  await api.sendMessage(chatId, "🚀 Арена начинается! Режим: ⚡ СПРИНТ.");
  await runSprintRound(api, chatId);
}

async function promptNext(ctx, draft) {
  const prompts = {
    description: "📝 Отправь описание арены:",
    maxPlayers: "👥 Укажи максимальное количество игроков (от 2 до 100):",
    winners: "🏆 Сколько будет победителей? Укажи число:",
    prizes: "🎁 Напиши призы:",
    startMinutes: "⏳ Через сколько минут начать арену? Напиши число минут (например, 5, 10 или 30):",
  };
  await ctx.reply(prompts[draft.step]);
}

bot.on("message:text", async (ctx, next) => {
  const chatId = String(ctx.chat.id);
  const draft = creationDrafts.get(chatId);
  if (!draft || ctx.from.id !== draft.creatorId || ctx.message.text.startsWith("/")) {
    return next();
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
    draft.step = "startMinutes";
  } else if (draft.step === "startMinutes") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 10080) {
      await ctx.reply("Укажи целое число минут от 1 до 10080 (7 дней).");
      return;
    }
    draft.startMinutes = n;

    const game = {
      chatId,
      creatorId: draft.creatorId,
      creatorName: draft.creatorName,
      status: "lobby",
      mode: "sprint",
      round: 0,
      players: new Map(),
      settings: { ...DEFAULT_SETTINGS },
      description: draft.description,
      maxPlayers: draft.maxPlayers,
      winners: draft.winners,
      prizes: draft.prizes,
      startMinutes: draft.startMinutes,
      createdAt: Date.now(),
    };
    game.players.set(ctx.from.id, {
      id: ctx.from.id,
      name: draft.creatorName,
      alive: true,
    });
    games.set(chatId, game);
    creationDrafts.delete(chatId);

    await ctx.reply(arenaCard(game), { reply_markup: lobbyKeyboard() });
    await ctx.reply("Управление ареной:", { reply_markup: arenaControlsKeyboard() });
    game.startTimer = setTimeout(() => {
      publishArena(bot.api, chatId).catch((err) => console.error("Arena start error:", err));
    }, n * 60 * 1000);
    return;
  }

  await promptNext(ctx, draft);
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "⚡ Привет! Я SayBerg — игровой бот для групп.\n\n" +
    "Добавь меня в группу и напиши /game, чтобы создать арену.\n" +
    "Первый доступный режим: ⚡ СПРИНТ."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Команды SayBerg:\n" +
    "/game — создать арену в этой группе\n" +
    "/join — присоединиться\n" +
    "/startgame — начать раньше таймера (создатель)\n" +
    "/status — состояние арены\n" +
    "/stopgame — остановить арену\n" +
    "/cancel — отменить создание арены"
  );
});

bot.command("game", async (ctx) => {
  if (!ctx.chat || ctx.chat.type === "private") {
    return ctx.reply("Создавать арены можно в группах. Добавь меня в нужную группу.");
  }

  const chatId = String(ctx.chat.id);
  const existing = getGame(chatId);
  if (existing && existing.status !== "finished" && existing.status !== "stopped") {
    return ctx.reply("В этой группе уже есть активная арена. Напиши /status.");
  }
  if (creationDrafts.has(chatId)) {
    return ctx.reply("Создание арены уже начато. Продолжай отвечать на вопросы или напиши /cancel.");
  }

  const creator = ctx.from;
  const draft = {
    creatorId: creator.id,
    creatorName: [creator.first_name, creator.last_name].filter(Boolean).join(" ") || creator.username || "Создатель",
    step: "description",
  };
  creationDrafts.set(chatId, draft);
  await ctx.reply("⚡ Создание новой арены.\n\nНапиши /cancel, если передумал.");
  await promptNext(ctx, draft);
});

bot.command("cancel", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const draft = creationDrafts.get(chatId);
  if (draft && draft.creatorId === ctx.from.id) {
    creationDrafts.delete(chatId);
    return ctx.reply("Создание арены отменено.");
  }
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
  game.players.set(user.id, { id: user.id, name, alive: true });
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
  game.players.set(user.id, { id: user.id, name, alive: true });
  await ctx.reply(`➕ ${name} присоединился. Игроков: ${game.players.size}/${game.maxPlayers}`);
});

bot.command("startgame", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status !== "lobby") return ctx.reply("Нет ожидающей арены.");
  if (ctx.from.id !== game.creatorId) return ctx.reply("Начать раньше таймера может только создатель.");
  await publishArena(ctx.api, chatId);
});

async function runSprintRound(api, chatId) {
  const game = getGame(chatId);
  if (!game || game.status !== "running") return;

  const alive = alivePlayers(game);
  if (alive.length <= 1) {
    game.status = "finished";
    const winner = alive[0];
    await api.sendMessage(chatId, winner
      ? `🏆 ${winner.name} победил в SayBerg — СПРИНТ!`
      : "Раунд завершён. Победителей нет.");
    return;
  }

  game.round += 1;
  const percent = game.round === 1 ? game.settings.firstElimination : game.settings.nextElimination;
  const eliminationCount = Math.min(alive.length - 1, Math.max(1, Math.floor(alive.length * percent / 100)));
  const shuffled = [...alive];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const eliminated = shuffled.slice(0, eliminationCount);
  eliminated.forEach((player) => { player.alive = false; });

  await api.sendMessage(chatId, [
    `⚡ СПРИНТ — раунд ${game.round}`,
    "",
    `🎲 Случайный отбор: ${percent}%`,
    `❌ Выбыли: ${eliminated.map((p) => p.name).join(", ")}`,
    `🟢 Осталось игроков: ${alivePlayers(game).length}`,
    "",
    playersText(game),
  ].join("\n"));

  if (alivePlayers(game).length <= 1) {
    const winner = alivePlayers(game)[0];
    game.status = "finished";
    await api.sendMessage(chatId, winner
      ? `🏆 ${winner.name} — победитель SayBerg!`
      : "Игра завершена.");
    return;
  }

  setTimeout(() => runSprintRound(api, chatId).catch((err) => console.error("Sprint round error:", err)), 5000);
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
