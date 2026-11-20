# ThatSongRocked Discord Bot

A Discord bot that runs a daily song-picking rotation for a server channel. Each weekday, the bot picks a member at random and asks them to submit a Spotify track link. The track is added to a shared Spotify playlist and the submission is logged to a Google Sheet.

---

## How It Works

1. **Daily pick** — At 10:00 AM Eastern (Monday–Friday, adjusts for daylight saving automatically), the bot mentions a randomly selected channel member and asks them to reply with a Spotify track link.
2. **Song submission** — The picked user (or any user mentioning the bot) replies with a `open.spotify.com/track/...` link.
3. **Duplicate check** — The bot checks the Google Sheet for the same track ID and for matching artist + title (to catch different versions of the same song). If a match is found, the user is asked to pick again.
4. **Playlist update** — The track is added to the configured Spotify playlist.
5. **Sheet logging** — The submission is logged with timestamp, username, artist, title, and link.
6. **Fire reactions** — Users can react with 🔥 to rate the song. The reaction count is logged to the sheet and updates in real time.

---

## Rotation Queue

Members are shuffled into a random queue. Each member is picked once before the queue resets and reshuffles. Members who leave the channel or server are skipped automatically.

---

## Google Sheet Structure

| Column | Header | Description |
|--------|--------|-------------|
| A | Timestamp | When the pick occurred (EST) |
| B | User | Discord username of the picked member |
| C | Artist | Artist name fetched from Spotify |
| D | Title | Song title fetched from Spotify |
| E | Link | Spotify track URL submitted by the user |
| F | 🔥 Count | Number of fire reactions (bots excluded) |
| G | Pick Message ID | Internal — used by the bot to look up rows |
| H | Reply Message ID | Internal — used to match 🔥 reactions to the correct row |

On startup, the bot backfills any rows missing artist/title (via Spotify) and any rows missing a reply message ID (via Discord message history).

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_CHANNEL_ID` | ID of the channel the bot operates in |
| `GOOGLE_SHEET_ID` | ID of the Google Spreadsheet |
| `GOOGLE_CREDENTIALS` | JSON string of the Google service account credentials (or use `credentials.json` locally) |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `SPOTIFY_REFRESH_TOKEN` | Spotify OAuth refresh token |
| `SPOTIFY_PLAYLIST_ID` | ID of the Spotify playlist to add tracks to |

---

## Local Setup

1. Clone the repo and run `npm install`
2. Copy `.env.example` to `.env` and fill in all variables
3. Place your Google service account key in `credentials.json`
4. Run `node bot.js`

To obtain a Spotify refresh token, run `node get-spotify-token.js` and follow the OAuth flow.

---

## Deployment

The bot is configured for [Railway](https://railway.app) via the included `Procfile`. Set all environment variables in the Railway project dashboard.
