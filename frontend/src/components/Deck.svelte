<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    isSpinning,
    isAutoRolling,
    isAutoSkip,
    isRollNudgeActive,
    autoRollMode,
    arenaAudioTime,
  } from '../lib/store.js';

  export let onRoll = () => {};

  let isLaunching = false;
  let launchTimer = null;
  let wasSpinning = false;

  let isPostRollNudge = false;
  let postRollNudgeTimer = null;

  // Beam display calculation:
  // - In 'on_track_end' mode, only show circling beam in the final 4 seconds before next auto-roll
  // - In 'immediate' mode, show circling beam when auto-rolling and not spinning
  // - Otherwise show circling beam during post-roll idle nudge
  $: isTrackEndingSoon = $arenaAudioTime?.duration > 0 &&
    ($arenaAudioTime.duration - $arenaAudioTime.current) <= 4.0;

  $: showCirclingBeam = !$isSpinning && (
    ($isAutoRolling && ($autoRollMode === 'immediate' || isTrackEndingSoon)) ||
    isPostRollNudge
  );

  let isMenuOpen = false;
  let menuWrapEl;

  function setAutoRollMode(mode) {
    autoRollMode.set(mode);
    try {
      localStorage.setItem('crate_autoroll_mode', mode);
    } catch (e) {}
    isMenuOpen = false;
  }

  function toggleMenu(e) {
    e.stopPropagation();
    isMenuOpen = !isMenuOpen;
  }

  function handleDocumentClick(e) {
    if (isMenuOpen && menuWrapEl && !menuWrapEl.contains(e.target)) {
      isMenuOpen = false;
    }
  }

  function handleKeydown(e) {
    if (isMenuOpen && e.key === 'Escape') {
      isMenuOpen = false;
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('click', handleDocumentClick);
    window.addEventListener('keydown', handleKeydown);
  }

  function clearPostRollNudge() {
    isPostRollNudge = false;
    if (postRollNudgeTimer) {
      clearTimeout(postRollNudgeTimer);
      postRollNudgeTimer = null;
    }
  }

  function handleRollClick() {
    clearPostRollNudge();
    if (!$isSpinning) {
      isLaunching = true;
      if (launchTimer) clearTimeout(launchTimer);
      launchTimer = setTimeout(() => {
        isLaunching = false;
      }, 280);
      onRoll();
    }
  }

  function handleAutoRollToggle() {
    isAutoRolling.update((val) => {
      const next = !val;
      if (next && !$isSpinning) {
        clearPostRollNudge();
        isLaunching = true;
        if (launchTimer) clearTimeout(launchTimer);
        launchTimer = setTimeout(() => {
          isLaunching = false;
        }, 280);
        onRoll();
      }
      return next;
    });
  }

  function handleAutoSkipToggle() {
    isAutoSkip.update((val) => !val);
  }

  // Detect when spinning completes:
  // 1. Arm post-roll nudge timer after roll completion
  // 2. Clear circling beam when a roll starts ($isSpinning turns true)
  $: {
    if (wasSpinning && !$isSpinning) {
      clearPostRollNudge();
      if (!$isAutoRolling) {
        postRollNudgeTimer = setTimeout(() => {
          if (!$isSpinning && !$isAutoRolling) {
            isPostRollNudge = true;
          }
        }, 4000);
      }
    }

    if ($isSpinning) {
      clearPostRollNudge();
    }
    wasSpinning = $isSpinning;
  }

  onMount(() => {
    postRollNudgeTimer = setTimeout(() => {
      if (!$isSpinning && !$isAutoRolling) {
        isPostRollNudge = true;
      }
    }, 4000);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('click', handleDocumentClick);
      window.removeEventListener('keydown', handleKeydown);
    }
    if (launchTimer) clearTimeout(launchTimer);
    if (postRollNudgeTimer) clearTimeout(postRollNudgeTimer);
  });
</script>

