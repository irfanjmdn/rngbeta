<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    rngTracks,
    isSpinning,
    isAutoRolling,
    isAutoSkip,
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
    getAudioContext,
  } from '../lib/audio.js';
  import { isPlaceholderCover, fetchAlbumArt } from '../lib/artCache.js';

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
  let autoRollTimer = null;

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

    div.innerHTML = `
      <div class="reel-card-art-wrap">
        <img class="reel-card-art ${isPlaceholder ? 'is-placeholder-art' : ''}" src="${albumCover}" alt="${htmlEscape(card.title)}" loading="lazy" />
        ${playlistCover ? `<img class="reel-card-playlist-badge" src="${playlistCover}" alt="${htmlEscape(card.playlist_name)}" title="Playlist: ${htmlEscape(card.playlist_name)}" loading="lazy" />` : ''}
      </div>
      <div class="reel-card-title" title="${htmlEscape(card.title)}">${htmlEscape(card.title)}</div>
      <div class="reel-card-artist" title="${htmlEscape(card.artist)}">${htmlEscape(card.artist)}</div>
      <div class="reel-card-tier" style="color:${card.rarityColor};">${htmlEscape(card.rarityName)}</div>
    `;

    if (card.spotify_id && isPlaceholder) {
      const artImg = div.querySelector('.reel-card-art');
      fetchAlbumArt(card.spotify_id).then((url) => {
        if (url && artImg) {
          card.album_cover_url = url;
          artImg.src = url;
          artImg.classList.remove('is-placeholder-art');
        }
      });
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
      const scale = 1 - normDist * 0.3;
      const opacity = 1 - normDist * 0.35;

      card.style.setProperty('--card-scale', scale.toFixed(3));
      card.style.setProperty('--card-opacity', opacity.toFixed(3));
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

  function clearActiveRollTimers() {
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
    if (rollRafId) {
      cancelAnimationFrame(rollRafId);
      rollRafId = null;
    }
    if (reelPointerTop) reelPointerTop.classList.remove('pointer-engaging', 'caliper-pinch');
    if (reelPointerBottom) reelPointerBottom.classList.remove('pointer-engaging', 'caliper-pinch');
    if (reelTrack) reelTrack.classList.remove('is-spinning');
  }

  export function executeSpin() {
    if ($isSpinning || !$rngTracks.length || !reelTrack) return;
    getAudioContext();
    isSpinning.set(true);
    clearActiveRollTimers();

    const previousCard =
      (reelTrack.children[currentReelIndex] && reelTrack.children[currentReelIndex]._cardData) ||
      $activeWinnerCard ||
      pickWeightedCard();

    const winner = pickWeightedCard();
    const START_INDEX = 5;
    const WINNER_INDEX = 65;
    const TOTAL_ITEMS = 75;
    currentReelIndex = WINNER_INDEX;

    reelTrack.innerHTML = '';
    for (let i = 0; i < TOTAL_ITEMS; i++) {
      let card;
      if (i === START_INDEX) {
        card = previousCard;
      } else if (i === WINNER_INDEX) {
        card = winner;
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

    reelTrack.classList.add('is-spinning');
    reelTrack.style.transition = 'none';
    reelTrack.style.transform = `translateX(${startTranslateX}px)`;
    void reelTrack.offsetWidth;
    updateReelScales();

    const spinDuration = 3500;
    const easingCurve = 'cubic-bezier(0.06, 0.72, 0.20, 1)';

    reelTrack.style.transition = `transform ${spinDuration}ms ${easingCurve}`;
    reelTrack.style.transform = `translateX(${finalTranslateX}px)`;

    let lastCrossedCard = START_INDEX;
    let lastTickAudioTime = 0;

    function trackReelTick() {
      if (!$isSpinning) return;
      try {
        const matrix = new DOMMatrixReadOnly(window.getComputedStyle(reelTrack).transform);
        const currentX = matrix.m41;
        const distanceTraversed = centerTarget - currentX;
        const currentCard = Math.floor((distanceTraversed + cardTotalWidth * 0.5) / cardTotalWidth);

        if (currentCard > lastCrossedCard && currentCard <= WINNER_INDEX) {
          const now = performance.now();
          if (now - lastTickAudioTime >= 24) {
            const progress = Math.min(1, (currentCard - START_INDEX) / (WINNER_INDEX - START_INDEX));
            playTickSound(progress);
            lastTickAudioTime = now;
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
      if (reelTrack) reelTrack.classList.remove('is-spinning');

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
      playLandingImpactBass();
      playFanfareSound(winner.rarityTier);

      // Reveal winner spotlight
      activeWinnerCard.set(winner);
      onRollComplete(winner, prevCount === 0);

      // Auto-Roll chained trigger
      if ($isAutoRolling) {
        autoRollTimer = setTimeout(executeSpin, $isAutoSkip ? 1200 : 1800);
      }
    }

    if ($isAutoSkip) {
      const btnSkip = document.getElementById('btnAutoSkip');
      if (btnSkip) btnSkip.classList.add('is-skipping-active');

      rollAutoSkipTimer = setTimeout(() => {
        const startGlideX = finalTranslateX + 35;
        reelTrack.style.transition = 'none';
        reelTrack.style.transform = `translateX(${startGlideX}px)`;
        void reelTrack.offsetWidth;

        reelTrack.style.transition = 'transform 100ms cubic-bezier(0.12, 0.9, 0.25, 1)';
        reelTrack.style.transform = `translateX(${finalTranslateX}px)`;

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
      rollNormalEndTimer = setTimeout(finalizeRoll, spinDuration + 50);
    }
  }

  onMount(() => {
    buildInitialReel();
    const handleResize = () => {
      if (!$isSpinning) {
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
  <div class="reel-pointer-top" id="reelPointerTop" bind:this={reelPointerTop}></div>
  <div class="reel-pointer-bottom" id="reelPointerBottom" bind:this={reelPointerBottom}></div>
  <div class="reel-centerline" id="reelCenterline" bind:this={reelCenterline}></div>

  <div class="reel-viewport" id="reelViewport" bind:this={reelViewport}>
    <div class="reel-track" id="reelTrack" bind:this={reelTrack}>
      <!-- Dynamically populated album cards -->
    </div>
  </div>
</section>
