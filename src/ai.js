const API_KEY = import.meta.env.VITE_GROQ_API_KEY;
const BATCH_SIZE = 20;

async function classifyBatch(tracks, mode, targetGroups) {
  const trackList = tracks
    .map((item, i) => {
      const t = item.item;
      return `${i + 1}. "${t?.name ?? "Unknown"}" by ${t?.artists?.[0]?.name ?? "Unknown"}`;
    })
    .join("\n");

  const isVibe = mode === "ai-vibe";
  const field = isVibe ? "vibe" : "genre";
  const instruction = isVibe
    ? `Assign each song a vibe using EXACTLY ${targetGroups} distinct labels across all songs. Vibes should capture mood, energy, and feeling — be creative and descriptive (e.g. "Late Night Drive", "Pre-Game Hype", "Sunday Morning", "Heartbreak", "Workout Fuel"). Choose the ${targetGroups} labels that best represent this collection.`
    : `Assign each song a genre using EXACTLY ${targetGroups} distinct labels across all songs. Choose the ${targetGroups} genre categories that best represent this collection (e.g. "Hip-Hop", "Indie Rock", "Electronic", "R&B", "Pop").`;

  const prompt = `${instruction}

Every song must get one label. Use the same ${targetGroups} labels consistently across all songs — no extras.

IMPORTANT: Return exactly ${tracks.length} objects in the same order. Return ONLY a JSON array, no extra text:
[{"${field}":"..."}, ...]

Songs:
${trackList}`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 2048,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length !== tracks.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function classifyTracks(tracks, onProgress, mode = "ai-vibe", targetGroups = 5) {
  const results = {};

  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const batch = tracks.slice(i, i + BATCH_SIZE);
    let classifications = null;
    let attempts = 0;

    while (!classifications && attempts < 3) {
      attempts++;
      classifications = await classifyBatch(batch, mode, targetGroups);
    }

    if (classifications) {
      batch.forEach((item, j) => {
        const id = item.item?.id;
        if (id && classifications[j]) {
          results[id] = classifications[j];
        }
      });
    }

    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, tracks.length), tracks.length);
  }

  return results;
}
