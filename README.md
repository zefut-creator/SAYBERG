# SayBerg

Telegram group-game bot. Players interact with the bot directly in group chats; there is no player-facing website.

## Current first build

- Separate game room per Telegram group
- Anyone can create a room with `/game`
- Players join with the button or `/join`
- Room creator starts with the button or `/startgame`
- First mode: **Sprint** — random eliminations (35% in round 1, then 15%)
- `/status`, `/stopgame`, and `/help`

## Run locally

Requires Node.js 20+.

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env`
3. Put the bot token in `.env` as `BOT_TOKEN=...`
4. Start: `npm start`

Never commit `.env` or share your bot token.

## Hosting

Deploy as a Node.js worker/service and set the environment variable `BOT_TOKEN`. The process must stay running. This initial version uses in-memory game state, so active games reset if the process restarts; persistent storage and production hardening are next.
