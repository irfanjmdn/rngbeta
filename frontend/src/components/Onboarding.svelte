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
</script>

<main class="onboarding-viewport" id="onboardingScreen">
  <div class="onboarding-card">
    <h1 class="onboarding-title">CRATE RNG</h1>

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
