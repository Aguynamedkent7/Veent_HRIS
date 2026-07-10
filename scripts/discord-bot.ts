/**
 * Veent HRIS — Discord time-tracking bot (standalone, run with `pnpm bot`).
 *
 * Posts one persistent message with "Clock In" / "Clock Out" buttons in the
 * configured channel. When a member clicks a button, the bot sends an
 * HMAC-signed POST to the HRIS `/api/v1/timesheets/log` endpoint carrying the
 * clicker's Discord user id, the punch type, and an ISO timestamp. The HRIS
 * resolves the employee by `discordId` and records a raw TimeLog punch.
 *
 * Required env (see scripts/README.md and .env.example):
 *   DISCORD_BOT_TOKEN   – bot token from the Discord developer portal
 *   DISCORD_CHANNEL_ID  – id of the #in-and-out channel
 *   HRIS_API_URL        – base URL of the HRIS, e.g. http://localhost:5173
 *   TIMELOG_API_SECRET  – shared secret, identical to the HRIS env value
 */

import 'dotenv/config'
import {
	Client,
	GatewayIntentBits,
	Events,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	type Interaction,
	type TextChannel
} from 'discord.js'
import { signPayload } from '../src/lib/server/hmac'

const { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, HRIS_API_URL, TIMELOG_API_SECRET } = process.env

for (const [key, value] of Object.entries({
	DISCORD_BOT_TOKEN,
	DISCORD_CHANNEL_ID,
	HRIS_API_URL,
	TIMELOG_API_SECRET
})) {
	if (!value) {
		console.error(`[bot] Missing required env var: ${key}`)
		process.exit(1)
	}
}

const CLOCK_IN = 'clock_in'
const CLOCK_OUT = 'clock_out'

function buildButtons() {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId(CLOCK_IN).setLabel('🟢 Clock In').setStyle(ButtonStyle.Success),
		new ButtonBuilder().setCustomId(CLOCK_OUT).setLabel('🔴 Clock Out').setStyle(ButtonStyle.Danger)
	)
}

const PANEL_TITLE = '**Veent HRIS — Time Tracking**'
const PANEL_BODY =
	`${PANEL_TITLE}\n` +
	'Use the buttons below to clock in when you start and clock out when you finish. ' +
	'Your punches are recorded against your employee profile and rolled up into your weekly timesheet.'

/** Post the panel once, or reuse an existing one so restarts do not spam the channel. */
async function ensurePanel(channel: TextChannel) {
	const recent = await channel.messages.fetch({ limit: 50 })
	const existing = recent.find(
		(m) =>
			m.author.id === channel.client.user?.id &&
			m.components.some((row) =>
				row.components.some((c) => 'customId' in c && (c.customId === CLOCK_IN || c.customId === CLOCK_OUT))
			)
	)

	if (existing) {
		console.log(`[bot] Reusing existing time-tracking panel: ${existing.id}`)
		await existing.edit({ content: PANEL_BODY, components: [buildButtons()] })
		return
	}

	const sent = await channel.send({ content: PANEL_BODY, components: [buildButtons()] })
	console.log(`[bot] Posted new time-tracking panel: ${sent.id}`)
}

async function sendPunch(discordId: string, punchType: 'IN' | 'OUT', messageId: string) {
	const payload = { discordId, punchType, timestamp: new Date().toISOString(), messageId }
	const rawBody = JSON.stringify(payload)
	const timestamp = Math.floor(Date.now() / 1000).toString()
	const signature = signPayload(rawBody, timestamp, TIMELOG_API_SECRET as string)

	const res = await fetch(`${HRIS_API_URL}/api/v1/timesheets/log`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-hris-signature': signature,
			'x-hris-timestamp': timestamp
		},
		body: rawBody
	})

	if (!res.ok) {
		const err = (await res.json().catch(() => ({}))) as { error?: string }
		throw new Error(err.error ?? `HRIS responded ${res.status}`)
	}
	return res.json() as Promise<{ data: { punchType: string } }>
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.once(Events.ClientReady, async (c) => {
	console.log(`[bot] Logged in as ${c.user.tag}`)
	const channel = await c.channels.fetch(DISCORD_CHANNEL_ID as string)
	if (!channel || !channel.isTextBased() || !('send' in channel)) {
		console.error('[bot] DISCORD_CHANNEL_ID is not a sendable text channel')
		process.exit(1)
	}
	await ensurePanel(channel as TextChannel)
})

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
	if (!interaction.isButton()) return
	if (interaction.customId !== CLOCK_IN && interaction.customId !== CLOCK_OUT) return

	const punchType = interaction.customId === CLOCK_IN ? 'IN' : 'OUT'
	await interaction.deferReply({ flags: MessageFlags.Ephemeral })

	try {
		await sendPunch(interaction.user.id, punchType, interaction.message.id)
		await interaction.editReply(
			punchType === 'IN'
				? '✅ Clocked **in**. Have a great shift!'
				: '✅ Clocked **out**. See you next time!'
		)
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Something went wrong'
		await interaction.editReply(
			`⚠️ Could not record your punch: ${message}\nIf this persists, ask HR to link your Discord account.`
		)
	}
})

client.login(DISCORD_BOT_TOKEN)
