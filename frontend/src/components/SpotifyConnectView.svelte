<script>
  import { onMount } from "svelte";
  import {
    getAccessToken,
    getSavedClientId,
    saveClientId,
    loginWithSpotify,
    handleAuthCallback,
    disconnectSpotify,
    fetchCurrentUserProfile,
    fetchUserLibraryPlaylists,
    fetchOtherUserPlaylists,
    compileMultiPlaylistCrate,
  } from "../lib/modes/spotifyAuth.js";
  import { appendLog, isBuildingCrate } from "../lib/store.js";
  import { createSseHandler } from "../lib/sse.js";

  export let onDirectPlaylistMode = () => {};
  export let onLoadDemo = () => {};

  let clientId = getSavedClientId();
  let token = null;
  let userProfile = null;
  let playlists = [];
  let selectedPlaylistIds = new Set();
  let activeTab = "mine"; // 'mine' | 'followed' | 'other'
  let otherUserIdInput = "";
  let isFetchingPlaylists = false;
  let statusMessage = "";

  const sseHandler = createSseHandler("spotify");

  onMount(async () => {
    try {
      const cbToken = await handleAuthCallback();
      if (cbToken) {
        token = cbToken;
        appendLog("Spotify authentication successful!", "success");
      } else {
        token = getAccessToken();
      }

      if (token) {
        await loadUserData(token);
      }
    } catch (e) {
      appendLog(`Auth error: ${e.message}`, "error");
    }
  });

  async function loadUserData(tok) {
    isFetchingPlaylists = true;
    statusMessage = "Fetching user profile and playlists from Spotify...";
    try {
      userProfile = await fetchCurrentUserProfile(tok);
      appendLog(`Logged in as Spotify user: ${userProfile.display_name}`, "success");

      const libPlaylists = await fetchUserLibraryPlaylists(tok);
      playlists = libPlaylists;
      appendLog(`Loaded ${playlists.length} playlists from library.`, "info");

      // By default, select user's own playlists
      const myIds = playlists
        .filter((p) => p.owner && p.owner.id === userProfile.id)
        .map((p) => p.id);
      selectedPlaylistIds = new Set(myIds.length > 0 ? myIds : playlists.slice(0, 5).map((p) => p.id));
    } catch (err) {
      appendLog(`Error loading Spotify data: ${err.message}`, "error");
      if (err.message.includes("401")) {
        disconnectSpotify();
        token = null;
      }
    } finally {
      isFetchingPlaylists = false;
      statusMessage = "";
    }
  }

  function handleConnect() {
    if (!clientId.trim()) {
      alert("Please enter your Spotify Client ID from developer.spotify.com");
      return;
    }
    saveClientId(clientId);
    loginWithSpotify(clientId.trim());
  }

  function handleDisconnect() {
    disconnectSpotify();
    token = null;
    userProfile = null;
    playlists = [];
    selectedPlaylistIds.clear();
    appendLog("Disconnected from Spotify.", "info");
  }

  function togglePlaylist(id) {
    if (selectedPlaylistIds.has(id)) {
      selectedPlaylistIds.delete(id);
    } else {
      selectedPlaylistIds.add(id);
    }
    selectedPlaylistIds = new Set(selectedPlaylistIds);
  }

  function selectAllCurrent() {
    displayedPlaylists.forEach((p) => selectedPlaylistIds.add(p.id));
    selectedPlaylistIds = new Set(selectedPlaylistIds);
  }

  function deselectAllCurrent() {
    displayedPlaylists.forEach((p) => selectedPlaylistIds.delete(p.id));
    selectedPlaylistIds = new Set(selectedPlaylistIds);
  }

  async function handleFetchOtherUser() {
    if (!otherUserIdInput.trim() || !token) return;
    isFetchingPlaylists = true;
    statusMessage = `Fetching public playlists for '${otherUserIdInput.trim()}'...`;
    try {
      const cleanUser = otherUserIdInput
        .replace(/.*spotify\.com\/user\//, "")
        .split("?")[0]
        .split("/")[0]
        .trim();
      const results = await fetchOtherUserPlaylists(token, cleanUser);
      if (results.length === 0) {
        appendLog(`No public playlists found for '${cleanUser}'.`, "warning");
      } else {
        appendLog(`Found ${results.length} public playlists for '${cleanUser}'.`, "success");
        // Merge without duplicates
        const existingIds = new Set(playlists.map((p) => p.id));
        const newOnes = results.filter((p) => !existingIds.has(p.id));
        playlists = [...playlists, ...newOnes];
        newOnes.forEach((p) => selectedPlaylistIds.add(p.id));
        selectedPlaylistIds = new Set(selectedPlaylistIds);
      }
    } catch (e) {
      appendLog(`Error fetching user playlists: ${e.message}`, "error");
    } finally {
      isFetchingPlaylists = false;
      statusMessage = "";
    }
  }

  async function handleBuildCrate() {
    const selected = playlists.filter((p) => selectedPlaylistIds.has(p.id));
    if (selected.length === 0) {
      alert("Please select at least one playlist to generate your crate.");
      return;
    }

    isBuildingCrate.set(true);
    appendLog(`Compiling crate from ${selected.length} selected playlists...`, "system");
    try {
      const readyEvent = await compileMultiPlaylistCrate(token, selected, (msg) => {
        appendLog(msg, "info");
      });

      appendLog(`Library compiled: ${readyEvent.tracksCount} tracks across ${selected.length} playlists!`, "success");
      appendLog(
        `Rarity Distribution -> Mythic: ${readyEvent.distribution.mythic}, Legendary: ${readyEvent.distribution.legendary}, Epic: ${readyEvent.distribution.epic}, Rare: ${readyEvent.distribution.rare}, Uncommon: ${readyEvent.distribution.uncommon}, Common: ${readyEvent.distribution.common}`,
        "info"
      );
      appendLog("Crate RNG initialized. Ready to roll!", "success");

      sseHandler(readyEvent);
    } catch (err) {
      appendLog(`Failed to build crate: ${err.message}`, "error");
      sseHandler({ type: "error", message: err.message });
    } finally {
      isBuildingCrate.set(false);
    }
  }

  $: myPlaylists = userProfile ? playlists.filter((p) => p.owner && p.owner.id === userProfile.id) : [];
  $: followedPlaylists = userProfile ? playlists.filter((p) => p.owner && p.owner.id !== userProfile.id) : [];
  $: displayedPlaylists = activeTab === "mine" ? myPlaylists : activeTab === "followed" ? followedPlaylists : playlists;
</script>

{#if !token}
  <div class="spotify-connect-card">
    <div class="connect-header">
      <h2 class="connect-title">CONNECT SPOTIFY (OFFICIAL PKCE)</h2>
      <p class="connect-sub">
        Connect directly to Spotify to scan all playlists from your profile, or creators you follow.
      </p>
    </div>

    <div class="client-id-field">
      <label for="inputSpotifyClientId" class="input-label">
        SPOTIFY CLIENT ID
        <a
          href="https://developer.spotify.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          class="dev-dashboard-link"
        >
          (Get Client ID in 1 min &rarr;)
        </a>
      </label>
      <input
        type="text"
        id="inputSpotifyClientId"
        class="input-profile input-profile-spotify"
        placeholder="e.g. d8a5ed958d274c2e8ee717e6a4b0971d"
        bind:value={clientId}
      />
      <span class="client-id-hint">
        Add <code>{typeof window !== 'undefined' ? window.location.origin + window.location.pathname : 'https://irfanjmdn.github.io/rngbeta/'}</code> as your Redirect URI in Spotify Developer Dashboard.
      </span>
    </div>

    <button
      type="button"
      class="btn-build-crate btn-build-spotify btn-spotify-connect"
      on:click={handleConnect}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"/>
      </svg>
      <span>Connect Spotify Account</span>
    </button>

    <div class="alt-options-divider">
      <span>OR</span>
    </div>

    <div class="alt-action-buttons">
      <button type="button" class="btn-alt-mode" on:click={onDirectPlaylistMode}>
        Paste Single Playlist Link Instead
      </button>
      <button type="button" class="btn-alt-mode" on:click={onLoadDemo}>
        Load Bundled Offline Demo Crate
      </button>
    </div>
  </div>
{:else}
  <!-- CONNECTED VIEW: Playlists & Creators Picker -->
  <div class="spotify-authenticated-panel">
    <!-- User Badge -->
    <div class="spotify-user-badge">
      <div class="user-info-left">
        {#if userProfile?.images?.[0]?.url}
          <img class="user-avatar" src={userProfile.images[0].url} alt={userProfile.display_name} />
        {:else}
          <div class="user-avatar-placeholder">
            {userProfile?.display_name?.[0] || 'U'}
          </div>
        {/if}
        <div class="user-text">
          <span class="user-connected-label">CONNECTED</span>
          <span class="user-display-name">{userProfile?.display_name || 'Spotify User'}</span>
        </div>
      </div>
      <button type="button" class="btn-disconnect" on:click={handleDisconnect}>
        Disconnect
      </button>
    </div>

    <!-- Navigation Tabs -->
    <div class="playlist-tabs-bar">
      <button
        type="button"
        class="tab-btn"
        class:is-active={activeTab === 'mine'}
        on:click={() => { activeTab = 'mine'; }}
      >
        My Playlists ({myPlaylists.length})
      </button>
      <button
        type="button"
        class="tab-btn"
        class:is-active={activeTab === 'followed'}
        on:click={() => { activeTab = 'followed'; }}
      >
        Followed Creators &amp; Playlists ({followedPlaylists.length})
      </button>
      <button
        type="button"
        class="tab-btn"
        class:is-active={activeTab === 'other'}
        on:click={() => { activeTab = 'other'; }}
      >
        Scan Another Profile
      </button>
    </div>

    <!-- Scan Another Profile Input -->
    {#if activeTab === 'other'}
      <div class="other-user-input-box">
        <label for="inputOtherUser" class="input-label">ENTER SPOTIFY USERNAME OR PROFILE URL</label>
        <div class="input-group">
          <input
            type="text"
            id="inputOtherUser"
            class="input-profile input-profile-spotify"
            placeholder="e.g. 2jp1yf3h1h49zye21bxnxk0w5 or profile link"
            bind:value={otherUserIdInput}
          />
          <button
            type="button"
            class="btn-build-crate btn-build-spotify"
            on:click={handleFetchOtherUser}
            disabled={isFetchingPlaylists}
          >
            {isFetchingPlaylists ? 'Scanning...' : 'Find Playlists'}
          </button>
        </div>
      </div>
    {/if}

    <!-- Selection Bar -->
    <div class="selection-control-bar">
      <span class="selection-count-label">
        <strong>{selectedPlaylistIds.size}</strong> of {playlists.length} playlists selected
      </span>
      <div class="selection-btns">
        <button type="button" class="btn-select-action" on:click={selectAllCurrent}>Select All</button>
        <button type="button" class="btn-select-action" on:click={deselectAllCurrent}>Clear</button>
      </div>
    </div>

    <!-- Playlists Scroll Grid -->
    <div class="playlists-picker-grid">
      {#if displayedPlaylists.length === 0}
        <div class="empty-picker-state">
          {activeTab === 'other'
            ? 'Enter a username above to load their public playlists.'
            : 'No playlists found in this category.'}
        </div>
      {:else}
        {#each displayedPlaylists as p (p.id)}
          <button
            type="button"
            class="playlist-picker-card"
            class:is-selected={selectedPlaylistIds.has(p.id)}
            on:click={() => togglePlaylist(p.id)}
          >
            <div class="card-checkbox-wrap">
              <input
                type="checkbox"
                class="card-checkbox"
                checked={selectedPlaylistIds.has(p.id)}
                tabindex="-1"
              />
            </div>
            {#if p.images?.[0]?.url}
              <img class="picker-cover" src={p.images[0].url} alt={p.name} loading="lazy" />
            {:else}
              <div class="picker-cover-placeholder">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
              </div>
            {/if}
            <div class="picker-meta">
              <span class="picker-title">{p.name}</span>
              <span class="picker-creator">by {p.owner?.display_name || 'Creator'} &bull; {p.tracks?.total || 0} tracks</span>
            </div>
          </button>
        {/each}
      {/if}
    </div>

    <!-- Primary Action Button -->
    <button
      type="button"
      class="btn-build-crate btn-build-spotify btn-compile-crate"
      disabled={$isBuildingCrate || selectedPlaylistIds.size === 0}
      on:click={handleBuildCrate}
    >
      <span id="btnBuildText">
        {$isBuildingCrate
          ? 'Compiling Multi-Playlist Crate...'
          : `Build Crate from ${selectedPlaylistIds.size} Selected Playlists`}
      </span>
      <div class="btn-spinner {$isBuildingCrate ? '' : 'hidden'}" id="btnSpinner"></div>
    </button>
  </div>
{/if}

<style>
  .spotify-connect-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .connect-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .connect-title {
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: var(--text-main);
    margin: 0;
  }

  .connect-sub {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-muted);
    margin: 0;
  }

  .client-id-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dev-dashboard-link {
    color: var(--brand-green);
    text-decoration: underline;
    font-weight: 600;
    margin-left: 6px;
  }

  .client-id-hint {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .client-id-hint code {
    background: rgba(255, 255, 255, 0.08);
    padding: 2px 6px;
    border-radius: 4px;
    color: #fff;
    user-select: all;
  }

  .btn-spotify-connect {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 48px;
    font-size: 14px;
    margin-top: 4px;
  }

  .alt-options-divider {
    display: flex;
    align-items: center;
    text-align: center;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    margin: 8px 0;
  }

  .alt-options-divider::before,
  .alt-options-divider::after {
    content: "";
    flex: 1;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .alt-options-divider span {
    padding: 0 10px;
  }

  .alt-action-buttons {
    display: flex;
    gap: 10px;
  }

  .btn-alt-mode {
    flex: 1;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: var(--text-muted);
    font-family: var(--font-body);
    font-size: 12px;
    font-weight: 600;
    padding: 10px 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-alt-mode:hover {
    color: var(--text-main);
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.07);
  }

  /* Authenticated Panel */
  .spotify-authenticated-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .spotify-user-badge {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(29, 185, 84, 0.08);
    border: 1px solid rgba(29, 185, 84, 0.25);
    border-radius: 8px;
    padding: 10px 14px;
  }

  .user-info-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .user-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
  }

  .user-avatar-placeholder {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(29, 185, 84, 0.2);
    color: var(--brand-green);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 14px;
  }

  .user-text {
    display: flex;
    flex-direction: column;
  }

  .user-connected-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: var(--brand-green);
  }

  .user-display-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-main);
  }

  .btn-disconnect {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    padding: 6px 10px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-disconnect:hover {
    color: #F43F5E;
    border-color: #F43F5E;
  }

  /* Tabs Bar */
  .playlist-tabs-bar {
    display: flex;
    gap: 6px;
    background: rgba(0, 0, 0, 0.25);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .tab-btn {
    flex: 1;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-muted);
    font-family: var(--font-body);
    font-size: 11.5px;
    font-weight: 700;
    padding: 8px 6px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
  }

  .tab-btn:hover {
    color: var(--text-main);
  }

  .tab-btn.is-active {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .other-user-input-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 12px;
    border-radius: 8px;
  }

  .selection-control-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-muted);
    padding: 0 4px;
  }

  .selection-btns {
    display: flex;
    gap: 8px;
  }

  .btn-select-action {
    background: transparent;
    border: none;
    color: var(--brand-green);
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    padding: 2px 4px;
    text-decoration: underline;
  }

  /* Grid */
  .playlists-picker-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 240px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .empty-picker-state {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }

  .playlist-picker-card {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #111622;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  .playlist-picker-card:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: #141b2b;
  }

  .playlist-picker-card.is-selected {
    border-color: var(--brand-green);
    background: rgba(29, 185, 84, 0.06);
  }

  .card-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--brand-green);
    cursor: pointer;
    pointer-events: none;
  }

  .picker-cover {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .picker-cover-placeholder {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .picker-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .picker-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-main);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picker-creator {
    font-size: 11.5px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .btn-compile-crate {
    margin-top: 4px;
    height: 48px;
    font-size: 14px;
  }
</style>
