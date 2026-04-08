require("dotenv").config();

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const cron = require("node-cron");
const { google } = require("googleapis");
// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const EXCLUDED_USER_IDS = ["578024967057309726"];
const CRON_SCHEDULE = "0 14 * * 1-5";          // 10:00 AM EDT (UTC-4), Mon–Fri
const MESSAGE_TEMPLATE = (user) => `🎵 ${user} - it's your turn to pick a song that rocked! 🎶`;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "Log";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`;
// ─────────────────────────────────────────────────────────────────────────────

// Google Sheets auth
// Locally: reads credentials.json from this folder
// On Railway: reads the GOOGLE_CREDENTIALS environment variable
const authConfig = process.env.GOOGLE_CREDENTIALS
  ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS), scopes: ["https://www.googleapis.com/auth/spreadsheets"] }
  : { keyFile: "credentials.json", scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
const auth = new google.auth.GoogleAuth(authConfig);
const sheets = google.sheets({ version: "v4", auth });

// Strips the bot's @mention tag from message content before logging
function cleanContent(message) {
  return message.content.replace(`<@${client.user.id}>`, "").trim();
}

// Appends a mention to a new sheet row and returns the row number
async function logMention(username, content) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:D`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[timestamp, username, content, ""]] },
    });
    const updatedRange = response.data.updates.updatedRange;
    const rowMatch = updatedRange.match(/(\d+)$/);
    const row = rowMatch ? parseInt(rowMatch[1]) : null;
    console.log(`📊 Logged mention from ${username} to row ${row}`);
    return row;
  } catch (err) {
    console.error("❌ Error logging mention to sheet:", err);
    return null;
  }
}

// Logs the user to a new row and saves the row number for the reply
async function logPick(username) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:D`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[timestamp, username, ""]] },
    });
    // Parse the row number from the response (e.g. "Log!A5:D5" → 5)
    const updatedRange = response.data.updates.updatedRange;
    const rowMatch = updatedRange.match(/(\d+)$/);
    lastLoggedRow = rowMatch ? parseInt(rowMatch[1]) : null;
    console.log(`📊 Logged PICK to sheet row ${lastLoggedRow}: ${username}`);
  } catch (err) {
    console.error("❌ Error logging pick to sheet:", err);
  }
}

// Updates column D with the current non-bot 🔥 count for a given row
async function logFireCount(count, row) {
  if (!row) return;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!D${row}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[count]] },
    });
    console.log(`📊 Updated 🔥 count to ${count} on row ${row}`);
  } catch (err) {
    console.error("❌ Error updating fire count:", err);
  }
}

// Updates the same row with the reply when it comes in
async function logReply(content) {
  if (!lastLoggedRow) return;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!C${lastLoggedRow}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[content]] },
    });
    console.log(`📊 Logged REPLY to sheet row ${lastLoggedRow}`);
  } catch (err) {
    console.error("❌ Error logging reply to sheet:", err);
  }
}

// Keeps track of the last message the bot sent, who was picked, and their reply
let lastBotMessage = null;
let lastPickedUserId = null;
let lastLoggedRow = null;
let lastReplyMessage = null;
let lastMentionMessage = null;
let lastMentionRow = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`⏰ Scheduled to run: ${CRON_SCHEDULE} (UTC)`);

  // Uncomment the line below to send a test message immediately on startup
  // pickAndMention();

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
  await logReply(cleanContent(message));

  lastReplyMessage = message;
  await message.react("🔥");

  await message.reply(
    `🎸 That song rocked. 
    
    Your entry & it's 🔥 rating will been logged on row **${lastLoggedRow}** of the sheet:\n${SHEET_URL}`
  );
});

// Listens for bot mentions and logs them to the sheet
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.users.has(client.user.id)) return;
  // Skip if this is already handled by the song reply flow
  if (message.reference?.messageId === lastBotMessage?.id && message.author.id === lastPickedUserId) return;

  console.log(`📣 Mentioned by ${message.author.tag}: ${message.content}`);
  const row = await logMention(message.author.tag, cleanContent(message));

  if (row) {
    lastMentionMessage = message;
    lastMentionRow = row;
    await message.react("🔥");
    await message.reply(
      `🎸 That song rocked! Your entry & its 🔥 rating will be logged on row **${row}** of the sheet:\n${SHEET_URL}`
    );
  }
});

// Fires on every 🔥 reaction add or remove on song replies and mention messages
async function handleFireReaction(reaction, _user) {
  if (reaction.partial) await reaction.fetch();
  if (reaction.emoji.name !== "🔥") return;

  let targetRow = null;
  if (lastReplyMessage && reaction.message.id === lastReplyMessage.id) {
    targetRow = lastLoggedRow;
  } else if (lastMentionMessage && reaction.message.id === lastMentionMessage.id) {
    targetRow = lastMentionRow;
  } else {
    return;
  }

  const users = await reaction.users.fetch();
  const nonBotCount = users.filter((u) => !u.bot).size;
  await logFireCount(nonBotCount, targetRow);
}

client.on("messageReactionAdd", handleFireReaction);
client.on("messageReactionRemove", handleFireReaction);

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

    await logPick(randomMember.user.tag);
  } catch (err) {
    console.error("❌ Error picking member:", err);
  }
}

client.login(TOKEN);
