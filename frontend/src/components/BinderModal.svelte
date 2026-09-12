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

  function handleOpenExternalTrack(e, track) {
    e.preventDefault();
    if (!track) return;
    if (track.source === 'spotify') {
      const targetUri = track.uri || track.spotify_url;
      if (targetUri) {
        window.open(targetUri, '_blank', 'noopener,noreferrer');
      }
    } else {
      const targetUrl = track.source_url || track.spotify_url || track.uri;
      if (targetUrl) {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    }
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
        <h2 class="binder-title">TRACK CATALOGUE</h2>
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
      <button class="binder-close" id="btnCloseBinderModal" type="button" on:click={closeModal} aria-label="Close catalogue">
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
        All Tracks <span class="cat-chip-count">({tierCounts.all})</span>
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
      <div class="binder-content-wrap" id="binderGridFull">
        {#if displayedCards.length === 0}
          <div class="binder-empty-card">
          <div class="binder-empty-icon" aria-hidden="true">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="var(--brand-green)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </div>
          <div class="binder-empty-title">
            {currentFilter === 'starred'
              ? 'No starred tracks yet'
              : (searchQuery ? 'No matching tracks found' : 'No tracks unlocked yet')}
          </div>
          <div class="binder-empty-text">
            {currentFilter === 'starred'
              ? 'Click the star on any track row to save your favorites here.'
              : (searchQuery
                ? `No unlocked tracks match "${searchQuery}". Try another search.`
                : 'Spin crates in the Arena to discover and unlock tracks for your catalogue!')}
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
        <div class="binder-track-table" role="table" aria-label="Unlocked Tracklist">
          <div class="binder-table-head" role="row">
            <div class="col-num" role="columnheader">#</div>
            <div class="col-title" role="columnheader">Title</div>
            <div class="col-origin" role="columnheader">Playlist / Origin</div>
            <div class="col-tier" role="columnheader">Rarity</div>
            <div class="col-count" role="columnheader">Owned</div>
            <div class="col-actions" role="columnheader"></div>
          </div>

          <div class="binder-table-body" role="rowgroup">
            {#each displayedCards as card, index (card.id)}
              {@const isCardPlaying = $activeBinderTrack?.id === card.id && $isBinderPlaying}
              {@const isCardSelected = $activeBinderTrack?.id === card.id}
              {@const isStarred = $starredTrackIds.has(card.id)}
              {@const appUri = card.uri || card.spotify_url}

              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <div
                class="binder-track-row tier-{card.rarityTier} {isCardPlaying ? 'is-playing-row' : ''} {isCardSelected ? 'is-selected-row' : ''}"
                role="row"
                tabindex="0"
                on:click={() => {
                  if ($activeBinderTrack?.id === card.id && card.preview_url) {
                    onToggleBinderPlay();
                  } else {
                    onPlayBinderTrack(card);
                  }
                }}
              >
                <!-- # Index Number / Play Button Indicator -->
                <div class="col-num" role="cell">
                  {#if isCardPlaying}
                    <div class="table-equalizer-bars" aria-label="Playing">
                      <span class="eq-bar eq-1"></span>
                      <span class="eq-bar eq-2"></span>
                      <span class="eq-bar eq-3"></span>
                    </div>
                  {:else}
                    <span class="row-index-num">{index + 1}</span>
                    {#if card.preview_url}
                      <button
                        class="row-play-btn"
                        type="button"
                        aria-label="Play {card.title}"
                        on:click|stopPropagation={() => onPlayBinderTrack(card)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                    {/if}
                  {/if}
                </div>

                <!-- Title & Artist Cluster with Album Cover Thumbnail -->
                <div class="col-title" role="cell">
                  <img
                    class="row-album-art {isPlaceholderCover(card) ? 'is-placeholder-art' : ''}"
                    src={card.album_cover_url || card.cover_url || card.playlist_cover_url || ''}
                    alt={card.title}
                    loading="lazy"
                  />
                  <div class="row-title-block">
                    <span class="row-track-title">{card.title}</span>
                    <span class="row-track-artist">{card.artist}</span>
                  </div>
                </div>

                <!-- Origin / Playlist -->
                <div class="col-origin" role="cell">
                  <span class="row-playlist-tag" title={card.playlist_name || '-'}>
                    {card.playlist_name || '-'}
                  </span>
                </div>

                <!-- Rarity Tier Pill -->
                <div class="col-tier" role="cell">
                  <span
                    class="row-tier-badge"
                    style="color: {card.rarityColor || 'var(--text-muted)'}; border-color: {card.rarityColor ? `color-mix(in srgb, ${card.rarityColor} 40%, rgba(255, 255, 255, 0.1))` : 'rgba(255, 255, 255, 0.1)'};"
                  >
                    {card.rarityName || card.rarityTier}
                  </span>
                </div>

                <!-- Count Badge -->
                <div class="col-count" role="cell">
                  {#if ($gameInventory[card.id] || 1) > 1}
                    <span class="row-owned-badge">x{$gameInventory[card.id]}</span>
                  {:else}
                    <span class="row-owned-single">1</span>
                  {/if}
                </div>

                <!-- Action Buttons: Star & External Spotify Link -->
                <div class="col-actions" role="cell">
                  <button
                    class="row-star-btn {isStarred ? 'is-starred' : ''}"
                    type="button"
                    aria-label="Star track"
                    on:click|stopPropagation={() => toggleStar(card.id)}
                  >
                    ★
                  </button>

                  {#if appUri}
                    <a
                      class="row-spotify-link"
                      href={appUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={card.source === 'spotify' ? 'Open in Spotify' : (card.source === 'soundcloud' ? 'Open in SoundCloud' : 'Open in Last.fm')}
                      on:click|stopPropagation={(e) => handleOpenExternalTrack(e, card)}
                    >
                      {#if card.source === 'spotify'}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path
                            d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"
                          />
                        </svg>
                      {:else if card.source === 'soundcloud'}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path
                            d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z"
                          />
                        </svg>
                      {:else}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path
                            d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.8 12.5c-.8.8-1.8 1.2-3 1.2-1.3 0-2.4-.4-3.2-1.2-.8-.8-1.2-1.9-1.2-3.3 0-1.4.4-2.5 1.2-3.3.8-.8 1.9-1.2 3.2-1.2 1.2 0 2.2.4 3 1.2.7.8 1.1 1.8 1.2 3.1H13.1c-.1-.7-.3-1.2-.7-1.6-.4-.4-.9-.6-1.5-.6-.7 0-1.2.2-1.6.7-.4.5-.6 1.1-.6 2 0 .8.2 1.5.6 2 .4.5 1 .7 1.6.7.6 0 1.1-.2 1.5-.6.4-.4.6-1 .7-1.6h1.9c-.1 1.2-.5 2.2-1.2 2.9zm3.5-3.6h1.5v1.4h-1.5v3.1c0 .5.1.8.3.9.2.1.4.2.7.2.3 0 .5-.1.7-.2l.3 1.3c-.4.2-.8.3-1.3.3-.6 0-1.1-.2-1.4-.5-.3-.3-.4-.8-.4-1.4v-3.7H16v-1.4h1.3V8.8h1.4v2.1h.6z"
                          />
                        </svg>
                      {/if}
                    </a>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
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

        {#if $activeBinderTrack.uri || $activeBinderTrack.spotify_url || $activeBinderTrack.source_url}
          <div class="binder-dock-actions">
            <a
              class="btn-binder-dock-spotify"
              id="binderDockSpotifyBtn"
              href={$activeBinderTrack.source === 'spotify'
                ? ($activeBinderTrack.uri || $activeBinderTrack.spotify_url)
                : ($activeBinderTrack.source_url || $activeBinderTrack.spotify_url || '#')}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={$activeBinderTrack.source === 'spotify' ? 'Play in Spotify app' : ($activeBinderTrack.source === 'soundcloud' ? 'Open track on SoundCloud' : 'Open track on Last.fm')}
              on:click={(e) => handleOpenExternalTrack(e, $activeBinderTrack)}
            >
              {#if $activeBinderTrack.source === 'spotify'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"
                  />
                </svg>
                <span>Play on Spotify</span>
              {:else if $activeBinderTrack.source === 'soundcloud'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z"
                  />
                </svg>
                <span>Listen on SoundCloud</span>
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1.8 12.5c-.8.8-1.8 1.2-3 1.2-1.3 0-2.4-.4-3.2-1.2-.8-.8-1.2-1.9-1.2-3.3 0-1.4.4-2.5 1.2-3.3.8-.8 1.9-1.2 3.2-1.2 1.2 0 2.2.4 3 1.2.7.8 1.1 1.8 1.2 3.1H13.1c-.1-.7-.3-1.2-.7-1.6-.4-.4-.9-.6-1.5-.6-.7 0-1.2.2-1.6.7-.4.5-.6 1.1-.6 2 0 .8.2 1.5.6 2 .4.5 1 .7 1.6.7.6 0 1.1-.2 1.5-.6.4-.4.6-1 .7-1.6h1.9c-.1 1.2-.5 2.2-1.2 2.9zm3.5-3.6h1.5v1.4h-1.5v3.1c0 .5.1.8.3.9.2.1.4.2.7.2.3 0 .5-.1.7-.2l.3 1.3c-.4.2-.8.3-1.3.3-.6 0-1.1-.2-1.4-.5-.3-.3-.4-.8-.4-1.4v-3.7H16v-1.4h1.3V8.8h1.4v2.1h.6z"
                  />
                </svg>
                <span>Listen on Last.fm</span>
              {/if}
            </a>
          </div>
        {/if}
      </footer>
    {/if}
  </div>
</dialog>
