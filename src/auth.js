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
  const state = generateRandomString(16);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem("verifier", verifier);
  localStorage.setItem("oauth_state", state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    show_dialog: true,
  });

  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code, returnedState) {
  const expectedState = localStorage.getItem("oauth_state");
  localStorage.removeItem("oauth_state");
  if (expectedState && returnedState !== expectedState) return null;

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

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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

export function getStaleCached(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data } = JSON.parse(raw);
    return data ?? null;
  } catch {
    return null;
  }
}

export function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full — evict oldest track/genre/ai cache entries and retry
    const evictable = Object.keys(localStorage).filter((k) =>
      k.startsWith("tracks_") || k.startsWith("genres_") || k.startsWith("ai_")
    );
    if (evictable.length > 0) {
      evictable.sort((a, b) => {
        try { return (JSON.parse(localStorage.getItem(a))?.ts ?? 0) - (JSON.parse(localStorage.getItem(b))?.ts ?? 0); } catch { return 0; }
      });
      localStorage.removeItem(evictable[0]);
      try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch { /* give up */ }
    }
  }
}

export function setRateLimit(retryAfterSeconds) {
  const newUntil = Date.now() + Math.max(retryAfterSeconds, 5) * 1000;
  const existing = getRateLimit();
  if (existing && existing.until >= newUntil) return;
  const start = existing?.start ?? Date.now();
  localStorage.setItem("rate_limit", JSON.stringify({ start, until: newUntil }));
}

export function getRateLimit() {
  try {
    const raw = localStorage.getItem("rate_limit");
    if (!raw) return null;
    const { start, until } = JSON.parse(raw);
    if (Date.now() >= until) return null;
    return { start, until };
  } catch {
    return null;
  }
}

export function clearCache() {
  const keep = new Set(["access_token", "refresh_token", "token_expires", "verifier", "theme", "rate_limit"]);
  Object.keys(localStorage).forEach((key) => {
    if (!keep.has(key)) localStorage.removeItem(key);
  });
}

export function clearAiCache() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith("ai_"))
    .forEach((k) => localStorage.removeItem(k));
}

export async function fetchPlaylists() {
  if (getRateLimit()) return [];
  const token = await getValidToken();
  const allItems = [];
  let url = "https://api.spotify.com/v1/me/playlists?limit=50";

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const retryAfter = Math.max(Number(res.headers.get("Retry-After") ?? 300), 300);
      setRateLimit(retryAfter);
      break;
    }
    if (!res.ok) break;
    const data = await res.json();
    if (data.error || !data.items) break;
    allItems.push(...data.items);
    url = data.next ?? null;
  }

  return allItems;
}

export async function fetchArtists(artistIds) {
  if (getRateLimit()) return {};
  const token = await getValidToken();
  const genreMap = {};
  for (let i = 0; i < artistIds.length; i += 50) {
    if (i > 0) await new Promise((r) => setTimeout(r, 50));
    const batch = artistIds.slice(i, i + 50);
    const res = await fetch(
      `https://api.spotify.com/v1/artists?ids=${batch.join(",")}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 429) {
      const retryAfter = Math.max(Number(res.headers.get("Retry-After") ?? 300), 300);
      setRateLimit(retryAfter);
      break;
    }
    if (!res.ok) break;
    const data = await res.json();
    (data.artists ?? []).forEach((a) => {
      if (a?.id) genreMap[a.id] = a.genres?.[0] ?? "—";
    });
  }
  return genreMap;
}


export async function deletePlaylist(playlistId) {
  const token = await getValidToken();
  await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createPlaylist(userId, name, description = "") {
  const token = await getValidToken();
  const res = await fetch(`https://api.spotify.com/v1/me/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description, public: false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${res.status}: ${err?.error?.message ?? "Failed to create playlist"}`);
  }
  return await res.json();
}

export async function addTracksToPlaylist(playlistId, uris) {
  const token = await getValidToken();
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: batch }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${res.status}: ${err?.error?.message ?? "Failed to add tracks"}`);
    }
  }
}

export async function fetchTracks(playlistId, onPage, shallow = false) {
  if (getRateLimit()) return { items: [], total: 0, next: null };
  const token = await getValidToken();
  const allItems = [];

  const res = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 429) {
    const retryAfter = Math.max(Number(res.headers.get("Retry-After") ?? 300), 300);
    setRateLimit(retryAfter);
    return { items: [], total: 0 };
  }

  if (!res.ok) return { items: [], total: 0 };

  const data = await res.json();
  const page = data.tracks ?? data.items;
  const firstItems = Array.isArray(page) ? page : (page?.items ?? []);
  const total = page?.total ?? firstItems.length;
  let next = Array.isArray(page) ? null : (page?.next ?? null);

  allItems.push(...firstItems);
  if (onPage) onPage([...allItems], total);

  if (shallow) return { items: allItems, total, next };

  while (next) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      const nextRes = await fetch(next, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (nextRes.status === 429) {
        const retryAfter = Math.max(Number(nextRes.headers.get("Retry-After") ?? 300), 300);
        setRateLimit(retryAfter);
        break;
      }
      if (!nextRes.ok) break;
      const nextData = await nextRes.json();
      if (nextData.error) break;
      allItems.push(...(nextData.items ?? []));
      next = nextData.next ?? null;
      if (onPage) onPage([...allItems], total);
    } catch {
      break;
    }
  }

  return { items: allItems, total };
}