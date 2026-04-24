# Playlist Purge

Sort, organize, and export your Spotify library. Connect your account, pick a playlist, and let Playlist Purge group your tracks by era, genre, or AI-powered energy — then push the sorted results back to Spotify as new playlists.

---

## Features

- **Browse your playlists** — sidebar lists all playlists you own, with live track counts as they load
- **Sort by Era** — groups tracks by decade (Pre-80s, 80s, 90s, 2000s, 2010s, 2020s) using album release date
- **AI Genre** — classifies each unique artist into one of 17 preset genres using AI (Lo-Fi, Trap, Rap, Hip-Hop, R&B, Soul, Funk, Pop, Old School Pop, Indie, Rock, Metal, EDM, Party, Latin, Jazz, Country)
- **Energy** — AI groups tracks by tempo and energy feel (High Energy → Chill → Late Night)
- **Write back to Spotify** — creates new playlists in your account for each sorted group, prefixed with `PP |` so they stay grouped. Empty playlists are automatically deleted
- **Export CSV** — download the current track list as a CSV file
- **All Playlists mode** — aggregates every track across your entire library (deduped) into one view
- **AI result caching** — classification results are saved to localStorage so re-opening a playlist doesn't re-run the AI

---

## How It Works

1. **Connect** — click "Connect Spotify" to authenticate via [OAuth PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow) (no passwords stored, token lives in your browser)
2. **Pick a playlist** — click any playlist in the sidebar to load its tracks
3. **Load all** — if the playlist has more than 100 tracks, a "Load all X tracks" button appears in the header
4. **Sort** — choose Era, AI Genre, or Energy from the sort controls. AI sorts call the [Groq API](https://console.groq.com) to classify each unique artist, then map the label back to all their tracks
5. **Create playlists** — once sorted, hit "Create Playlists" to push each group back to Spotify via the [Add Items to Playlist](https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist) endpoint
6. **Export** — use the Export CSV button in the header to download the current track list

---

## Setup

### Prerequisites
- Node.js 18+
- A [Spotify Developer](https://developer.spotify.com/dashboard) app with:
  - `http://127.0.0.1:5173/` added as a Redirect URI
  - Your Spotify account email added under **User Management**
  - Scopes: `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, `playlist-modify-private`
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

Open `http://127.0.0.1:5173` — must use `127.0.0.1`, not `localhost`.

---

## Tech Stack

| Tool | Purpose | Docs |
|------|---------|------|
| [React](https://react.dev) + [Vite](https://vitejs.dev) | Frontend framework | — |
| [Spotify Web API](https://developer.spotify.com/documentation/web-api) | Auth, playlist data, write-back | [Reference](https://developer.spotify.com/documentation/web-api/reference) |
| [Groq API](https://console.groq.com/docs/openai) | AI classification via llama-3.1-8b-instant | [Docs](https://console.groq.com/docs/quickstart) |
| [SheetJS](https://sheetjs.com) | CSV export | [Docs](https://docs.sheetjs.com) |

---

## Rate Limits

**Spotify** enforces rate limits on their API. All playlist, track, and genre data is cached locally for 30 minutes to minimize requests. If you hit a limit, a countdown banner appears at the top of the app — [details here](https://developer.spotify.com/documentation/web-api/concepts/rate-limits).

**Groq** free tier allows 30 requests per minute. Playlist Purge adds a 2.2 second delay between classification batches to stay within this limit — [details here](https://console.groq.com/docs/rate-limits).
