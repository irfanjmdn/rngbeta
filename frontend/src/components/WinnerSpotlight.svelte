<script>
  import {
    activeWinnerCard,
    starredTrackIds,
    toggleStar,
    gameInventory,
    isArenaPlaying,
    arenaAudioTime,
  } from '../lib/store.js';
  import { isPlaceholderCover, fetchAlbumArt } from '../lib/artCache.js';

  export let onToggleAudio = () => {};
  export let onSeekAudio = (ratio) => {};

  let scrubTrackEl;
  let isDragging = false;
  let albumCoverLoaded = '';

  $: isStarred = $activeWinnerCard ? $starredTrackIds.has($activeWinnerCard.id) : false;
  $: ownedCount = $activeWinnerCard ? $gameInventory[$activeWinnerCard.id] || 1 : 0;
  $: isNewUnlock = ownedCount === 1;

  $: if ($activeWinnerCard) {
    albumCoverLoaded =
      $activeWinnerCard.album_cover_url ||
      $activeWinnerCard.cover_url ||
      $activeWinnerCard.playlist_cover_url ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%231e293b'/%3E%3C/svg%3E";

    if ($activeWinnerCard.spotify_id && isPlaceholderCover($activeWinnerCard)) {
      fetchAlbumArt($activeWinnerCard.spotify_id).then((url) => {
        if (url) {
          albumCoverLoaded = url;
          if ($activeWinnerCard) $activeWinnerCard.album_cover_url = url;
        }
      });
    }
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  $: scrubPercent =
    $arenaAudioTime.duration > 0
      ? `${Math.max(0, Math.min(100, ($arenaAudioTime.current / $arenaAudioTime.duration) * 100)).toFixed(1)}%`
      : '0%';

  $: timeLabelText = `${formatTime($arenaAudioTime.current)} / ${formatTime($arenaAudioTime.duration || 30)}`;

  function handleStarClick() {
    if ($activeWinnerCard) {
      toggleStar($activeWinnerCard.id);
    }
  }

  function handleScrubSeek(e) {
    if (!scrubTrackEl) return;
    const rect = scrubTrackEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeekAudio(ratio);
  }

  function handlePointerDown(e) {
    e.preventDefault();
    isDragging = true;
    try {
      scrubTrackEl.setPointerCapture(e.pointerId);
    } catch (_) {}
    handleScrubSeek(e);
  }

  function handlePointerMove(e) {
    if (!isDragging) return;
    handleScrubSeek(e);
  }

  function handlePointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    try {
      scrubTrackEl.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }

  function handleKeydown(e) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onToggleAudio();
    }
  }

  function handleSpotifyClick(e) {
    const uri = $activeWinnerCard?.uri || $activeWinnerCard?.spotify_url;
    if (uri) {
      e.preventDefault();
      window.location.href = uri;
    }
  }
</script>

<section
  class="winner-spotlight-box tier-{$activeWinnerCard?.rarityTier || 'common'} {$activeWinnerCard ? 'pop' : ''}"
  id="winnerSpotlight"
