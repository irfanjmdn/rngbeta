<script>
  import {
    activeUserId,
    rngTracks,
    playlistsCount,
    masteryText,
    gameRolls,
    rarestRolled,
    unlockedCount,
    activeModal,
    isCrateReady,
    isSpinning,
    isAutoRolling,
  } from '../lib/store.js';

  function handleOpenBinder() {
    activeModal.set('binder');
  }

  function handleCloseBinder() {
    if ($activeModal === 'binder') {
      activeModal.set(null);
    }
  }

  function handleOpenRates() {
    activeModal.set('rates');
  }

  function handleOpenSettings() {
    activeModal.set('settings');
  }

  function handleSwitchAccount() {
    if ($isSpinning) return;
    isAutoRolling.set(false);
    activeModal.set(null);
    isCrateReady.set(false);
  }
</script>

<header class="game-hud-bar">
  <div class="game-hud-left">
    <div class="hud-logo-mark">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    </div>
    <div class="hud-brand-titles">
      <div class="hud-brand-title">TRACK CRATE RNG</div>
      <div class="hud-brand-sub" id="hudAccountSub">
        User: {$activeUserId} &bull; {$rngTracks.length} Tracks &bull; {$playlistsCount} Playlists
      </div>
    </div>
  </div>

  <div class="game-hud-center">
    <div class="hud-telemetry-bar">
      <div class="telemetry-item">
        <span class="telemetry-label">Mastery</span>
        <span class="telemetry-val highlight" id="hudMastery">{$masteryText}</span>
      </div>
      <div class="telemetry-divider"></div>
      <div class="telemetry-item">
        <span class="telemetry-label">Rolls</span>
        <span class="telemetry-val" id="hudRolls">{$gameRolls}</span>
      </div>
      <div class="telemetry-divider"></div>
      <div class="telemetry-item">
        <span class="telemetry-label">Rarest</span>
        <span class="telemetry-val" id="hudRarest">{$rarestRolled}</span>
      </div>
    </div>
  </div>

  <div class="game-hud-right">
    <div class="hud-nav-segmented">
      <button
        class="btn-hud-tab {$activeModal !== 'binder' ? 'active' : ''}"
        id="btnHudArena"
        type="button"
        on:click={handleCloseBinder}
      >
        Roll Arena
      </button>
      <button
        class="btn-hud-tab {$activeModal === 'binder' ? 'active' : ''}"
        id="btnHudBinder"
        type="button"
        on:click={handleOpenBinder}
      >
        Binder (<span id="hudBinderCount">{$unlockedCount}</span>)
      </button>
    </div>
    <button class="btn-hud-secondary" id="btnHudRates" type="button" on:click={handleOpenRates}>
      Odds &amp; Rates
    </button>
    <button
      class="btn-hud-secondary"
      id="btnHudSettings"
      type="button"
      title="Audio and game settings"
      on:click={handleOpenSettings}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        style="vertical-align: -2px; margin-right: 4px;"
      >
        <circle cx="12" cy="12" r="3"></circle>
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        ></path>
      </svg>
      Settings
    </button>
    <button
      class="btn-hud-ghost"
      id="btnSwitchAccount"
      type="button"
      title="Load a different Spotify account"
      on:click={handleSwitchAccount}
    >
      Change Profile
    </button>
  </div>
</header>
