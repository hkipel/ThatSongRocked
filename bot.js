require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");
const { google } = require("googleapis");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const EXCLUDED_USER_IDS = ["578024967057309726"];
const CRON_SCHEDULE = "0 14 * * 1-5";          // 10:00 AM EDT (UTC-4), Mon–Fri
const MESSAGE_TEMPLATE = (user) => `🎵 THAT SONG ROCKED! ${user} - it's your turn to pick an older song that ROCKED! 🎶`;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "Log";
// ─────────────────────────────────────────────────────────────────────────────

// Google Sheets auth
// Locally: reads credentials.json from this folder
// On Railway: reads the GOOGLE_CREDENTIALS environment variable
const authConfig = process.env.GOOGLE_CREDENTIALS
  ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS), scopes: ["https://www.googleapis.com/auth/spreadsheets"] }
  : { keyFile: "credentials.json", scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
const auth = new google.auth.GoogleAuth(authConfig);
const sheets = google.sheets({ version: "v4", auth });

async function logToSheet(type, username, content = "") {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:D`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[type, timestamp, username, content]] },
    });
    console.log(`📊 Logged to sheet: [${type}] ${username}`);
  } catch (err) {
    console.error("❌ Error logging to sheet:", err);
  }
}

// Keeps track of the last message the bot sent and who was picked
let lastBotMessage = null;
let lastPickedUserId = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`⏰ Scheduled to run: ${CRON_SCHEDULE} (UTC)`);

  // Uncomment the line below to send a test message immediately on startup
   pickAndMention();

  cron.schedule(CRON_SCHEDULE, async () => {
    await pickAndMention();
  });
});

// Listens for replies to the bot's message and logs them
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== CHANNEL_ID) return;
  if (!lastBotMessage) return;
  if (message.reference?.messageId !== lastBotMessage.id) return;
  if (message.author.id !== lastPickedUserId) return;

  console.log(`💬 Reply from ${message.author.tag}: ${message.content}`);
  await logToSheet("REPLY", message.author.tag, message.content);
});

async function getChannelMembers(channel) {
  const guild = channel.guild;
  await guild.members.fetch(); // populate cache

  // Filter to members who have permission to view this channel, excluding bots
  const members = guild.members.cache.filter((member) => {
    if (member.user.bot) return false;
    if (EXCLUDED_USER_IDS.includes(member.user.id)) return false;
    const perms = channel.permissionsFor(member);
    return perms && perms.has("ViewChannel") && perms.has("SendMessages");
  });

  return members;
}

async function pickAndMention() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      console.error("❌ Channel not found or is not a text channel.");
      return;
    }

    const members = await getChannelMembers(channel);

    if (members.size === 0) {
      console.warn("⚠️ No eligible members found in this channel.");
      return;
    }

    const randomMember = members.random();

    lastBotMessage = await channel.send(MESSAGE_TEMPLATE(randomMember.toString()));
    lastPickedUserId = randomMember.user.id;
    console.log(`📣 Mentioned ${randomMember.user.tag} at ${new Date().toISOString()}`);
    console.log(`👥 Picked from pool of ${members.size} eligible channel members`);

    await logToSheet("PICK", randomMember.user.tag);
  } catch (err) {
    console.error("❌ Error picking member:", err);
  }
}

client.login(TOKEN);
