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
announcement. `pnpm bot` is fine for local development, but for production run it under a process
manager so it restarts on crash and on server reboot — see **Production deployment** below.

## Production deployment

The bot is a single long-lived process. It holds one Discord gateway connection and makes outbound
HMAC-signed HTTP calls to the HRIS — it does **not** listen on any port, so there is nothing to
reverse-proxy. Production hardening is therefore just: keep it running, restart it on failure, start
it on boot, and rotate its logs. Either pm2 or systemd below does this; pick one.

Run the bot from the repo root with the same `.env` used by `pnpm bot`. Ensure `tsx` is installed
(it is a dev dependency; on a production box run `pnpm install` or install `tsx` globally).

### Option A — pm2

Good if you already manage other Node processes with pm2. Create `ecosystem.config.cjs` in the repo
root:

```js
module.exports = {
	apps: [
		{
			name: 'veent-hris-bot',
			script: 'pnpm',
			args: 'bot',
			cwd: '/opt/veent-hris', // absolute path to the repo on the server
			autorestart: true,
			max_restarts: 10,
			restart_delay: 5000, // back off 5s between restarts to avoid Discord rate limits
			env: { NODE_ENV: 'production' }
		}
	]
}
```

```bash
pm2 start ecosystem.config.cjs
pm2 save                     # persist the process list
pm2 startup                  # print the command to enable pm2 on boot — run what it prints
pm2 logs veent-hris-bot      # tail logs
```

pm2 captures stdout/stderr and rotates logs if you add the `pm2-logrotate` module
(`pm2 install pm2-logrotate`).

### Option B — systemd (no pm2 dependency)

Preferred if you want the bot supervised by the OS with no extra runtime. Create
`/etc/systemd/system/veent-hris-bot.service`:

```ini
[Unit]
Description=Veent HRIS Discord time-tracking bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=veent
WorkingDirectory=/opt/veent-hris
EnvironmentFile=/opt/veent-hris/.env
ExecStart=/usr/bin/pnpm bot
Restart=on-failure
RestartSec=5
# Discord rate-limits reconnect storms; cap restart attempts per window.
StartLimitIntervalSec=60
StartLimitBurst=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now veent-hris-bot   # start now + on boot
sudo systemctl status veent-hris-bot
journalctl -u veent-hris-bot -f              # tail logs (rotated by journald)
```

Notes:

- `EnvironmentFile` reads the same `.env` (`DISCORD_BOT_TOKEN`, `HRIS_API_URL`, `TIMELOG_API_SECRET`).
  Keep it `chmod 600` and owned by the service user — it holds the bot token and HMAC secret.
- If `pnpm` is not on the system `PATH` for the service user, use the absolute path in `ExecStart`
  (`which pnpm`), or `ExecStart=/usr/bin/node /path/to/tsx scripts/discord-bot.ts`.
- After a code update, `sudo systemctl restart veent-hris-bot` (pm2: `pm2 restart veent-hris-bot`).

### Health & recovery

- On boot the bot re-registers `/in`, `/out`, `/break` in every guild — restarting is always safe and
  idempotent, no manual re-registration needed.
- A wrong or revoked `DISCORD_BOT_TOKEN` makes login fail immediately; the process exits and the
  supervisor keeps retrying. Check the logs — do **not** raise `max_restarts` to mask a bad token.
- The bot is stateless: every punch is derived from the member's last `TimeLog` by the HRIS, so a
  restart never loses or double-counts punches.

## Fallback when the bot is down

Punching is a convenience layer over `TimeLog`; attendance is never blocked by the bot being offline.
If the bot is unavailable (deploy in progress, token issue, Discord outage), record time via either:

- **HRIS timesheet review UI** — HR can add or edit punches directly on the timesheet review page,
  then aggregate and approve as usual. This is the normal correction path for a missed or wrong punch.
- **Backfill after recovery** — once the bot is back, members can supply the forgotten time inline:
  `/in 9:00`, `/out 5:30pm`. The optional `time` argument writes the punch at the intended PHT time
  rather than "now", so a bot outage during the day can be reconciled without HR intervention.

Because `/break` and the `IN`/`OUT` resolution are computed from the member's last punch on the HRIS
side, these fallback edits and later slash commands stay consistent with each other automatically.

## Security model

- Every request is signed: `HMAC-SHA256(key=TIMELOG_API_SECRET, msg=`\``${timestamp}.${rawBody}`\``)`,
  sent as `x-hris-signature` with the unix `x-hris-timestamp`.
- The endpoint recomputes the signature over the raw body and rejects it unless it
  matches **and** the timestamp is within ±5 minutes (replay protection).
- The bot never trusts client-supplied identity beyond the Discord user id; the HRIS
  maps that id → employee and refuses unknown/inactive accounts.

## Troubleshooting

| Symptom                                                         | Cause / fix                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `⚠️ Could not record your punch: No active employee is linked…` | Set `Employee.discordId` for that member.                                  |
| `Invalid or missing signature` (401)                            | `TIMELOG_API_SECRET` differs between bot and HRIS, or clock skew > 5 min.  |
| Slash commands not showing                                      | Bot invited without the `applications.commands` scope — re-invite with it. |
| Announcement not posted                                         | Bot lacks **Send Messages** permission in that channel.                    |
| `Couldn't read the time`                                        | Use a form like `9:00`, `13:30`, or `1:30pm`.                              |
