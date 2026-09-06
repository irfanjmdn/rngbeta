<script>
  import {
    activeModal,
    rngTracks,
    gameInventory,
    gameInventoryTimestamps,
    starredTrackIds,
    toggleStar,
    activeBinderTrack,
    isBinderPlaying,
    binderAudioTime,
    unlockedCount,
  } from '../lib/store.js';
  import { isPlaceholderCover, fetchAlbumArt } from '../lib/artCache.js';

  export let onPlayBinderTrack = (card) => {};
  export let onToggleBinderPlay = () => {};
  export let onSeekBinderAudio = (ratio) => {};

  let currentFilter = 'all';
  let searchQuery = '';
  let sortMode = 'recent-desc';
  let scrubTrackEl;
  let isDraggingScrub = false;

  function closeModal() {
    activeModal.set(null);
  }

  function handleBackdropClick(e) {
    if (e.target.id === 'gameBinderModal') {
      closeModal();
    }
  }

  $: unlockedList = $rngTracks.filter((t) => Boolean($gameInventory[t.id]));

  $: starredCount = unlockedList.filter((t) => $starredTrackIds.has(t.id)).length;

  $: tierCounts = {
    all: unlockedList.length,
    starred: starredCount,
    mythic: unlockedList.filter((t) => t.rarityTier === 'mythic').length,
    legendary: unlockedList.filter((t) => t.rarityTier === 'legendary').length,
    epic: unlockedList.filter((t) => t.rarityTier === 'epic').length,
    rare: unlockedList.filter((t) => t.rarityTier === 'rare').length,
    uncommon: unlockedList.filter((t) => t.rarityTier === 'uncommon').length,
    common: unlockedList.filter((t) => t.rarityTier === 'common').length,
  };

  $: displayedCards = (() => {
    let list = [...unlockedList];

    if (currentFilter === 'starred') {
      list = list.filter((t) => $starredTrackIds.has(t.id));
    } else if (currentFilter !== 'all') {
      list = list.filter((t) => t.rarityTier === currentFilter);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(q) ||
          (t.artist || '').toLowerCase().includes(q) ||
          (t.playlist_name || '').toLowerCase().includes(q)
      );
    }

    const tierOrder = { mythic: 6, legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
    list.sort((a, b) => {
      if (sortMode === 'recent-desc') {
        const timeA = $gameInventoryTimestamps[a.id] || 0;
        const timeB = $gameInventoryTimestamps[b.id] || 0;
        if (timeB !== timeA) return timeB - timeA;
        return (tierOrder[b.rarityTier] || 0) - (tierOrder[a.rarityTier] || 0);
      } else if (sortMode === 'rarity-desc') {
        const diff = (tierOrder[b.rarityTier] || 0) - (tierOrder[a.rarityTier] || 0);
        if (diff !== 0) return diff;
        return (a.title || '').localeCompare(b.title || '');
      } else if (sortMode === 'rarity-asc') {
        const diff = (tierOrder[a.rarityTier] || 0) - (tierOrder[b.rarityTier] || 0);
        if (diff !== 0) return diff;
        return (a.title || '').localeCompare(b.title || '');
      } else if (sortMode === 'artist-asc') {
        const diff = (a.artist || '').localeCompare(b.artist || '');
        if (diff !== 0) return diff;
        return (a.title || '').localeCompare(b.title || '');
      } else if (sortMode === 'title-asc') {
        return (a.title || '').localeCompare(b.title || '');
      } else if (sortMode === 'count-desc') {
        const diff = ($gameInventory[b.id] || 0) - ($gameInventory[a.id] || 0);
        if (diff !== 0) return diff;
        return (tierOrder[b.rarityTier] || 0) - (tierOrder[a.rarityTier] || 0);
      }
      return 0;
    });

    return list;
  })();

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  $: dockScrubPercent =
    $binderAudioTime.duration > 0
      ? `${Math.max(0, Math.min(100, ($binderAudioTime.current / $binderAudioTime.duration) * 100)).toFixed(1)}%`
      : '0%';

  function handleScrubSeek(e) {
    if (!scrubTrackEl) return;
    const rect = scrubTrackEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeekBinderAudio(ratio);
  }

  function handlePointerDown(e) {
    e.preventDefault();
    isDraggingScrub = true;
    try {
      scrubTrackEl.setPointerCapture(e.pointerId);
    } catch (_) {}
    handleScrubSeek(e);
  }

  function handlePointerMove(e) {
    if (!isDraggingScrub) return;
    handleScrubSeek(e);
  }

  function handlePointerUp(e) {
    if (!isDraggingScrub) return;
    isDraggingScrub = false;
    try {
      scrubTrackEl.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
  class="game-binder-modal {$activeModal === 'binder' ? 'open' : ''}"
  id="gameBinderModal"
  open={$activeModal === 'binder'}
  on:click={handleBackdropClick}
>
  <div class="binder-dialog-content">
    <div class="binder-modal-header">
      <div class="binder-title-wrap">
        <h2 class="binder-title">ALBUM CARD BINDER</h2>
        <div class="binder-progress-block" id="binderProgressText">
          <div class="binder-progress-stats">
            <span class="binder-progress-count">{$unlockedCount}</span>
            <span class="binder-progress-sep">/</span>
            <span class="binder-progress-total">{$rngTracks.length}</span>
            <span class="binder-progress-label">UNLOCKED</span>
            <span class="binder-progress-pct">{Math.round(($unlockedCount / ($rngTracks.length || 1)) * 100)}%</span>
          </div>
          <div class="binder-progress-bar" aria-hidden="true">
            <div
              class="binder-progress-bar-fill"
              style="transform: scaleX({Math.min(1, ($unlockedCount / ($rngTracks.length || 1)))}); width: 100%; transform-origin: left center;"
            ></div>
          </div>
        </div>
      </div>
      <button class="binder-close" id="btnCloseBinderModal" type="button" on:click={closeModal} aria-label="Close binder">
        <span class="binder-close-glyph" aria-hidden="true">×</span>
      </button>
    </div>

    <nav class="binder-filters-bar" id="binderFilterBar" aria-label="Rarity Filter">
      <button
        class="cat-chip {currentFilter === 'all' ? 'active' : ''}"
        data-filter="all"
        type="button"
        on:click={() => (currentFilter = 'all')}
      >
        All Cards <span class="cat-chip-count">({tierCounts.all})</span>
      </button>
      <button
        class="cat-chip {currentFilter === 'starred' ? 'active' : ''} {tierCounts.starred === 0 ? 'empty-tier' : ''}"
        data-filter="starred"
        type="button"
        on:click={() => (currentFilter = 'starred')}
      >
        ★ Starred <span class="cat-chip-count" id="binderCatStarredCount">({tierCounts.starred})</span>
      </button>
      <button
        class="cat-chip {currentFilter === 'mythic' ? 'active' : ''} {tierCounts.mythic === 0 ? 'empty-tier' : ''}"
        data-filter="mythic"
        type="button"
        on:click={() => (currentFilter = 'mythic')}
      >
        Mythic <span class="cat-chip-count">({tierCounts.mythic})</span>
      </button>
      <button
        class="cat-chip {currentFilter === 'legendary' ? 'active' : ''} {tierCounts.legendary === 0 ? 'empty-tier' : ''}"
        data-filter="legendary"
        type="button"
        on:click={() => (currentFilter = 'legendary')}
      >
        Legendary <span class="cat-chip-count">({tierCounts.legendary})</span>
      </button>
      <button
        class="cat-chip {currentFilter === 'epic' ? 'active' : ''} {tierCounts.epic === 0 ? 'empty-tier' : ''}"
        data-filter="epic"
        type="button"
        on:click={() => (currentFilter = 'epic')}
      >
        Epic <span class="cat-chip-count">({tierCounts.epic})</span>
      </button>
      <button
        class="cat-chip {currentFilter === 'rare' ? 'active' : ''} {tierCounts.rare === 0 ? 'empty-tier' : ''}"
        data-filter="rare"
        type="button"
        on:click={() => (currentFilter = 'rare')}
      >
        Rare <span class="cat-chip-count">({tierCounts.rare})</span>
      </button>
      <button
        class="cat-chip {currentFilter === 'uncommon' ? 'active' : ''} {tierCounts.uncommon === 0 ? 'empty-tier' : ''}"
        data-filter="uncommon"
        type="button"
        on:click={() => (currentFilter = 'uncommon')}
      >
        Uncommon <span class="cat-chip-count">({tierCounts.uncommon})</span>
      </button>
      <button
        class="cat-chip {currentFilter === 'common' ? 'active' : ''} {tierCounts.common === 0 ? 'empty-tier' : ''}"
        data-filter="common"
        type="button"
        on:click={() => (currentFilter = 'common')}
      >
        Common <span class="cat-chip-count">({tierCounts.common})</span>
      </button>
    </nav>

    <div class="binder-toolbar" id="binderToolbar">
      <div class="binder-search-wrap">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="search"
          class="binder-search-input"
          id="binderSearchInput"
          placeholder="Search unlocked tracks or artists..."
          autocomplete="off"
          spellcheck="false"
          aria-label="Search unlocked tracks or artists"
          bind:value={searchQuery}
        />
        <button
          class="btn-clear-search {!searchQuery ? 'hidden' : ''}"
          id="btnClearBinderSearch"
          type="button"
          aria-label="Clear search"
          on:click={() => (searchQuery = '')}
        >
          &times;
        </button>
      </div>

      <div class="binder-sort-wrap">
        <label for="binderSortSelect" class="binder-sort-label">Sort by</label>
        <select
          class="binder-sort-select"
          id="binderSortSelect"
          aria-label="Sort tracks by"
          bind:value={sortMode}
        >
          <option value="recent-desc">Recently Owned</option>
          <option value="rarity-desc">Rarest First</option>
          <option value="rarity-asc">Common First</option>
          <option value="artist-asc">Artist (A-Z)</option>
          <option value="title-asc">Title (A-Z)</option>
          <option value="count-desc">Most Owned</option>
        </select>
      </div>
    </div>

    <div class="binder-scroll-area">
      <div class="binder-grid-full" id="binderGridFull">
        {#if displayedCards.length === 0}
          <div class="binder-empty-card">
            <div class="binder-empty-icon">&#128451;</div>
            <div class="binder-empty-title">
              {currentFilter === 'starred'
                ? 'No starred tracks yet'
                : (searchQuery ? 'No matching tracks found' : 'No cards unlocked yet')}
            </div>
            <div class="binder-empty-text">
              {currentFilter === 'starred'
                ? 'Click the star on any card or winner reveal to save your favorites here.'
                : (searchQuery
                  ? `No unlocked tracks match "${searchQuery}". Try another search.`
                  : 'Spin crates in the Arena to discover and unlock tracks for your binder!')}
            </div>
            {#if searchQuery}
              <button
                class="btn-empty-reset"
                id="btnEmptyClearSearch"
                type="button"
                on:click={() => (searchQuery = '')}
              >
                Clear Search
              </button>
            {:else}
              <button class="btn-empty-reset" id="btnEmptyGoArena" type="button" on:click={closeModal}>
                Spin in Arena
              </button>
            {/if}
          </div>
        {:else}
          {#each displayedCards as card (card.id)}
            {@const isCardPlaying = $activeBinderTrack?.id === card.id && $isBinderPlaying}
            {@const isCardSelected = $activeBinderTrack?.id === card.id}
            {@const isStarred = $starredTrackIds.has(card.id)}
            {@const appUri = card.uri || card.spotify_url}

            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
              class="binder-tile tier-{card.rarityTier} {isCardPlaying ? 'is-playing-card' : ''} {isCardSelected ? 'is-selected-card' : ''}"
              data-card-id={card.id}
              role="button"
              tabindex="0"
              on:click={() => {
                if ($activeBinderTrack?.id === card.id && card.preview_url) {
                  onToggleBinderPlay();
                } else {
                  onPlayBinderTrack(card);
                }
              }}
            >
              <div class="binder-tile-art-wrap">
                <img
                  class="binder-tile-art {isPlaceholderCover(card) ? 'is-placeholder-art' : ''}"
                  src={card.album_cover_url || card.cover_url || card.playlist_cover_url || ''}
                  alt={card.title}
                  loading="lazy"
                />
                <button
                  class="binder-card-star-btn {isStarred ? 'is-starred' : ''}"
                  data-star-id={card.id}
                  type="button"
                  aria-label="Star track"
                  title={isStarred ? 'Starred track' : 'Star this track'}
                  on:click|stopPropagation={() => toggleStar(card.id)}
                >
                  ★
                </button>
                <span class="binder-tile-count">x{$gameInventory[card.id] || 1}</span>
                {#if card.playlist_cover_url}
                  <img
                    class="binder-tile-playlist-badge"
                    src={card.playlist_cover_url}
                    alt="Playlist"
                    title="From playlist: {card.playlist_name}"
                    loading="lazy"
                  />
                {/if}
                {#if card.preview_url}
                  <div
                    class="binder-tile-play-hint"
                    title={isCardPlaying ? 'Pause preview' : 'Play preview in Binder'}
                  >
                    {#if isCardPlaying}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={card.rarityColor || 'white'}>
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    {:else}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    {/if}
                  </div>
                {/if}
              </div>

              <div class="binder-tile-title" title={card.title}>{card.title}</div>
              <div class="binder-tile-artist" title={card.artist}>{card.artist}</div>

              {#if appUri}
                <a
                  class="btn-binder-spotify"
                  href={appUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open track on Last.fm"
                  on:click|stopPropagation={(e) => {
                    e.preventDefault();
                    window.open(appUri, '_blank', 'noopener,noreferrer');
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path
                      d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.8 12.5c-.8.8-1.8 1.2-3 1.2-1.3 0-2.4-.4-3.2-1.2-.8-.8-1.2-1.9-1.2-3.3 0-1.4.4-2.5 1.2-3.3.8-.8 1.9-1.2 3.2-1.2 1.2 0 2.2.4 3 1.2.7.8 1.1 1.8 1.2 3.1H13.1c-.1-.7-.3-1.2-.7-1.6-.4-.4-.9-.6-1.5-.6-.7 0-1.2.2-1.6.7-.4.5-.6 1.1-.6 2 0 .8.2 1.5.6 2 .4.5 1 .7 1.6.7.6 0 1.1-.2 1.5-.6.4-.4.6-1 .7-1.6h1.9c-.1 1.2-.5 2.2-1.2 2.9zm3.5-3.6h1.5v1.4h-1.5v3.1c0 .5.1.8.3.9.2.1.4.2.7.2.3 0 .5-.1.7-.2l.3 1.3c-.4.2-.8.3-1.3.3-.6 0-1.1-.2-1.4-.5-.3-.3-.4-.8-.4-1.4v-3.7H16v-1.4h1.3V8.8h1.4v2.1h.6z"
                    />
                  </svg>
                  <span>Listen on Last.fm</span>
                </a>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Docked Minimal Binder Audio Player -->
    {#if $activeBinderTrack}
      <footer class="binder-audio-dock" id="binderAudioDock" style="display:flex;">
        <div class="binder-dock-track-info">
          <img
            class="binder-dock-art {isPlaceholderCover($activeBinderTrack) ? 'is-placeholder-art' : ''}"
            id="binderDockArt"
            src={$activeBinderTrack.album_cover_url || $activeBinderTrack.cover_url || $activeBinderTrack.playlist_cover_url || ''}
            alt="Album Cover"
            style="border-color: {$activeBinderTrack.rarityColor || ''}; outline: {$activeBinderTrack.rarityColor ? `2px solid ${$activeBinderTrack.rarityColor}` : ''};"
          />
          <div class="binder-dock-text">
            <div class="binder-dock-title" id="binderDockTitle">{$activeBinderTrack.title}</div>
            <div class="binder-dock-artist" id="binderDockArtist">{$activeBinderTrack.artist}</div>
          </div>
          <span
            class="binder-dock-tier-pill"
            id="binderDockTier"
            style="color: {$activeBinderTrack.rarityColor}; border-color: {$activeBinderTrack.rarityColor};"
          >
            {$activeBinderTrack.rarityName}
          </span>
        </div>

        <div class="binder-dock-scrub-group">
          <button
            class="btn-dock-play"
            id="btnBinderDockPlay"
            type="button"
            aria-label="Play or pause binder audio"
            disabled={!$activeBinderTrack.preview_url}
            style="background: {$activeBinderTrack.rarityColor || '#1DB954'}; color: #FFFFFF; opacity: {$activeBinderTrack.preview_url ? '1' : '0.4'};"
            on:click={onToggleBinderPlay}
          >
            <svg
              id="binderDockPlayIcon"
              class={$isBinderPlaying ? 'hidden' : ''}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={$isBinderPlaying ? 'display:none;' : 'display:block;'}
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg
              id="binderDockPauseIcon"
              class={!$isBinderPlaying ? 'hidden' : ''}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              style={!$isBinderPlaying ? 'display:none;' : 'display:block;'}
            >
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </button>
          <div
            class="audio-scrub-track {isDraggingScrub ? 'is-dragging' : ''}"
            id="binderScrubTrack"
            role="slider"
            aria-label="Binder audio timeline scrubber"
            tabindex="0"
            aria-valuemin="0"
            aria-valuemax="30"
            aria-valuenow={Math.round($binderAudioTime.current)}
            bind:this={scrubTrackEl}
            on:pointerdown={handlePointerDown}
            on:pointermove={handlePointerMove}
            on:pointerup={handlePointerUp}
            on:pointercancel={handlePointerUp}
          >
            <div
              class="audio-scrub-fill"
              id="binderScrubFill"
              style="width: {dockScrubPercent}; background: {$activeBinderTrack.rarityColor || 'var(--brand-green)'};"
            ></div>
            <div class="audio-scrub-thumb" id="binderScrubThumb" style="left: {dockScrubPercent};"></div>
          </div>
          <span class="audio-time-label" id="binderTimeLabel">
            {$activeBinderTrack.preview_url
              ? `${formatTime($binderAudioTime.current)} / ${formatTime($binderAudioTime.duration || 30)}`
              : 'No preview'}
          </span>
        </div>

        {#if $activeBinderTrack.uri || $activeBinderTrack.spotify_url}
          <div class="binder-dock-actions">
            <a
              class="btn-binder-dock-spotify"
              id="binderDockSpotifyBtn"
              href={$activeBinderTrack.uri || $activeBinderTrack.spotify_url}
              title="Play in Spotify app"
              on:click={(e) => {
                e.preventDefault();
                window.location.href = $activeBinderTrack.uri || $activeBinderTrack.spotify_url;
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"
                />
              </svg>
              <span>Play on Spotify</span>
            </a>
          </div>
        {/if}
      </footer>
    {/if}
  </div>
</dialog>
