require("dotenv").config();

console.log("🔍 ENV CHECK:");
console.log("  SPOTIFY_CLIENT_ID:", process.env.SPOTIFY_CLIENT_ID ? "✅ set" : "❌ missing");
console.log("  SPOTIFY_CLIENT_SECRET:", process.env.SPOTIFY_CLIENT_SECRET ? "✅ set" : "❌ missing");
console.log("  SPOTIFY_REFRESH_TOKEN:", process.env.SPOTIFY_REFRESH_TOKEN ? "✅ set" : "❌ missing");
console.log("  SPOTIFY_PLAYLIST_ID:", process.env.SPOTIFY_PLAYLIST_ID ? "✅ set" : "❌ missing");

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const cron = require("node-cron");
const { google } = require("googleapis");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN              = process.env.DISCORD_TOKEN;
const CHANNEL_ID         = process.env.DISCORD_CHANNEL_ID;
const EXCLUDED_USER_IDS  = ["578024967057309726"];
const CRON_SCHEDULE      = "0 14 * * 1-5";         // 10:00 AM EDT (UTC-4), Mon–Fri
const MESSAGE_TEMPLATE   = (user) => `🎵 ${user} - it's your turn to pick a song that rocked! Reply to this message with a Spotify track link 🎶`;
const SPREADSHEET_ID     = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME         = "Log";
const SHEET_URL          = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}`;

// Spotify
const SPOTIFY_CLIENT_ID      = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET  = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REFRESH_TOKEN  = process.env.SPOTIFY_REFRESH_TOKEN;
const SPOTIFY_PLAYLIST_ID    = process.env.SPOTIFY_PLAYLIST_ID;

const SPOTIFY_PLAYLIST_URL = `https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`;
const SPOTIFY_TRACK_REGEX  = /https:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/;
// ─────────────────────────────────────────────────────────────────────────────

// ── Google Sheets Auth ────────────────────────────────────────────────────────
const authConfig = process.env.GOOGLE_CREDENTIALS
  ? { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS), scopes: ["https://www.googleapis.com/auth/spreadsheets"] }
  : { keyFile: "credentials.json", scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
const auth   = new google.auth.GoogleAuth(authConfig);
const sheets = google.sheets({ version: "v4", auth });


// ── Spotify Auth ──────────────────────────────────────────────────────────────
let spotifyAccessToken = null;

async function refreshSpotifyToken() {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  const data = await response.json();
  if (!data.access_token) throw new Error(`Spotify token refresh failed: ${JSON.stringify(data)}`);
  spotifyAccessToken = data.access_token;
  console.log("🔑 Spotify access token refreshed.");
}

async function getTrackInfo(trackId) {
  const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${spotifyAccessToken}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    name:   data.name,
    artist: data.artists.map((a) => a.name).join(", "),
  };
}

async function addTrackToPlaylist(trackId) {
  const response = await fetch(`https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/items`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${spotifyAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
  const json = await response.json();
  console.log("🔍 Spotify response status:", response.status);
  console.log("🔍 Spotify response body:", JSON.stringify(json));
  console.log("🔍 Playlist ID being used:", SPOTIFY_PLAYLIST_ID);
  console.log("🔍 Access token (first 20 chars):", spotifyAccessToken?.slice(0, 20));
  if (!response.ok) {
    throw new Error(`Spotify API error: ${JSON.stringify(json)}`);
  }
  return json;
}

// ── Sheets Helpers ────────────────────────────────────────────────────────────
function cleanContent(message) {
  return message.content.replace(`<@${client.user.id}>`, "").trim();
}

async function findRowById(id) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!E:E`,
  });
  const rows = response.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === String(id)) return i + 1; // 1-indexed
  }
  return null;
}

async function logMention(username, content, messageId) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[timestamp, username, content, "", String(messageId)]] },
    });
    console.log(`📊 Logged mention from ${username} (message ID: ${messageId})`);
  } catch (err) {
    console.error("❌ Error logging mention to sheet:", err);
  }
}

async function logPick(username, messageId) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[timestamp, username, "", "", String(messageId)]] },
    });
    console.log(`📊 Logged PICK to sheet: ${username} (message ID: ${messageId})`);
  } catch (err) {
    console.error("❌ Error logging pick to sheet:", err);
  }
}

