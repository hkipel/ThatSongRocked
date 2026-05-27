# Changelog

---

## 2026-05-27

### Added
- **Artist and title logging** — When a song is submitted, the bot now fetches the artist name and song title from Spotify and writes them to the Google Sheet (columns C and D).
- **Startup backfill** — On bot startup, any sheet rows that have a Spotify link but are missing artist/title are automatically filled in via the Spotify API.
- **Duplicate song detection** — Before accepting a submission, the bot checks the sheet for duplicates two ways: exact Spotify track ID match, and case-insensitive artist + title match (to catch different versions of the same song). If a duplicate is found, the user is notified and asked to pick a different song.

### Changed
- **Google Sheet column structure** updated to: Timestamp (A), User (B), Artist (C), Title (D), Link (E), 🔥 Count (F), Message ID (G, internal).
- Song reply and mention handlers restructured to fetch Spotify track info before the duplicate check, enabling artist/title comparison.

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
