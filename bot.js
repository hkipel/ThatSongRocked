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
    range: `${SHEET_NAME}!G:G`,
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
      range: `${SHEET_NAME}!A:H`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[timestamp, username, "", "", content, "", String(messageId), String(messageId)]] },
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
      range: `${SHEET_NAME}!A:G`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[timestamp, username, "", "", "", "", String(messageId)]] },
    });
    console.log(`📊 Logged PICK to sheet: ${username} (message ID: ${messageId})`);
  } catch (err) {
    console.error("❌ Error logging pick to sheet:", err);
  }
}

async function logReply(content, pickMessageId, replyMessageId) {
  if (!pickMessageId) return;
  const row = await findRowById(pickMessageId);
  if (!row) return;
  try {
    await Promise.all([
      sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!E${row}`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[content]] },
      }),
      sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!H${row}`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [[String(replyMessageId)]] },
      }),
    ]);
    console.log(`📊 Logged REPLY to sheet row ${row}`);
  } catch (err) {
    console.error("❌ Error logging reply to sheet:", err);
  }
}

async function logSongDetails(songName, artist, messageId) {
  if (!messageId) return;
  const row = await findRowById(messageId);
  if (!row) return;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!C${row}:D${row}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[artist, songName]] },
    });
    console.log(`📊 Logged song details to sheet row ${row}: ${songName} by ${artist}`);
  } catch (err) {
    console.error("❌ Error logging song details to sheet:", err);
  }
}

async function getFireStats() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!B:F`,
  });
  const rows = response.data.values || [];
  const stats = new Map(); // user -> { total, count }

  for (let i = 1; i < rows.length; i++) { // skip header row
    const user      = rows[i][0]; // B
    const fireCount = parseInt(rows[i][4], 10) || 0; // F
    if (!user) continue;
    const entry = stats.get(user) || { total: 0, count: 0 };
    entry.total += fireCount;
    entry.count += 1;
    stats.set(user, entry);
  }

  return stats;
}

function formatRanking(stats) {
  const ranking = [...stats.entries()]
    .map(([user, { total }]) => [user, total])
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranking.length === 0) return "No 🔥 ratings logged yet!";

  const medals = ["🥇", "🥈", "🥉"];
  const lines = ranking.map(([user, total], i) => {
    const medal = medals[i] || `${i + 1}.`;
    return `${medal} **${user}** — ${total} 🔥`;
  });

  return `🔥 **Fire Ranking** 🔥\n\n${lines.join("\n")}`;
}

function formatAverageRanking(stats) {
  const ranking = [...stats.entries()]
    .map(([user, { total, count }]) => [user, total / count, count])
    .filter(([, avg]) => avg > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranking.length === 0) return "No 🔥 ratings logged yet!";

  const medals = ["🥇", "🥈", "🥉"];
  const lines = ranking.map(([user, avg, count], i) => {
    const medal = medals[i] || `${i + 1}.`;
    const entries = count === 1 ? "entry" : "entries";
    return `${medal} **${user}** — ${avg.toFixed(2)} 🔥 avg (${count} ${entries})`;
  });

  return `🔥 **Average Fire Ranking** 🔥\n\n${lines.join("\n")}`;
}

async function findRowByReplyMessageId(id) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!H:H`,
  });
  const rows = response.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === String(id)) return i + 1;
  }
  return null;
}

