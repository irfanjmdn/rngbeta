<script>
  import { activeModal, rngTracks, activeUserId } from '../lib/store.js';

  function closeModal() {
    activeModal.set(null);
  }

  function handleBackdropClick(e) {
    if (e.target.id === 'gameRatesModal') {
      closeModal();
    }
  }

  const tierOrder = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
  const tierMeta = {
    mythic: { name: 'Mythic', color: '#F43F5E', bg: 'rgba(244, 63, 94, 0.15)', desc: 'Exclusive' },
    legendary: { name: 'Legendary', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)', desc: 'Curated' },
    epic: { name: 'Epic', color: '#A855F7', bg: 'rgba(168, 85, 247, 0.15)', desc: 'Mid-size' },
    rare: { name: 'Rare', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)', desc: 'Rotation' },
    uncommon: { name: 'Uncommon', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)', desc: 'Popular' },
    common: { name: 'Common', color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.15)', desc: 'Frequent' },
  };

  $: ratesData = (() => {
    const totalTracks = $rngTracks.length;
    const totalWeight = $rngTracks.reduce((sum, t) => sum + (t.weight || 0), 0);

    const counts = {};
    const weights = {};
    tierOrder.forEach((t) => {
      counts[t] = 0;
      weights[t] = 0;
    });

    $rngTracks.forEach((t) => {
      const tier = t.rarityTier;
      if (counts[tier] !== undefined) {
        counts[tier]++;
        weights[tier] += t.weight || 0;
      }
    });

    return tierOrder.map((tier) => {
      const meta = tierMeta[tier];
      const count = counts[tier] || 0;
      const weight = weights[tier] || 0;
      const rollProb = totalWeight > 0 ? weight / totalWeight : 0;
      const rollPct = (rollProb * 100).toFixed(1);
      const oddsNum = rollProb > 0 ? Math.round(1 / rollProb) : 0;
      const oddsText = oddsNum > 0 ? `1 in ${oddsNum.toLocaleString()} (${rollPct}%)` : '-';

      return {
        tier,
        ...meta,
        count,
        oddsText,
      };
    });
  })();
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
  class="game-rates-modal {$activeModal === 'rates' ? 'open' : ''}"
  id="gameRatesModal"
  open={$activeModal === 'rates'}
  on:click={handleBackdropClick}
>
  <div class="rates-dialog-content">
    <div class="modal-header">
      <div class="modal-title">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          style="vertical-align: -3px; margin-right: 8px; color: var(--brand-green);"
        >
          <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
          <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
          <path d="M7 21h10" />
          <path d="M12 3v18" />
          <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
        </svg>
        DYNAMIC ODDS &amp; RATES
      </div>
      <button class="modal-close-btn" id="btnCloseRatesModal" type="button" aria-label="Close" on:click={closeModal}>
        &times;
      </button>
    </div>

    <div class="rates-list" id="ratesList">
      {#each ratesData as row}
        <div class="rates-row" style="border-left: 3px solid {row.color};">
          <span
            class="tier-label-badge"
            style="background: {row.bg}; color: {row.color}; border: 1px solid {row.color};"
          >
            {row.name}
          </span>
          <span class="rates-desc">
            {row.desc} &bull; <strong style="color: var(--text-main);">{row.count} tracks</strong>
          </span>
          <strong class="rates-odds" style="color: {row.color};">{row.oddsText}</strong>
        </div>
      {/each}
    </div>

    <div class="rates-note" id="ratesNote">
      Rates calibrated dynamically from {$activeUserId ? $activeUserId : 'user'}'s crate ({$rngTracks.length} tracks across all playlists).
    </div>
  </div>
</dialog>
