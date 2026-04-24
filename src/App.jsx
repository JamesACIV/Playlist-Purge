import { useEffect, useState, useRef, useMemo } from "react";
import "./App.css";
import {
  redirectToSpotifyLogin,
  exchangeCodeForToken,
  getAccessToken,
  fetchPlaylists,
  fetchTracks,
  fetchArtists,
  createPlaylist,
  deletePlaylist,
  addTracksToPlaylist,
  getCached,
  getStaleCached,
  setCache,
  getRateLimit,
} from "./auth";
import { classifyTracks, PRESET_GENRES } from "./ai";
import { exportCSV } from "./export";

const ERA_ORDER = ["Pre-80s", "80s", "90s", "2000s", "2010s", "2020s", "Unknown"];

function getEra(releaseDate) {
  const year = parseInt(releaseDate?.slice(0, 4));
  if (!year) return "Unknown";
  if (year < 1980) return "Pre-80s";
  if (year < 1990) return "80s";
  if (year < 2000) return "90s";
  if (year < 2010) return "2000s";
  if (year < 2020) return "2010s";
  return "2020s";
}

function groupTracks(tracks, mode, genreMap, aiMap) {
  const groups = {};
  tracks.forEach((item) => {
    const track = item.item;
    let key;
    if (mode === "era") {
      key = getEra(track?.album?.release_date);
    } else if (mode === "genre") {
      key = genreMap[track?.artists?.[0]?.id] ?? "Unknown";
    } else if (mode === "ai-genre") {
      key = aiMap[track?.id]?.genre ?? "Unknown";
    } else if (mode === "ai-vibe") {
      key = aiMap[track?.id]?.vibe ?? "Unknown";
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  if (mode === "era") {
    return Object.fromEntries(
      ERA_ORDER.filter((k) => groups[k]).map((k) => [k, groups[k]])
    );
  }
  return Object.fromEntries(
    Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [genreMap, setGenreMap] = useState({});
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadingAllProgress, setLoadingAllProgress] = useState(null);
  const [allPlaylistsSelected, setAllPlaylistsSelected] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortMode, setSortMode] = useState(null); // null | 'era' | 'genre' | 'ai-genre' | 'ai-vibe'
  const [aiMap, setAiMap] = useState({});
  const [aiProgress, setAiProgress] = useState(null); // null | { done, total }
  const [targetGroups, setTargetGroups] = useState(5);
  const [writeProgress, setWriteProgress] = useState(null); // null | { current, total, label }
  const [createdPlaylists, setCreatedPlaylists] = useState([]);
  const [writeError, setWriteError] = useState(null);
  const [rateLimit, setRateLimit] = useState(() => getRateLimit());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setRateLimit(getRateLimit());
    }, 500);
    return () => clearInterval(id);
  }, []);
  const PAGE_SIZE = 50;
  const didRun = useRef(false);
  const activePlaylistId = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const token = getAccessToken();

    if (code) {
      exchangeCodeForToken(code, state).then((newToken) => {
        window.history.replaceState({}, document.title, "/");
        if (newToken) fetchUser(newToken);
      });
    } else if (token) {
      fetchUser(token);
    }
  }, []);

  async function fetchUser(token) {
    const cachedUser = getCached("user");
    const cachedPlaylists = getCached("playlists");
    if (cachedUser && cachedPlaylists !== null) {
      setUser(cachedUser);
      setPlaylists(cachedPlaylists);
      return;
    }

    if (getRateLimit()) {
      const staleUser = cachedUser ?? getStaleCached("user");
      const stalePlaylists = cachedPlaylists ?? getStaleCached("playlists");
      if (staleUser) {
        setUser(staleUser);
        setPlaylists(stalePlaylists ?? []);
        return;
      }
    }

    try {
      const res = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("auth");
      const data = await res.json();
      if (!data.id) throw new Error("auth");
      setCache("user", data);
      setUser(data);
      const lists = await fetchPlaylists();
      if (lists.length > 0) {
        setCache("playlists", lists);
        setPlaylists(lists);
      } else {
        const stalePlaylists = getStaleCached("playlists");
        setPlaylists(stalePlaylists ?? []);
      }
    } catch {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("token_expires");
    }
  }

  async function selectAllPlaylists() {
    setSelectedPlaylist(null);
    setAllPlaylistsSelected(true);
    setTracks([]);
    setGenreMap({});
    setAiMap({});
    setAiProgress(null);
    setWriteProgress(null);
    setCreatedPlaylists([]);
    setCurrentPage(1);
    setSortMode(null);
    setLoadingAll(true);

    const seen = new Set();
    const allItems = [];

    try {
      for (let i = 0; i < ownedPlaylists.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 100));
        const playlist = ownedPlaylists[i];
        setLoadingAllProgress({
          current: i + 1,
          total: ownedPlaylists.length,
          name: playlist.name,
        });
        await fetchTracks(playlist.id, (partial) => {
          const newItems = partial.filter((item) => {
            const id = item.item?.id;
            if (!id || seen.has(id)) return false;
            seen.add(id);
            allItems.push(item);
            return true;
          });
          if (newItems.length > 0) setTracks([...allItems]);
        });
      }
    } finally {
      setLoadingAllProgress(null);
      setTracks([...allItems]);
      setLoadingAll(false);
      setLoadingTracks(false);
    }
  }

  async function selectPlaylist(playlist) {
    activePlaylistId.current = playlist.id;
    setAllPlaylistsSelected(false);
    setSelectedPlaylist(playlist);
    setTracks([]);
    setGenreMap({});
    setAiMap({});
    setAiProgress(null);
    setWriteProgress(null);
    setCreatedPlaylists([]);
    setCurrentPage(1);
    setSortMode(null);
    setLoadingTracks(true);

    const cachedTracks = getCached(`tracks_${playlist.id}`) ?? getStaleCached(`tracks_${playlist.id}`);
    const cachedGenres = getCached(`genres_${playlist.id}`) ?? getStaleCached(`genres_${playlist.id}`);

    if (cachedTracks) {
      if (activePlaylistId.current !== playlist.id) return;
      setTracks(cachedTracks.items);
      setPlaylists((prev) =>
        prev.map((p) => p.id === playlist.id ? { ...p, trackTotal: cachedTracks.total } : p)
      );
      if (cachedGenres) setGenreMap(cachedGenres);
      setLoadingTracks(false);
      return;
    }

    try {
      const { items, total } = await fetchTracks(playlist.id, (partial, total) => {
        if (activePlaylistId.current !== playlist.id) return;
        setTracks(partial);
        setPlaylists((prev) =>
          prev.map((p) => p.id === playlist.id ? { ...p, trackTotal: total } : p)
        );
      }, true);
      if (activePlaylistId.current !== playlist.id) return;
      if (items.length > 0) setCache(`tracks_${playlist.id}`, { items, total });
      const artistIds = [
        ...new Set(items.map((item) => item.item?.artists?.[0]?.id).filter(Boolean)),
      ];
      const genres = await fetchArtists(artistIds);
      if (activePlaylistId.current !== playlist.id) return;
      if (Object.keys(genres).length > 0) setCache(`genres_${playlist.id}`, genres);
      setGenreMap(genres);
    } catch {
      // network error — tracks already shown if partial load succeeded
    } finally {
      if (activePlaylistId.current === playlist.id) setLoadingTracks(false);
    }
  }

  async function loadAllTracks() {
    if (!selectedPlaylist || loadingTracks) return;
    setLoadingTracks(true);
    try {
      const { items, total } = await fetchTracks(selectedPlaylist.id, (partial, total) => {
        setTracks(partial);
        setPlaylists((prev) =>
          prev.map((p) => p.id === selectedPlaylist.id ? { ...p, trackTotal: total } : p)
        );
      });
      if (items.length > 0) setCache(`tracks_${selectedPlaylist.id}`, { items, total });
      const artistIds = [
        ...new Set(items.map((item) => item.item?.artists?.[0]?.id).filter(Boolean)),
      ];
      const genres = await fetchArtists(artistIds);
      if (Object.keys(genres).length > 0) setCache(`genres_${selectedPlaylist.id}`, genres);
      setGenreMap(genres);
    } catch {
      // network error — tracks already shown if partial load succeeded
    } finally {
      setLoadingTracks(false);
    }
  }

  function aiCacheKey(mode) {
    const id = allPlaylistsSelected ? "all" : selectedPlaylist?.id;
    return `ai_${mode}_${id}`;
  }

  async function handleSortMode(mode) {
    const next = sortMode === mode ? null : mode;
    setSortMode(next);
    setCurrentPage(1);

    if ((next === "ai-genre" || next === "ai-vibe") && Object.keys(aiMap).length === 0) {
      const cached = getCached(aiCacheKey(next)) ?? getStaleCached(aiCacheKey(next));
      if (cached) {
        setAiMap(cached);
        return;
      }

      setAiProgress({ done: 0, total: tracks.length });
      try {
        const results = await classifyTracks(tracks, (done, total) => {
          setAiProgress({ done, total });
        }, next, targetGroups);
        setAiMap(results);
        setCache(aiCacheKey(next), results);
      } catch {
        // Classification failed — leave aiMap empty, groups show as Unknown
      } finally {
        setAiProgress(null);
      }
    }
  }

  async function handleWriteBack() {
    if (!groups) return;
    setCreatedPlaylists([]);
    setWriteError(null);
    const groupEntries = Object.entries(groups);
    const created = [];

    try {
      for (let i = 0; i < groupEntries.length; i++) {
        const [label, groupTracks] = groupEntries[i];
        setWriteProgress({ current: i + 1, total: groupEntries.length, label });

        const baseName = allPlaylistsSelected ? "Purge" : selectedPlaylist.name;
        const playlist = await createPlaylist(
          user.id,
          `PP | ${baseName} — ${label}`,
          `Created by Playlist Purge`
        );

        const uris = groupTracks
          .map((item) => item.item?.uri)
          .filter((uri) => uri?.startsWith("spotify:track:"));

        if (uris.length === 0) {
          await deletePlaylist(playlist.id);
          continue;
        }

        await new Promise((r) => setTimeout(r, 500));
        await addTracksToPlaylist(playlist.id, uris);

        created.push({
          label,
          name: playlist.name,
          url: playlist.external_urls?.spotify,
          count: uris.length,
        });
      }
    } catch (err) {
      setWriteError(`Spotify error: ${err?.message ?? "Unknown error"}`);
    } finally {
      setCreatedPlaylists(created);
      setWriteProgress(null);
    }
  }

  const ownedPlaylists = useMemo(
    () => user ? playlists.filter((p) => p.owner?.id === user.id) : [],
    [playlists, user]
  );
  const groups = useMemo(
    () => sortMode ? groupTracks(tracks, sortMode, genreMap, aiMap) : null,
    [tracks, sortMode, genreMap, aiMap]
  );

  if (!user) {
    return (
      <div className="login-screen">
        <svg className="login-topo" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path d="M-100,800 C200,720 500,600 800,480 S1200,300 1600,200" />
          <path d="M-100,680 C200,600 500,480 800,360 S1200,180 1600,80" />
          <path d="M-100,560 C200,480 500,360 800,240 S1200,60 1600,-40" />
          <path d="M-100,440 C200,360 500,240 800,120 S1200,-60 1600,-160" />
          <path d="M-100,320 C200,240 500,120 800,0 S1200,-180 1600,-280" />
          <path d="M-100,200 C200,120 500,0 800,-120 S1200,-300 1600,-400" />
          <path d="M-100,1000 C200,900 500,760 800,620 S1200,420 1600,300" />
          <path d="M-100,1120 C200,1020 500,880 800,740 S1200,540 1600,420" />
        </svg>
        <div className="login-content">
          <div className="visualizer" aria-hidden="true">
            {Array.from({ length: 36 }, (_, i) => (
              <div
                key={i}
                className="visualizer-bar"
                style={{
                  animationDelay: `${(i * 0.09) % 1.6}s`,
                  animationDuration: `${0.9 + (i % 5) * 0.15}s`,
                }}
              />
            ))}
          </div>
          <h1>Playlist Purge</h1>
          <p>Sort your Spotify library. Make it yours again.</p>
          <button className="btn-connect" onClick={redirectToSpotifyLogin}>
            Connect Spotify
          </button>
          <div className="login-features">
            <span>Sort by Era</span>
            <span>Sort by Genre</span>
            <span>AI Vibes</span>
            <span>Export CSV</span>
          </div>
        </div>
      </div>
    );
  }

  function logout() {
    ["access_token", "refresh_token", "token_expires", "verifier", "user", "playlists", "rate_limit"]
      .forEach((k) => localStorage.removeItem(k));
    Object.keys(localStorage)
      .filter((k) => k.startsWith("tracks_") || k.startsWith("genres_"))
      .forEach((k) => localStorage.removeItem(k));
    setUser(null);
    setPlaylists([]);
    setTracks([]);
    setSelectedPlaylist(null);
    setAllPlaylistsSelected(false);
    didRun.current = false;
  }

  return (
    <div className="app">
      <header className="header">
        <svg className="header-topo" viewBox="0 0 1200 52" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path d="M-100,130 C200,108 450,84 700,60 S1000,28 1300,8" />
          <path d="M-100,108 C180,86 440,62 700,38 S990,6 1300,-14" />
          <path d="M-100,86 C190,64 450,40 710,16 S1000,-16 1300,-36" />
          <path d="M-100,64 C200,42 460,18 720,-6 S1010,-38 1300,-58" />
          <path d="M-100,42 C210,20 470,-4 730,-28 S1020,-60 1300,-80" />
          <path d="M-100,20 C220,-2 480,-26 740,-50 S1030,-82 1300,-102" />
        </svg>
        <div className="header-left">
          {user.images?.[0]?.url && (
            <img className="header-avatar" src={user.images[0].url} alt={user.display_name} />
          )}
          <div className="header-user">
            Connected as <span>{user.display_name}</span>
          </div>
        </div>
        <span className="header-logo">Playlist Purge</span>
        <div className="header-right">
          {!loadingTracks && tracks.length > 0 && (
            <button
              className="logout-btn"
              data-tooltip="Download track list as CSV"
              onClick={() => {
                const name = allPlaylistsSelected ? "All Playlists" : selectedPlaylist.name;
                exportCSV(tracks, groups, genreMap, aiMap, name);
              }}
            >
              Export CSV
            </button>
          )}
          <button className="logout-btn" data-tooltip="Sign out of Spotify" onClick={logout}>Log out</button>
        </div>
      </header>

      {rateLimit && (() => {
        const elapsed = Date.now() - rateLimit.start;
        const total = rateLimit.until - rateLimit.start;
        const remaining = Math.ceil((rateLimit.until - Date.now()) / 1000);
        const pct = Math.min((elapsed / total) * 100, 100);
        return (
          <div className="rate-limit-banner">
            <div className="rate-limit-bar">
              <div className="rate-limit-fill" style={{ width: `${100 - pct}%` }} />
            </div>
            <span className="rate-limit-label">
              {allPlaylistsSelected
                ? "All Playlists"
                : selectedPlaylist?.name
                ? `"${selectedPlaylist.name}"`
                : "Playlists"
              }{" "}— rate limited, ready in {remaining}s
            </span>
          </div>
        );
      })()}
      <div className="main">
        <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
          <div className="sidebar-heading">Your Playlists</div>
          <ul className="playlist-list">
            {playlists.length === 0 ? (
              <li className="playlist-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Couldn't load playlists.</span>
                <button
                  className="sort-btn"
                  data-tooltip="Try loading playlists again"
                  style={{ fontSize: 11 }}
                  onClick={() => {
                    localStorage.removeItem("playlists");
                    fetchUser(getAccessToken());
                  }}
                >
                  Retry
                </button>
              </li>
            ) : (
              <>
            <li
              className={`playlist-item all-playlists${allPlaylistsSelected ? " active" : ""}`}
              onClick={selectAllPlaylists}
            >
              <span className="playlist-name">All Playlists</span>
              <span className="playlist-count">{ownedPlaylists.length} lists</span>
            </li>
            {ownedPlaylists.map((p) => (
              <li
                key={p.id}
                className={`playlist-item${selectedPlaylist?.id === p.id ? " active" : ""}`}
                onClick={() => selectPlaylist(p)}
              >
                <span className="playlist-name">{p.name}</span>
                {p.trackTotal != null && (
                  <span className="playlist-count">{p.trackTotal}</span>
                )}
              </li>
            ))}
              </>
            )}
          </ul>
        </aside>
        <button
          className={`sidebar-toggle${sidebarCollapsed ? " collapsed" : ""}`}
          onClick={() => setSidebarCollapsed((c) => !c)}
          aria-label={sidebarCollapsed ? "Show playlists" : "Hide playlists"}
        >
          {sidebarCollapsed ? "›" : "‹"}
        </button>

        <div className="content">
          {!selectedPlaylist && !allPlaylistsSelected ? (
            <div className="content-empty">Select a playlist to get started</div>
          ) : (
            <>
              <div className="content-header">
                <svg className="header-topo" viewBox="0 0 1200 73" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                  <path d="M-100,160 C200,136 450,110 700,84 S1000,50 1300,28" />
                  <path d="M-100,136 C190,112 450,86 710,60 S1000,26 1300,4" />
                  <path d="M-100,112 C200,88 460,62 720,36 S1010,2 1300,-20" />
                  <path d="M-100,88 C210,64 470,38 730,12 S1020,-22 1300,-44" />
                  <path d="M-100,64 C220,40 480,14 740,-12 S1030,-46 1300,-68" />
                  <path d="M-100,40 C230,16 490,-10 750,-36 S1040,-70 1300,-92" />
                  <path d="M-100,16 C240,-8 500,-34 760,-60 S1050,-94 1300,-116" />
                </svg>
                <div className="content-header-top">
                  <div className="content-title-row">
                    <h2 className="content-title">
                      {allPlaylistsSelected ? "All Playlists" : selectedPlaylist.name}
                    </h2>
                    {!allPlaylistsSelected && !loadingTracks &&
                      selectedPlaylist?.trackTotal > tracks.length && (
                      <button
                        className="sort-btn load-all-btn"
                        data-tooltip="Fetch remaining tracks from Spotify"
                        onClick={loadAllTracks}
                      >
                        Load all {selectedPlaylist.trackTotal} tracks
                      </button>
                    )}
                  </div>
                  {sortMode && !writeProgress && (
                    <button
                      className="btn-create"
                      data-tooltip="Save each group as a new Spotify playlist"
                      onClick={handleWriteBack}
                      disabled={!!aiProgress}
                    >
                      Create Playlists
                    </button>
                  )}
                  {!loadingTracks && tracks.length > 0 && (
                    <div className="sort-controls">
                      <span className="sort-label">Sort by</span>
                      <button
                        className={`sort-btn${sortMode === "era" ? " active" : ""}`}
                        data-tooltip="Group tracks by decade"
                        onClick={() => handleSortMode("era")}
                      >
                        Era
                      </button>
                      <button
                        className={`sort-btn ai${sortMode === "ai-genre" ? " active" : ""}`}
                        data-tooltip={`Sorts into: ${PRESET_GENRES.join(", ")}`}
                        onClick={() => handleSortMode("ai-genre")}
                        disabled={!!aiProgress}
                      >
                        AI Genre
                      </button>
                      <button
                        className={`sort-btn ai${sortMode === "ai-vibe" ? " active" : ""}`}
                        data-tooltip="AI groups tracks by energy and tempo feel"
                        onClick={() => handleSortMode("ai-vibe")}
                        disabled={!!aiProgress}
                      >
                        Energy
                      </button>
                      {(sortMode === "ai-genre" || sortMode === "ai-vibe") && (
                        <>
                          {sortMode === "ai-vibe" && (
                            <>
                              <div className="sort-divider" />
                              <label className="sort-label" htmlFor="target-groups">Playlists</label>
                              <select
                                id="target-groups"
                                className="groups-select"
                                value={targetGroups}
                                onChange={(e) => {
                                  setTargetGroups(Number(e.target.value));
                                  setAiMap({});
                                }}
                                disabled={!!aiProgress}
                              >
                                {Array.from({ length: 14 }, (_, i) => i + 2).map((n) => (
                                  <option key={n} value={n}>{n}</option>
                                ))}
                              </select>
                            </>
                          )}
                          {Object.keys(aiMap).length > 0 && (
                            <button
                              className="sort-btn ai"
                              data-tooltip="Re-run AI with current settings"
                              onClick={async () => {
                                localStorage.removeItem(aiCacheKey(sortMode));
                                setAiMap({});
                                setAiProgress({ done: 0, total: tracks.length });
                                const results = await classifyTracks(
                                  tracks,
                                  (done, total) => setAiProgress({ done, total }),
                                  sortMode,
                                  targetGroups
                                );
                                setAiMap(results);
                                setCache(aiCacheKey(sortMode), results);
                                setAiProgress(null);
                              }}
                              disabled={!!aiProgress}
                            >
                              Re-classify
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {aiProgress && (
                <div className="ai-progress">
                  <div className="ai-progress-bar">
                    <div
                      className="ai-progress-fill"
                      style={{ width: `${(aiProgress.done / aiProgress.total) * 100}%` }}
                    />
                  </div>
                  <span>Classifying artists… {aiProgress.done}/{aiProgress.total}</span>
                </div>
              )}

              {writeProgress && (
                <div className="ai-progress">
                  <div className="ai-progress-bar">
                    <div
                      className="ai-progress-fill"
                      style={{ width: `${(writeProgress.current / writeProgress.total) * 100}%` }}
                    />
                  </div>
                  <span>Creating "{writeProgress.label}" ({writeProgress.current}/{writeProgress.total})</span>
                </div>
              )}

              {writeError && (
                <div className="write-error">
                  {writeError}
                </div>
              )}

              {createdPlaylists.length > 0 && (
                <div className="created-playlists">
                  <span className="created-title">Saved to Spotify</span>
                  <div className="created-grid">
                    {createdPlaylists.map((p) => (
                      <a
                        key={p.label}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="created-card"
                      >
                        <span className="created-card-label">{p.label}</span>
                        <span className="created-card-count">{p.count} tracks</span>
                        <span className="created-card-arrow">↗</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {loadingAll ? (
                <div className="fetch-all-progress">
                  <div className="fetch-all-bar-wrap">
                    <div
                      className="fetch-all-bar-fill"
                      style={{
                        width: loadingAllProgress
                          ? `${(loadingAllProgress.current / loadingAllProgress.total) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <div className="fetch-all-meta">
                    <span className="fetch-all-label">
                      {loadingAllProgress
                        ? `Fetching "${loadingAllProgress.name}"…`
                        : "Starting…"}
                    </span>
                    <span className="fetch-all-counts">
                      {loadingAllProgress && `${loadingAllProgress.current} / ${loadingAllProgress.total} playlists`}
                      {tracks.length > 0 && ` · ${tracks.length} tracks`}
                    </span>
                  </div>
                </div>
              ) : loadingTracks ? (
                <div className="content-loading">Loading tracks...</div>
              ) : tracks.length === 0 ? (
                <div className="content-loading">No tracks found.</div>
              ) : sortMode ? (
                // ── Grouped view ──
                <div className="groups">
                  {Object.entries(groups).map(([label, groupTracks]) => (
                    <div key={label} className="group">
                      <div className="group-header">
                        <span className="group-label">{label}</span>
                        <span className="group-count">{groupTracks.length} tracks</span>
                      </div>
                      <table className="track-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Title</th>
                            <th>Artist</th>
                            <th>Year</th>
                            <th>Genre</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupTracks.map((item, i) => {
                            const track = item.item;
                            const year = track?.album?.release_date?.slice(0, 4) ?? "—";
                            const genre = aiMap[track?.id]?.genre ?? genreMap[track?.artists?.[0]?.id] ?? "—";
                            return (
                              <tr key={track?.id ?? i}>
                                <td className="track-meta">{i + 1}</td>
                                <td className="track-name">{track?.name ?? "—"}</td>
                                <td>{track?.artists?.[0]?.name ?? "—"}</td>
                                <td className="track-meta">{year}</td>
                                <td>{genre}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ) : (
                // ── Flat view with pagination ──
                (() => {
                  const totalPages = Math.ceil(tracks.length / PAGE_SIZE);
                  const pageStart = (currentPage - 1) * PAGE_SIZE;
                  const pageTracks = tracks.slice(pageStart, pageStart + PAGE_SIZE);
                  return (
                    <>
                      <table className="track-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Title</th>
                            <th>Artist</th>
                            <th>Year</th>
                            <th>Genre</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageTracks.map((item, i) => {
                            const track = item.item;
                            const year = track?.album?.release_date?.slice(0, 4) ?? "—";
                            const genre = aiMap[track?.id]?.genre ?? genreMap[track?.artists?.[0]?.id] ?? "—";
                            return (
                              <tr key={track?.id ?? i}>
                                <td className="track-meta">{pageStart + i + 1}</td>
                                <td className="track-name">{track?.name ?? "—"}</td>
                                <td>{track?.artists?.[0]?.name ?? "—"}</td>
                                <td className="track-meta">{year}</td>
                                <td>{genre}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {totalPages > 1 && (
                        <div className="pagination">
                          <button
                            className="page-btn"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                          >
                            ←
                          </button>
                          <span className="page-label">
                            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, tracks.length)} of {tracks.length}
                          </span>
                          <button
                            className="page-btn"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                          >
                            →
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
