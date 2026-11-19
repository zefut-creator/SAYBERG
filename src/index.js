require("dotenv").config();

const { Bot, InlineKeyboard } = require("grammy");

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is missing. Add it to the hosting environment variables.");
  process.exit(1);
}

const bot = new Bot(token);

// Each Telegram group gets its own independent game session.
// This first version stores sessions in memory; persistence will be added before production.
const games = new Map();

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
  return players
    .map((p, i) => `${i + 1}. ${p.name} — ${p.alive ? "🟢 в игре" : "❌ выбыл"}`)
    .join("\n");
}

function lobbyKeyboard() {
  return new InlineKeyboard()
    .text("➕ Войти", "sayberg:join")
    .text("🚀 Начать", "sayberg:start");
}

function gameSummary(game) {
  return [
    "⚡ **SAYBERG — СПРИНТ**",
    "",
    `Раунд: ${game.round}`,
    `Игроков в игре: ${alivePlayers(game).length}/${game.players.size}`,
    "",
    playersText(game),
  ].join("\n");
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    "⚡ Привет! Я SayBerg — игровой бот для групп.\n\n" +
    "Добавь меня в группу и напиши /game, чтобы создать игру.\n" +
    "Первый доступный режим: ⚡ СПРИНТ."
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Команды SayBerg:\n" +
    "/game — создать игру в этой группе\n" +
    "/join — присоединиться\n" +
    "/startgame — начать игру (создатель)\n" +
    "/status — показать состояние игры\n" +
    "/stopgame — остановить игру (создатель или администратор)"
  );
});

bot.command("game", async (ctx) => {
  if (!ctx.chat || ctx.chat.type === "private") {
    return ctx.reply("Создавать игры можно в группах. Добавь меня в нужную группу.");
  }

  const chatId = String(ctx.chat.id);
  const existing = getGame(chatId);
  if (existing && existing.status !== "finished" && existing.status !== "stopped") {
    return ctx.reply("В этой группе уже есть активная игра. Напиши /status.");
  }

  const creator = ctx.from;
  const game = {
    chatId,
    creatorId: creator.id,
    creatorName: creator.first_name || "Создатель",
    status: "lobby",
    mode: "sprint",
    round: 0,
    players: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    createdAt: Date.now(),
  };

  game.players.set(creator.id, {
    id: creator.id,
    name: creator.first_name || "Игрок",
    alive: true,
  });
  games.set(chatId, game);

  await ctx.reply(
    "⚡ **SayBerg — СПРИНТ**\n\n" +
    "Создана игровая комната! Нажимайте «Войти», чтобы присоединиться.\n" +
    `Создатель: ${game.creatorName}\n` +
    "Выбывание: 35% в первом раунде, затем 15%.\n\n" +
    "Когда все готовы, создатель нажимает «Начать».",
    { parse_mode: "Markdown", reply_markup: lobbyKeyboard() }
  );
});

async function joinGame(ctx) {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status !== "lobby") {
    return ctx.answerCallbackQuery({ text: "Сейчас нет комнаты для входа." });
  }

  const user = ctx.from;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Игрок";
  game.players.set(user.id, { id: user.id, name, alive: true });
  await ctx.answerCallbackQuery({ text: "Ты в игре!" });
  await ctx.editMessageText(
    "⚡ **SayBerg — СПРИНТ**\n\n" +
    "Комната открыта для игроков.\n" +
    `Участников: ${game.players.size}\n\n` +
    playersText(game) +
    "\n\nСоздатель может начинать игру.",
    { parse_mode: "Markdown", reply_markup: lobbyKeyboard() }
  ).catch(() => {});
}

async function startGame(ctx) {
  const chatId = String(ctx.chat.id);
  const game = getGame(chatId);
  if (!game || game.status !== "lobby") {
    return ctx.answerCallbackQuery({ text: "Нет ожидающей игры." });
  }
  if (ctx.from.id !== game.creatorId) {
    return ctx.answerCallbackQuery({ text: "Начать игру может только создатель." });
  }
  if (game.players.size < 2) {
    return ctx.answerCallbackQuery({ text: "Нужно минимум 2 игрока." });
  }

  game.status = "running";
  await ctx.answerCallbackQuery({ text: "Игра началась!" });
  await runSprintRound(ctx.api, chatId);
}

