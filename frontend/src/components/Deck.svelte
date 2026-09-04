<script>
  import {
    isSpinning,
    isAutoRolling,
    isAutoSkip,
  } from '../lib/store.js';

  export let onRoll = () => {};

  function handleRollClick() {
    if (!$isSpinning) {
      onRoll();
    }
  }

  function handleAutoRollToggle() {
    isAutoRolling.update((val) => {
      const next = !val;
      if (next && !$isSpinning) {
        onRoll();
      }
      return next;
    });
  }

  function handleAutoSkipToggle() {
    isAutoSkip.update((val) => !val);
  }
</script>

<footer class="game-controls-deck">
  <div class="deck-col-left">
    <button
      class="btn-auto-roll-lock {$isAutoRolling ? 'active' : ''}"
      id="btnAutoRoll"
      type="button"
      aria-label="Auto-Roll continuous spinning"
      aria-pressed={$isAutoRolling ? 'true' : 'false'}
      title={$isAutoRolling ? 'Auto-Roll: ON (Click to stop)' : 'Auto-Roll (Lock continuous spinning)'}
      on:click={handleAutoRollToggle}
    >
      <svg
        class="auto-roll-lock-icon"
        width="20"
        height="20"
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
        <rect x="9" y="10" width="6" height="5" rx="1" fill="currentColor" />
        <path d="M10 10V8.5a2 2 0 0 1 4 0V10" />
      </svg>
      <span class="auto-roll-status-dot"></span>
      <span id="lblAutoRoll" style="display:none;">
        {$isAutoRolling ? 'Auto-Roll: ON' : 'Auto-Roll: OFF'}
      </span>
    </button>
  </div>

  <div class="deck-col-center">
    <button
      class="btn-big-roll {$isSpinning ? 'is-spinning' : ''} {$isAutoRolling ? 'is-auto-rolling' : ''}"
      id="btnBigRoll"
      type="button"
      on:click={handleRollClick}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
      <span id="lblRollBtn">ROLL (R)</span>
    </button>
  </div>

  <div class="deck-col-right">
    <button
      class="btn-auto-skip-lock {$isAutoSkip ? 'active' : ''}"
      id="btnAutoSkip"
      type="button"
      aria-label="Auto Skip roll animation"
      aria-pressed={$isAutoSkip ? 'true' : 'false'}
      title={$isAutoSkip ? 'Auto Skip: ON (Click to disable)' : 'Auto Skip (Snap immediately at 0.75s)'}
      on:click={handleAutoSkipToggle}
    >
      <svg
        class="auto-skip-icon"
        width="20"
        height="20"
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
      <span class="auto-skip-status-dot"></span>
      <span id="lblAutoSkip" style="display:none;">
        {$isAutoSkip ? 'Auto Skip: ON' : 'Auto Skip: OFF'}
      </span>
    </button>
  </div>
</footer>