async function logFireCount(count, messageId) {
  if (!messageId) return;
  const row = await findRowById(messageId);
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

async function logReply(content, messageId) {
  if (!messageId) return;
  const row = await findRowById(messageId);
  if (!row) return;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!C${row}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[content]] },
    });
    console.log(`📊 Logged REPLY to sheet row ${row}`);
  } catch (err) {
    console.error("❌ Error logging reply to sheet:", err);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
let lastBotMessage      = null;
let lastPickedUserId    = null;
let lastReplyMessage    = null;
let lastMentionMessage  = null;
let lastPickMessageId   = null;
let lastMentionMessageId = null;

// ── Discord Client ────────────────────────────────────────────────────────────
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

// ── Song Reply Handler ────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== CHANNEL_ID) return;
  if (!lastBotMessage) return;
  if (message.reference?.messageId !== lastBotMessage.id) return;
  if (message.author.id !== lastPickedUserId) return;

  console.log(`💬 Reply from ${message.author.tag}: ${message.content}`);

  // Check for Spotify link
  const spotifyMatch = message.content.match(SPOTIFY_TRACK_REGEX);

  if (!spotifyMatch) {
    await message.reply("❌ Please reply with a Spotify track link. It should look like:\n`https://open.spotify.com/track/...`\n\nOpen Spotify, find your song, tap **Share → Copy Song Link**, and paste it here.");
    return;
  }

  // Valid Spotify link — add to playlist
  const trackId = spotifyMatch[1];
  let trackLabel = "your track";

  try {
    await refreshSpotifyToken();
    const trackInfo = await getTrackInfo(trackId);
    await addTrackToPlaylist(trackId);
    if (trackInfo) trackLabel = `**${trackInfo.name}** by ${trackInfo.artist}`;
    console.log(`🎵 Added track ${trackId} submitted by ${message.author.tag}`);
  } catch (err) {
    console.error("❌ Spotify error:", err.message);
    await message.reply("⚠️ Something went wrong adding that track to Spotify. Please try again or let an admin know.");
    return;
  }

  // Log to sheet and react
  await logReply(cleanContent(message), lastPickMessageId);
  lastReplyMessage = message;
  await message.react("🔥");

  await message.reply(
    `🎸 ${trackLabel} has been added to the playlist: ${SPOTIFY_PLAYLIST_URL}\n\nYour entry & its 🔥 rating will be logged in the sheet:\n${SHEET_URL}`
  );
});

// ── Mention Handler ───────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== CHANNEL_ID) return;
  if (!message.mentions.users.has(client.user.id)) return;
  if (message.reference?.messageId === lastBotMessage?.id && message.author.id === lastPickedUserId) return;

  console.log(`📣 Mentioned by ${message.author.tag}: ${message.content}`);

  const spotifyMatch = message.content.match(SPOTIFY_TRACK_REGEX);
  let trackLabel = null;

  if (spotifyMatch) {
    const trackId = spotifyMatch[1];
    try {
      await refreshSpotifyToken();
      const trackInfo = await getTrackInfo(trackId);
      await addTrackToPlaylist(trackId);
      if (trackInfo) trackLabel = `**${trackInfo.name}** by ${trackInfo.artist}`;
      console.log(`🎵 Added track ${trackId} submitted by ${message.author.tag}`);
    } catch (err) {
      console.error("❌ Spotify error:", err.message);
      await message.reply("⚠️ Something went wrong adding that track to Spotify. Please try again or let an admin know.");
      return;
    }
  }

  await logMention(message.author.tag, cleanContent(message), message.id);
  lastMentionMessage   = message;
  lastMentionMessageId = message.id;
  await message.react("🔥");

  const spotifyLine = trackLabel
    ? `🎵 ${trackLabel} has been added to the playlist: ${SPOTIFY_PLAYLIST_URL}\n\n`
    : "";
  await message.reply(
    `🎸 That song rocked! ${spotifyLine}Your entry & its 🔥 rating will be logged in the sheet:\n${SHEET_URL}`
  );
});

// ── Fire Reaction Handler ─────────────────────────────────────────────────────
async function handleFireReaction(reaction, _user) {
  if (reaction.partial) await reaction.fetch();
  if (reaction.emoji.name !== "🔥") return;

  let targetMessageId = null;
  if (lastReplyMessage && reaction.message.id === lastReplyMessage.id) {
    targetMessageId = lastPickMessageId;
  } else if (lastMentionMessage && reaction.message.id === lastMentionMessage.id) {
    targetMessageId = lastMentionMessageId;
  } else {
    return;
  }

  const users       = await reaction.users.fetch();
  const nonBotCount = users.filter((u) => !u.bot).size;
  await logFireCount(nonBotCount, targetMessageId);
}

client.on("messageReactionAdd",    handleFireReaction);
client.on("messageReactionRemove", handleFireReaction);

// ── Channel Members ───────────────────────────────────────────────────────────
async function getChannelMembers(channel) {
  const guild = channel.guild;
  await guild.members.fetch();

  return guild.members.cache.filter((member) => {
    if (member.user.bot) return false;
    if (EXCLUDED_USER_IDS.includes(member.user.id)) return false;
    const perms = channel.permissionsFor(member);
    return perms && perms.has("ViewChannel") && perms.has("SendMessages");
  });
}

// ── Daily Pick ────────────────────────────────────────────────────────────────
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

    lastBotMessage    = await channel.send(MESSAGE_TEMPLATE(randomMember.toString()));
    lastPickedUserId  = randomMember.user.id;
    lastPickMessageId = lastBotMessage.id;
    console.log(`📣 Mentioned ${randomMember.user.tag} at ${new Date().toISOString()}`);
    console.log(`👥 Picked from pool of ${members.size} eligible channel members`);

    await logPick(randomMember.user.tag, lastBotMessage.id);
  } catch (err) {
    console.error("❌ Error picking member:", err);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
client.login(TOKEN);