async function findDuplicateSong(trackId, artist, title) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!C:E`,
  });
  const rows = response.data.values || [];
  for (const row of rows) {
    const rowArtist = row[0]; // C
    const rowTitle  = row[1]; // D
    const rowLink   = row[2]; // E

    if (rowLink) {
      const match = rowLink.match(SPOTIFY_TRACK_REGEX);
      if (match && match[1] === trackId) return { found: true, byId: true };
    }

    if (artist && title && rowArtist && rowTitle) {
      if (rowArtist.toLowerCase() === artist.toLowerCase() &&
          rowTitle.toLowerCase() === title.toLowerCase()) {
        return { found: true, byId: false };
      }
    }
  }
  return { found: false };
}

async function backfillSongDetails() {
  console.log("🔄 Starting backfill of missing song details...");
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:G`,
    });
    const rows = response.data.values || [];

    await refreshSpotifyToken();

    let count = 0;
    for (let i = 1; i < rows.length; i++) { // skip header row
      const row = rows[i];
      const artist = row[2]; // C
      const title  = row[3]; // D
      const link   = row[4]; // E

      if (!link || (artist && title)) continue;

      const match = link.match(SPOTIFY_TRACK_REGEX);
      if (!match) continue;

      try {
        const trackInfo = await getTrackInfo(match[1]);
        if (!trackInfo) continue;

        const rowNum = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!C${rowNum}:D${rowNum}`,
          valueInputOption: "USER_ENTERED",
          resource: { values: [[trackInfo.artist, trackInfo.name]] },
        });
        console.log(`📊 Backfilled row ${rowNum}: ${trackInfo.name} by ${trackInfo.artist}`);
        count++;
      } catch (err) {
        console.error(`❌ Error backfilling row ${i + 1}:`, err.message);
      }
    }
    console.log(`✅ Backfill complete. Updated ${count} row(s).`);
  } catch (err) {
    console.error("❌ Error during backfill:", err);
  }
}

async function backfillReplyMessageIds(channel) {
  console.log("🔄 Starting backfill of missing reply message IDs...");
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:H`,
    });
    const rows = response.data.values || [];

    let count = 0;
    for (let i = 1; i < rows.length; i++) { // skip header row
      const row        = rows[i];
      const link       = row[4]; // E
      const pickMsgId  = row[6]; // G
      const replyMsgId = row[7]; // H

      if (!link || !pickMsgId || replyMsgId) continue;

      const match = link.match(SPOTIFY_TRACK_REGEX);
      if (!match) continue;
      const trackId = match[1];

      try {
        let replyMsg = null;
        let afterId  = pickMsgId;

        for (let batch = 0; batch < 10 && !replyMsg; batch++) {
          const messages = await channel.messages.fetch({ after: afterId, limit: 100 });
          if (messages.size === 0) break;

          replyMsg = messages.find((m) => !m.author.bot && m.content.includes(trackId));

          // Advance the anchor to the newest message in this batch for next iteration
          afterId = [...messages.keys()].reduce((max, id) =>
            BigInt(id) > BigInt(max) ? id : max
          );
        }

        if (!replyMsg) continue;

        const rowNum = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!H${rowNum}`,
          valueInputOption: "USER_ENTERED",
          resource: { values: [[String(replyMsg.id)]] },
        });
        console.log(`📊 Backfilled reply message ID for row ${rowNum}`);
        count++;
      } catch (err) {
        console.error(`❌ Error backfilling reply message ID for row ${i + 1}:`, err.message);
      }
    }
    console.log(`✅ Reply message ID backfill complete. Updated ${count} row(s).`);
  } catch (err) {
    console.error("❌ Error during reply message ID backfill:", err);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
let lastBotMessage    = null;
let lastPickedUserId  = null;
let lastPickMessageId = null;
let pickQueue         = [];

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

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`⏰ Scheduled to run: ${CRON_SCHEDULE} (UTC)`);

  const channel = await client.channels.fetch(CHANNEL_ID);
  await backfillSongDetails();
  await backfillReplyMessageIds(channel);

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

  // Valid Spotify link — fetch track info, check for duplicate, then add to playlist
  const trackId = spotifyMatch[1];
  let trackInfo = null;

  try {
    await refreshSpotifyToken();
    trackInfo = await getTrackInfo(trackId);
  } catch (err) {
    console.error("❌ Spotify error:", err.message);
    await message.reply("⚠️ Something went wrong connecting to Spotify. Please try again or let an admin know.");
    return;
  }

  const duplicate = await findDuplicateSong(trackId, trackInfo?.artist, trackInfo?.name);
  if (duplicate.found) {
    const reason = duplicate.byId
      ? "That exact track has already been picked!"
      : `**${trackInfo.name}** by **${trackInfo.artist}** has already been picked (possibly a different version).`;
    await message.reply(`❌ ${reason} Please choose a different song.`);
    return;
  }

  let trackLabel = "your track";

  try {
    await addTrackToPlaylist(trackId);
    if (trackInfo) trackLabel = `**${trackInfo.name}** by ${trackInfo.artist}`;
    console.log(`🎵 Added track ${trackId} submitted by ${message.author.tag}`);
  } catch (err) {
    console.error("❌ Spotify error:", err.message);
    await message.reply("⚠️ Something went wrong adding that track to Spotify. Please try again or let an admin know.");
    return;
  }

  // Log to sheet and react
  await logReply(cleanContent(message), lastPickMessageId, message.id);
  if (trackInfo) await logSongDetails(trackInfo.name, trackInfo.artist, lastPickMessageId);
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

  const mentionContent = cleanContent(message);
  if (/\brank\b/i.test(mentionContent)) {
    console.log(`📊 Rank request from ${message.author.tag}`);
    try {
      const stats  = await getFireStats();
      const isAvg  = /\baverage\b/i.test(mentionContent);
      await message.reply(isAvg ? formatAverageRanking(stats) : formatRanking(stats));
    } catch (err) {
      console.error("❌ Error building fire ranking:", err);
      await message.reply("⚠️ Something went wrong reading the sheet. Please try again or let an admin know.");
    }
    return;
  }

  const spotifyMatch = message.content.match(SPOTIFY_TRACK_REGEX);

  if (!spotifyMatch) {
    await message.reply("❌ Please reply with a Spotify track link. It should look like:\n`https://open.spotify.com/track/...`\n\nOpen Spotify, find your song, tap **Share → Copy Song Link**, and paste it here.");
    return;
  }

  const trackId = spotifyMatch[1];
  let trackInfo = null;

  try {
    await refreshSpotifyToken();
    trackInfo = await getTrackInfo(trackId);
  } catch (err) {
    console.error("❌ Spotify error:", err.message);
    await message.reply("⚠️ Something went wrong connecting to Spotify. Please try again or let an admin know.");
    return;
  }

  const duplicate = await findDuplicateSong(trackId, trackInfo?.artist, trackInfo?.name);
  if (duplicate.found) {
    const reason = duplicate.byId
      ? "That exact track has already been picked!"
      : `**${trackInfo.name}** by **${trackInfo.artist}** has already been picked (possibly a different version).`;
    await message.reply(`❌ ${reason} Please choose a different song.`);
    return;
  }

  let trackLabel = null;

  try {
    await addTrackToPlaylist(trackId);
    if (trackInfo) trackLabel = `**${trackInfo.name}** by ${trackInfo.artist}`;
    console.log(`🎵 Added track ${trackId} submitted by ${message.author.tag}`);
  } catch (err) {
    console.error("❌ Spotify error:", err.message);
    await message.reply("⚠️ Something went wrong adding that track to Spotify. Please try again or let an admin know.");
    return;
  }

  await logMention(message.author.tag, cleanContent(message), message.id);
  if (trackInfo) await logSongDetails(trackInfo.name, trackInfo.artist, message.id);
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

  const row = await findRowByReplyMessageId(reaction.message.id);
  if (!row) return;

  const users       = await reaction.users.fetch();
  const nonBotCount = users.filter((u) => !u.bot).size;

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!F${row}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [[nonBotCount]] },
    });
    console.log(`📊 Updated 🔥 count to ${nonBotCount} on row ${row}`);
  } catch (err) {
    console.error("❌ Error updating fire count:", err);
  }
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
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

    // Refill and shuffle the queue when it runs out
    if (pickQueue.length === 0) {
      pickQueue = shuffleArray([...members.keys()]);
      console.log(`🔄 New round started. Queue: ${pickQueue.length} members.`);
    }

    // Find the next queued member who is still eligible
    let pickedMember = null;
    while (pickQueue.length > 0) {
      const nextId = pickQueue.shift();
      const member = members.get(nextId);
      if (member) { pickedMember = member; break; }
      console.log(`⚠️ Skipped ${nextId} — no longer eligible.`);
    }

    if (!pickedMember) {
      console.warn("⚠️ No eligible members left in queue.");
      return;
    }

    lastBotMessage    = await channel.send(MESSAGE_TEMPLATE(pickedMember.toString()));
    lastPickedUserId  = pickedMember.user.id;
    lastPickMessageId = lastBotMessage.id;
    console.log(`📣 Mentioned ${pickedMember.user.tag} at ${new Date().toISOString()}`);
    console.log(`👥 ${pickQueue.length} members remaining in this round.`);

    await logPick(pickedMember.user.tag, lastBotMessage.id);
  } catch (err) {
    console.error("❌ Error picking member:", err);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
client.login(TOKEN);