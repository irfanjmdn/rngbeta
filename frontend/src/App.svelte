<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    isCrateReady,
    isSpinning,
    activeWinnerCard,
    activeArenaTrack,
    activeBinderTrack,
    isArenaPlaying,
    isBinderPlaying,
    arenaAudioTime,
    binderAudioTime,
    activeModal,
  } from './lib/store.js';

  import Onboarding from './components/Onboarding.svelte';
  import Hud from './components/Hud.svelte';
  import Reel from './components/Reel.svelte';
  import WinnerSpotlight from './components/WinnerSpotlight.svelte';
  import Deck from './components/Deck.svelte';
  import BinderModal from './components/BinderModal.svelte';
  import RatesModal from './components/RatesModal.svelte';
  import SettingsModal from './components/SettingsModal.svelte';

  let reelComponent;
  let arenaAudioEl;
  let binderAudioEl;
  let arenaFadeInterval = null;
  let binderFadeInterval = null;

  function stopOrFadeOutArenaAudio(durationMs = 750) {
    if (arenaFadeInterval) {
      clearInterval(arenaFadeInterval);
      arenaFadeInterval = null;
    }
    if (!arenaAudioEl) return;

    if (durationMs <= 0 || arenaAudioEl.paused || arenaAudioEl.ended || arenaAudioEl.currentTime === 0) {
      try {
        arenaAudioEl.pause();
        arenaAudioEl.currentTime = 0;
        arenaAudioEl.volume = 1;
      } catch (e) {}
      isArenaPlaying.set(false);
      arenaAudioTime.set({ current: 0, duration: arenaAudioEl.duration || 30 });
      return;
    }

    const startVolume = arenaAudioEl.volume || 1;
    const startTime = performance.now();

    arenaFadeInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const currentVol = Math.max(0, startVolume * (1 - progress));

      try {
        arenaAudioEl.volume = currentVol;
      } catch (e) {}

      if (progress >= 1) {
        clearInterval(arenaFadeInterval);
        arenaFadeInterval = null;
        try {
          arenaAudioEl.pause();
          arenaAudioEl.currentTime = 0;
          arenaAudioEl.volume = 1;
        } catch (e) {}
        isArenaPlaying.set(false);
        arenaAudioTime.set({ current: 0, duration: arenaAudioEl.duration || 30 });
      }
    }, 25);
  }

  function stopOrFadeOutBinderAudio(durationMs = 500) {
    if (binderFadeInterval) {
      clearInterval(binderFadeInterval);
      binderFadeInterval = null;
    }
    if (!binderAudioEl) return;

    if (durationMs <= 0 || binderAudioEl.paused || binderAudioEl.ended || binderAudioEl.currentTime === 0) {
      try {
        binderAudioEl.pause();
        binderAudioEl.currentTime = 0;
        binderAudioEl.volume = 1;
      } catch (e) {}
      isBinderPlaying.set(false);
      binderAudioTime.set({ current: 0, duration: binderAudioEl.duration || 30 });
      return;
    }

    const startVolume = binderAudioEl.volume || 1;
    const startTime = performance.now();

    binderFadeInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const currentVol = Math.max(0, startVolume * (1 - progress));

      try {
        binderAudioEl.volume = currentVol;
      } catch (e) {}

      if (progress >= 1) {
        clearInterval(binderFadeInterval);
        binderFadeInterval = null;
        try {
          binderAudioEl.pause();
          binderAudioEl.currentTime = 0;
          binderAudioEl.volume = 1;
        } catch (e) {}
        isBinderPlaying.set(false);
        binderAudioTime.set({ current: 0, duration: binderAudioEl.duration || 30 });
      }
    }, 25);
  }

  function playArenaAudio(url, startTime = 0) {
    stopOrFadeOutBinderAudio(0);
    if (!arenaAudioEl || !url) return;

    try {
      arenaAudioEl.pause();
      arenaAudioEl.volume = 1;
      if (arenaAudioEl.src !== url) {
        arenaAudioEl.src = url;
      }
      arenaAudioEl.currentTime = startTime;
      arenaAudioEl.play().catch(() => isArenaPlaying.set(false));
    } catch (e) {
      isArenaPlaying.set(false);
    }
  }

  function toggleArenaAudio() {
    let track = $activeArenaTrack || $activeWinnerCard;
    if (!track?.preview_url || !arenaAudioEl) return;

    if (arenaAudioEl.paused) {
      stopOrFadeOutBinderAudio(0);
      if (!arenaAudioEl.src || !arenaAudioEl.src.includes(track.preview_url)) {
        playArenaAudio(track.preview_url);
      } else {
        arenaAudioEl.play().catch(() => isArenaPlaying.set(false));
      }
    } else {
      arenaAudioEl.pause();
      isArenaPlaying.set(false);
    }
  }

  function seekArenaAudio(ratio) {
    if (!arenaAudioEl) return;
    const dur = arenaAudioEl.duration || 30;
    const target = ratio * dur;
    arenaAudioTime.set({ current: target, duration: dur });
    if (!isNaN(dur)) {
      arenaAudioEl.currentTime = target;
    }
  }

  function playBinderTrack(card) {
    stopOrFadeOutArenaAudio(0);
    activeBinderTrack.set(card);
    if (!binderAudioEl || !card?.preview_url) {
      stopOrFadeOutBinderAudio(0);
      return;
    }

    try {
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
      stopOrFadeOutArenaAudio(0);
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
    stopOrFadeOutArenaAudio(750);
    stopOrFadeOutBinderAudio(0);
    if (reelComponent) {
      reelComponent.executeSpin();
    }
  }

  function handleRollComplete(winner, isNew) {
    activeArenaTrack.set(winner);
    if (winner.preview_url) {
      playArenaAudio(winner.preview_url);
    }
  }

  onMount(() => {
    const handleKeydown = (e) => {
      if (e.key === 'r' || e.key === 'R') {
        if ($isCrateReady && !$isSpinning && document.activeElement?.tagName !== 'INPUT') {
          triggerRoll();
        }
      }
      if (e.key === 'Escape') {
        activeModal.set(null);
      }
    };
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<div class="app-root">
  <!-- 1. Onboarding Screen -->
  <div class={$isCrateReady ? 'hidden' : ''}>
    <Onboarding />
  </div>

  <!-- 2. Crate RNG Game Arena View -->
  <div class="game-viewport {$isCrateReady ? '' : 'hidden'}" id="gameArenaScreen">
    <Hud />

    <main class="game-stage-body">
      <Reel bind:this={reelComponent} onRollComplete={handleRollComplete} />

      <WinnerSpotlight onToggleAudio={toggleArenaAudio} onSeekAudio={seekArenaAudio} />

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

  <!-- Hidden HTML5 Audio Previews -->
  <audio
    id="arenaAudioPlayer"
    bind:this={arenaAudioEl}
    preload="none"
    on:play={() => isArenaPlaying.set(true)}
    on:pause={() => isArenaPlaying.set(false)}
    on:ended={() => {
      isArenaPlaying.set(false);
      arenaAudioTime.set({ current: 0, duration: arenaAudioEl?.duration || 30 });
    }}
    on:timeupdate={() => {
      if (arenaAudioEl) {
        arenaAudioTime.set({
          current: arenaAudioEl.currentTime || 0,
          duration: arenaAudioEl.duration || 30,
        });
      }
    }}
    on:loadedmetadata={() => {
      if (arenaAudioEl) {
        arenaAudioTime.set({
          current: arenaAudioEl.currentTime || 0,
          duration: arenaAudioEl.duration || 30,
        });
      }
    }}
  ></audio>

  <audio
    id="binderAudioPlayer"
    bind:this={binderAudioEl}
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