>
  <div class="winner-art-column" id="winnerArtColumn">
    <div
      class="winner-art-wrap"
      id="winnerArtWrap"
      role="button"
      tabindex="0"
      aria-label="Play or pause audio preview"
      title="Click to play or pause audio preview"
      on:click={onToggleAudio}
      on:keydown={handleKeydown}
    >
      <img
        class="winner-art-img {$activeWinnerCard && isPlaceholderCover($activeWinnerCard) ? 'is-placeholder-art' : ''}"
        id="winnerArtImg"
        src={$activeWinnerCard ? albumCoverLoaded : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%231e293b'/%3E%3C/svg%3E"}
        alt="Album Cover"
      />
      <div class="winner-art-hover-overlay" id="winnerArtHoverOverlay" aria-hidden="true">
        <svg
          class="winner-art-hover-icon {$isArenaPlaying ? 'hidden' : ''}"
          id="winnerArtHoverPlay"
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="currentColor"
          style={$isArenaPlaying ? 'display:none;' : 'display:block;'}
        >
          <path d="M8 5v14l11-7z" />
        </svg>
        <svg
          class="winner-art-hover-icon {!$isArenaPlaying ? 'hidden' : ''}"
          id="winnerArtHoverPause"
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="currentColor"
          style={!$isArenaPlaying ? 'display:none;' : 'display:block;'}
        >
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
      </div>
    </div>
    <div
      class="winner-rarity-banner"
      id="winnerTierPill"
      style={$activeWinnerCard
        ? `background-color: ${$activeWinnerCard.rarityColor}; color: ${['legendary', 'uncommon', 'common'].includes($activeWinnerCard.rarityTier) ? '#080B11' : '#FFFFFF'}; border: none;`
        : ''}
    >
      {$activeWinnerCard ? $activeWinnerCard.rarityName.toUpperCase() : 'READY TO ROLL'}
    </div>
  </div>

  <div class="winner-info">
    <div class="winner-header-row">
      {#if $activeWinnerCard}
        <div class="winner-header-badges">
          <span
            id="winnerCountBadge"
            class="winner-foil-stamp {isNewUnlock ? 'is-first-seen' : 'is-duplicate'}"
            style="--tier-color: {$activeWinnerCard.rarityColor};"
          >
            <span class="stamp-icon">{isNewUnlock ? '✦' : '◈'}</span>
            <span class="stamp-text">{isNewUnlock ? 'FIRST SEEN' : 'DUPLICATE'}</span>
          </span>
          {#if $activeWinnerCard.dropChance}
            <span
              class="winner-odds-pill"
              id="winnerOddsStamp"
              style="--tier-color: {$activeWinnerCard.rarityColor};"
            >
              <span class="odds-label">ODDS</span>
              <span class="odds-val">{$activeWinnerCard.dropChance.toUpperCase()}</span>
            </span>
          {/if}
        </div>
      {:else}
        <span id="winnerCountBadge" class="winner-count-highlight" style="display: none;"></span>
      {/if}
      {#if $activeWinnerCard}
        <button
          class="btn-star-track {isStarred ? 'is-starred' : ''}"
          id="btnWinnerStar"
          type="button"
          aria-label="Star track"
          title="Star this track"
          on:click={handleStarClick}
        >
          <svg
            class="star-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polygon
              points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
            />
          </svg>
          <span class="star-label">{isStarred ? 'Starred' : 'Star'}</span>
        </button>
      {/if}
    </div>

    <div class="winner-title" id="winnerTitle">
      {$activeWinnerCard ? $activeWinnerCard.title : 'Press ROLL to Spin Albums'}
    </div>
    <div class="winner-artist" id="winnerArtist">
      {$activeWinnerCard ? $activeWinnerCard.artist : 'Watch multiple album covers spin past in real-time'}
    </div>

    {#if $activeWinnerCard && $activeWinnerCard.preview_url}
      <div class="winner-audio-seeker" id="winnerAudioSeeker" style="display:flex;">
        <button
          class="btn-mini-play"
          id="btnWinnerMiniPlay"
          type="button"
          aria-label="Play or pause audio"
          on:click={onToggleAudio}
        >
          <svg
            id="winnerMiniPlayIcon"
            class={$isArenaPlaying ? 'hidden' : ''}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={$isArenaPlaying ? 'display:none;' : 'display:block;'}
          >
            <path d="M8 5v14l11-7z" />
          </svg>
          <svg
            id="winnerMiniPauseIcon"
            class={!$isArenaPlaying ? 'hidden' : ''}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={!$isArenaPlaying ? 'display:none;' : 'display:block;'}
          >
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        </button>
        <div
          class="audio-scrub-track {isDragging ? 'is-dragging' : ''}"
          id="winnerScrubTrack"
          role="slider"
          aria-label="Track audio progress scrubber"
          tabindex="0"
          aria-valuemin="0"
          aria-valuemax="30"
          aria-valuenow={Math.round($arenaAudioTime.current)}
          bind:this={scrubTrackEl}
          on:pointerdown={handlePointerDown}
          on:pointermove={handlePointerMove}
          on:pointerup={handlePointerUp}
          on:pointercancel={handlePointerUp}
        >
          <div class="audio-scrub-fill" id="winnerScrubFill" style="width: {scrubPercent};"></div>
          <div class="audio-scrub-thumb" id="winnerScrubThumb" style="left: {scrubPercent};"></div>
        </div>
        <span class="audio-time-label" id="winnerTimeLabel">{timeLabelText}</span>
      </div>
    {/if}

    <div class="winner-footer-row">
      <div class="winner-meta-tags">
        <a
          class="meta-tag source-tag"
          id="winnerSourceLink"
          href={$activeWinnerCard ? $activeWinnerCard.playlist_uri || $activeWinnerCard.playlist_url || '#' : '#'}
          title="Open playlist in Spotify app"
          style={$activeWinnerCard ? 'pointer-events: auto;' : 'pointer-events: none;'}
        >
          {#if $activeWinnerCard && $activeWinnerCard.playlist_cover_url}
            <img
              class="winner-playlist-badge"
              id="winnerPlaylistBadge"
              src={$activeWinnerCard.playlist_cover_url}
              alt="Playlist Cover"
              title="From playlist"
              style="display: inline-block;"
            />
          {/if}
          <strong class="winner-source" id="winnerSource">
            {$activeWinnerCard ? $activeWinnerCard.playlist_name : '-'}
          </strong>
        </a>
        <span class="meta-tag odds-tag">
          Odds: <strong class="winner-odds" id="winnerOdds">{$activeWinnerCard ? $activeWinnerCard.dropChance : '-'}</strong>
        </span>
      </div>

      {#if $activeWinnerCard && ($activeWinnerCard.uri || $activeWinnerCard.spotify_url)}
        <a
          class="btn-winner-spotify"
          id="winnerSpotifyBtn"
          href={$activeWinnerCard.uri || $activeWinnerCard.spotify_url}
          title="Play track in Spotify app"
          on:click={handleSpotifyClick}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"
            />
          </svg>
          <span>Listen on Spotify</span>
        </a>
      {/if}
    </div>
  </div>
</section>
