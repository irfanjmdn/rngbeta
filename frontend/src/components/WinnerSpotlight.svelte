<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    activeWinnerCard,
    starredTrackIds,
    toggleStar,
    gameInventory,
    isArenaPlaying,
    arenaAudioTime,
    rngTracks,
    isSpinning,
  } from '../lib/store.js';
  import { isPlaceholderCover, fetchTrackDetails } from '../lib/artCache.js';
  import { getSubBassEnergy, getTargetBassPeakMetrics } from '../lib/audio.js';

  export let onToggleAudio = () => {};
  export let onSeekAudio = (ratio) => {};
  export let onWinnerArtLoaded = (url) => {};

  let scrubTrackEl;
  let isDragging = false;
  let albumCoverLoaded = '';
  let releaseDateLoaded = '';
  let shimmerActive = false;
  let lastShimmeredCardId = null;
  let shimmerTimeout = null;
  let spotlightEl = null;
  let auroraWrapEl = null;
  let bassRafId = null;
  let smoothedBassEnergy = 0;

  let tiltRafId = null;
  let targetTiltX = 0;
  let targetTiltY = 0;
  let currentTiltX = 0;
  let currentTiltY = 0;
  let targetScale = 1;
  let currentScale = 1;
  let rumbleX = 0;
  let rumbleY = 0;
  let impactSpike = 0;
  let targetGlareOpacity = 0;
  let currentGlareOpacity = 0;
  let targetOuterX = 50;
  let targetOuterY = 50;
  let currentOuterX = 50;
  let currentOuterY = 50;
  let targetInnerX = 50;
  let targetInnerY = 50;
  let currentInnerX = 50;
  let currentInnerY = 50;
  let isHoveringCard = false;


  function formatReleaseDate(raw) {
    if (!raw) return '-';
    const clean = raw.split('T')[0];
    const parts = clean.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIndex = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (monthIndex >= 0 && monthIndex < 12 && !isNaN(day)) {
        return `${months[monthIndex]} ${day}, ${year}`;
      }
      return clean;
    }
    if (parts.length === 1 && parts[0].length === 4) {
      return parts[0];
    }
    return clean;
  }

  $: formattedReleaseDate = formatReleaseDate(releaseDateLoaded || $activeWinnerCard?.release_date);
  $: isStarred = $activeWinnerCard ? $starredTrackIds.has($activeWinnerCard.id) : false;
  $: ownedCount = $activeWinnerCard ? $gameInventory[$activeWinnerCard.id] || 1 : 0;
  $: isNewUnlock = ownedCount === 1;

  let wasSpinning = false;
  let impactBoost = 0;

  $: if ($isSpinning && !wasSpinning) {
    wasSpinning = true;
    impactBoost = 0;
  } else if (!$isSpinning && wasSpinning) {
    wasSpinning = false;
    // Roll finished: punchy impact pop (boost up, then lerp down)
    impactBoost = 0.055;
  }

  $: if ($activeWinnerCard) {
    // Single-fire shimmer on entire container for brand-new legendary or mythic cards
    const tier = $activeWinnerCard.rarityTier;
    const isRareTier = tier === 'legendary' || tier === 'mythic';
    if (isNewUnlock && isRareTier && lastShimmeredCardId !== $activeWinnerCard.id) {
      lastShimmeredCardId = $activeWinnerCard.id;
      shimmerActive = true;
      if (shimmerTimeout) clearTimeout(shimmerTimeout);
      shimmerTimeout = setTimeout(() => {
        shimmerActive = false;
        shimmerTimeout = null;
      }, 1300);
    } else if (lastShimmeredCardId !== $activeWinnerCard.id) {
      shimmerActive = false;
    }

    albumCoverLoaded =
      $activeWinnerCard.album_cover_url ||
      $activeWinnerCard.cover_url ||
      $activeWinnerCard.playlist_cover_url ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%231e293b'/%3E%3C/svg%3E";
    releaseDateLoaded = $activeWinnerCard.release_date || '';

    if ($activeWinnerCard.spotify_id && (!releaseDateLoaded || isPlaceholderCover($activeWinnerCard))) {
      fetchTrackDetails(
        $activeWinnerCard.spotify_id,
        $activeWinnerCard.title,
        $activeWinnerCard.artist
      ).then((details) => {
        if (details) {
          if (details.album_cover_url) {
            albumCoverLoaded = details.album_cover_url;
            if ($activeWinnerCard) $activeWinnerCard.album_cover_url = details.album_cover_url;
            onWinnerArtLoaded(details.album_cover_url);
          }
          if (details.release_date) {
            releaseDateLoaded = details.release_date;
            if ($activeWinnerCard) $activeWinnerCard.release_date = details.release_date;
          }
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

  function tickSubBass() {
    if ($isArenaPlaying) {
      const metrics = getTargetBassPeakMetrics(20, 150);
      const rawEnergy = metrics.energy;

      // Snappy attack and smooth release for punchy tactile breathing swell
      if (rawEnergy > smoothedBassEnergy) {
        smoothedBassEnergy += (rawEnergy - smoothedBassEnergy) * 0.48;
      } else {
        smoothedBassEnergy += (rawEnergy - smoothedBassEnergy) * 0.09;
      }

      // Transient impact spike driven by beat detection
      if (metrics.peak > impactSpike) {
        impactSpike = metrics.peak;
      } else {
        impactSpike *= 0.86;
      }
    } else {
      smoothedBassEnergy *= 0.85;
      impactSpike *= 0.85;
    }

    if (smoothedBassEnergy < 0.001) smoothedBassEnergy = 0;
    if (impactSpike < 0.001) impactSpike = 0;

    if (auroraWrapEl) {
      const surgeEnergy = Math.max(smoothedBassEnergy, impactSpike * 0.85);
      const flowX = surgeEnergy * 42;
      auroraWrapEl.style.setProperty('--aurora-flow-x', `${flowX.toFixed(1)}px`);
    }

    bassRafId = requestAnimationFrame(tickSubBass);
  }

  function handleGlobalPointerMove(e) {
    if (!spotlightEl) return;
    const rect = spotlightEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Calculate center coordinates of winner card
    const cardCenterX = rect.left + rect.width / 2;
    const cardCenterY = rect.top + rect.height / 2;

    // Distance normalized across viewport width/height
    const viewW = window.innerWidth || document.documentElement.clientWidth || 1920;
    const viewH = window.innerHeight || document.documentElement.clientHeight || 1080;

    const deltaX = (e.clientX - cardCenterX) / (viewW * 0.5);
    const deltaY = (e.clientY - cardCenterY) / (viewH * 0.5);

    // Smooth tilt angles clamped to -9deg to +9deg
    targetTiltX = Math.max(-9, Math.min(9, -deltaY * 9));
    targetTiltY = Math.max(-9, Math.min(9, deltaX * 9));

    // Inverted & reversed lighting reflection:
    // Physical specular reflection moves opposite to surface normal deviation relative to overhead light
    targetOuterX = 50 - (targetTiltY * 4.2);
    targetOuterY = 40 + (targetTiltX * 4.2);

    // Inner substrate glass reflection: reverse offset for depth parallax
    targetInnerX = targetOuterX - (targetTiltY * 2.2);
    targetInnerY = targetOuterY + (targetTiltX * 2.2);

    // Subtle specular glare intensity based on card tilt angle towards the light source
    const tiltMagnitude = Math.hypot(targetTiltX, targetTiltY);
    targetGlareOpacity = 0.22 + Math.min(0.28, (tiltMagnitude / 12.0) * 0.28);
  }

  function tickTilt() {
    // High-fidelity spring/lerp damping (alpha = 0.10)
    const factor = 0.10;
    currentTiltX += (targetTiltX - currentTiltX) * factor;
    currentTiltY += (targetTiltY - currentTiltY) * factor;
    currentGlareOpacity += (targetGlareOpacity - currentGlareOpacity) * factor;
    currentOuterX += (targetOuterX - currentOuterX) * factor;
    currentOuterY += (targetOuterY - currentOuterY) * factor;
    currentInnerX += (targetInnerX - currentInnerX) * factor;
    currentInnerY += (targetInnerY - currentInnerY) * factor;

    // Scale calculation:
    // When rolling ($isSpinning), shrink smoothly to 0.92 while keeping 3D tilt.
    // When roll lands, impactBoost kicks up by +0.055 and decays smoothly back to 0.
    const baseTargetScale = $isSpinning ? 0.92 : 1.0;
    impactBoost += (0 - impactBoost) * 0.12;
    // Audio reactivity: punchy tactile scale kick from peak impact + responsive rhythmic swell from sub-bass
    const audioPunch = (smoothedBassEnergy * 0.052) + (impactSpike * 0.040);
    const audioReactiveCardScale = (baseTargetScale + impactBoost) + audioPunch;
    currentScale += (audioReactiveCardScale - currentScale) * 0.35;

    // Tactile rumble kick on energetic sub-bass impacts
    if ($isArenaPlaying && impactSpike > 0.30) {
      const rumbleAmp = impactSpike * 0.95;
      const angle = Math.random() * Math.PI * 2;
      const targetRumbleX = Math.cos(angle) * rumbleAmp;
      const targetRumbleY = Math.sin(angle) * rumbleAmp;
      rumbleX += (targetRumbleX - rumbleX) * 0.65;
      rumbleY += (targetRumbleY - rumbleY) * 0.65;
    } else {
      rumbleX += (0 - rumbleX) * 0.35;
      rumbleY += (0 - rumbleY) * 0.35;
    }

    if (spotlightEl) {
      spotlightEl.style.setProperty('--rumble-x', `${rumbleX.toFixed(2)}px`);
      spotlightEl.style.setProperty('--rumble-y', `${rumbleY.toFixed(2)}px`);
      spotlightEl.style.setProperty('--tilt-rx', `${currentTiltX.toFixed(2)}deg`);
      spotlightEl.style.setProperty('--tilt-ry', `${currentTiltY.toFixed(2)}deg`);
      spotlightEl.style.setProperty('--tilt-scale', currentScale.toFixed(4));
      spotlightEl.style.setProperty('--glare-opacity', currentGlareOpacity.toFixed(3));
      spotlightEl.style.setProperty('--glare-outer-x', `${currentOuterX.toFixed(1)}%`);
      spotlightEl.style.setProperty('--glare-outer-y', `${currentOuterY.toFixed(1)}%`);
      spotlightEl.style.setProperty('--glare-inner-x', `${currentInnerX.toFixed(1)}%`);
      spotlightEl.style.setProperty('--glare-inner-y', `${currentInnerY.toFixed(1)}%`);
      spotlightEl.style.setProperty('--bass-energy', Math.max(smoothedBassEnergy, impactSpike * 0.85).toFixed(3));
    }

    tiltRafId = requestAnimationFrame(tickTilt);
  }

  onMount(() => {
    bassRafId = requestAnimationFrame(tickSubBass);
    tiltRafId = requestAnimationFrame(tickTilt);
    window.addEventListener('pointermove', handleGlobalPointerMove, { passive: true });
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', handleGlobalPointerMove);
    }
    if (bassRafId) {
      cancelAnimationFrame(bassRafId);
      bassRafId = null;
    }
    if (tiltRafId) {
      cancelAnimationFrame(tiltRafId);
      tiltRafId = null;
    }
  });
</script>

<div class="winner-spotlight-wrapper">
  <section
    class="winner-spotlight-box tier-{$activeWinnerCard?.rarityTier || 'common'} {$activeWinnerCard ? 'pop' : ''} {$activeWinnerCard && isNewUnlock ? 'is-holographic-new' : ''} {$isSpinning ? 'is-rolling' : ''}"
    id="winnerSpotlight"
    aria-label="Winner track spotlight"
    style="--tier-color: {$activeWinnerCard?.rarityColor || '#10B981'};"
    bind:this={spotlightEl}
  >
  {#if shimmerActive}
    <div class="winner-shimmer-sweep" aria-hidden="true"></div>
  {/if}
  <div class="winner-tilt-glare" aria-hidden="true">
    <div class="winner-tilt-glare-outer"></div>
    <div class="winner-tilt-glare-inner"></div>
    <div class="winner-tilt-glare-grain"></div>
  </div>

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

  <div class="winner-info {$activeWinnerCard && isNewUnlock ? 'is-new-unlock' : ''}">
    {#if $activeWinnerCard && isNewUnlock}
      <div class="ps5-mesh-aurora-wrap" bind:this={auroraWrapEl} aria-hidden="true">
        <div class="mesh-blobs-layer">
          <div class="mesh-blob mesh-blob-1" style="--tier-color: {$activeWinnerCard.rarityColor};"></div>
          <div class="mesh-blob mesh-blob-2" style="--tier-color: {$activeWinnerCard.rarityColor};"></div>
          <div class="mesh-blob mesh-blob-3" style="--tier-color: {$activeWinnerCard.rarityColor};"></div>
          <div class="mesh-blob mesh-blob-4" style="--tier-color: {$activeWinnerCard.rarityColor};"></div>
        </div>
        <div class="mesh-gradient-blur-stack">
          <div class="blur-slice blur-slice-1"></div>
          <div class="blur-slice blur-slice-2"></div>
          <div class="blur-slice blur-slice-3"></div>
          <div class="blur-slice blur-slice-4"></div>
        </div>
        <div class="mesh-backdrop-diffuse"></div>
        <div class="mesh-glass-specular"></div>
      </div>
    {/if}

    <div class="winner-title-row">
      <div class="winner-title-group">
        <div class="winner-title" id="winnerTitle">
          {$activeWinnerCard ? $activeWinnerCard.title : 'Press ROLL to Spin Albums'}
        </div>
        {#if $activeWinnerCard && !isNewUnlock}
          <span
            id="winnerCountBadge"
            class="winner-foil-stamp is-duplicate"
            style="--tier-color: {$activeWinnerCard.rarityColor};"
          >
            <span class="stamp-text">DUPLICATE</span>
          </span>
        {:else}
          <span id="winnerCountBadge" class="winner-count-highlight" style="display: none;"></span>
        {/if}
      </div>
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
            width="14"
            height="14"
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
    <div class="winner-artist" id="winnerArtist" style={!$activeWinnerCard ? 'display: none;' : ''}>
      <span class="artist-name">{$activeWinnerCard ? $activeWinnerCard.artist : ''}</span>
      {#if $activeWinnerCard && formattedReleaseDate && formattedReleaseDate !== '-'}
        <span class="winner-artist-separator" aria-hidden="true">•</span>
        <span class="winner-release-date-wrap">
          <span class="release-prefix">Released</span>
          <span class="winner-release-date" id="winnerReleaseDate">{formattedReleaseDate}</span>
        </span>
      {/if}
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
        {#if $activeWinnerCard}
          <span class="source-in-prefix">in</span>
        {/if}
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
</div>
