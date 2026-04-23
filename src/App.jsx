import { useEffect, useState, useRef } from "react";
import "./App.css";
import {
  redirectToSpotifyLogin,
  exchangeCodeForToken,
  getAccessToken,
  fetchPlaylists,
  fetchTracks,
  fetchArtists,
  createPlaylist,
  addTracksToPlaylist,
  getCached,
  setCache,
} from "./auth";
import { classifyTracks } from "./ai";

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
  const PAGE_SIZE = 50;
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const token = getAccessToken();

    if (code) {
      exchangeCodeForToken(code).then((newToken) => {
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
    if (cachedUser && cachedPlaylists) {
      setUser(cachedUser);
      setPlaylists(cachedPlaylists);
      return;
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
      if (lists && lists.length > 0) setCache("playlists", lists);
      setPlaylists(lists ?? []);
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

    const ownedPlaylists = playlists.filter((p) => p.owner?.id === user.id);
    const seen = new Set();
    const allItems = [];

    for (let i = 0; i < ownedPlaylists.length; i++) {
      const playlist = ownedPlaylists[i];
      setLoadingAllProgress({
        current: i + 1,
        total: ownedPlaylists.length,
        name: playlist.name,
      });
      const { items } = await fetchTracks(playlist.id);
      for (const item of items) {
        const id = item.item?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          allItems.push(item);
        }
      }
      setTracks([...allItems]);
    }
    setLoadingAllProgress(null);

    setTracks(allItems);

    try {
      const artistIds = [
        ...new Set(allItems.map((item) => item.item?.artists?.[0]?.id).filter(Boolean)),
      ];
      const genres = await fetchArtists(artistIds);
      setGenreMap(genres);
    } finally {
      setLoadingAll(false);
      setLoadingTracks(false);
    }
  }

  async function selectPlaylist(playlist) {
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

    try {
      const { items, total } = await fetchTracks(playlist.id);
      setTracks(items);
      setPlaylists((prev) =>
        prev.map((p) => p.id === playlist.id ? { ...p, trackTotal: total } : p)
      );
      const artistIds = [
        ...new Set(items.map((item) => item.item?.artists?.[0]?.id).filter(Boolean)),
      ];
      const genres = await fetchArtists(artistIds);
      setGenreMap(genres);
    } finally {
      setLoadingTracks(false);
    }
  }

  async function handleSortMode(mode) {
    const next = sortMode === mode ? null : mode;
    setSortMode(next);
    setCurrentPage(1);

    if ((next === "ai-genre" || next === "ai-vibe") && Object.keys(aiMap).length === 0) {
      setAiProgress({ done: 0, total: tracks.length });
      try {
        const results = await classifyTracks(tracks, (done, total) => {
          setAiProgress({ done, total });
        }, next, targetGroups);
        setAiMap(results);
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
    const groupEntries = Object.entries(groups);
    const created = [];

    for (let i = 0; i < groupEntries.length; i++) {
      const [label, groupTracks] = groupEntries[i];
      setWriteProgress({ current: i + 1, total: groupEntries.length, label });

      const baseName = allPlaylistsSelected ? "Purge" : selectedPlaylist.name;
      const playlist = await createPlaylist(
        user.id,
        `${baseName} — ${label}`,
        `Created by Playlist Purge`
      );

      const uris = groupTracks
        .map((item) => item.item?.uri)
        .filter((uri) => uri && !uri.startsWith("spotify:local"));

      if (uris.length > 0) {
        await addTracksToPlaylist(playlist.id, uris);
      }

      created.push({
        label,
        name: playlist.name,
        url: playlist.external_urls?.spotify,
        count: uris.length,
      });
    }

    setCreatedPlaylists(created);
    setWriteProgress(null);
  }

  if (!user) {
    return (
      <div className="login-screen">
        <h1>Playlist Purge</h1>
        <p>Sort your Spotify library. Make it yours again.</p>
        <button className="btn-connect" onClick={redirectToSpotifyLogin}>
          Connect Spotify
        </button>
      </div>
    );
  }

  const ownedPlaylists = playlists.filter((p) => p.owner?.id === user.id);
  const groups = sortMode ? groupTracks(tracks, sortMode, genreMap, aiMap) : null;

  return (
    <div className="app">
      <header className="header">
        <span className="header-logo">Playlist Purge</span>
        <div className="header-user">
          Connected as <span>{user.display_name}</span>
        </div>
      </header>

      <div className="main">
        <aside className="sidebar">
          <div className="sidebar-heading">Your Playlists</div>
          <ul className="playlist-list">
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
          </ul>
        </aside>

        <div className="content">
          {!selectedPlaylist && !allPlaylistsSelected ? (
            <div className="content-empty">Select a playlist to get started</div>
          ) : (
            <>
              <div className="content-header">
                <div className="content-header-top">
                  <h2 className="content-title">
                    {allPlaylistsSelected ? "All Playlists" : selectedPlaylist.name}
                  </h2>
                  {sortMode && !writeProgress && (
                    <button
                      className="btn-create"
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
                        onClick={() => handleSortMode("era")}
                      >
                        Era
                      </button>
                      <button
                        className={`sort-btn${sortMode === "genre" ? " active" : ""}`}
                        onClick={() => handleSortMode("genre")}
                      >
                        Genre
                      </button>
                      <button
                        className={`sort-btn ai${sortMode === "ai-genre" ? " active" : ""}`}
                        onClick={() => handleSortMode("ai-genre")}
                        disabled={!!aiProgress}
                      >
                        AI Genre
                      </button>
                      <button
                        className={`sort-btn ai${sortMode === "ai-vibe" ? " active" : ""}`}
                        onClick={() => handleSortMode("ai-vibe")}
                        disabled={!!aiProgress}
                      >
                        AI Vibe
                      </button>
                      {(sortMode === "ai-genre" || sortMode === "ai-vibe") && (
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
                          {Object.keys(aiMap).length > 0 && (
                            <button
                              className="sort-btn ai"
                              onClick={async () => {
                                setAiMap({});
                                setAiProgress({ done: 0, total: tracks.length });
                                const results = await classifyTracks(
                                  tracks,
                                  (done, total) => setAiProgress({ done, total }),
                                  sortMode,
                                  targetGroups
                                );
                                setAiMap(results);
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
                  <span>Classifying with AI… {aiProgress.done}/{aiProgress.total}</span>
                </div>
              )}

              {writeProgress && (
                <div className="ai-progress">
                  <div className="ai-progress-bar">
                    <div
                      className="ai-progress-fill"
                      style={{ width: `${(writeProgress.current / writeProgress.total) * 100}%`, background: "var(--green)" }}
                    />
                  </div>
                  <span>Creating "{writeProgress.label}" ({writeProgress.current}/{writeProgress.total})</span>
                </div>
              )}

              {createdPlaylists.length > 0 && (
                <div className="created-playlists">
                  <span className="created-title">Playlists created</span>
                  {createdPlaylists.map((p) => (
                    <a
                      key={p.label}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="created-link"
                    >
                      <span>{p.name}</span>
                      <span className="created-count">{p.count} tracks</span>
                    </a>
                  ))}
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
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                            <button
                              key={page}
                              className={`page-btn${currentPage === page ? " active" : ""}`}
                              onClick={() => setCurrentPage(page)}
                            >
                              {page}
                            </button>
                          ))}
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
