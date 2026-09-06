<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    rngTracks,
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
    saveUserData,
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
  } from '../lib/audio.js';
  import { isPlaceholderCover, clientArtCache, fetchTrackDetails } from '../lib/artCache.js';

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
      <div class="reel-card-art-wrap">
        <img class="reel-card-art ${isPlaceholder ? 'is-placeholder-art' : ''}" src="${albumCover}" alt="${htmlEscape(card.title)}" loading="lazy" />
        ${playlistCover ? `<img class="reel-card-playlist-badge" src="${playlistCover}" alt="${htmlEscape(card.playlist_name)}" title="Playlist: ${htmlEscape(card.playlist_name)}" loading="lazy" />` : ''}
      </div>
      <div class="reel-card-title" title="${htmlEscape(card.title)}">${htmlEscape(card.title)}</div>
      <div class="reel-card-artist" title="${htmlEscape(card.artist)}">${htmlEscape(card.artist)}</div>
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

  function updateReelScales() {
    if (!reelTrack || !reelViewport) return;
    const cards = reelTrack.children;
    if (!cards.length) return;
    const viewportRect = reelViewport.getBoundingClientRect();
    const centerX = viewportRect.left + viewportRect.width / 2;
    const maxDist = viewportRect.width / 2 + 80;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cardRect = card.getBoundingClientRect();
      const cardCenterX = cardRect.left + cardRect.width / 2;
      const dist = Math.abs(centerX - cardCenterX);
      const normDist = Math.min(dist / maxDist, 1);

      // Parabolic arched bridge drop: y = normDist^2 * 38px
      const translateY = Math.pow(normDist, 2) * 38;

      // Tangential tilt outward
      const direction = cardCenterX < centerX ? -1 : 1;
      const rotateZ = direction * Math.pow(normDist, 1.15) * 7.5;

      const scale = 1 - normDist * 0.26;
      const opacity = Math.max(0.68, 1 - normDist * 0.35);
      const blur = normDist > 0.22 ? Math.pow((normDist - 0.22) / 0.78, 1.35) * 4.2 : 0;

      card.style.setProperty('--card-translate-y', `${translateY.toFixed(2)}px`);
      card.style.setProperty('--card-rotate-z', `${rotateZ.toFixed(2)}deg`);
      card.style.setProperty('--card-scale', scale.toFixed(3));
      card.style.setProperty('--card-opacity', opacity.toFixed(3));
      card.style.setProperty('--card-blur', `${blur.toFixed(2)}px`);
    }
  }

  function recenterReel(index) {
    if (!reelTrack || !reelViewport) return;
    const firstCard = reelTrack.firstElementChild;
    if (!firstCard) return;
    const cardRect = firstCard.getBoundingClientRect();
    const cardStyle = window.getComputedStyle(firstCard);
    const mLeft = parseFloat(cardStyle.marginLeft) || 6;
    const mRight = parseFloat(cardStyle.marginRight) || 6;
    const cardWidth =
      firstCard.offsetWidth > 0 ? firstCard.offsetWidth : cardRect.width > 0 ? cardRect.width : 136;
    const cardTotalWidth = cardWidth + mLeft + mRight;
    const viewportWidth = reelViewport.clientWidth;
    const centerTarget = viewportWidth / 2 - cardTotalWidth / 2;
    const targetX = -(index * cardTotalWidth) + centerTarget;
    reelTrack.style.transition = 'none';
    reelTrack.style.transform = `translateX(${targetX}px)`;
    currentTranslateX = targetX;
    updateReelScales();
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
    reelVelocity.set(0);
    reelCurrentX.set(null);
    if (reelPointerTop) reelPointerTop.classList.remove('pointer-engaging', 'caliper-pinch');
    if (reelPointerBottom) reelPointerBottom.classList.remove('pointer-engaging', 'caliper-pinch');
    if (reelTrack) reelTrack.classList.remove('is-spinning');
  }

  function getCenterCardData() {
    if (!reelTrack || !reelViewport || !reelTrack.children.length) return null;
    const vpRect = reelViewport.getBoundingClientRect();
    const centerX = vpRect.left + vpRect.width / 2;
    let closestCard = null;
    let minDistance = Infinity;

    for (let i = 0; i < reelTrack.children.length; i++) {
      const card = reelTrack.children[i];
      const cardRect = card.getBoundingClientRect();
      const cardCenterX = cardRect.left + cardRect.width / 2;
      const dist = Math.abs(cardCenterX - centerX);
      if (dist < minDistance) {
        minDistance = dist;
        closestCard = card;
      }
    }
    return closestCard ? closestCard._cardData : null;
  }

  function startPostRollDrift() {
    if ($isSpinning || !reelTrack || !reelViewport) return;

    if (driftRafId) {
      cancelAnimationFrame(driftRafId);
      driftRafId = null;
    }

    reelTrack.style.transition = 'none';
    const driftSpeed = 30; // slightly slower pixels per second
    const rampDuration = 1000; // ms to smoothly ease into continuous drift
    const startTime = performance.now();
    let lastTime = startTime;

    // Return the selected winner card back to its original state 1 second after drift begins
    winnerUnselectTimer = setTimeout(() => {
      const landedWinner = reelTrack?.querySelector('.reel-card.winner-landed');
      if (landedWinner) {
        landedWinner.classList.remove('winner-landed');
      }
      winnerUnselectTimer = null;
    }, 1000);

    function driftStep(now) {
      if ($isSpinning || !reelTrack || !reelViewport) {
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
      const lastCard = reelTrack.lastElementChild;
      if (lastCard) {
        const lastRect = lastCard.getBoundingClientRect();
        const vpRect = reelViewport.getBoundingClientRect();
        if (lastRect.right < vpRect.right + 800) {
          const newCard = pickWeightedCard();
          if (newCard) {
            reelTrack.appendChild(createReelCardElement(newCard));
          }
        }
      }

      updateReelScales();
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

    const winner = pickWeightedCard();
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

    const firstCard = reelTrack.firstElementChild;
    const cardRect = firstCard ? firstCard.getBoundingClientRect() : null;
    const cardStyle = firstCard ? window.getComputedStyle(firstCard) : null;
    const mLeft = cardStyle ? parseFloat(cardStyle.marginLeft) || 0 : 6;
    const mRight = cardStyle ? parseFloat(cardStyle.marginRight) || 0 : 6;
    const cardWidth =
      firstCard && firstCard.offsetWidth > 0
        ? firstCard.offsetWidth
        : cardRect && cardRect.width > 0
          ? cardRect.width
          : 136;
    const cardTotalWidth = cardWidth + mLeft + mRight;
    const viewportWidth = reelViewport.clientWidth;
    const centerTarget = viewportWidth / 2 - cardTotalWidth / 2;

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
    updateReelScales();

    const spinDuration = 3950;
    const easingCurve = 'cubic-bezier(0.05, 0.68, 0.16, 1)';

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

            // Near-miss suspense flutter on Mythic or Legendary cards during braking
            if (progress > 0.82) {
              const passingCard = reelTrack.children[currentCard]?._cardData;
              if (passingCard && (passingCard.rarityTier === 'mythic' || passingCard.rarityTier === 'legendary')) {
                playNearMissSound();
              }
            }
          }
          lastCrossedCard = currentCard;
        }

        updateReelScales();
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
      let currentStarred = new Set();

      gameInventory.subscribe((v) => (currentInv = v))();
      gameInventoryTimestamps.subscribe((v) => (currentTimes = v))();
      activeUserId.subscribe((v) => (currentUserId = v))();
      gameRolls.subscribe((v) => (currentRolls = v))();

      const prevCount = currentInv[winner.id] || 0;
      currentInv[winner.id] = prevCount + 1;
      currentTimes[winner.id] = Date.now();

      gameInventory.set({ ...currentInv });
      gameInventoryTimestamps.set({ ...currentTimes });
      saveUserData(currentUserId, currentInv, currentRolls, currentTimes, currentStarred);

      // Arena shockwave
      if (spinnerMachineWrap) {
        spinnerMachineWrap.classList.remove('impact-shock');
        void spinnerMachineWrap.offsetWidth;
        spinnerMachineWrap.classList.add('impact-shock');
        setTimeout(() => spinnerMachineWrap?.classList.remove('impact-shock'), 300);
      }

      // Winner card highlight
      const allCards = reelTrack.children;
      if (allCards[WINNER_INDEX]) {
        allCards[WINNER_INDEX].classList.remove('winner-landed');
        void allCards[WINNER_INDEX].offsetWidth;
        allCards[WINNER_INDEX].classList.add('winner-landed');
      }
      updateReelScales();

      // Audio effects
      playTierLandingSound(winner.rarityTier);
      playFanfareSound(winner.rarityTier);

      // Reveal winner spotlight
      activeWinnerCard.set(winner);
      onRollComplete(winner, prevCount === 0);

      // Auto-Roll chained trigger (immediate continuous mode only; on_track_end mode triggers when audio track ends)
      if ($isAutoRolling && $autoRollMode === 'immediate') {
        autoRollTimer = setTimeout(executeSpin, $isAutoSkip ? 1200 : 3000);
      }

      // Start slow forward drift about 2 seconds after aligning to chosen card
      postRollDriftTimer = setTimeout(() => {
        startPostRollDrift();
      }, 2000);
    }

    if ($isAutoSkip) {
      const btnSkip = document.getElementById('btnAutoSkip');
      if (btnSkip) btnSkip.classList.add('is-skipping-active');

      rollAutoSkipTimer = setTimeout(() => {
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

  onMount(() => {
    buildInitialReel();
    const handleResize = () => {
      if (!$isSpinning && !driftRafId) {
        recenterReel(currentReelIndex);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearActiveRollTimers();
      if (autoRollTimer) clearTimeout(autoRollTimer);
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
