<script>
  import {
    debugLogs,
    debugStatus,
    isBuildingCrate,
  } from '../lib/store.js';
  import { fetchAndBuildCrate } from '../lib/sse.js';

  let profileUrl = 'https://open.spotify.com/user/2jp1yf3h1h49zye21bxnxk0w5';
  let forceRefresh = false;
  let terminalEl;

  $: if ($debugLogs && terminalEl) {
    setTimeout(() => {
      if (terminalEl) terminalEl.scrollTop = terminalEl.scrollHeight;
    }, 10);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!profileUrl.trim()) return;
    fetchAndBuildCrate(profileUrl.trim(), forceRefresh);
  }

  function handleDemoClick() {
    profileUrl = 'https://open.spotify.com/user/2jp1yf3h1h49zye21bxnxk0w5';
    fetchAndBuildCrate(profileUrl, false);
  }
</script>

<main class="onboarding-viewport" id="onboardingScreen">
  <div class="onboarding-card">
    <div class="brand-badge-pill">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"/>
      </svg>
      <span>STANDALONE CRATE SPINNER</span>
    </div>

    <h1 class="onboarding-title">SPOTIFY CRATE RNG</h1>
    <p class="onboarding-desc">
      Input any public Spotify account to scan all playlists and build your dynamic card-collector crate.
    </p>

    <form class="onboarding-form" id="formFetchProfile" on:submit={handleSubmit}>
      <label for="inputProfileUrl" class="input-label">Spotify Profile URL or Username</label>
      <div class="input-group">
        <input
          type="text"
          id="inputProfileUrl"
          class="input-profile"
          placeholder="https://open.spotify.com/user/2jp1yf3h1h49zye21bxnxk0w5"
          autocomplete="off"
          spellcheck="false"
          bind:value={profileUrl}
          required
        />
        <button type="submit" class="btn-build-crate" id="btnBuildCrate" disabled={$isBuildingCrate}>
          <span id="btnBuildText">{$isBuildingCrate ? 'Scanning Profile...' : 'Fetch & Build Crate'}</span>
          <div class="btn-spinner {$isBuildingCrate ? '' : 'hidden'}" id="btnSpinner"></div>
        </button>
      </div>

      <div class="quick-demos-bar">
        <span class="demos-label">Quick load:</span>
        <button type="button" class="chip-demo" id="btnDemoIrfan" on:click={handleDemoClick}>
          Irfan's Profile (935 Tracks)
        </button>
      </div>

      <div class="options-bar">
        <label class="checkbox-label">
          <input type="checkbox" id="chkForceRefresh" bind:checked={forceRefresh} />
          <span>Force live re-scrape (bypass local cache)</span>
        </label>
      </div>
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
