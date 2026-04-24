const API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 2200; // Groq free tier: 30 req/min

export const PRESET_GENRES = [
  "Lo-Fi", "Trap", "Rap", "Hip-Hop", "R&B", "Soul", "Funk",
  "Pop", "Old School Pop", "Indie", "Rock", "Metal",
  "EDM", "Party", "Latin", "Jazz", "Country",
];

async function classifyArtistBatch(artists, mode, targetGroups) {
  const field = mode === "ai-vibe" ? "vibe" : "genre";
  const artistList = artists.map((a, i) => `${i + 1}. ${a.name}`).join("\n");

  const isVibe = mode === "ai-vibe";
  const instruction = isVibe
    ? `Assign each artist an energy level using EXACTLY ${targetGroups} distinct labels across all artists. Labels should reflect tempo and energy feel — from high intensity to low (e.g. "High Energy", "Workout", "Upbeat", "Mid Tempo", "Chill", "Late Night", "Sleep"). Choose the ${targetGroups} energy levels that best span this collection. Never use "Unknown" or generic placeholders.`
    : `Assign each artist to exactly ONE genre from this fixed list: ${PRESET_GENRES.join(", ")}. Use ONLY these exact genre names — copy them exactly as written. Never invent new genre names, never combine genres, never use "Unknown" or "Uncategorized". You MUST always pick the closest genre from the list — even if you are not familiar with the artist, reason about their name, style, or any context clues to make your best guess. If you truly cannot identify the artist, think about what their music might sound like based on their name and assign the most fitting genre. Every artist must get a real genre from the list — no exceptions.`;

  const prompt = `${instruction}

Every artist MUST get one label. Return ONLY a JSON array of exactly ${artists.length} objects in the same order, no extra text:
[{"${field}":"..."}, ...]

Artists:
${artistList}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      max_tokens: 1024,
      temperature: isVibe ? 0.7 : 0.1,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    throw new Error("rate_limited");
  }
  if (!res.ok) return null;

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length !== artists.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Snap any AI-invented genre label back to the nearest PRESET_GENRES entry
function snapToPreset(label) {
  if (!label) return PRESET_GENRES[0];
  const normalized = label.toLowerCase().trim();
  // Exact match (case-insensitive)
  const exact = PRESET_GENRES.find((g) => g.toLowerCase() === normalized);
  if (exact) return exact;
  // Partial match — preset contained in label or label contained in preset
  const partial = PRESET_GENRES.find(
    (g) => normalized.includes(g.toLowerCase()) || g.toLowerCase().includes(normalized)
  );
  if (partial) return partial;
  // Fallback — return most popular preset as last resort
  return PRESET_GENRES[0];
}

// For vibe mode: collapse any extra labels down to exactly targetGroups
function enforceGroupCount(artistLabels, field, targetGroups) {
  const counts = {};
  Object.values(artistLabels).forEach((label) => {
    counts[label] = (counts[label] ?? 0) + 1;
  });
  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (sorted.length <= targetGroups) return artistLabels;

  const keep = new Set(sorted.slice(0, targetGroups));
  const fallback = sorted[0]; // most common kept label
  const result = {};
  Object.entries(artistLabels).forEach(([id, label]) => {
    result[id] = keep.has(label) ? label : fallback;
  });
  return result;
}

export async function classifyTracks(tracks, onProgress, mode = "ai-vibe", targetGroups = 5) {
  const field = mode === "ai-vibe" ? "vibe" : "genre";

  // Deduplicate by artist — classify each unique artist once, assign to all their tracks
  const artistIndex = {};
  tracks.forEach((item) => {
    const track = item.item;
    const artistId = track?.artists?.[0]?.id;
    const artistName = track?.artists?.[0]?.name;
    const trackId = track?.id;
    if (!artistId || !trackId || !artistName) return;
    if (!artistIndex[artistId]) artistIndex[artistId] = { name: artistName, trackIds: [] };
    artistIndex[artistId].trackIds.push(trackId);
  });

  const uniqueArtists = Object.entries(artistIndex).map(([id, { name, trackIds }]) => ({ id, name, trackIds }));
  let artistLabels = {}; // artistId → label string

  for (let i = 0; i < uniqueArtists.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));

    const batch = uniqueArtists.slice(i, i + BATCH_SIZE);
    let classifications = null;
    let attempts = 0;

    while (!classifications && attempts < 3) {
      if (attempts > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      attempts++;
      try {
        classifications = await classifyArtistBatch(batch, mode, targetGroups);
      } catch (err) {
        if (err?.message === "rate_limited") continue;
        break;
      }
    }

    if (classifications) {
      batch.forEach((artist, j) => {
        const raw = classifications[j]?.[field];
        if (raw) {
          artistLabels[artist.id] = mode === "ai-genre" ? snapToPreset(raw) : raw;
        }
      });
    } else {
      const counts = {};
      Object.values(artistLabels).forEach((label) => {
        counts[label] = (counts[label] ?? 0) + 1;
      });
      const fallback = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] ?? "Uncategorized";
      batch.forEach((artist) => { artistLabels[artist.id] = fallback; });
    }

    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, uniqueArtists.length), uniqueArtists.length);
  }

  // For vibe mode, collapse down to exactly targetGroups labels
  if (mode === "ai-vibe") {
    artistLabels = enforceGroupCount(artistLabels, field, targetGroups);
  }

  // Map artist labels back to every track
  const results = {};
  tracks.forEach((item) => {
    const track = item.item;
    const artistId = track?.artists?.[0]?.id;
    const trackId = track?.id;
    if (trackId && artistId && artistLabels[artistId]) {
      results[trackId] = { [field]: artistLabels[artistId] };
    }
  });

  return results;
}
