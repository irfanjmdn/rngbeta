<script>
  import {
    debugLogs,
    debugStatus,
    isBuildingCrate,
    isCrateReady,
  } from '../lib/store.js';
  import { fetchAndBuildCrate, loadDemoCrateDirect } from '../lib/sse.js';
  import { getSpotifyProxyUrl, setSpotifyProxyUrl } from '../lib/modes/spotifyEngine.js';

  // Screen state: 'select' (First thing: 2 big buttons) | 'entry' (Input card)
  let currentStep = 'select';
  let selectedMode = 'lastfm'; // 'lastfm' | 'spotify'

  let wasCrateReady = false;
  $: {
    if (wasCrateReady && !$isCrateReady) {
      currentStep = 'select';
    }
    wasCrateReady = $isCrateReady;
  }

  let lastfmUsername = 'rj';
  let spotifyInput = '';
  let forceRefresh = false;
  let workerProxyUrl = getSpotifyProxyUrl();
  let showProxyConfig = false;
  let terminalEl;

  function handleSaveProxy() {
    setSpotifyProxyUrl(workerProxyUrl);
  }

  function handleLoadDemo() {
    loadDemoCrateDirect('spotify');
  }

  $: if ($debugLogs && terminalEl) {
    setTimeout(() => {
      if (terminalEl) terminalEl.scrollTop = terminalEl.scrollHeight;
    }, 10);
  }

  function pickMode(mode) {
    selectedMode = mode;
    currentStep = 'entry';
  }

  function goBackToSelect() {
    currentStep = 'select';
  }

  function handleSubmit(e) {
    e.preventDefault();
    const currentInput = selectedMode === 'lastfm' ? lastfmUsername : spotifyInput;
    if (!currentInput.trim()) return;
    fetchAndBuildCrate(currentInput.trim(), selectedMode, forceRefresh);
  }
</script>