bot.callbackQuery("sayberg:join", joinGame);
bot.callbackQuery("sayberg:start", startGame);

bot.command("join", async (ctx) => {
  const game = getGame(ctx.chat.id);
  if (!game || game.status !== "lobby") return ctx.reply("Сейчас нет комнаты для входа. Напиши /game.");
  const user = ctx.from;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "Игрок";
  game.players.set(user.id, { id: user.id, name, alive: true });
  await ctx.reply(`➕ ${name} присоединился. Игроков: ${game.players.size}`);
});

bot.command("startgame", async (ctx) => {
  const game = getGame(ctx.chat.id);
  if (!game || game.status !== "lobby") return ctx.reply("Нет комнаты, которую можно начать.");
  if (ctx.from.id !== game.creatorId) return ctx.reply("Начать игру может только её создатель.");
  if (game.players.size < 2) return ctx.reply("Нужно минимум 2 игрока.");
  game.status = "running";
  await ctx.reply("🚀 СПРИНТ начинается!");
  await runSprintRound(ctx.api, String(ctx.chat.id));
});

async function runSprintRound(api, chatId) {
  const game = getGame(chatId);
  if (!game || game.status !== "running") return;

  const alive = alivePlayers(game);
  if (alive.length <= 1) {
    game.status = "finished";
    const winner = alive[0];
    await api.sendMessage(chatId, winner
      ? `🏆 **${winner.name}** победил в SayBerg — СПРИНТ!`
      : "Раунд завершён. Победителей нет.", { parse_mode: "Markdown" });
    return;
  }

  game.round += 1;
  const percent = game.round === 1
    ? game.settings.firstElimination
    : game.settings.nextElimination;
  const eliminationCount = Math.min(alive.length - 1, Math.max(1, Math.floor(alive.length * percent / 100)));
  const shuffled = [...alive].sort(() => Math.random() - 0.5);
  const eliminated = shuffled.slice(0, eliminationCount);
  eliminated.forEach((player) => { player.alive = false; });

  const lines = [
    `⚡ **СПРИНТ — раунд ${game.round}**`,
    "",
    `🎲 Случайный отбор: ${percent}%`,
    `❌ Выбыли: ${eliminated.map((p) => p.name).join(", ")}`,
    `🟢 Осталось игроков: ${alivePlayers(game).length}`,
    "",
    playersText(game),
  ];

  await api.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });

  if (alivePlayers(game).length <= 1) {
    const winner = alivePlayers(game)[0];
    game.status = "finished";
    await api.sendMessage(chatId,
      winner ? `🏆 **${winner.name}** — победитель SayBerg!` : "Игра завершена.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Short pause keeps rounds readable in a busy group.
  setTimeout(() => runSprintRound(api, chatId).catch((err) => console.error("Sprint round error:", err)), 5000);
}

bot.command("status", async (ctx) => {
  const game = getGame(ctx.chat.id);
  if (!game) return ctx.reply("В этой группе сейчас нет игры. Напиши /game.");
  await ctx.reply(gameSummary(game), { parse_mode: "Markdown" });
});

bot.command("stopgame", async (ctx) => {
  const game = getGame(ctx.chat.id);
  if (!game || game.status === "finished" || game.status === "stopped") {
    return ctx.reply("Активной игры нет.");
  }
  const member = await ctx.getChatMember(ctx.from.id).catch(() => null);
  const isAdmin = member && ["administrator", "creator"].includes(member.status);
  if (ctx.from.id !== game.creatorId && !isAdmin) {
    return ctx.reply("Остановить игру может создатель или администратор группы.");
  }
  game.status = "stopped";
  await ctx.reply("⏹ Игра остановлена.");
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.start({
  onStart: (info) => console.log(`SayBerg started as @${info.username}`),
});
