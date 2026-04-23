const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function redirectToSpotifyLogin() {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem("verifier", verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    show_dialog: true,
  });

  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem("verifier");

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json();
  if (!data.access_token) return null;
  localStorage.setItem("access_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token);
  if (data.expires_in) {
    localStorage.setItem("token_expires", Date.now() + data.expires_in * 1000);
  }
  return data.access_token;
}

export function getAccessToken() {
  return localStorage.getItem("access_token");
}

export async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  let data;
  try { data = await response.json(); } catch { return null; }
  if (!data.access_token) return null;

  localStorage.setItem("access_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token);
  if (data.expires_in) {
    localStorage.setItem("token_expires", Date.now() + data.expires_in * 1000);
  }
  return data.access_token;
}

export function isTokenExpired() {
  const expires = localStorage.getItem("token_expires");
  if (!expires) return false;
  return Date.now() > Number(expires) - 60000; // refresh 1 min early
}

export async function getValidToken() {
  if (isTokenExpired()) {
    const newToken = await refreshAccessToken();
    if (newToken) return newToken;
  }
  return getAccessToken();
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getCached(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

export function setCache(key, data) {
  localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
}

export async function fetchPlaylists() {
  const token = await getValidToken();
  const allItems = [];
  let url = "https://api.spotify.com/v1/me/playlists?limit=50";
  let retries = 0;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      if (retries >= 3) break;
      retries++;
      const wait = Math.max(Number(res.headers.get("Retry-After") ?? 5), 5) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    retries = 0;
    const data = await res.json();
    if (data.error || !data.items) break;
    allItems.push(...data.items);
    url = data.next ?? null;
  }

  return allItems;
}

export async function fetchArtists(artistIds) {
  const token = await getValidToken();
  const genreMap = {};
  for (let i = 0; i < artistIds.length; i += 50) {
    const batch = artistIds.slice(i, i + 50);
    const res = await fetch(
      `https://api.spotify.com/v1/artists?ids=${batch.join(",")}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    (data.artists ?? []).forEach((a) => {
      if (a?.id) genreMap[a.id] = a.genres?.[0] ?? "—";
    });
  }
  return genreMap;
}

export async function fetchAudioFeatures(trackIds) {
  const token = await getValidToken();
  const ids = trackIds.join(",");
  const res = await fetch(
    `https://api.spotify.com/v1/audio-features?ids=${ids}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.audio_features ?? [];
}

export async function createPlaylist(userId, name, description = "") {
  const token = await getValidToken();
  const res = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description, public: false }),
  });
  return await res.json();
}

export async function addTracksToPlaylist(playlistId, uris) {
  const token = await getValidToken();
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: batch }),
    });
  }
}

export async function fetchTracks(playlistId) {
  const token = await getValidToken();
  const allItems = [];

  // First page via full playlist endpoint
  const res = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const page = data.tracks ?? data.items;
  const firstItems = Array.isArray(page) ? page : (page?.items ?? []);
  const total = page?.total ?? firstItems.length;
  let next = Array.isArray(page) ? null : (page?.next ?? null);

  allItems.push(...firstItems);

  // Follow pagination for subsequent pages
  while (next) {
    try {
      const nextRes = await fetch(next, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!nextRes.ok) break;
      const nextData = await nextRes.json();
      if (nextData.error) break;
      allItems.push(...(nextData.items ?? []));
      next = nextData.next ?? null;
    } catch {
      break;
    }
  }

  return { items: allItems, total };
}