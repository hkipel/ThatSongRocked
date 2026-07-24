# Changelog

---

## 2026-07-24

### Added
- **🔥 fire ranking command** — Mentioning the bot with the word "rank" (e.g. `@ThatSongRocked rank`) replies with a leaderboard of users ranked by total 🔥 reactions across all their logged submissions, read live from the Google Sheet.

---

## 2026-05-27

### Added
- **Artist and title logging** — When a song is submitted, the bot fetches the artist name and song title from Spotify and writes them to the Google Sheet (columns C and D).
- **Startup backfill (song details)** — On startup, any sheet rows that have a Spotify link but are missing artist/title are automatically filled in via the Spotify API.
- **Startup backfill (reply message IDs)** — On startup, any sheet rows missing a reply message ID (column H) are backfilled by searching Discord message history after each pick message for the matching Spotify track.
- **Duplicate song detection** — Before accepting a submission, the bot checks the sheet for duplicates two ways: exact Spotify track ID match, and case-insensitive artist + title match (to catch different versions of the same song). If a duplicate is found, the user is notified and asked to pick a different song.
- **Historical fire reaction tracking** — 🔥 reactions now update the sheet for any previously logged song, not just the most recent one. The bot stores the reply message ID in column H and looks it up on every reaction event.

### Changed
- **Google Sheet column structure** updated to: Timestamp (A), User (B), Artist (C), Title (D), Link (E), 🔥 Count (F), Pick Message ID (G, internal), Reply Message ID (H, internal).
- Song reply and mention handlers restructured to fetch Spotify track info before the duplicate check, enabling artist/title comparison.
- Fire reaction handler rewritten to use a sheet lookup instead of in-memory state, removing the dependency on bot session continuity.

---

## 2026-04-09 — Initial Release

### Features
- Daily random member pick at 10:00 AM EDT, Monday–Friday via cron schedule.
- Rotating queue ensures each member is picked once per round before reshuffling.
- Validates Spotify track links and adds them to a configured playlist.
- Logs picks and submissions to a Google Sheet.
- Tracks 🔥 fire reactions on submissions and logs the count to the sheet.
- Supports direct bot mentions as an alternative submission path.
- Deployed on Railway via `Procfile`.