<footer class="game-controls-deck">
  <div class="deck-col-left">
    <div class="deck-auto-roll-group" bind:this={menuWrapEl}>
      <button
        class="btn-deck-action btn-auto-roll-lock {$isAutoRolling ? 'active' : ''}"
        id="btnAutoRoll"
        type="button"
        aria-label="Auto-Roll continuous spinning"
        aria-pressed={$isAutoRolling ? 'true' : 'false'}
        title={$isAutoRolling ? 'Auto-Roll: ON (Click to stop)' : 'Auto-Roll (Lock continuous spinning)'}
        on:click={handleAutoRollToggle}
      >
        <svg
          class="auto-roll-lock-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M17 2l4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="M7 22l-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
        <span class="deck-btn-label">
          {$autoRollMode === 'on_track_end' ? 'Auto-roll (Track)' : 'Auto-roll'}
        </span>
        <span class="auto-roll-status-dot"></span>
        <span id="lblAutoRoll" style="display:none;">
          {$isAutoRolling ? 'Auto-Roll: ON' : 'Auto-Roll: OFF'}
        </span>
      </button>

      <button
        class="btn-deck-action btn-auto-roll-chevron {$isAutoRolling ? 'active' : ''}"
        id="btnAutoRollChevron"
        type="button"
        aria-label="Select auto-roll mode"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        title="Auto-roll mode options"
        on:click={toggleMenu}
      >
        <svg
          class="auto-roll-chevron-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {#if isMenuOpen}
        <div class="auto-roll-flyout-menu" role="menu" aria-label="Auto-roll mode">
          <div class="flyout-menu-header">Auto-Roll Mode</div>
          <button
            type="button"
            role="menuitem"
            class="flyout-menu-item {$autoRollMode === 'immediate' ? 'selected' : ''}"
            on:click={() => setAutoRollMode('immediate')}
          >
            <div class="flyout-item-text">
              <span class="flyout-item-title">Immediate</span>
              <span class="flyout-item-desc">Rolls as soon as spin ends</span>
            </div>
            {#if $autoRollMode === 'immediate'}
              <svg class="flyout-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            {/if}
          </button>
          <button
            type="button"
            role="menuitem"
            class="flyout-menu-item {$autoRollMode === 'on_track_end' ? 'selected' : ''}"
            on:click={() => setAutoRollMode('on_track_end')}
          >
            <div class="flyout-item-text">
              <span class="flyout-item-title">On Track End</span>
              <span class="flyout-item-desc">Plays 30s preview, rolls on end</span>
            </div>
            {#if $autoRollMode === 'on_track_end'}
              <svg class="flyout-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="deck-col-center">
    <div class="roll-btn-halo-wrap {showCirclingBeam ? 'has-circling-beam' : ''}">
      {#if showCirclingBeam}
        <svg class="roll-btn-svg-beam" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="beamGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#34D399" stop-opacity="0" />
              <stop offset="60%" stop-color="#10B981" stop-opacity="0.8" />
              <stop offset="100%" stop-color="#FFFFFF" stop-opacity="1" />
            </linearGradient>
          </defs>
          <!-- Track base outline -->
          <rect class="beam-track" x="0.5" y="0.5" width="99" height="99" rx="4.8" ry="21.7" />
          <!-- Animated traveling beam head -->
          <rect class="beam-head" x="0.5" y="0.5" width="99" height="99" rx="4.8" ry="21.7" pathLength="100" />
        </svg>
      {/if}
      <button
        class="btn-big-roll {$isSpinning ? 'is-spinning' : ''} {$isAutoRolling ? 'is-auto-rolling' : ''} {isLaunching ? 'is-launching' : ''} {$isRollNudgeActive ? 'is-nudged' : ''}"
        id="btnBigRoll"
        type="button"
        on:click={handleRollClick}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span id="lblRollBtn">ROLL (R)</span>
      </button>
    </div>
  </div>

  <div class="deck-col-right">
    <button
      class="btn-deck-action btn-auto-skip-lock {$isAutoSkip ? 'active' : ''}"
      id="btnAutoSkip"
      type="button"
      aria-label="Fast-forward roll animation"
      aria-pressed={$isAutoSkip ? 'true' : 'false'}
      title={$isAutoSkip ? 'Fast-forward: ON (Click to disable)' : 'Fast-forward (Snap immediately at 0.75s)'}
      on:click={handleAutoSkipToggle}
    >
      <svg
        class="auto-skip-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polygon points="13 19 22 12 13 5 13 19" />
        <polygon points="2 19 11 12 2 5 2 19" />
      </svg>
      <span class="deck-btn-label">Fast-forward</span>
      <span class="auto-skip-status-dot"></span>
      <span id="lblAutoSkip" style="display:none;">
        {$isAutoSkip ? 'Auto Skip: ON' : 'Auto Skip: OFF'}
      </span>
    </button>
  </div>
</footer>
