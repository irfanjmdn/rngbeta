<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    activeMode,
    isCrateReady,
    isSpinning,
    isAutoRolling,
    autoRollMode,
    activeWinnerCard,
    activeArenaTrack,
    activeBinderTrack,
    isArenaPlaying,
    isBinderPlaying,
    arenaAudioTime,
    binderAudioTime,
    activeModal,
    rngTracks,
    isLoggingOut,
    isRollNudgeActive,
    isRollShimmerActive,
    markTrackUnplayable,
    unplayableTrackIds,
  } from './lib/store.js';

  import Onboarding from './components/Onboarding.svelte';
  import Hud from './components/Hud.svelte';
  import Reel from './components/Reel.svelte';
  import WinnerSpotlight from './components/WinnerSpotlight.svelte';
  import Deck from './components/Deck.svelte';
  import BinderModal from './components/BinderModal.svelte';
  import RatesModal from './components/RatesModal.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import CyberGrid from './components/CyberGrid.svelte';
  import {
    connectMediaElement,
    setArenaLowpassFilter,
    fadeInMusic,
    getAudioContext,
    playLogoutSquareSound,
    declickAudioSeek,
  } from './lib/audio.js';
  import { fetchTrackPreview } from './lib/artCache.js';

  let windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  let windowHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
  let hasDismissedSmallScreenWarning = false;

  $: isWindowTooSmall = windowWidth > 0 && (windowWidth <= 768 || windowHeight <= 500);

  // Whenever window expands to normal desktop size, reset dismissed flag so it warns again on future shrinkage
  $: if (!isWindowTooSmall) {
    hasDismissedSmallScreenWarning = false;
  }

  $: showScreenWarning = isWindowTooSmall && !hasDismissedSmallScreenWarning;

  let isInitialLoading = true;
  let isHidingSplash = false;

  function handleDismissScreenWarning() {
    playLogoutSquareSound(1);
    hasDismissedSmallScreenWarning = true;
  }

  let reelComponent;
  let arenaAudioEl;
  let arenaAudioElB;
  let activeArenaPlayerId = 'A'; // 'A' | 'B'
  let binderAudioEl;
  let arenaFadeInterval = null;
  let arenaFadeIntervalB = null;
  let binderFadeInterval = null;

  function rampAudioVolume(audioEl, targetVol, durationMs = 350, onDone = null) {
    if (!audioEl) return null;
    const startVol = audioEl.volume;
    if (Math.abs(startVol - targetVol) < 0.01) {
      audioEl.volume = targetVol;
      if (onDone) onDone();
      return null;
    }
    const startTime = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      try {
        audioEl.volume = startVol + (targetVol - startVol) * progress;
      } catch (e) {}
      if (progress >= 1) {
        clearInterval(timer);
        try {
          audioEl.volume = targetVol;
        } catch (e) {}
        if (onDone) onDone();
      }
    }, 20);
    return timer;
  }

  function getActiveArenaEl() {
    return activeArenaPlayerId === 'A' ? arenaAudioEl : arenaAudioElB;
  }

  function getInactiveArenaEl() {
    return activeArenaPlayerId === 'A' ? arenaAudioElB : arenaAudioEl;
  }

  function stopArenaAudio() {
    if (arenaFadeInterval) {
      clearInterval(arenaFadeInterval);
      arenaFadeInterval = null;
    }
    if (arenaFadeIntervalB) {
      clearInterval(arenaFadeIntervalB);
      arenaFadeIntervalB = null;
    }
    isArenaBgLooping = false;
    isTransitioningToLoop = false;
    setArenaLowpassFilter(false);

    [arenaAudioEl, arenaAudioElB].forEach((el) => {
      if (el) {
        try {
          el.pause();
          el.currentTime = 0;
          el.volume = 1;
        } catch (e) {}
      }
    });

    isArenaPlaying.set(false);
    const activeEl = getActiveArenaEl();
    arenaAudioTime.set({ current: 0, duration: activeEl?.duration || 30 });
  }

  function stopBinderAudio() {
    if (binderFadeInterval) {
      clearInterval(binderFadeInterval);
      binderFadeInterval = null;
    }
    if (!binderAudioEl) return;
    try {
      binderAudioEl.pause();
      binderAudioEl.currentTime = 0;
      binderAudioEl.volume = 1;
    } catch (e) {}
    isBinderPlaying.set(false);
    binderAudioTime.set({ current: 0, duration: binderAudioEl.duration || 30 });
  }

  let isArenaBgLooping = false;
  let isTransitioningToLoop = false;

  function playArenaAudio(url, startTime = 0, isLoop = false) {
    stopBinderAudio();
    const activeEl = getActiveArenaEl();
    if (!activeEl || !url) return;

    try {
      isArenaBgLooping = isLoop;
      isTransitioningToLoop = false;
      // Filter: 100Hz highpass + 500Hz lowpass when looping
      setArenaLowpassFilter(isLoop, 500, 100, 0.2);

      [arenaAudioEl, arenaAudioElB].forEach((el) => {
        if (el) connectMediaElement(el, true);
      });

      const inactiveEl = getInactiveArenaEl();
      if (inactiveEl && !isLoop) {
        try {
          inactiveEl.pause();
          inactiveEl.currentTime = 0;
        } catch (e) {}
      }

      activeEl.pause();
      const targetVol = isLoop ? 0.18 : 1.0;
      activeEl.volume = targetVol;
      if (activeEl.src !== url) {
        activeEl.src = url;
      }
      activeEl.currentTime = startTime;
      activeEl.play().catch(() => {
        isArenaPlaying.set(false);
        const track = $activeArenaTrack || $activeWinnerCard;
        if (track?.id) {
          markTrackUnplayable(track.id);
        }
      });
    } catch (e) {
      isArenaPlaying.set(false);
    }
  }

  // Dual-Player Ping-Pong cross-fade transition
  function triggerPingPongLoopTransition() {
    const curEl = getActiveArenaEl();
    const nextEl = getInactiveArenaEl();
    if (!curEl || !nextEl || !curEl.src) return;

    isTransitioningToLoop = true;
    isArenaBgLooping = true;
    // Engage bandpass filter: 100Hz highpass to 500Hz lowpass
    setArenaLowpassFilter(true, 500, 100, 0.15);

    // Fade out currently ending player over 600ms
    if (arenaFadeInterval) clearInterval(arenaFadeInterval);
    if (arenaFadeIntervalB) clearInterval(arenaFadeIntervalB);

    if (activeArenaPlayerId === 'A') {
      arenaFadeInterval = rampAudioVolume(curEl, 0, 600, () => {
        try {
          curEl.pause();
          curEl.currentTime = 0;
        } catch (e) {}
      });
    } else {
      arenaFadeIntervalB = rampAudioVolume(curEl, 0, 600, () => {
        try {
          curEl.pause();
          curEl.currentTime = 0;
        } catch (e) {}
      });
    }

    // Prepare and start next player from beginning with matching 600ms fade-in to 0.25
    if (nextEl.src !== curEl.src) {
      nextEl.src = curEl.src;
    }
    connectMediaElement(nextEl, true);
    nextEl.currentTime = 0;
    nextEl.volume = 0;
    nextEl.play().then(() => {
      activeArenaPlayerId = activeArenaPlayerId === 'A' ? 'B' : 'A';
      isTransitioningToLoop = false;
      isArenaPlaying.set(true);
      const nextFade = rampAudioVolume(nextEl, 0.18, 600);
      if (activeArenaPlayerId === 'A') {
        arenaFadeInterval = nextFade;
      } else {
        arenaFadeIntervalB = nextFade;
      }
    }).catch(() => {});
  }

  function toggleArenaAudio() {
    let track = $activeArenaTrack || $activeWinnerCard;
    const activeEl = getActiveArenaEl();
    if (!activeEl || !track) return;
    if ($unplayableTrackIds.has(track.id)) return;

    if (!track.preview_url) {
      fetchTrackPreview(track).then((pUrl) => {
        if (pUrl && !$unplayableTrackIds.has(track.id)) {
          track.preview_url = pUrl;
          activeArenaTrack.set(track);
          activeWinnerCard.set(track);
          playArenaAudio(pUrl, 0, false);
        } else if (!pUrl) {
          markTrackUnplayable(track.id);
        }
      });
      return;
    }

    if (activeEl.paused) {
      stopBinderAudio();
      if (!activeEl.src || !activeEl.src.includes(track.preview_url)) {
        playArenaAudio(track.preview_url, 0, false);
      } else {
        isArenaBgLooping = false;
        setArenaLowpassFilter(false);
        activeEl.volume = 1.0;
        activeEl.play().catch(() => isArenaPlaying.set(false));
      }
    } else {
      activeEl.pause();
      isArenaPlaying.set(false);
    }
  }

  function handleArenaAudioError(playerId) {
    const track = $activeArenaTrack || $activeWinnerCard;
    if (track?.id) {
      markTrackUnplayable(track.id);
    }
    isArenaPlaying.set(false);

    // If Auto-Roll is enabled in "on_track_end" mode, advance to next track after a brief 2.5s pause
    if ($isAutoRolling && $autoRollMode === 'on_track_end' && !$isSpinning) {
      setTimeout(() => {
        if ($isAutoRolling && $autoRollMode === 'on_track_end' && !$isSpinning) {
          triggerRoll();
        }
      }, 2500);
    }
  }

  let pendingArenaSeekRatio = null;

  function seekArenaAudio(ratio, isExact = false) {
    const activeEl = getActiveArenaEl();
    if (!activeEl) return;
    const dur = activeEl.duration || 30;
    const target = Math.max(0, Math.min(dur, ratio * dur));
    arenaAudioTime.set({ current: target, duration: dur });
    if (isNaN(dur) || !isFinite(target)) return;

    if (isExact) {
      pendingArenaSeekRatio = null;
      declickAudioSeek(activeEl, target, true);
      return;
    }

    // If browser is actively decoding a prior seek, queue latest ratio to avoid audio stalls
    if (activeEl.seeking) {
      pendingArenaSeekRatio = ratio;
      return;
    }

    declickAudioSeek(activeEl, target, false);
  }

  function handleArenaSeeked(playerId) {
    if (activeArenaPlayerId !== playerId) return;
    if (pendingArenaSeekRatio !== null) {
      const nextRatio = pendingArenaSeekRatio;
      pendingArenaSeekRatio = null;
      seekArenaAudio(nextRatio, false);
    }
  }

  function playBinderTrack(card) {
    stopArenaAudio();
    activeBinderTrack.set(card);
    if (!binderAudioEl || !card) {
      stopBinderAudio();
      return;
    }

    if (!card.preview_url) {
      fetchTrackPreview(card).then((pUrl) => {
        if (pUrl && $activeBinderTrack?.id === card.id) {
          playBinderTrack(card);
        }
      });
      return;
    }

    try {
      connectMediaElement(binderAudioEl);
      binderAudioEl.pause();
      binderAudioEl.volume = 1;
      if (binderAudioEl.src !== card.preview_url) {
        binderAudioEl.src = card.preview_url;
      }
      binderAudioEl.currentTime = 0;
      binderAudioEl.play().catch(() => isBinderPlaying.set(false));
    } catch (e) {
      isBinderPlaying.set(false);
    }
  }

  function toggleBinderAudio() {
    if (!binderAudioEl || !$activeBinderTrack?.preview_url) return;

    if (binderAudioEl.paused) {
      stopArenaAudio();
      if (!binderAudioEl.src || !binderAudioEl.src.includes($activeBinderTrack.preview_url)) {
        playBinderTrack($activeBinderTrack);
      } else {
        binderAudioEl.play().catch(() => isBinderPlaying.set(false));
      }
    } else {
      binderAudioEl.pause();
      isBinderPlaying.set(false);
    }
  }

  function seekBinderAudio(ratio) {
    if (!binderAudioEl) return;
    const dur = binderAudioEl.duration || 30;
    const target = ratio * dur;
    binderAudioTime.set({ current: target, duration: dur });
    if (!isNaN(dur)) {
      binderAudioEl.currentTime = target;
    }
  }

  function triggerRoll() {
    if ($isSpinning || !$isCrateReady) return;
    if (reelComponent) {
      reelComponent.executeSpin();
    }
  }

  const TIER_AURA_COLORS = {
    default: {
      glow: 'rgba(29, 185, 84, 0.16)',
      accent: 'rgba(29, 185, 84, 0.09)',
    },
    common: {
      glow: 'rgba(148, 163, 184, 0.14)',
      accent: 'rgba(100, 116, 139, 0.08)',
    },
    uncommon: {
      glow: 'rgba(16, 185, 129, 0.18)',
      accent: 'rgba(5, 150, 105, 0.10)',
    },
    rare: {
      glow: 'rgba(59, 130, 246, 0.22)',
      accent: 'rgba(37, 99, 235, 0.12)',
    },
    epic: {
      glow: 'rgba(168, 85, 247, 0.24)',
      accent: 'rgba(147, 51, 234, 0.13)',
    },
    legendary: {
      glow: 'rgba(245, 158, 11, 0.26)',
      accent: 'rgba(217, 119, 6, 0.14)',
    },
    mythic: {
      glow: 'rgba(244, 63, 94, 0.28)',
      accent: 'rgba(225, 29, 72, 0.16)',
    },
  };

  $: currentAura = $activeWinnerCard
    ? (TIER_AURA_COLORS[$activeWinnerCard.rarityTier] || TIER_AURA_COLORS.default)
    : TIER_AURA_COLORS.default;

  function handleRollComplete(winner, isNew) {
    activeArenaTrack.set(winner);
    activeWinnerCard.set(winner);

    const isKnownUnplayable = $unplayableTrackIds.has(winner.id);
    const hasPreview = Boolean(winner.preview_url && !isKnownUnplayable);

    if (hasPreview) {
      const activeEl = getActiveArenaEl();
      if (activeEl && !activeEl.paused && activeEl.src && activeEl.src.includes(winner.preview_url)) {
        // Same track is already playing; restore full volume and normal EQ smoothly
        isArenaBgLooping = false;
        setArenaLowpassFilter(false);
        if (arenaFadeInterval) {
          clearInterval(arenaFadeInterval);
          arenaFadeInterval = null;
        }
        if (arenaFadeIntervalB) {
          clearInterval(arenaFadeIntervalB);
          arenaFadeIntervalB = null;
        }
        if (activeArenaPlayerId === 'A') {
          arenaFadeInterval = rampAudioVolume(activeEl, 1.0, 300);
        } else {
          arenaFadeIntervalB = rampAudioVolume(activeEl, 1.0, 300);
        }
      } else {
        // Different audio or not playing: start winner audio cleanly
        playArenaAudio(winner.preview_url, 0, false);
      }
    } else {
      stopArenaAudio();

      if (!isKnownUnplayable && winner.source !== 'soundcloud') {
        fetchTrackPreview(winner).then((pUrl) => {
          if (pUrl && ($activeWinnerCard?.id === winner.id || $activeArenaTrack?.id === winner.id)) {
            winner.preview_url = pUrl;
            activeArenaTrack.set(winner);
            activeWinnerCard.set(winner);
            playArenaAudio(pUrl, 0, false);
          } else if (!pUrl) {
            markTrackUnplayable(winner.id);
          }
        }).catch(() => {
          markTrackUnplayable(winner.id);
        });
      }
    }
  }

  // Reactive audio ducking and lowpass filtering during rolls or modal views
  // Arena audio engages the 500Hz lowpass filter and ducks during spinning
  $: {
    const activeEl = getActiveArenaEl();
    const shouldFilter = $isSpinning || isArenaBgLooping;
    // Faster, snappier lowpass ramp-down on roll launch (40ms vs 200ms)
    const timeConstant = $isSpinning ? 0.04 : 0.15;
    setArenaLowpassFilter(shouldFilter, 500, 100, timeConstant);

    if (activeEl && !activeEl.paused && !isTransitioningToLoop) {
      const shouldDuck = $isSpinning || Boolean($activeModal);
      let targetVol = 1.0;
      if (isArenaBgLooping) {
        targetVol = shouldDuck ? 0.08 : 0.25;
      } else {
        targetVol = shouldDuck ? 0.25 : 1.0;
      }
      if (activeArenaPlayerId === 'A') {
        if (arenaFadeInterval) {
          clearInterval(arenaFadeInterval);
          arenaFadeInterval = null;
        }
        arenaFadeInterval = rampAudioVolume(activeEl, targetVol, 350);
      } else {
        if (arenaFadeIntervalB) {
          clearInterval(arenaFadeIntervalB);
          arenaFadeIntervalB = null;
        }
        arenaFadeIntervalB = rampAudioVolume(activeEl, targetVol, 350);
      }
    }
  }

  // 2. Binder audio ducks when returning to roll arena ($activeModal !== 'binder') OR during spinning
  $: {
    if (binderAudioEl && !binderAudioEl.paused) {
      const shouldDuck = $activeModal !== 'binder' || $isSpinning;
      const targetVol = shouldDuck ? 0.25 : 1.0;
      if (binderFadeInterval) {
        clearInterval(binderFadeInterval);
        binderFadeInterval = null;
      }
      binderFadeInterval = rampAudioVolume(binderAudioEl, targetVol, 350);
    }
  }

  // Stop all playing music when user switches account / logs out
  $: if (!$isCrateReady) {
    stopArenaAudio();
    stopBinderAudio();
  }

  // Restore the music fade gain when a new crate becomes ready.
  // fadeOutMusic at logout leaves the bus at ~-80 dB; fadeInMusic brings it back.
  $: if ($isCrateReady) {
    fadeInMusic(0.15);
    if ($rngTracks && $rngTracks.length > 0) {
      const rareTracks = $rngTracks.filter((t) => t.rarityTier === 'mythic' || t.rarityTier === 'legendary').slice(0, 5);
      rareTracks.forEach((t, idx) => {
        setTimeout(() => {
          if (!t.preview_url) fetchTrackPreview(t);
        }, (idx + 1) * 350);
      });
    }
  }

  // Roll Button Nudge & Shimmer on Lowpass Loop
  let nudgeInitialTimer = null;
  let nudgeIntervalTimer = null;
  let nudgePulseClearTimer = null;
  let shimmerIntervalTimer = null;
  let shimmerPulseClearTimer = null;

  function clearNudgeTimers() {
    if (nudgeInitialTimer) {
      clearTimeout(nudgeInitialTimer);
      nudgeInitialTimer = null;
    }
    if (nudgeIntervalTimer) {
      clearInterval(nudgeIntervalTimer);
      nudgeIntervalTimer = null;
    }
    if (nudgePulseClearTimer) {
      clearTimeout(nudgePulseClearTimer);
      nudgePulseClearTimer = null;
    }
    if (shimmerIntervalTimer) {
      clearInterval(shimmerIntervalTimer);
      shimmerIntervalTimer = null;
    }
    if (shimmerPulseClearTimer) {
      clearTimeout(shimmerPulseClearTimer);
      shimmerPulseClearTimer = null;
    }
    isRollNudgeActive.set(false);
    isRollShimmerActive.set(false);
  }

  function triggerRollNudge() {
    if ($isSpinning || !$isCrateReady || !isArenaBgLooping) return;
    isRollNudgeActive.set(true);
    if (nudgePulseClearTimer) clearTimeout(nudgePulseClearTimer);
    nudgePulseClearTimer = setTimeout(() => {
      isRollNudgeActive.set(false);
      nudgePulseClearTimer = null;
    }, 1100);
  }

  function triggerRollShimmer() {
    if ($isSpinning || !$isCrateReady || !isArenaBgLooping) return;
    isRollShimmerActive.set(true);
    if (shimmerPulseClearTimer) clearTimeout(shimmerPulseClearTimer);
    shimmerPulseClearTimer = setTimeout(() => {
      isRollShimmerActive.set(false);
      shimmerPulseClearTimer = null;
    }, 1400);
  }

  $: if (!isArenaBgLooping || $isSpinning || !$isCrateReady) {
    clearNudgeTimers();
  } else if (isArenaBgLooping && !$isSpinning && $isCrateReady && !nudgeInitialTimer && !nudgeIntervalTimer) {
    // Fire tactile nudge 2s after song repeats / engages lowpass, then every 10s
    nudgeInitialTimer = setTimeout(() => {
      nudgeInitialTimer = null;
      triggerRollNudge();
      nudgeIntervalTimer = setInterval(() => {
        triggerRollNudge();
      }, 10000);
    }, 2000);

    // Fire shimmer hint on roll button every 5s during lowpass
    triggerRollShimmer();
    shimmerIntervalTimer = setInterval(() => {
      triggerRollShimmer();
    }, 5000);
  }

  onDestroy(() => {
    clearNudgeTimers();
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  onMount(() => {
    const splashTimer = setTimeout(async () => {
      try {
        if (typeof document !== 'undefined' && document.fonts) {
          await document.fonts.ready;
        }
      } catch {}
      isHidingSplash = true;
      setTimeout(() => {
        isInitialLoading = false;
      }, 550);
    }, 750);

    const unlockAudio = () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    const handleKeydown = (e) => {
      if (e.key === 'Enter' && showScreenWarning) {
        handleDismissScreenWarning();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        if ($isCrateReady && !showScreenWarning && !$isSpinning && document.activeElement?.tagName !== 'INPUT') {
          triggerRoll();
        }
      }
      if (e.key === 'Escape') {
        activeModal.set(null);
      }
    };
    window.addEventListener('keydown', handleKeydown);

    return () => {
      clearTimeout(splashTimer);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

<div class="app-root">
  <!-- SVG Filter for hand-drawn turbulence/boiling effect -->
  <svg class="splash-filter-svg" width="0" height="0" style="position: absolute; pointer-events: none;">
    <defs>
      <filter id="splash-boil-filter-1">
        <feTurbulence type="fractalNoise" baseFrequency="0.04 0.08" numOctaves="2" result="noise" seed="1" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="splash-boil-filter-2">
        <feTurbulence type="fractalNoise" baseFrequency="0.05 0.09" numOctaves="2" result="noise" seed="15" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="splash-boil-filter-3">
        <feTurbulence type="fractalNoise" baseFrequency="0.04 0.07" numOctaves="2" result="noise" seed="30" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.8" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="splash-boil-filter-4">
        <feTurbulence type="fractalNoise" baseFrequency="0.06 0.08" numOctaves="2" result="noise" seed="45" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs>
  </svg>

  <!-- Start-up Empty Page Loading Splash with Nippo Font and Boiling Distortion -->
  {#if isInitialLoading}
    <div class="startup-splash-screen" class:is-hiding={isHidingSplash} aria-label="Loading Track RNG">
      <div class="startup-splash-brand">Track RNG</div>
    </div>
  {/if}

  <!-- 1. Onboarding Screen -->
  <div class={$isCrateReady ? 'hidden' : ''}>
    <Onboarding />
  </div>

  <!-- Logout Transition Shroud -->
  <div
    class="logout-transition-shroud {$isLoggingOut ? 'is-active' : ''}"
    aria-hidden="true"
  ></div>

  <!-- 2. Small Screen Warning Overlay -->
  {#if showScreenWarning}
    <div
      class="screen-warning-overlay"
      id="screenWarningOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screenWarningTitle"
      aria-describedby="screenWarningDesc"
    >
      <div class="screen-warning-card">
        <svg
          class="screen-warning-icon"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="20" height="14" rx="1" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>

        <h2 class="screen-warning-title" id="screenWarningTitle">
          Desktop Screen Recommended
        </h2>

        <p class="screen-warning-desc" id="screenWarningDesc">
          Optimized for wider displays (768px+). Mobile and small windows are not recommended.
        </p>

        <button
          type="button"
          class="btn-screen-dismiss"
          id="btnDismissScreenWarning"
          on:click={handleDismissScreenWarning}
        >
          Continue Anyway
        </button>
      </div>
    </div>
  {/if}

  <!-- 3. Crate RNG Game Arena View -->
  <div class="game-viewport {$isCrateReady ? '' : 'hidden'}" id="gameArenaScreen">
    <!-- Ambient Reactive Aura Layer -->
    <div
      class="ambient-aura-layer {$isSpinning ? 'is-spinning' : ''}"
      aria-hidden="true"
      style="--tier-glow-color: {currentAura.glow}; --tier-glow-accent: {currentAura.accent};"
    >
      <div class="aura-orb aura-orb-primary"></div>
      <div class="aura-orb aura-orb-secondary"></div>
    </div>

    <!-- Cyber Grid & Audio-Reactive IRFANJ Watermark Layer -->
    <CyberGrid />

    <Hud />

    <main class="game-stage-body">
      <Reel bind:this={reelComponent} onRollComplete={handleRollComplete} />

      <WinnerSpotlight
          onToggleAudio={toggleArenaAudio}
          onSeekAudio={seekArenaAudio}
          onWinnerArtLoaded={(url) => reelComponent?.updateWinnerArt(url)}
        />

      <Deck onRoll={triggerRoll} />
    </main>
  </div>

  <!-- Modals -->
  <BinderModal
    onPlayBinderTrack={playBinderTrack}
    onToggleBinderPlay={toggleBinderAudio}
    onSeekBinderAudio={seekBinderAudio}
  />

  <RatesModal />

  <SettingsModal />

  <!-- Hidden HTML5 Audio Previews (Dual Player Ping-Pong for gapless loop) -->
  <audio
    id="arenaAudioPlayer"
    bind:this={arenaAudioEl}
    crossorigin="anonymous"
    preload="none"
    on:play={() => {
      if (activeArenaPlayerId === 'A') isArenaPlaying.set(true);
    }}
    on:pause={() => {
      if (activeArenaPlayerId === 'A' && (!arenaAudioElB || arenaAudioElB.paused)) {
        isArenaPlaying.set(false);
      }
    }}
    on:timeupdate={() => {
      if (activeArenaPlayerId === 'A' && arenaAudioEl) {
        const cur = arenaAudioEl.currentTime || 0;
        const realDur = arenaAudioEl.duration;
        const dur = isFinite(realDur) && realDur > 0 ? realDur : 30;
        arenaAudioTime.set({ current: cur, duration: dur });

        // If Auto-Roll is enabled in "on_track_end" mode, roll next track right as song ends!
        if (isFinite(realDur) && realDur > 0) {
          const timeLeft = realDur - cur;
          if (timeLeft <= 0.65 && timeLeft > 0.05 && !arenaAudioEl.paused) {
            if ($isAutoRolling && $autoRollMode === 'on_track_end' && !$isSpinning) {
              triggerRoll();
            } else if (!isTransitioningToLoop) {
              triggerPingPongLoopTransition();
            }
          }
        }
      }
    }}
    on:loadedmetadata={() => {
      if (activeArenaPlayerId === 'A' && arenaAudioEl) {
        arenaAudioTime.set({
          current: arenaAudioEl.currentTime || 0,
          duration: arenaAudioEl.duration || 30,
        });
      }
    }}
    on:error={() => handleArenaAudioError('A')}
    on:seeked={() => handleArenaSeeked('A')}
    on:ended={() => {
      if (!isTransitioningToLoop) triggerPingPongLoopTransition();
    }}
  ></audio>

  <audio
    id="arenaAudioPlayerB"
    bind:this={arenaAudioElB}
    crossorigin="anonymous"
    preload="none"
    on:play={() => {
      if (activeArenaPlayerId === 'B') isArenaPlaying.set(true);
    }}
    on:pause={() => {
      if (activeArenaPlayerId === 'B' && (!arenaAudioEl || arenaAudioEl.paused)) {
        isArenaPlaying.set(false);
      }
    }}
    on:timeupdate={() => {
      if (activeArenaPlayerId === 'B' && arenaAudioElB) {
        const cur = arenaAudioElB.currentTime || 0;
        const realDur = arenaAudioElB.duration;
        const dur = isFinite(realDur) && realDur > 0 ? realDur : 30;
        arenaAudioTime.set({ current: cur, duration: dur });

        // If Auto-Roll is enabled in "on_track_end" mode, roll next track right as song ends!
        if (isFinite(realDur) && realDur > 0) {
          const timeLeft = realDur - cur;
          if (timeLeft <= 0.65 && timeLeft > 0.05 && !arenaAudioElB.paused) {
            if ($isAutoRolling && $autoRollMode === 'on_track_end' && !$isSpinning) {
              triggerRoll();
            } else if (!isTransitioningToLoop) {
              triggerPingPongLoopTransition();
            }
          }
        }
      }
    }}
    on:loadedmetadata={() => {
      if (activeArenaPlayerId === 'B' && arenaAudioElB) {
        arenaAudioTime.set({
          current: arenaAudioElB.currentTime || 0,
          duration: arenaAudioElB.duration || 30,
        });
      }
    }}
    on:error={() => handleArenaAudioError('B')}
    on:seeked={() => handleArenaSeeked('B')}
    on:ended={() => {
      if (!isTransitioningToLoop) triggerPingPongLoopTransition();
    }}
  ></audio>

  <audio
    id="binderAudioPlayer"
    bind:this={binderAudioEl}
    crossorigin="anonymous"
    preload="none"
    on:play={() => isBinderPlaying.set(true)}
    on:pause={() => isBinderPlaying.set(false)}
    on:ended={() => {
      isBinderPlaying.set(false);
      binderAudioTime.set({ current: 0, duration: binderAudioEl?.duration || 30 });
    }}
    on:timeupdate={() => {
      if (binderAudioEl) {
        binderAudioTime.set({
          current: binderAudioEl.currentTime || 0,
          duration: binderAudioEl.duration || 30,
        });
      }
    }}
    on:loadedmetadata={() => {
      if (binderAudioEl) {
        binderAudioTime.set({
          current: binderAudioEl.currentTime || 0,
          duration: binderAudioEl.duration || 30,
        });
      }
    }}
  ></audio>
</div>
