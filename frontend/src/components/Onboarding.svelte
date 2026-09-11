<script>
  import {
    debugLogs,
    debugStatus,
    isBuildingCrate,
    isCrateReady,
    recentProfiles,
    removeRecentProfile,
    clearRecentProfiles,
  } from '../lib/store.js';
  import { fetchAndBuildCrate } from '../lib/sse.js';

  // Screen state: 'select' (First thing: 2 big buttons) | 'entry' (Input card)
  let currentStep = 'select';
  let selectedMode = 'lastfm'; // 'lastfm' | 'soundcloud' | 'spotify'

  let wasCrateReady = false;
  $: {
    if (wasCrateReady && !$isCrateReady) {
      currentStep = 'select';
    }
    wasCrateReady = $isCrateReady;
  }

  let lastfmUsername = '';
  let soundcloudInput = '';
  let spotifyInput = '';
  let inputEl;
  let terminalEl;
  let isConsoleOpen = false;
  let userScrolledUp = false;

  function handleTerminalScroll() {
    if (!terminalEl) return;
    const distanceFromBottom = terminalEl.scrollHeight - terminalEl.scrollTop - terminalEl.clientHeight;
    userScrolledUp = distanceFromBottom > 35;
  }

  // Auto-open console when logs appear or error occurs, but never auto-close it
  $: if ($debugLogs.length > 0 || $debugStatus === 'error' || $debugStatus === 'running') {
    isConsoleOpen = true;
  }

  // Reset scroll lock when a new crate build starts
  $: if ($isBuildingCrate) {
    userScrolledUp = false;
  }

  $: if ($debugLogs && terminalEl && !userScrolledUp) {
    setTimeout(() => {
      if (terminalEl && !userScrolledUp) {
        terminalEl.scrollTop = terminalEl.scrollHeight;
      }
    }, 10);
  }

  function pickMode(mode) {
    selectedMode = mode;
    currentStep = 'entry';
    setTimeout(() => inputEl?.focus(), 40);
  }

  function switchMode(mode) {
    selectedMode = mode;
    setTimeout(() => inputEl?.focus(), 40);
  }

  let activeLoadingProfileKey = null;

  $: if ($isCrateReady || !$isBuildingCrate) {
    activeLoadingProfileKey = null;
  }

  // Auto-open console and switch to entry view if an error occurs while building
  $: if ($debugStatus === 'error') {
    activeLoadingProfileKey = null;
    currentStep = 'entry';
    isConsoleOpen = true;
  }

  function goBackToSelect() {
    currentStep = 'select';
  }

  function handleSelectRecent(profile) {
    if (!profile || $isBuildingCrate) return;
    if (profile.mode === 'soundcloud') {
      appendLog('SoundCloud mode is currently work in progress.', 'warn');
      return;
    }

    selectedMode = profile.mode;
    const targetInput = (profile.fetchTarget || profile.input || profile.rawUserId || (profile.mode === 'lastfm' || profile.mode === 'soundcloud' ? profile.userId : '') || '').trim();
    
    // If a legacy Spotify entry only had display name, prompt user to enter URL
    if (!targetInput) {
      if (profile.mode === 'lastfm') {
        lastfmUsername = profile.userId || '';
      } else if (profile.mode === 'soundcloud') {
        soundcloudInput = profile.userId || '';
      } else {
        spotifyInput = '';
      }
      currentStep = 'entry';
      setTimeout(() => inputEl?.focus(), 40);
      return;
    }

    if (profile.mode === 'lastfm') {
      lastfmUsername = targetInput;
    } else if (profile.mode === 'soundcloud') {
      soundcloudInput = targetInput;
    } else {
      spotifyInput = targetInput;
    }

    activeLoadingProfileKey = `${profile.mode}:${profile.fetchTarget || profile.userId}`;
    fetchAndBuildCrate(targetInput, profile.mode, false);
  }

  function handleRemoveRecent(e, profile) {
    e.stopPropagation();
    removeRecentProfile(profile.userId, profile.mode);
  }

  function handleClearRecent(e) {
    e.stopPropagation();
    clearRecentProfiles();
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (selectedMode === 'soundcloud') return;
    const currentInput = selectedMode === 'lastfm' ? lastfmUsername : (selectedMode === 'soundcloud' ? soundcloudInput : spotifyInput);
    if (!currentInput.trim()) return;
    fetchAndBuildCrate(currentInput.trim(), selectedMode, false);
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
            <p class="mode-big-desc">Roll tracks from public playlists on your profile.</p>
          </div>
        </button>

        <!-- SoundCloud Card (WIP) -->
        <button
          type="button"
          class="mode-big-card mode-card-soundcloud is-wip"
          id="btnChooseSoundCloud"
          disabled
          aria-label="SoundCloud crate mode (Work in progress)"
          title="SoundCloud mode is currently work in progress"
        >
          <span class="mode-card-badge-wip" aria-hidden="true">WIP</span>
          <div class="mode-icon-cradle cradle-soundcloud">
            <!-- Official SoundCloud Cloud SVG -->
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M1.17 12.23c-.05 0-.1.04-.1.1v4.83c0 .06.05.1.1.1h.47c.06 0 .1-.04.1-.1v-4.83c0-.06-.04-.1-.1-.1h-.47zm1.18-.55c-.06 0-.1.05-.1.1v5.93c0 .06.04.1.1.1h.47c.05 0 .1-.04.1-.1v-5.93c0-.05-.05-.1-.1-.1h-.47zm1.17-.67c-.06 0-.1.05-.1.1v7.28c0 .05.04.1.1.1h.48c.05 0 .1-.05.1-.1v-7.28c0-.05-.05-.1-.1-.1h-.48zm1.18-.32c-.05 0-.1.04-.1.1v7.92c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1v-7.92c0-.06-.04-.1-.1-.1h-.47zm1.18-.08c-.06 0-.1.05-.1.1v8.08c0 .06.04.1.1.1h.47c.06 0 .1-.04.1-.1v-8.08c0-.05-.04-.1-.1-.1h-.47zm1.17-.23c-.05 0-.1.05-.1.1v8.39c0 .05.05.1.1.1h.48c.05 0 .1-.05.1-.1v-8.39c0-.05-.05-.1-.1-.1h-.48zm1.18-.46c-.05 0-.1.05-.1.1v8.93c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1V9.92c0-.05-.04-.1-.1-.1h-.47zm1.18-.54c-.05 0-.1.04-.1.1v9.55c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1V9.38c0-.06-.04-.1-.1-.1h-.47zm1.17-.24c-.05 0-.1.05-.1.1v9.87c0 .06.05.1.1.1h.48c.05 0 .1-.04.1-.1V9.14c0-.05-.05-.1-.1-.1h-.48zm1.53-.45c.16-.62.47-1.18.91-1.63.76-.78 1.8-1.24 2.92-1.24.45 0 .88.08 1.28.23.47.18.89.46 1.23.82.26.27.47.58.62.92.51-.31 1.1-.48 1.73-.48 1.78 0 3.23 1.45 3.23 3.23 0 .12-.01.24-.03.35.98.53 1.64 1.56 1.64 2.75 0 1.74-1.41 3.15-3.15 3.15H11.8c-.06 0-.1-.04-.1-.1V8.79c0-.05-.04-.1-.1-.1h-.63z"/>
            </svg>
          </div>

          <div class="mode-card-content">
            <h2 class="mode-big-title">SOUNDCLOUD</h2>
            <p class="mode-big-desc">Roll tracks from your liked songs.</p>
          </div>
        </button>
      </div>

      <!-- Previously Loaded Profiles (Distilled & Usable) -->
      {#if $recentProfiles && $recentProfiles.length > 0}
        <section class="recent-profiles-section" aria-label="Previously Loaded Profiles">
          <div class="recent-profiles-header">
            <span class="recent-profiles-title">RECENT CRATES</span>
            <button
              type="button"
              class="btn-clear-recent"
              on:click={handleClearRecent}
              aria-label="Clear all previously loaded profiles"
            >
              Clear
            </button>
          </div>

          <div class="recent-profiles-grid" role="list">
            {#each $recentProfiles as profile (profile.mode + ':' + (profile.fetchTarget || profile.userId))}
              {@const profileKey = `${profile.mode}:${profile.fetchTarget || profile.userId}`}
              {@const isThisLoading = activeLoadingProfileKey === profileKey && $isBuildingCrate}
              <div
                class="recent-profile-card {profile.mode === 'soundcloud' ? 'is-wip' : ''} {isThisLoading ? 'is-loading' : ''} {$isBuildingCrate && !isThisLoading ? 'is-disabled' : ''}"
                role="button"
                tabindex="0"
                on:click={() => handleSelectRecent(profile)}
                on:keydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectRecent(profile);
                  }
                }}
                aria-label="Load {profile.displayName || profile.userId} on {profile.mode === 'lastfm' ? 'Last.fm' : (profile.mode === 'soundcloud' ? 'SoundCloud (Work in progress)' : 'Spotify')}"
                aria-busy={isThisLoading}
              >
                <!-- Avatar / Spinner -->
                <div class="recent-avatar-wrap">
                  {#if isThisLoading}
                    <div class="recent-spinner" aria-label="Loading"></div>
                  {:else if profile.avatarUrl}
                    <img
                      class="recent-avatar-img"
                      src={profile.avatarUrl}
                      alt=""
                      loading="lazy"
                    />
                  {:else}
                    <span class="recent-avatar-initial">
                      {(profile.displayName || profile.userId || '?').charAt(0).toUpperCase()}
                    </span>
                  {/if}
                </div>

                <!-- Platform Indicator Icon -->
                <span
                  class="recent-platform-indicator platform-{profile.mode}"
                  title={profile.mode === 'lastfm' ? 'Last.fm' : (profile.mode === 'soundcloud' ? 'SoundCloud' : 'Spotify')}
                  aria-hidden="true"
                >
                  {#if profile.mode === 'lastfm'}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/>
                    </svg>
                  {:else if profile.mode === 'soundcloud'}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M1.17 12.23c-.05 0-.1.04-.1.1v4.83c0 .06.05.1.1.1h.47c.06 0 .1-.04.1-.1v-4.83c0-.06-.04-.1-.1-.1h-.47zm1.18-.55c-.06 0-.1.05-.1.1v5.93c0 .06.04.1.1.1h.47c.05 0 .1-.04.1-.1v-5.93c0-.05-.05-.1-.1-.1h-.47zm1.17-.67c-.06 0-.1.05-.1.1v7.28c0 .05.04.1.1.1h.48c.05 0 .1-.05.1-.1v-7.28c0-.05-.05-.1-.1-.1h-.48zm1.18-.32c-.05 0-.1.04-.1.1v7.92c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1v-7.92c0-.06-.04-.1-.1-.1h-.47zm1.18-.08c-.06 0-.1.05-.1.1v8.08c0 .06.04.1.1.1h.47c.06 0 .1-.04.1-.1v-8.08c0-.05-.04-.1-.1-.1h-.47zm1.17-.23c-.05 0-.1.05-.1.1v8.39c0 .05.05.1.1.1h.48c.05 0 .1-.05.1-.1v-8.39c0-.05-.05-.1-.1-.1h-.48zm1.18-.46c-.05 0-.1.05-.1.1v8.93c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1V9.92c0-.05-.04-.1-.1-.1h-.47zm1.18-.54c-.05 0-.1.04-.1.1v9.55c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1V9.38c0-.06-.04-.1-.1-.1h-.47zm1.17-.24c-.05 0-.1.05-.1.1v9.87c0 .06.05.1.1.1h.48c.05 0 .1-.04.1-.1V9.14c0-.05-.05-.1-.1-.1h-.48zm1.53-.45c.16-.62.47-1.18.91-1.63.76-.78 1.8-1.24 2.92-1.24.45 0 .88.08 1.28.23.47.18.89.46 1.23.82.26.27.47.58.62.92.51-.31 1.1-.48 1.73-.48 1.78 0 3.23 1.45 3.23 3.23 0 .12-.01.24-.03.35.98.53 1.64 1.56 1.64 2.75 0 1.74-1.41 3.15-3.15 3.15H11.8c-.06 0-.1-.04-.1-.1V8.79c0-.05-.04-.1-.1-.1h-.63z"/>
                    </svg>
                  {:else}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"/>
                    </svg>
                  {/if}
                </span>

                <!-- Username / Display Name -->
                <span class="recent-profile-name">{profile.displayName || profile.userId}</span>

                <!-- Status / Track Count / WIP Badge -->
                {#if profile.mode === 'soundcloud'}
                  <span class="recent-wip-badge" title="Work in progress">WIP</span>
                {:else if isThisLoading}
                  <span class="recent-loading-text">LOADING...</span>
                {:else if profile.tracksCount > 0}
                  <span class="recent-profile-count">{profile.tracksCount} tracks</span>
                {/if}

                <!-- Remove Button -->
                {#if !isThisLoading}
                  <button
                    type="button"
                    class="btn-remove-recent"
                    aria-label="Remove {profile.displayName || profile.userId}"
                    on:click={(e) => handleRemoveRecent(e, profile)}
                  >
                    ×
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </main>

<!-- PAGE 2: Input Screen (Distilled Unified Entry Card) -->
{:else}
  <main class="onboarding-viewport" id="onboardingScreen">
    <div class="onboarding-card mode-{selectedMode}">
      <!-- Top Navigation & Platform Switcher Bar -->
      <div class="onboarding-top-bar">
        <button
          type="button"
          class="btn-back-mode"
          id="btnBackToModes"
          on:click={goBackToSelect}
          aria-label="Back to platform selection"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          <span>BACK</span>
        </button>

        <!-- Segmented Source Switcher -->
        <div class="source-segmented-tabs" role="tablist" aria-label="Audio Platform">
          <button
            type="button"
            role="tab"
            class="source-tab-btn {selectedMode === 'lastfm' ? 'is-active is-lastfm' : ''}"
            aria-selected={selectedMode === 'lastfm'}
            on:click={() => switchMode('lastfm')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"/>
            </svg>
            <span>LAST.FM</span>
          </button>
          <button
            type="button"
            role="tab"
            class="source-tab-btn {selectedMode === 'spotify' ? 'is-active is-spotify' : ''}"
            aria-selected={selectedMode === 'spotify'}
            on:click={() => switchMode('spotify')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"/>
            </svg>
            <span>SPOTIFY</span>
          </button>
          <button
            type="button"
            role="tab"
            class="source-tab-btn is-wip {selectedMode === 'soundcloud' ? 'is-active is-soundcloud' : ''}"
            aria-selected={selectedMode === 'soundcloud'}
            disabled
            title="SoundCloud mode is currently work in progress"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M1.17 12.23c-.05 0-.1.04-.1.1v4.83c0 .06.05.1.1.1h.47c.06 0 .1-.04.1-.1v-4.83c0-.06-.04-.1-.1-.1h-.47zm1.18-.55c-.06 0-.1.05-.1.1v5.93c0 .06.04.1.1.1h.47c.05 0 .1-.04.1-.1v-5.93c0-.05-.05-.1-.1-.1h-.47zm1.17-.67c-.06 0-.1.05-.1.1v7.28c0 .05.04.1.1.1h.48c.05 0 .1-.05.1-.1v-7.28c0-.05-.05-.1-.1-.1h-.48zm1.18-.32c-.05 0-.1.04-.1.1v7.92c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1v-7.92c0-.06-.04-.1-.1-.1h-.47zm1.18-.08c-.06 0-.1.05-.1.1v8.08c0 .06.04.1.1.1h.47c.06 0 .1-.04.1-.1v-8.08c0-.05-.04-.1-.1-.1h-.47zm1.17-.23c-.05 0-.1.05-.1.1v8.39c0 .05.05.1.1.1h.48c.05 0 .1-.05.1-.1v-8.39c0-.05-.05-.1-.1-.1h-.48zm1.18-.46c-.05 0-.1.05-.1.1v8.93c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1V9.92c0-.05-.04-.1-.1-.1h-.47zm1.18-.54c-.05 0-.1.04-.1.1v9.55c0 .05.05.1.1.1h.47c.06 0 .1-.05.1-.1V9.38c0-.06-.04-.1-.1-.1h-.47zm1.17-.24c-.05 0-.1.05-.1.1v9.87c0 .06.05.1.1.1h.48c.05 0 .1-.04.1-.1V9.14c0-.05-.05-.1-.1-.1h-.48zm1.53-.45c.16-.62.47-1.18.91-1.63.76-.78 1.8-1.24 2.92-1.24.45 0 .88.08 1.28.23.47.18.89.46 1.23.82.26.27.47.58.62.92.51-.31 1.1-.48 1.73-.48 1.78 0 3.23 1.45 3.23 3.23 0 .12-.01.24-.03.35.98.53 1.64 1.56 1.64 2.75 0 1.74-1.41 3.15-3.15 3.15H11.8c-.06 0-.1-.04-.1-.1V8.79c0-.05-.04-.1-.1-.1h-.63z"/>
            </svg>
            <span>SOUNDCLOUD</span>
            <span class="source-tab-wip-tag" aria-hidden="true">WIP</span>
          </button>
        </div>
      </div>

      <div class="onboarding-header">
        <h1 class="onboarding-title">
          {selectedMode === 'soundcloud' ? 'SOUNDCLOUD CRATE' : (selectedMode === 'spotify' ? 'SPOTIFY CRATE' : 'LAST.FM CRATE')}
        </h1>
        <p class="onboarding-desc">
          {selectedMode === 'soundcloud'
            ? 'Scan liked songs from your SoundCloud profile.'
            : (selectedMode === 'spotify'
              ? 'Scan public playlists from your Spotify profile.'
              : 'Scan top tracks from your Last.fm listening history.')}
        </p>
      </div>

      <form class="onboarding-form" id="formFetchProfile" on:submit={handleSubmit}>
        {#if selectedMode === 'lastfm'}
          <label for="inputLastfmUser" class="input-label">LAST.FM USERNAME</label>
          <div class="input-group">
            <input
              type="text"
              id="inputLastfmUser"
              class="input-profile input-profile-lastfm"
              placeholder="e.g. rj"
              autocomplete="off"
              spellcheck="false"
              bind:this={inputEl}
              bind:value={lastfmUsername}
              required
            />
            <button type="submit" class="btn-build-crate btn-build-lastfm" id="btnBuildCrate" disabled={$isBuildingCrate}>
              <span id="btnBuildText">{$isBuildingCrate ? 'Building Crate...' : 'Build Crate'}</span>
              <div class="btn-spinner {$isBuildingCrate ? '' : 'hidden'}" id="btnSpinner"></div>
            </button>
          </div>
        {:else if selectedMode === 'soundcloud'}
          <label for="inputSoundcloudProfile" class="input-label">SOUNDCLOUD USERNAME OR PROFILE URL</label>
          <div class="input-group">
            <input
              type="text"
              id="inputSoundcloudProfile"
              class="input-profile input-profile-soundcloud"
              placeholder="e.g. irfanjmdn or soundcloud.com/irfanjmdn"
              autocomplete="off"
              spellcheck="false"
              bind:this={inputEl}
              bind:value={soundcloudInput}
              required
            />
            <button type="submit" class="btn-build-crate btn-build-soundcloud" id="btnBuildCrate" disabled={$isBuildingCrate}>
              <span id="btnBuildText">{$isBuildingCrate ? 'Building Crate...' : 'Build Crate'}</span>
              <div class="btn-spinner {$isBuildingCrate ? '' : 'hidden'}" id="btnSpinner"></div>
            </button>
          </div>
        {:else}
          <label for="inputSpotifyProfile" class="input-label">SPOTIFY PROFILE OR USERNAME</label>
          <div class="input-group">
            <input
              type="text"
              id="inputSpotifyProfile"
              class="input-profile input-profile-spotify"
              placeholder="Username or open.spotify.com/user/..."
              autocomplete="off"
              spellcheck="false"
              bind:this={inputEl}
              bind:value={spotifyInput}
              required
            />
            <button type="submit" class="btn-build-crate btn-build-spotify" id="btnBuildCrate" disabled={$isBuildingCrate}>
              <span id="btnBuildText">{$isBuildingCrate ? 'Building Crate...' : 'Build Crate'}</span>
              <div class="btn-spinner {$isBuildingCrate ? '' : 'hidden'}" id="btnSpinner"></div>
            </button>
          </div>
        {/if}
      </form>

      <!-- Collapsible Live Progress & Console Dropdown -->
      <details class="debug-dropdown" id="debugDropdown" bind:open={isConsoleOpen}>
        <summary class="debug-summary">
          <div class="debug-summary-left">
            <span class="debug-status-dot {$debugStatus}" id="debugStatusDot"></span>
            <span class="debug-summary-title">Console</span>
          </div>
          <span class="debug-badge" id="debugBadge">{$debugLogs.length} events</span>
        </summary>
        <div
          class="debug-terminal"
          id="debugTerminal"
          bind:this={terminalEl}
          on:scroll={handleTerminalScroll}
        >
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
