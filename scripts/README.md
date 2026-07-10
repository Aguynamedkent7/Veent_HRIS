# Veent HRIS — Discord Time-Tracking Bot

A standalone Discord bot that replaces manual `#in-and-out` messages with a
persistent **Clock In / Clock Out** button panel. Button clicks are sent as
**HMAC-signed** requests to the HRIS `POST /api/v1/timesheets/log` endpoint,
which records a raw `TimeLog` punch against the employee linked by `discordId`.
HR later aggregates a week of punches into a reviewable weekly timesheet.

```
Discord member clicks button
        │
        ▼
scripts/discord-bot.ts ──HMAC-signed POST──▶ /api/v1/timesheets/log
        │                                          │
   ephemeral reply                          recordPunch() → TimeLog row
                                                   │
                              HR: aggregateTimeLogsToTimesheet() → weekly Timesheet → payroll
```

## Prerequisites

1. A Discord application + bot ([Developer Portal](https://discord.com/developers/applications)).
   - Copy the **bot token** → `DISCORD_BOT_TOKEN`.
   - Invite the bot to your server with the `bot` scope and **Send Messages** permission.
   - No privileged intents are required (the bot only uses `Guilds`).
2. The id of your `#in-and-out` channel (enable Developer Mode → right-click channel →
   Copy Channel ID) → `DISCORD_CHANNEL_ID`.
3. Each employee's Discord user id stored on their HRIS profile (`Employee.discordId`).
   Set it via HR (Employees) or `prisma studio`. Get a user's id in Discord with
   Developer Mode → right-click user → Copy User ID.

## Configuration

Add to `.env` (see `.env.example`):

```dotenv
TIMELOG_API_SECRET="<same random secret the HRIS uses>"
DISCORD_BOT_TOKEN="<bot token>"
DISCORD_CHANNEL_ID="<channel id>"
HRIS_API_URL="http://localhost:5173"   # or your deployed HRIS URL
```

`TIMELOG_API_SECRET` **must be identical** in the HRIS environment and the bot
environment — it is the shared key used to sign and verify every punch.

## Running

```bash
pnpm bot
```

On startup the bot finds (or posts) a single persistent panel in the channel, so
restarts don't spam it. Members click **Clock In** / **Clock Out** and get a
private (ephemeral) confirmation. For production, run it under a process manager
(pm2 / systemd) — that hardening is intentionally out of scope here.

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
| Panel not appearing | Bot lacks Send Messages permission, or wrong `DISCORD_CHANNEL_ID`. |
