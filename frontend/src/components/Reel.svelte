<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    rngTracks,
    isCrateReady,
    isSpinning,
    reelVelocity,
    reelCurrentX,
    isAutoRolling,
    isAutoSkip,
    autoRollMode,
    activeWinnerCard,
    activeUserId,
    gameInventory,
    gameInventoryTimestamps,
    gameRolls,
    starredTrackIds,
    saveUserData,
    isArenaPlaying,
  } from '../lib/store.js';
  import {
    playTickSound,
    playPointerSeekSound,
    playMechanicalBrakeSound,
    playLandingImpactBass,
    playFanfareSound,
    playSpringCoilSound,
    playNearMissSound,
    playTierLandingSound,
    getAudioContext,
    getTargetBassPeakMetrics,
  } from '../lib/audio.js';
  import { isPlaceholderCover, clientArtCache, fetchTrackDetails, fetchTrackPreview } from '../lib/artCache.js';
  import { resolveSoundCloudStreamUrl } from '../lib/modes/soundcloudEngine.js';
  import { triggerHaptic, triggerThrottledHaptic } from '../lib/haptics.js';

  export let onRollComplete = () => {};

  let spinnerMachineWrap;
  let reelViewport;
  let reelTrack;
  let reelPointerTop;
  let reelPointerBottom;
  let reelCenterline;

  let currentReelIndex = 15;
  let rollRafId = null;
  let rollAutoSkipTimer = null;
  let rollRegisterTimer = null;
  let rollNormalEndTimer = null;
  let rollAlignTimer = null;
  let autoRollTimer = null;
  let postRollDriftTimer = null;
  let winnerUnselectTimer = null;
  let driftRafId = null;
  let currentTranslateX = 0;
  const preloadedAudioMap = new Map();
  const MAX_PRELOADED_AUDIO = 6;

  function prunePreloadedAudio() {
    while (preloadedAudioMap.size > MAX_PRELOADED_AUDIO) {
      const oldestKey = preloadedAudioMap.keys().next().value;
      const oldAudio = preloadedAudioMap.get(oldestKey);
      if (oldAudio) {
        try {
          oldAudio.pause();
          oldAudio.src = '';
          oldAudio.load();
        } catch (e) {}
      }
      preloadedAudioMap.delete(oldestKey);
    }
  }
  let upcomingRollQueue = [];

  let spinStartTime = 0;
  let spinExpectedDuration = 3950;
  let finalizeRollFn = null;
  let resumeSpinFn = null;
  let isDriftingActive = false;

  function preloadCardAudio(card) {
    if (!card) return;
    if (card.source === 'soundcloud' && card.preview_url) {
      const endpoint = card.stream_proxy_url || card.preview_url;
      resolveSoundCloudStreamUrl(endpoint).then((directUrl) => {
        if (directUrl && directUrl !== endpoint) {
          card.stream_proxy_url = endpoint;
          card.preview_url = directUrl;
        }
        if (directUrl && !preloadedAudioMap.has(directUrl)) {
          const audio = new Audio();
          audio.preload = 'auto';
          audio.src = directUrl;
          preloadedAudioMap.set(directUrl, audio);
          prunePreloadedAudio();
        }
      });
    } else {
      fetchTrackPreview(card).then((pUrl) => {
        if (pUrl && !preloadedAudioMap.has(pUrl)) {
          const audio = new Audio();
          audio.preload = 'auto';
          audio.src = pUrl;
          preloadedAudioMap.set(pUrl, audio);
          prunePreloadedAudio();
        }
      });
    }
    if (card.spotify_id && isPlaceholderCover(card)) {
      fetchTrackDetails(card.spotify_id, card.title, card.artist).then((details) => {
        if (details?.album_cover_url) {
          card.album_cover_url = details.album_cover_url;
          if (details.release_date) card.release_date = details.release_date;
        }
      });
    }
  }

  export function topUpUpcomingRolls() {
    if (!$rngTracks.length) return;
    while (upcomingRollQueue.length < 5) {
      const card = pickWeightedCard();
      if (!card) break;
      upcomingRollQueue.push(card);
      preloadCardAudio(card);
    }
  }

  let lastLoadedTracks = null;
  $: if ($rngTracks !== lastLoadedTracks) {
    lastLoadedTracks = $rngTracks;
    upcomingRollQueue = [];
    if ($rngTracks && $rngTracks.length > 0) {
      topUpUpcomingRolls();
      if (reelTrack) {
        buildInitialReel();
      }
    } else if (reelTrack) {
      reelTrack.innerHTML = '';
    }
  }

  $: if ($rngTracks.length > 0 && upcomingRollQueue.length < 5) {
    topUpUpcomingRolls();
  }

  function pickWeightedCard() {
    if (!$rngTracks.length) return null;
    const totalWeight = $rngTracks.reduce((sum, t) => sum + (t.weight || 1), 0);
    let rand = Math.random() * totalWeight;
    for (const t of $rngTracks) {
      if (rand < (t.weight || 1)) return t;
      rand -= (t.weight || 1);
    }
    return $rngTracks[0];
  }

  const TIER_RANKS = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 };

  function pickCardByTier(tier) {
    if (!$rngTracks.length) return null;
    const matches = $rngTracks.filter((t) => t.rarityTier === tier);
    if (!matches.length) return null;
    return matches[Math.floor(Math.random() * matches.length)];
  }

  function determineNearMiss(winnerTier) {
    const winnerRank = TIER_RANKS[winnerTier] || 1;

    // 1/40 chance of Mythic near-miss (if winner is below Mythic)
    const mythicThreshold = (1 / 40) * (0.85 + Math.random() * 0.3);
    if (winnerRank < 6 && Math.random() < mythicThreshold) {
      const card = pickCardByTier('mythic');
      if (card) return { tier: 'mythic', card };
    }

    // 1/25 chance of Legendary near-miss (if winner is below Legendary)
    const legThreshold = (1 / 25) * (0.85 + Math.random() * 0.3);
    if (winnerRank < 5 && Math.random() < legThreshold) {
      const card = pickCardByTier('legendary');
      if (card) return { tier: 'legendary', card };
    }

    // 1/15 chance of Epic near-miss (if winner is below Epic)
    const epicThreshold = (1 / 15) * (0.85 + Math.random() * 0.3);
    if (winnerRank < 4 && Math.random() < epicThreshold) {
      const card = pickCardByTier('epic');
      if (card) return { tier: 'epic', card };
    }

    return null;
  }

  function htmlEscape(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createReelCardElement(card) {
    const div = document.createElement('div');
    div._cardData = card;
    div.className = `reel-card tier-${card.rarityTier}`;
    const isPlaceholder = isPlaceholderCover(card);
    const albumCover =
      card.album_cover_url ||
      card.cover_url ||
      card.playlist_cover_url ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%231e293b'/%3E%3C/svg%3E";
    const playlistCover = card.playlist_cover_url || '';

    const textColor = ['legendary', 'uncommon', 'common'].includes(card.rarityTier) ? '#080B11' : '#FFFFFF';

    div.innerHTML = `
      <div class="reel-card-body">
        <div class="reel-card-art-wrap">
          <img class="reel-card-art ${isPlaceholder ? 'is-placeholder-art' : ''}" src="${albumCover}" alt="${htmlEscape(card.title)}" loading="lazy" />
        </div>
        <div class="reel-card-title">${htmlEscape(card.title)}</div>
        <div class="reel-card-artist">${htmlEscape(card.artist)}</div>
      </div>
      <div class="reel-card-tier-banner" style="background-color: ${card.rarityColor}; color: ${textColor};">${htmlEscape(card.rarityName.toUpperCase())}</div>
    `;

    if (card.spotify_id && clientArtCache[card.spotify_id]) {
      const artImg = div.querySelector('.reel-card-art');
      if (artImg) {
        card.album_cover_url = clientArtCache[card.spotify_id];
        artImg.src = clientArtCache[card.spotify_id];
        artImg.classList.remove('is-placeholder-art');
      }
    }

    return div;
  }

  const isMobileInitial = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
  const CARD_WIDTH = 148;
  const CARD_MARGIN = 6;
  let cardTotalWidth = isMobileInitial ? (158 + 14) : (CARD_WIDTH + CARD_MARGIN * 2); // 172px mobile, 160px desktop
  let cachedViewportWidth = 0;

  function measureDimensions() {
    if (!reelViewport) return;
    cachedViewportWidth = reelViewport.clientWidth || 1024;
    const isMobile = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    const fallbackWidth = isMobile ? 158 : CARD_WIDTH;
    const firstCard = reelTrack?.firstElementChild;
    if (firstCard && typeof window !== 'undefined') {
      const style = window.getComputedStyle(firstCard);
      const marginLeft = parseFloat(style.marginLeft) || 0;
      const marginRight = parseFloat(style.marginRight) || 0;
      const w = firstCard.offsetWidth || parseFloat(style.width) || fallbackWidth;
      if (w > 0) {
        cardTotalWidth = w + marginLeft + marginRight;
      }
    }
  }

  function updateReelScales(activeX = currentTranslateX, updateAll = false) {
    if (!reelTrack || !reelViewport) return;
    const cards = reelTrack.children;
    const totalCards = cards.length;
    if (!totalCards) return;

    const vpWidth = cachedViewportWidth || reelViewport.clientWidth || 1024;
    const centerX = vpWidth / 2;
    const maxDist = centerX + 80;

    let minIndex = 0;
    let maxIndex = totalCards - 1;

    if (!updateAll) {
      const centerCardFloat = (centerX - (activeX + cardTotalWidth / 2)) / cardTotalWidth;
      const centerCardIndex = Math.round(centerCardFloat);
      minIndex = Math.max(0, centerCardIndex - 7);
      maxIndex = Math.min(totalCards - 1, centerCardIndex + 7);
    }

    for (let i = minIndex; i <= maxIndex; i++) {
      const card = cards[i];
      if (!card) continue;

      const cardCenterX = activeX + i * cardTotalWidth + cardTotalWidth / 2;
      const dist = Math.abs(centerX - cardCenterX);
      const normDist = Math.min(dist / maxDist, 1);

      // Parabolic arched bridge drop: y = normDist^2 * 38px (disabled on mobile for flat precision alignment)
      const isMobileReel = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
      const translateY = isMobileReel ? 0 : Math.pow(normDist, 2) * 38;

      // Tangential tilt outward (disabled on mobile for flat alignment)
      const direction = cardCenterX < centerX ? -1 : 1;
      const rotateZ = isMobileReel ? 0 : direction * Math.pow(normDist, 1.15) * 7.5;

      const scale = 1 - normDist * 0.26;
      const opacity = Math.max(0.68, 1 - normDist * 0.35);
      const blur = isMobileReel ? 0 : (normDist > 0.22 ? Math.pow((normDist - 0.22) / 0.78, 1.35) * 4.2 : 0);

      card.style.setProperty('--card-translate-y', `${translateY.toFixed(2)}px`);
      card.style.setProperty('--card-rotate-z', `${rotateZ.toFixed(2)}deg`);
      card.style.setProperty('--card-scale', scale.toFixed(3));
      card.style.setProperty('--card-opacity', opacity.toFixed(3));
      card.style.setProperty('--card-blur', `${blur.toFixed(2)}px`);
    }
  }

  function recenterReel(index) {
    if (!reelTrack || !reelViewport) return;
    measureDimensions();
    const centerTarget = cachedViewportWidth / 2 - cardTotalWidth / 2;
    const targetX = -(index * cardTotalWidth) + centerTarget;
    reelTrack.style.transition = 'none';
    reelTrack.style.transform = `translateX(${targetX}px)`;
    currentTranslateX = targetX;
    updateReelScales(targetX, true);
  }

  export function buildInitialReel() {
    if (!reelTrack) return;
    reelTrack.innerHTML = '';
    const TOTAL = 30;
    for (let i = 0; i < TOTAL; i++) {
      const card = pickWeightedCard();
      if (card) reelTrack.appendChild(createReelCardElement(card));
    }
    currentReelIndex = 15;
    recenterReel(15);
  }

  export function updateWinnerArt(url) {
    if (!reelTrack || !url) return;
    const winnerEl = reelTrack.children[currentReelIndex];
    if (!winnerEl) return;
    const img = winnerEl.querySelector('.reel-card-art');
    if (img) {
      img.src = url;
      img.classList.remove('is-placeholder-art');
    }
  }

  function clearActiveRollTimers() {
    isDriftingActive = false;
    finalizeRollFn = null;
    resumeSpinFn = null;
    if (postRollDriftTimer) {
      clearTimeout(postRollDriftTimer);
      postRollDriftTimer = null;
    }
    if (winnerUnselectTimer) {
      clearTimeout(winnerUnselectTimer);
      winnerUnselectTimer = null;
    }
    if (driftRafId) {
      cancelAnimationFrame(driftRafId);
      driftRafId = null;
    }
    if (rollAutoSkipTimer) {
      clearTimeout(rollAutoSkipTimer);
      rollAutoSkipTimer = null;
    }
    if (rollRegisterTimer) {
      clearTimeout(rollRegisterTimer);
      rollRegisterTimer = null;
    }
    if (rollNormalEndTimer) {
      clearTimeout(rollNormalEndTimer);
      rollNormalEndTimer = null;
    }
    if (rollAlignTimer) {
      clearTimeout(rollAlignTimer);
      rollAlignTimer = null;
    }
    if (rollRafId) {
      cancelAnimationFrame(rollRafId);
      rollRafId = null;
    }
    if (reelAudioRafId) {
      cancelAnimationFrame(reelAudioRafId);
      reelAudioRafId = null;
    }
    currentReelBassScale = 1.0;
    reelSmoothedBass = 0;
    reelImpactSpike = 0;
    reelVelocity.set(0);
    reelCurrentX.set(null);
    if (reelPointerTop) reelPointerTop.classList.remove('pointer-engaging', 'caliper-pinch');
    if (reelPointerBottom) reelPointerBottom.classList.remove('pointer-engaging', 'caliper-pinch');
    if (reelTrack) reelTrack.classList.remove('is-spinning');
  }

  function getCenterCardData() {
    if (!reelTrack || !reelTrack.children.length) return null;
    const vpWidth = cachedViewportWidth || (reelViewport ? reelViewport.clientWidth : 1024);
    const centerX = vpWidth / 2;
    const centerIndex = Math.round((centerX - currentTranslateX - cardTotalWidth / 2) / cardTotalWidth);
    const clampedIndex = Math.max(0, Math.min(reelTrack.children.length - 1, centerIndex));
    const card = reelTrack.children[clampedIndex];
    return card ? card._cardData : null;
  }

  function startPostRollDrift() {
    if ($isSpinning || !reelTrack || !reelViewport) return;

    if (driftRafId) {
      cancelAnimationFrame(driftRafId);
      driftRafId = null;
    }

    // Return the selected winner card back to its original state 1 second after drift begins
    winnerUnselectTimer = setTimeout(() => {
      const landedWinner = reelTrack?.querySelector('.reel-card.winner-landed');
      if (landedWinner) {
        landedWinner.classList.remove('winner-landed');
      }
      winnerUnselectTimer = null;
    }, 1000);

    // On mobile devices, cut corners on continuous RAF loops by using a GPU hardware CSS transition
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      isDriftingActive = false;
      currentTranslateX -= 40;
      reelTrack.style.transition = 'transform 2.2s cubic-bezier(0.22, 1, 0.36, 1)';
      reelTrack.style.transform = `translateX(${currentTranslateX.toFixed(2)}px)`;
      return;
    }

    isDriftingActive = true;
    reelTrack.style.transition = 'none';
    const driftSpeed = 30; // continuous pixels per second
    const rampDuration = 1000; // ms to smoothly ease into continuous drift
    const startTime = performance.now();
    let lastTime = startTime;

    function driftStep(now) {
      if ($isSpinning || !reelTrack || !reelViewport) {
        driftRafId = null;
        isDriftingActive = false;
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        driftRafId = null;
        return;
      }

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / rampDuration);
      const ease = progress * progress * (3 - 2 * progress);
      const currentSpeed = driftSpeed * ease;

      currentTranslateX -= currentSpeed * dt;
      reelTrack.style.transform = `translateX(${currentTranslateX.toFixed(2)}px)`;

      // Ensure upcoming cards on the right never run out
      const totalCards = reelTrack.children.length;
      if (totalCards > 0) {
        const lastCardRight = currentTranslateX + totalCards * cardTotalWidth;
        const vpWidth = cachedViewportWidth || reelViewport.clientWidth || 1024;
        if (lastCardRight < vpWidth + 800) {
          const newCard = pickWeightedCard();
          if (newCard) {
            reelTrack.appendChild(createReelCardElement(newCard));
          }
        }
      }

      updateReelScales(currentTranslateX);
      driftRafId = requestAnimationFrame(driftStep);
    }

    driftRafId = requestAnimationFrame(driftStep);
  }

  export function executeSpin() {
    if ($isSpinning || !$rngTracks.length || !reelTrack) return;
    getAudioContext();
    isSpinning.set(true);
    clearActiveRollTimers();

    // Anticipation feedback
    playSpringCoilSound();
    if (spinnerMachineWrap) {
      spinnerMachineWrap.classList.remove('is-anticipating');
      void spinnerMachineWrap.offsetWidth;
      spinnerMachineWrap.classList.add('is-anticipating');
      setTimeout(() => spinnerMachineWrap?.classList.remove('is-anticipating'), 140);
    }

    const previousCard =
      getCenterCardData() ||
      (reelTrack.children[currentReelIndex] && reelTrack.children[currentReelIndex]._cardData) ||
      $activeWinnerCard ||
      pickWeightedCard();

    topUpUpcomingRolls();
    const winner = upcomingRollQueue.shift() || pickWeightedCard();
    topUpUpcomingRolls();
    const START_INDEX = 5;
    const WINNER_INDEX = 65;
    const TOTAL_ITEMS = 75;
    currentReelIndex = WINNER_INDEX;

    // Prefetch real album art for the winner ahead of time during the spin
    if (winner.spotify_id && isPlaceholderCover(winner)) {
      fetchTrackDetails(winner.spotify_id, winner.title, winner.artist).then((details) => {
        if (details?.album_cover_url) {
          winner.album_cover_url = details.album_cover_url;
          if (details.release_date) winner.release_date = details.release_date;
          updateWinnerArt(details.album_cover_url);
        }
      });
    }

    // Prefetch 30s audio preview and HD art during the 3.95s spin
    if (!winner.preview_url) {
      fetchTrackPreview(winner).then((pUrl) => {
        if (pUrl) {
          const preAudio = new Audio();
          preAudio.preload = 'auto';
          preAudio.src = pUrl;
        }
      });
    } else if (winner.source === 'soundcloud' && winner.preview_url) {
      const endpoint = winner.stream_proxy_url || winner.preview_url;
      resolveSoundCloudStreamUrl(endpoint).then((directUrl) => {
        if (directUrl) {
          winner.stream_proxy_url = endpoint;
          winner.preview_url = directUrl;
          const preAudio = new Audio();
          preAudio.preload = 'auto';
          preAudio.src = directUrl;
        }
      });
    }

    // Check for pseudo-random near-miss teaser card beside the winner
    const nearMiss = determineNearMiss(winner.rarityTier);
    let nearMissIndex = null;
    if (nearMiss) {
      // Randomly place either immediately to the left (-1) or immediately to the right (+1)
      nearMissIndex = Math.random() < 0.5 ? WINNER_INDEX - 1 : WINNER_INDEX + 1;
    }

    reelTrack.innerHTML = '';
    for (let i = 0; i < TOTAL_ITEMS; i++) {
      let card;
      if (i === START_INDEX) {
        card = previousCard;
      } else if (i === WINNER_INDEX) {
        card = winner;
      } else if (i === nearMissIndex && nearMiss) {
        card = nearMiss.card;
      } else {
        card = pickWeightedCard();
      }
      reelTrack.appendChild(createReelCardElement(card));
    }

    measureDimensions();
    const centerTarget = cachedViewportWidth / 2 - cardTotalWidth / 2;

    const startTranslateX = -(START_INDEX * cardTotalWidth) + centerTarget;
    const finalTranslateX = -(WINNER_INDEX * cardTotalWidth) + centerTarget;

    // Landing offset calculation:
    // If a near-miss is present, bias landing right onto the border of that teaser card!
    let naturalOffset = 0;
    if (nearMiss) {
      const sign = nearMissIndex === WINNER_INDEX - 1 ? 1 : -1;
      naturalOffset = sign * (36 + Math.random() * 20);
    } else {
      const rollType = Math.random();
      const sign = Math.random() < 0.5 ? -1 : 1;
      if (rollType < 0.50) {
        naturalOffset = sign * (2 + Math.random() * 12);
      } else if (rollType < 0.88) {
        naturalOffset = sign * (14 + Math.random() * 20);
      } else {
        naturalOffset = sign * (36 + Math.random() * 16);
      }
    }
    const landingTranslateX = finalTranslateX + naturalOffset;

    reelTrack.classList.add('is-spinning');
    reelTrack.style.transition = 'none';
    reelTrack.style.transform = `translateX(${startTranslateX}px)`;
    currentTranslateX = startTranslateX;
    void reelTrack.offsetWidth;
    reelCurrentX.set(startTranslateX);
    updateReelScales(startTranslateX, true);

    const spinDuration = 3950;
    const easingCurve = 'cubic-bezier(0.05, 0.68, 0.16, 1)';

    spinStartTime = performance.now();
    const needsNudge = Math.abs(naturalOffset) > 4;
    const alignDuration = needsNudge
      ? Math.round(Math.max(160, Math.min(300, 140 + Math.abs(naturalOffset) * 2.5)))
      : 0;
    spinExpectedDuration = $isAutoSkip ? 850 : (spinDuration + alignDuration);

    finalizeRollFn = finalizeRoll;
    resumeSpinFn = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      prevTickTime = performance.now();
      try {
        const matrix = new DOMMatrixReadOnly(window.getComputedStyle(reelTrack).transform);
        prevTranslateX = matrix.m41;
      } catch (e) {}
      if (!rollRafId && $isSpinning) {
        rollRafId = requestAnimationFrame(trackReelTick);
      }
    };

    reelTrack.style.transition = `transform ${spinDuration}ms ${easingCurve}`;
    reelTrack.style.transform = `translateX(${landingTranslateX}px)`;
    currentTranslateX = landingTranslateX;

    let lastCrossedCard = START_INDEX;
    let lastTickAudioTime = 0;
    let prevTranslateX = startTranslateX;
    let prevTickTime = performance.now();
    reelVelocity.set(0);

    function trackReelTick() {
      if (!$isSpinning) return;
      if (typeof document !== 'undefined' && document.hidden) {
        rollRafId = null;
        return;
      }
      try {
        const now = performance.now();
        const matrix = new DOMMatrixReadOnly(window.getComputedStyle(reelTrack).transform);
        const currentX = matrix.m41;
        reelCurrentX.set(currentX);

        const dt = (now - prevTickTime) / 1000;
        if (dt > 0.0001) {
          const rawVel = Math.min(6000, Math.abs(currentX - prevTranslateX) / dt);
          reelVelocity.set(rawVel);
          prevTranslateX = currentX;
          prevTickTime = now;
        }

        const distanceTraversed = centerTarget - currentX;
        const currentCard = Math.floor((distanceTraversed + cardTotalWidth * 0.5) / cardTotalWidth);

        if (currentCard > lastCrossedCard && currentCard <= WINNER_INDEX) {
          const nowTick = performance.now();
          if (nowTick - lastTickAudioTime >= 24) {
            const progress = Math.min(1, (currentCard - START_INDEX) / (WINNER_INDEX - START_INDEX));
            playTickSound(progress);
            lastTickAudioTime = nowTick;
            triggerThrottledHaptic('selection', 28);

            // Near-miss suspense flutter on Mythic or Legendary cards during braking
            if (progress > 0.82) {
              const passingCard = reelTrack.children[currentCard]?._cardData;
              if (passingCard && (passingCard.rarityTier === 'mythic' || passingCard.rarityTier === 'legendary')) {
                playNearMissSound();
                triggerHaptic('light');
              }
            }
          }
          lastCrossedCard = currentCard;
        }

        updateReelScales(currentX);
      } catch (e) {}

      if ($isSpinning) {
        rollRafId = requestAnimationFrame(trackReelTick);
      }
    }
    rollRafId = requestAnimationFrame(trackReelTick);

    function finalizeRoll() {
      clearActiveRollTimers();
      isSpinning.set(false);
      reelVelocity.set(0);
      reelCurrentX.set(null);
      if (reelTrack) {
        reelTrack.classList.remove('is-spinning');
        reelTrack.style.transition = 'none';
        reelTrack.style.transform = `translateX(${finalTranslateX}px)`;
        currentTranslateX = finalTranslateX;
      }

      // Update roll counts and inventory in stores
      gameRolls.update((r) => r + 1);
      let currentInv = {};
      let currentTimes = {};
      let currentUserId = null;
      let currentRolls = 0;
      let currentStarred = null;

      gameInventory.subscribe((v) => (currentInv = v))();
      gameInventoryTimestamps.subscribe((v) => (currentTimes = v))();
      activeUserId.subscribe((v) => (currentUserId = v))();
      gameRolls.subscribe((v) => (currentRolls = v))();
      starredTrackIds.subscribe((v) => (currentStarred = v))();

      const prevCount = currentInv[winner.id] || 0;
      currentInv[winner.id] = prevCount + 1;
      currentTimes[winner.id] = Date.now();

      gameInventory.set({ ...currentInv });
      gameInventoryTimestamps.set({ ...currentTimes });
      saveUserData(currentUserId, currentInv, currentRolls, currentTimes, currentStarred);

      // Arena shockwave
      const isDocHidden = typeof document !== 'undefined' && document.hidden;
      if (!isDocHidden && spinnerMachineWrap) {
        spinnerMachineWrap.classList.remove('impact-shock');
        void spinnerMachineWrap.offsetWidth;
        spinnerMachineWrap.classList.add('impact-shock');
        setTimeout(() => spinnerMachineWrap?.classList.remove('impact-shock'), 300);
      }

      // Winner card highlight
      const allCards = reelTrack.children;
      if (allCards[WINNER_INDEX]) {
        allCards[WINNER_INDEX].classList.remove('winner-landed');
        if (!isDocHidden) void allCards[WINNER_INDEX].offsetWidth;
        allCards[WINNER_INDEX].classList.add('winner-landed');
      }
      updateReelScales(finalTranslateX, true);

      // Audio and haptic effects
      playTierLandingSound(winner.rarityTier);
      playFanfareSound(winner.rarityTier);
      if (winner.rarityTier === 'mythic' || winner.rarityTier === 'legendary') {
        triggerHaptic('heavy');
      } else {
        triggerHaptic('medium');
      }

      // Reveal winner spotlight
      activeWinnerCard.set(winner);
      onRollComplete(winner, prevCount === 0);

      // Auto-Roll chained trigger (immediate continuous mode only; on_track_end mode triggers when audio track ends)
      if ($isAutoRolling && $autoRollMode === 'immediate') {
        autoRollTimer = setTimeout(executeSpin, $isAutoSkip ? 1200 : 3000);
      }

      // Start slow forward drift about 1.35 seconds after aligning to chosen card
      postRollDriftTimer = setTimeout(() => {
        startPostRollDrift();
      }, 1350);
    }

    if ($isAutoSkip) {
      const btnSkip = document.getElementById('btnAutoSkip');
      if (btnSkip) btnSkip.classList.add('is-skipping-active');

      rollAutoSkipTimer = setTimeout(() => {
        rollAutoSkipTimer = null;
        if (typeof document !== 'undefined' && document.hidden) {
          if (btnSkip) btnSkip.classList.remove('is-skipping-active');
          finalizeRoll();
          return;
        }

        const startGlideX = finalTranslateX + 35;
        reelTrack.style.transition = 'none';
        reelTrack.style.transform = `translateX(${startGlideX}px)`;
        currentTranslateX = startGlideX;
        void reelTrack.offsetWidth;

        reelTrack.style.transition = 'transform 100ms cubic-bezier(0.12, 0.9, 0.25, 1)';
        reelTrack.style.transform = `translateX(${finalTranslateX}px)`;
        currentTranslateX = finalTranslateX;

        reelPointerTop?.classList.add('pointer-engaging');
        reelPointerBottom?.classList.add('pointer-engaging');

        playPointerSeekSound();

        rollRegisterTimer = setTimeout(() => {
          rollRegisterTimer = null;
          reelPointerTop?.classList.remove('pointer-engaging');
          reelPointerBottom?.classList.remove('pointer-engaging');

          reelPointerTop?.classList.add('caliper-pinch');
          reelPointerBottom?.classList.add('caliper-pinch');
          setTimeout(() => {
            reelPointerTop?.classList.remove('caliper-pinch');
            reelPointerBottom?.classList.remove('caliper-pinch');
          }, 240);

          reelCenterline?.classList.add('beam-flash');
          setTimeout(() => reelCenterline?.classList.remove('beam-flash'), 160);

          const winningCard = reelTrack.children[WINNER_INDEX];
          if (winningCard) {
            winningCard.classList.add('brake-recoil');
            setTimeout(() => winningCard?.classList.remove('brake-recoil'), 100);
          }

          playMechanicalBrakeSound();
          if (btnSkip) btnSkip.classList.remove('is-skipping-active');
          finalizeRoll();
        }, 100);
      }, 750);
    } else {
      rollNormalEndTimer = setTimeout(() => {
        rollNormalEndTimer = null;
        if (typeof document !== 'undefined' && document.hidden) {
          finalizeRoll();
          return;
        }

        const needsNudge = Math.abs(naturalOffset) > 4;
        const alignDuration = needsNudge
          ? Math.round(Math.max(160, Math.min(300, 140 + Math.abs(naturalOffset) * 2.5)))
          : 0;

        if (needsNudge) {
          reelPointerTop?.classList.add('pointer-engaging');
          reelPointerBottom?.classList.add('pointer-engaging');
          playPointerSeekSound();

          reelTrack.style.transition = `transform ${alignDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          reelTrack.style.transform = `translateX(${finalTranslateX}px)`;
          currentTranslateX = finalTranslateX;
        }

        rollAlignTimer = setTimeout(() => {
          rollAlignTimer = null;
          reelPointerTop?.classList.remove('pointer-engaging');
          reelPointerBottom?.classList.remove('pointer-engaging');

          reelPointerTop?.classList.add('caliper-pinch');
          reelPointerBottom?.classList.add('caliper-pinch');
          setTimeout(() => {
            reelPointerTop?.classList.remove('caliper-pinch');
            reelPointerBottom?.classList.remove('caliper-pinch');
          }, 240);

          reelCenterline?.classList.add('beam-flash');
          setTimeout(() => reelCenterline?.classList.remove('beam-flash'), 160);

          const winningCard = reelTrack.children[WINNER_INDEX];
          if (winningCard) {
            winningCard.classList.add('brake-recoil');
            setTimeout(() => winningCard?.classList.remove('brake-recoil'), 100);
          }

          playMechanicalBrakeSound();
          finalizeRoll();
        }, alignDuration);
      }, spinDuration);
    }
  }

  let reelAudioRafId = null;
  let reelSmoothedBass = 0;
  let reelImpactSpike = 0;
  let currentReelBassScale = 1.0;

  function tickReelAudio() {
    if (typeof document !== 'undefined' && document.hidden) {
      reelAudioRafId = null;
      return;
    }

    const isMobile = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    if (!isMobile) {
      reelAudioRafId = null;
      return;
    }

    if ($isArenaPlaying && !$isSpinning) {
      const metrics = getTargetBassPeakMetrics(20, 150);
      const rawEnergy = metrics.energy;

      if (rawEnergy > reelSmoothedBass) {
        reelSmoothedBass += (rawEnergy - reelSmoothedBass) * 0.48;
      } else {
        reelSmoothedBass += (rawEnergy - reelSmoothedBass) * 0.09;
      }

      if (metrics.peak > reelImpactSpike) {
        reelImpactSpike = metrics.peak;
      } else {
        reelImpactSpike *= 0.86;
      }
    } else {
      reelSmoothedBass *= 0.85;
      reelImpactSpike *= 0.85;
    }

    if (reelSmoothedBass < 0.001) reelSmoothedBass = 0;
    if (reelImpactSpike < 0.001) reelImpactSpike = 0;

    // Punchy tactile scale kick from peak impact + rhythmic swell from sub-bass
    const audioPunch = (reelSmoothedBass * 0.052) + (reelImpactSpike * 0.040);
    const targetScale = 1.0 + audioPunch;
    currentReelBassScale += (targetScale - currentReelBassScale) * 0.35;
    const bassEnergy = Math.max(reelSmoothedBass, reelImpactSpike * 0.85);

    if (reelTrack) {
      const activeCard = reelTrack.querySelector('.reel-card.winner-landed') || reelTrack.children[currentReelIndex];
      if (activeCard) {
        activeCard.style.setProperty('--reel-card-bass-scale', currentReelBassScale.toFixed(4));
        activeCard.style.setProperty('--reel-card-bass-energy', bassEnergy.toFixed(3));
      }
    }

    if ($isArenaPlaying || currentReelBassScale > 1.001 || reelSmoothedBass > 0.001) {
      reelAudioRafId = requestAnimationFrame(tickReelAudio);
    } else {
      reelAudioRafId = null;
    }
  }

  $: if ($isArenaPlaying && !$isSpinning) {
    const isMobile = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    if (isMobile && !reelAudioRafId) {
      reelAudioRafId = requestAnimationFrame(tickReelAudio);
    }
  }

  function handleVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      if (rollRafId) {
        cancelAnimationFrame(rollRafId);
        rollRafId = null;
      }
      if (driftRafId) {
        cancelAnimationFrame(driftRafId);
        driftRafId = null;
      }
      if (reelAudioRafId) {
        cancelAnimationFrame(reelAudioRafId);
        reelAudioRafId = null;
      }
    } else {
      if ($isSpinning && finalizeRollFn) {
        const elapsed = performance.now() - spinStartTime;
        if (elapsed >= spinExpectedDuration) {
          finalizeRollFn();
        } else if (resumeSpinFn) {
          resumeSpinFn();
        }
      } else {
        updateReelScales(currentTranslateX, true);
        if (isDriftingActive && !driftRafId) {
          startPostRollDrift();
        }
        const isMobile = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
        if (isMobile && $isArenaPlaying && !$isSpinning && !reelAudioRafId) {
          reelAudioRafId = requestAnimationFrame(tickReelAudio);
        }
      }
    }
  }

  let reelResizeObserver = null;

  $: if ($isCrateReady && reelTrack && reelViewport) {
    requestAnimationFrame(() => {
      measureDimensions();
      if (!$isSpinning && !driftRafId) {
        recenterReel(currentReelIndex);
      }
    });
  }

  onMount(() => {
    buildInitialReel();
    requestAnimationFrame(() => {
      measureDimensions();
      recenterReel(currentReelIndex);
    });

    if (typeof ResizeObserver !== 'undefined' && reelViewport) {
      reelResizeObserver = new ResizeObserver(() => {
        if (!$isSpinning && !driftRafId) {
          measureDimensions();
          recenterReel(currentReelIndex);
        }
      });
      reelResizeObserver.observe(reelViewport);
    }

    const handleResize = () => {
      if (!$isSpinning && !driftRafId) {
        measureDimensions();
        recenterReel(currentReelIndex);
      }
    };
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (reelResizeObserver) {
        reelResizeObserver.disconnect();
        reelResizeObserver = null;
      }
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearActiveRollTimers();
      if (autoRollTimer) clearTimeout(autoRollTimer);
      if (reelAudioRafId) {
        cancelAnimationFrame(reelAudioRafId);
        reelAudioRafId = null;
      }
    };
  });
</script>

<section class="spinner-machine-wrap" id="spinnerMachineWrap" bind:this={spinnerMachineWrap} aria-label="Slot Carousel Reel">
  <!-- Reticle Target Box & Crosshairs -->
  <div class="reticle-target-box" aria-hidden="true">
    <div class="reticle-corner reticle-tl"></div>
    <div class="reticle-corner reticle-tr"></div>
    <div class="reticle-corner reticle-bl"></div>
    <div class="reticle-corner reticle-br"></div>
    <div class="reticle-crosshair-line reticle-crosshair-left"></div>
    <div class="reticle-crosshair-line reticle-crosshair-right"></div>
  </div>

  <div class="reel-pointer-top" id="reelPointerTop" bind:this={reelPointerTop}></div>
  <div class="reel-pointer-bottom" id="reelPointerBottom" bind:this={reelPointerBottom}></div>
  <div class="reel-centerline" id="reelCenterline" bind:this={reelCenterline}>
    <div class="reel-laser-core"></div>
  </div>

  <div class="reel-viewport" id="reelViewport" bind:this={reelViewport}>
    <div class="reel-track" id="reelTrack" bind:this={reelTrack}>
      <!-- Dynamically populated album cards -->
    </div>
  </div>
</section>
