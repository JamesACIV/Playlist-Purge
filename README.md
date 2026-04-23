# Playlist Purge

Sort, organize, and export your Spotify library. Connect your account, pick a playlist, and let Playlist Purge group your tracks by era, genre, or AI-powered vibe — then push the sorted results back to Spotify as new playlists.

---

## Features

- **Browse your playlists** — sidebar lists all playlists you own, with live track counts as they load
- **Sort by Era** — groups tracks by decade (Pre-80s, 80s, 90s, 2000s, 2010s, 2020s) using album release date
- **Sort by Genre** — groups by Spotify's artist genre tags
- **AI Genre & AI Vibe** — sends tracks to an AI model (Groq / llama-3.1-8b) which classifies them into a configurable number of themed groups
- **Write back to Spotify** — creates new playlists in your account for each sorted group
- **Export** — download the current view as CSV or Excel
- **All Playlists mode** — aggregates every track across your entire library (deduped) into one view
- **Dark mode** — toggle between light and dark theme, persisted across sessions

---

## How It Works

1. **Connect** — click "Connect Spotify" to authenticate via OAuth PKCE (no passwords stored, token lives in your browser)
2. **Pick a playlist** — click any playlist in the sidebar to load its first 100 tracks
3. **Load all** — if the playlist has more than 100 tracks, a "Load all X tracks" button appears in the header
4. **Sort** — choose Era, Genre, AI Genre, or AI Vibe from the sort controls. AI sorts call the Groq API to classify each track
5. **Create playlists** — once sorted, hit "Create Playlists" to push each group back to Spotify as a new private playlist
6. **Export** — use the CSV or Excel buttons to download the current track list

---

## Setup

### Prerequisites
- Node.js 18+
- A [Spotify Developer](https://developer.spotify.com/dashboard) app with `http://127.0.0.1:5173/` as a Redirect URI
- A [Groq](https://console.groq.com) API key (free tier works)

### Install

```bash
npm install
```

### Environment

Create a `.env` file in the project root:

```
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
VITE_REDIRECT_URI=http://127.0.0.1:5173/
VITE_GROQ_API_KEY=your_groq_api_key
```

### Run

```bash
npm run dev
```

Open `http://127.0.0.1:5173` — note: must be `127.0.0.1`, not `localhost`.

---

## Tech Stack

- **React + Vite** — frontend framework
- **Spotify Web API** — OAuth PKCE auth, playlist and track data, write-back
- **Groq API** — AI classification (llama-3.1-8b-instant)
- **SheetJS** — CSV and Excel export
- **localStorage** — 30-minute cache for playlists, tracks, and genres to stay within Spotify rate limits

---

## Rate Limits

Spotify enforces rate limits on their API. Playlist Purge caches all data locally for 30 minutes to minimize requests. If you hit a limit, a countdown banner appears at the top of the app showing when requests will be available again. Use the **↺** button in the header to clear the cache and force a fresh load.