<!-- PAGE 1: Mode Selection Viewport (Distilled Selection Cards) -->
{#if currentStep === 'select'}
  <main class="mode-select-viewport" id="modeSelectScreen">
    <div class="mode-select-container">
      <div class="mode-select-header">
        <h1 class="mode-select-heading">SELECT CRATE SOURCE</h1>
        <p class="mode-select-subheading">Choose an audio platform to generate your crate.</p>
      </div>

      <div class="mode-select-grid" role="group" aria-label="Select Crate Source">
        <!-- Last.fm Card -->
        <button
          type="button"
          class="mode-big-card mode-card-lastfm"
          id="btnChooseLastfm"
          on:click={() => pickMode('lastfm')}
          aria-label="Select Last.fm crate mode"
        >
          <div class="mode-icon-cradle cradle-lastfm">
            <!-- Official Last.fm Script Logo SVG -->
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/>
            </svg>
          </div>

          <div class="mode-card-content">
            <h2 class="mode-big-title">LAST.FM</h2>
            <p class="mode-big-desc">Roll tracks from your listening history.</p>
          </div>
        </button>

        <!-- Spotify Card -->
        <button
          type="button"
          class="mode-big-card mode-card-spotify"
          id="btnChooseSpotify"
          on:click={() => pickMode('spotify')}
          aria-label="Select Spotify mode"
        >
          <div class="mode-icon-cradle cradle-spotify">
            <!-- Spotify Logo SVG -->
            <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"/>
            </svg>
          </div>

          <div class="mode-card-content">
            <h2 class="mode-big-title">SPOTIFY</h2>
            <p class="mode-big-desc">Roll tracks from public playlists or direct playlist links.</p>
          </div>
        </button>
      </div>
    </div>
  </main>

<!-- PAGE 2: Input Screen matching original card -->
{:else}
  <main class="onboarding-viewport" id="onboardingScreen">
    <div class="onboarding-card mode-{selectedMode}">
      <div class="form-nav-bar">
        <button
          type="button"
          class="btn-back-mode"
          id="btnBackToModes"
          on:click={goBackToSelect}
          aria-label="Back to mode selection"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>BACK</span>
        </button>
      </div>

      <h1 class="onboarding-title">
        {selectedMode === 'spotify' ? 'SPOTIFY CRATE' : 'LAST.FM CRATE'}
      </h1>

      <p class="onboarding-desc">
        {selectedMode === 'spotify'
          ? 'Enter a public Spotify playlist link or profile to scan tracks and build your crate.'
          : 'Enter a public Last.fm profile to scan listening history and build your crate.'}
      </p>

      <form class="onboarding-form" id="formFetchProfile" on:submit={handleSubmit}>
        {#if selectedMode === 'lastfm'}
          <label for="inputLastfmUser" class="input-label">LAST.FM USERNAME</label>
          <div class="input-group">
            <input
              type="text"
              id="inputLastfmUser"
              class="input-profile input-profile-lastfm"
              placeholder="rj"
              autocomplete="off"
              spellcheck="false"
              bind:value={lastfmUsername}
              required
            />
            <button type="submit" class="btn-build-crate btn-build-lastfm" id="btnBuildCrate" disabled={$isBuildingCrate}>
              <span id="btnBuildText">{$isBuildingCrate ? 'Building Crate...' : 'Fetch & Build Crate'}</span>
              <div class="btn-spinner {$isBuildingCrate ? '' : 'hidden'}" id="btnSpinner"></div>
            </button>
          </div>
        {:else}
          <label for="inputSpotifyProfile" class="input-label">SPOTIFY PLAYLIST URL</label>
          <div class="input-group">
            <input
              type="text"
              id="inputSpotifyProfile"
              class="input-profile input-profile-spotify"
              placeholder="https://open.spotify.com/playlist/..."
              autocomplete="off"
              spellcheck="false"
              bind:value={spotifyInput}
              required
            />
            <button type="submit" class="btn-build-crate btn-build-spotify" id="btnBuildCrate" disabled={$isBuildingCrate}>
              <span id="btnBuildText">{$isBuildingCrate ? 'Building Crate...' : 'Fetch & Build Crate'}</span>
              <div class="btn-spinner {$isBuildingCrate ? '' : 'hidden'}" id="btnSpinner"></div>
            </button>
          </div>
          <span class="proxy-hint">Tip: Paste any public playlist link (Share &rarr; Copy link to playlist). User profile discovery requires running python server.py.</span>

          <div class="options-bar">
            <label class="checkbox-label" for="chkForceRefresh">
              <input
                type="checkbox"
                id="chkForceRefresh"
                bind:checked={forceRefresh}
              />
              <span>Force live re-scrape (bypass local cache)</span>
            </label>
            <button
              type="button"
              class="btn-demo-link"
              on:click={handleLoadDemo}
              disabled={$isBuildingCrate}
            >
              Load Offline Demo Crate
            </button>
          </div>

          <div class="proxy-config-bar">
            <button
              type="button"
              class="btn-proxy-toggle"
              on:click={() => { showProxyConfig = !showProxyConfig; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              <span>{showProxyConfig ? 'Hide Cloudflare Worker Proxy Settings' : 'Cloudflare Worker Proxy (GitHub Pages)'}</span>
            </button>

            {#if showProxyConfig}
              <div class="proxy-input-group">
                <input
                  type="url"
                  class="input-proxy-url"
                  placeholder="e.g. https://spotify-proxy.your-name.workers.dev"
                  bind:value={workerProxyUrl}
                  on:input={handleSaveProxy}
                />
                <span class="proxy-hint">Required on static GitHub Pages to proxy Spotify embed data. Local backend (server.py) works without proxy.</span>
              </div>
            {/if}
          </div>
        {/if}
      </form>

      <!-- Collapsible Live Progress & Debug Dropdown -->
      <details class="debug-dropdown" id="debugDropdown" open={$debugStatus === 'error'}>
        <summary class="debug-summary">
          <div class="debug-summary-left">
            <span class="debug-status-dot {$debugStatus}" id="debugStatusDot"></span>
            <span class="debug-summary-title">Live Scraper Progress &amp; Debug Console</span>
          </div>
          <span class="debug-badge" id="debugBadge">{$debugLogs.length} events</span>
        </summary>
        <div class="debug-terminal" id="debugTerminal" bind:this={terminalEl}>
          {#each $debugLogs as log}
            <div class="terminal-line {log.level}">
              {log.time ? `[${log.time}] ` : ''}{log.message}
            </div>
          {/each}
        </div>
      </details>
    </div>
  </main>
{/if}
