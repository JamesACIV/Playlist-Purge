# Playlist Purge

> Sort your Spotify library. Make it yours again.

Connect your account, pick a playlist, and group your tracks by era, genre, or AI-powered energy — then push the results back to Spotify as new private playlists.

&nbsp;

## Features

| | |
|---|---|
| **Era** | Groups tracks by decade using album release date |
| **AI Genre** | Classifies artists into 17 genres — Lo-Fi, Trap, Rap, Hip-Hop, R&B, Soul, Funk, Pop, Old School Pop, Indie, Rock, Metal, EDM, Party, Latin, Jazz, Country |
| **Energy** | AI groups tracks by tempo and energy feel |
| **Write-back** | Pushes each sorted group to Spotify as a new private playlist |
| **All Playlists** | Merges your entire library into one deduplicated view |
| **Export** | Downloads the current track list as CSV |

AI results are cached locally — reclassifying only happens when you ask for it.

&nbsp;

## Setup

**Prerequisites**
- Node.js 18+
- [Spotify Developer app](https://developer.spotify.com/dashboard) with `http://127.0.0.1:5173/` as a redirect URI and your account added under User Management
- [Groq API key](https://console.groq.com) — free tier works

**Install**
```bash
npm install
```

**Environment** — create `.env` in the project root:
```
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
VITE_REDIRECT_URI=http://127.0.0.1:5173/
VITE_GROQ_API_KEY=your_groq_api_key
```

**Run**
```bash
npm run dev
```

Open `http://127.0.0.1:5173` — use `127.0.0.1`, not `localhost`.

&nbsp;

## Stack

[React](https://react.dev) + [Vite](https://vitejs.dev) · [Spotify Web API](https://developer.spotify.com/documentation/web-api/reference) · [Groq](https://console.groq.com/docs/quickstart) `llama-3.1-8b-instant` · [SheetJS](https://docs.sheetjs.com)

&nbsp;

## Notes

- Spotify data is cached for 30 minutes to stay within [rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits). A countdown banner shows when the limit is active.
- Groq classification runs at 2.2s per batch to stay under the [free tier cap](https://console.groq.com/docs/rate-limits) of 30 req/min. Large libraries (~5000 tracks) take 2–3 minutes.
- Created playlists are prefixed with `PP |` so they group together in your library.
