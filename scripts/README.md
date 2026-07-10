# Veent HRIS — Discord Time-Tracking Bot

A standalone Discord bot that replaces manual `#in-and-out` messages with **slash commands**
`/in`, `/out`, and `/break`. The command is not a chat message; the bot sends an **HMAC-signed**
request to the HRIS `POST /api/v1/timesheets/log` endpoint (recording a `TimeLog` punch against the
employee linked by `discordId`), then posts a **public announcement** ("🟢 Elena clocked in at 9:00 AM")
so everyone sees who's in/out/on break. The invoker gets a private (ephemeral) acknowledgement.

- **`/break`** toggles — starts a break if none is open, otherwise ends it (the HRIS resolves
  `BREAK_START`/`BREAK_END` from the member's last punch).
- Each command takes an **optional `time`** (e.g. `/in 9:00`, `/out 5:30pm`) to backfill a forgotten
  punch; omit it and the current time is used. Times are interpreted in Philippine Standard Time.

```
/in [time]  /out [time]  /break [time]
        │
        ▼
scripts/discord-bot.ts ──HMAC-signed POST──▶ /api/v1/timesheets/log
        │                                          │
  public announcement                       recordPunch() → TimeLog row
  + ephemeral ack                                  │
                              HR: attendance derivation → timesheet/payroll
```

## Prerequisites

1. A Discord application + bot ([Developer Portal](https://discord.com/developers/applications)).
   - Copy the **bot token** → `DISCORD_BOT_TOKEN`.
   - Invite the bot with the `bot` **and `applications.commands`** scopes and **Send Messages** permission.
   - No privileged intents are required (the bot only uses `Guilds`).
   - Slash commands register automatically to every server the bot has joined (instant).
2. Each employee's Discord user id stored on their HRIS profile (`Employee.discordId`).
   Set it via HR (**Employees → employee → Discord ID**) or `prisma studio`. Get a user's id in
   Discord with Developer Mode → right-click user → Copy User ID.

## Configuration

Add to `.env` (see `.env.example`):

```dotenv
TIMELOG_API_SECRET="<same random secret the HRIS uses>"
DISCORD_BOT_TOKEN="<bot token>"
HRIS_API_URL="http://localhost:5173"   # or your deployed HRIS URL
```

`TIMELOG_API_SECRET` **must be identical** in the HRIS environment and the bot
environment — it is the shared key used to sign and verify every punch.

## Running

```bash
pnpm bot
```

On startup the bot registers `/in`, `/out`, `/break` to every server it has joined. Members type
`/in` (optionally `/in 9:00` to backfill), get a private confirmation, and the bot posts the public
announcement. For production, run it under a process manager (pm2 / systemd) — that hardening is
intentionally out of scope here.

## Security model

- Every request is signed: `HMAC-SHA256(key=TIMELOG_API_SECRET, msg=`\``${timestamp}.${rawBody}`\``)`,
  sent as `x-hris-signature` with the unix `x-hris-timestamp`.
- The endpoint recomputes the signature over the raw body and rejects it unless it
  matches **and** the timestamp is within ±5 minutes (replay protection).
- The bot never trusts client-supplied identity beyond the Discord user id; the HRIS
  maps that id → employee and refuses unknown/inactive accounts.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `⚠️ Could not record your punch: No active employee is linked…` | Set `Employee.discordId` for that member. |
| `Invalid or missing signature` (401) | `TIMELOG_API_SECRET` differs between bot and HRIS, or clock skew > 5 min. |
| Slash commands not showing | Bot invited without the `applications.commands` scope — re-invite with it. |
| Announcement not posted | Bot lacks **Send Messages** permission in that channel. |
| `Couldn't read the time` | Use a form like `9:00`, `13:30`, or `1:30pm`. |
