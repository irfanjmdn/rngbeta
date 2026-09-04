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
  import { connectMediaElement, getBassEnergy, getAudioVisualizerData } from './lib/audio.js';

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
  let auraLayerEl;
  let visualizerCanvas;
  let canvasCtx = null;
  let arenaFadeInterval = null;
  let binderFadeInterval = null;

  let rafId = null;
  let currentPulseScale = 0;
  let currentPulseOpacity = 0;
  let rings = [];
  let embers = [];

  const TIER_VISUALIZER_CONFIG = {
    default: {
      color: [29, 185, 84],
      maxRadius: 360,
      ringSpeed: 4.5,
      lineWidth: 2.4,
      hasEcho: false,
      emberCount: 0,
    },
    common: {
      color: [148, 163, 184],
      maxRadius: 320,
      ringSpeed: 3.8,
      lineWidth: 2.0,
      hasEcho: false,
      emberCount: 0,
    },
    uncommon: {
      color: [16, 185, 129],
      maxRadius: 360,
      ringSpeed: 4.2,
      lineWidth: 2.4,
      hasEcho: false,
      emberCount: 0,
    },
    rare: {
      color: [59, 130, 246],
      maxRadius: 400,
      ringSpeed: 4.8,
      lineWidth: 2.8,
      hasEcho: true,
      emberCount: 2,
    },
    epic: {
      color: [168, 85, 247],
      maxRadius: 440,
      ringSpeed: 5.2,
      lineWidth: 3.2,
      hasEcho: true,
      emberCount: 4,
    },
    legendary: {
      color: [245, 158, 11],
      maxRadius: 480,
      ringSpeed: 5.8,
      lineWidth: 3.6,
      hasEcho: true,
      emberCount: 7,
    },
    mythic: {
      color: [244, 63, 94],
      maxRadius: 520,
      ringSpeed: 6.4,
      lineWidth: 4.0,
      hasEcho: true,
      emberCount: 10,
    },
  };

  function spawnShockwave(intensity = 1.0) {
    const tier = $activeWinnerCard?.rarityTier || 'default';
    const cfg = TIER_VISUALIZER_CONFIG[tier] || TIER_VISUALIZER_CONFIG.default;

    rings.push({
      radius: 14,
      maxRadius: cfg.maxRadius * (0.85 + intensity * 0.3),
      speed: cfg.ringSpeed * (0.85 + intensity * 0.3),
      opacity: 0.75 + intensity * 0.25,
      lineWidth: cfg.lineWidth * (0.85 + intensity * 0.3),
      color: cfg.color,
    });

    if (cfg.hasEcho) {
      setTimeout(() => {
        rings.push({
          radius: 14,
          maxRadius: cfg.maxRadius * 0.75,
          speed: cfg.ringSpeed * 0.75,
          opacity: 0.5,
          lineWidth: cfg.lineWidth * 0.7,
          color: cfg.color,
        });
      }, 80);
    }

    if (cfg.emberCount > 0) {
      for (let i = 0; i < cfg.emberCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (2.2 + Math.random() * 4.5) * (0.8 + intensity * 0.4);
        embers.push({
          x: 0,
          y: 0,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 1.5 + Math.random() * 2,
          opacity: 0.85,
          decay: 0.022 + Math.random() * 0.02,
          color: cfg.color,
        });
      }
    }
  }

  function renderVisualizerFrame() {
    if (!visualizerCanvas) return;
    if (!canvasCtx) {
      canvasCtx = visualizerCanvas.getContext('2d');
    }
    const ctx = canvasCtx;
    if (!ctx) return;

    const width = visualizerCanvas.clientWidth;
    const height = visualizerCanvas.clientHeight;
    if (visualizerCanvas.width !== width || visualizerCanvas.height !== height) {
      visualizerCanvas.width = width;
      visualizerCanvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);

    const data = getAudioVisualizerData();
    if (data.beat && ($isArenaPlaying || $isBinderPlaying)) {
      spawnShockwave(data.beatIntensity);
    }

    currentPulseScale += (data.bass * 0.25 - currentPulseScale) * 0.22;
    currentPulseOpacity += (data.bass * 0.45 - currentPulseOpacity) * 0.22;
    if (auraLayerEl) {
      auraLayerEl.style.setProperty('--audio-pulse-scale', currentPulseScale.toFixed(4));
      auraLayerEl.style.setProperty('--audio-pulse-opacity', currentPulseOpacity.toFixed(4));
    }

    const centerX = width / 2;
    const centerY = height * 0.27;

    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      ctx.beginPath();
      ctx.arc(centerX, centerY, r.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r.color[0]}, ${r.color[1]}, ${r.color[2]}, ${r.opacity.toFixed(3)})`;
      ctx.lineWidth = r.lineWidth;
      ctx.shadowColor = `rgba(${r.color[0]}, ${r.color[1]}, ${r.color[2]}, 0.55)`;
      ctx.shadowBlur = 10;
      ctx.stroke();

      r.radius += r.speed;
      r.opacity *= 0.94;

      if (r.opacity < 0.015 || r.radius >= r.maxRadius) {
        rings.splice(i, 1);
      }
    }

    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      ctx.beginPath();
      ctx.arc(centerX + e.x, centerY + e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${e.color[0]}, ${e.color[1]}, ${e.color[2]}, ${e.opacity.toFixed(3)})`;
      ctx.shadowColor = `rgba(${e.color[0]}, ${e.color[1]}, ${e.color[2]}, 0.8)`;
      ctx.shadowBlur = 6;
      ctx.fill();

      e.x += e.vx;
      e.y += e.vy;
      e.vx *= 0.96;
      e.vy *= 0.96;
      e.opacity -= e.decay;

      if (e.opacity <= 0) {
        embers.splice(i, 1);
      }
    }

    ctx.shadowBlur = 0;

    if ($isArenaPlaying || $isBinderPlaying || rings.length > 0 || embers.length > 0 || currentPulseScale > 0.005) {
      rafId = requestAnimationFrame(renderVisualizerFrame);
    } else {
      rafId = null;
      ctx.clearRect(0, 0, width, height);
      if (auraLayerEl) {
        auraLayerEl.style.setProperty('--audio-pulse-scale', '0');
        auraLayerEl.style.setProperty('--audio-pulse-opacity', '0');
      }
    }
  }

  function ensureAudioAuraLoop() {
    if (!rafId && typeof window !== 'undefined') {
      rafId = requestAnimationFrame(renderVisualizerFrame);
    }
  }

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
      connectMediaElement(arenaAudioEl);
      arenaAudioEl.pause();
      arenaAudioEl.volume = 1;
      if (arenaAudioEl.src !== url) {
        arenaAudioEl.src = url;
      }
      arenaAudioEl.currentTime = startTime;
      arenaAudioEl.play().catch(() => isArenaPlaying.set(false));
      ensureAudioAuraLoop();
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
        connectMediaElement(arenaAudioEl);
        arenaAudioEl.play().catch(() => isArenaPlaying.set(false));
        ensureAudioAuraLoop();
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
      connectMediaElement(binderAudioEl);
      binderAudioEl.pause();
      binderAudioEl.volume = 1;
      if (binderAudioEl.src !== card.preview_url) {
        binderAudioEl.src = card.preview_url;
      }
      binderAudioEl.currentTime = 0;
      binderAudioEl.play().catch(() => isBinderPlaying.set(false));
      ensureAudioAuraLoop();
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
        connectMediaElement(binderAudioEl);
        binderAudioEl.play().catch(() => isBinderPlaying.set(false));
        ensureAudioAuraLoop();
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

  let isShockwaveActive = false;

  $: currentAura = $activeWinnerCard
    ? (TIER_AURA_COLORS[$activeWinnerCard.rarityTier] || TIER_AURA_COLORS.default)
    : TIER_AURA_COLORS.default;

  function handleRollComplete(winner, isNew) {
    activeArenaTrack.set(winner);
    isShockwaveActive = true;
    spawnShockwave(1.35);
    ensureAudioAuraLoop();
    setTimeout(() => {
      isShockwaveActive = false;
    }, 480);
    if (winner.preview_url) {
      playArenaAudio(winner.preview_url);
    }
  }

  onDestroy(() => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

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
    <!-- Ambient Reactive Aura Layer -->
    <div
      bind:this={auraLayerEl}
      class="ambient-aura-layer {$isSpinning ? 'is-spinning' : ''} {isShockwaveActive ? 'shockwave-flash' : ''}"
      aria-hidden="true"
      style="--tier-glow-color: {currentAura.glow}; --tier-glow-accent: {currentAura.accent};"
    >
      <div class="aura-orb aura-orb-primary"></div>
      <div class="aura-orb aura-orb-secondary"></div>
      <div class="aura-shockwave"></div>
    </div>

    <!-- Audio-Reactive Radial Shockwave Canvas -->
    <canvas
      bind:this={visualizerCanvas}
      class="audio-visualizer-canvas"
      aria-hidden="true"
    ></canvas>

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
    crossorigin="anonymous"
    preload="none"
    on:play={() => {
      connectMediaElement(arenaAudioEl);
      isArenaPlaying.set(true);
      ensureAudioAuraLoop();
    }}
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
    crossorigin="anonymous"
    preload="none"
    on:play={() => {
      connectMediaElement(binderAudioEl);
      isBinderPlaying.set(true);
      ensureAudioAuraLoop();
    }}
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
