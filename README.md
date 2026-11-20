# SayBerg

Telegram group-game bot. Games run inside Telegram groups; arena creation is configured in the bot's private chat.

## Modes

- **Arena** — event choices, protective shields, and a revival round.
- **Sprint** — roll-call, timed rounds, elimination order, multiple winners.
- **Rooms** — choose one of four rooms; one is dangerous.
- **Rooms X2** — two lives, double-danger rounds, and an ALL IN option.
- **Click-Clack** — reaction race; fastest earns a point, slowest loses a life.
- **Searchers** — hide in a room; the checked room is revealed after the round.
- **Wanted** — clue-based six-window search, 10 rounds, points leaderboard.
- **Ohueberg** — random mini-games: math, color guess, and reaction.
- **Dice Tournament** — 15-round number prediction for game points; no betting.
- **Umnik** — 15 multiple-choice rounds. The creator can add up to 30 custom questions.

## Create a game

1. Add the bot to a group and send /register there.
2. Open the bot's private chat and send /game.
3. Select the group and game mode.
4. Complete the setup prompts.
5. Players join using the arena card; the creator starts the game.

For Umnik, before starting, the creator can add questions in the group:

    /addquestion Question text | correct answer | wrong answer 2 | wrong answer 3

The correct answer is the first answer after the first |. Add up to 30 questions.

## Commands

- /start — bot intro
- /help — commands
- /register — register this group
- /game — create an arena in private chat
- /join — join an open arena
- /startgame — creator starts
- /status — show current arena
- /stopgame — creator/admin stops the arena
- /endgame — creator ends the current game
- /cancel — cancel setup or a lobby
- /addquestion — add a custom Umnik question

## Hosting and limitations

Requires Node.js 20+. Set BOT_TOKEN in Railway Variables. Never commit .env or share the bot token.

Game state and registered groups are currently kept in process memory. A Railway restart or redeploy clears active games and group registrations; send /register again in each group after a restart. Persistent storage is a separate next step.