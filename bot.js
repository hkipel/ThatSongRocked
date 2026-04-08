require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");

// ── Config ────────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CRON_SCHEDULE = "0 14 * * 1-5";          // 10:00 AM EDT (UTC-4), Mon/Wed/Fri
const MESSAGE_TEMPLATE = (user) => `🎵 THAT SONG ROCKED! ${user} - it's your turn to pick an older song that ROCKED! 🎶`;
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
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
 
async function getChannelMembers(channel) {
  const guild = channel.guild;
  await guild.members.fetch(); // populate cache
 
  // Filter to members who have permission to view this channel, excluding bots
  const members = guild.members.cache.filter((member) => {
    if (member.user.bot) return false;
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
 
    await channel.send(MESSAGE_TEMPLATE(randomMember.toString()));
    console.log(`📣 Mentioned ${randomMember.user.tag} at ${new Date().toISOString()}`);
    console.log(`👥 Picked from pool of ${members.size} eligible channel members`);
  } catch (err) {
    console.error("❌ Error picking member:", err);
  }
}
 
client.login(TOKEN);
