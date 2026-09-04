/**
 * Spotify Crate RNG - Standalone Client Engine
 * Live SSE Progress, Web Audio Synthesizer, Dynamic Auto Skip with Brake Calipers,
 * and Native Spotify App Playback.
 */

(function () {
  'use strict';

  // --- Web Audio Context ---
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // --- Realistic Sampled Audio Buffers (Tactical Crate Ticker & Mechanical Latch) ---
  const soundBuffers = {};

  async function loadSoundBuffer(name, url) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return null;
      if (soundBuffers[name]) return soundBuffers[name];
      const res = await fetch(url);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      soundBuffers[name] = audioBuffer;
      return audioBuffer;
    } catch (e) {
      return null;
    }
  }

  function preloadRollSounds() {
    loadSoundBuffer('roll_tick', '/sounds/roll_tick.wav');
    loadSoundBuffer('roll_latch', '/sounds/roll_latch.wav');
    loadSoundBuffer('roll_drop', '/sounds/roll_drop.wav');
    loadSoundBuffer('seek_tick', '/sounds/kenney_tick.wav');
  }

  // Preload on initial load
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', () => preloadRollSounds(), { once: true });
    window.addEventListener('keydown', () => preloadRollSounds(), { once: true });
  }

  // --- Game Settings & Audio Volume State ---
  let sfxVolume = 0.8;
  try {
    const savedSfx = localStorage.getItem('crate_sfx_volume');
    if (savedSfx !== null) {
      const parsed = parseFloat(savedSfx);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        sfxVolume = parsed;
      }
    }
  } catch (e) {}

  function playSampledSound(bufferName, { volume = 1.0, playbackRate = 1.0 } = {}) {
    if (sfxVolume <= 0) return false;
    try {
      const ctx = getAudioContext();
      if (!ctx) return false;
      const buffer = soundBuffers[bufferName];
      if (!buffer) return false;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(playbackRate, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(Math.max(0, volume * sfxVolume), ctx.currentTime);

      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(ctx.currentTime);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Seeking audio when needle drops into track on auto-skip
  function playPointerSeekSound() {
    if (sfxVolume <= 0) return;
    const played = playSampledSound('seek_tick', { volume: 0.45, playbackRate: 1.15 });
    if (!played) {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(460, now);
        osc.frequency.exponentialRampToValueAtTime(920, now + 0.08);
        gain.gain.setValueAtTime(0.08 * sfxVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.095);
      } catch (e) {}
    }
  }

  // Mechanical brake snap with tactile registration click
  function playMechanicalBrakeSound() {
    if (sfxVolume <= 0) return;
    const played = playSampledSound('roll_latch', { volume: 0.95, playbackRate: 1.0 });
    if (!played) {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        // 1. Sharp registration click transient (1800Hz -> 600Hz)
        const oscClick = ctx.createOscillator();
        const gainClick = ctx.createGain();
        oscClick.type = 'triangle';
        oscClick.frequency.setValueAtTime(1800, now);
        oscClick.frequency.exponentialRampToValueAtTime(600, now + 0.025);
        gainClick.gain.setValueAtTime(0.35 * sfxVolume, now);
        gainClick.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
        oscClick.connect(gainClick);
        gainClick.connect(ctx.destination);
        oscClick.start(now);
        oscClick.stop(now + 0.025);

        // 2. High transient metallic latch bite (1150Hz -> 320Hz)
        const oscHigh = ctx.createOscillator();
        const gainHigh = ctx.createGain();
        oscHigh.type = 'triangle';
        oscHigh.frequency.setValueAtTime(1150, now);
        oscHigh.frequency.exponentialRampToValueAtTime(320, now + 0.045);
        gainHigh.gain.setValueAtTime(0.28 * sfxVolume, now);
        gainHigh.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        oscHigh.connect(gainHigh);
        gainHigh.connect(ctx.destination);
        oscHigh.start(now);
        oscHigh.stop(now + 0.045);

        // 3. Low-end dampening latch thud (160Hz -> 45Hz)
        const oscLow = ctx.createOscillator();
        const gainLow = ctx.createGain();
        oscLow.type = 'sine';
        oscLow.frequency.setValueAtTime(160, now);
        oscLow.frequency.exponentialRampToValueAtTime(45, now + 0.08);
        gainLow.gain.setValueAtTime(0.4 * sfxVolume, now);
        gainLow.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        oscLow.connect(gainLow);
        gainLow.connect(ctx.destination);
        oscLow.start(now);
        oscLow.stop(now + 0.08);
      } catch (e) {}
    }
  }

  // Deep sub-bass impact thud when landing on a card
  function playLandingImpactBass() {
    if (sfxVolume <= 0) return;
    playSampledSound('roll_drop', { volume: 0.65, playbackRate: 1.0 });
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.18);
      gain.gain.setValueAtTime(0.45 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    } catch (e) {}
  }

  // Client-side album art lazy enrichment
  const clientArtCache = {};

  function isPlaceholderCover(card) {
    if (!card) return true;
    const albumArt = (card.spotify_id && clientArtCache[card.spotify_id]) || card.album_cover_url;
    if (!albumArt) return true;
    if (card.playlist_cover_url && albumArt === card.playlist_cover_url) return true;
    return false;
  }

  async function ensureTrackAlbumArt(card, imgEl) {
    const tid = card.spotify_id;
    if (!tid) return;
    const targetCardId = card.id;
    if (imgEl) {
      imgEl.dataset.expectedTrackId = targetCardId;
    }
    if (clientArtCache[tid]) {
      card.album_cover_url = clientArtCache[tid];
      if (imgEl && imgEl.dataset.expectedTrackId === targetCardId) {
        if (imgEl.src !== clientArtCache[tid]) {
          imgEl.src = clientArtCache[tid];
        }
        if (!isPlaceholderCover(card)) {
          imgEl.classList.remove('is-placeholder-art');
        }
      }
      return;
    }
    try {
      const res = await fetch(`/api/art?id=${encodeURIComponent(tid)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.album_cover_url) {
          clientArtCache[tid] = data.album_cover_url;
          card.album_cover_url = data.album_cover_url;
          if (imgEl && imgEl.dataset.expectedTrackId === targetCardId) {
            imgEl.src = data.album_cover_url;
            if (!isPlaceholderCover(card)) {
              imgEl.classList.remove('is-placeholder-art');
            }
          }
        }
      }
    } catch (e) {}
  }

  // Ticking audio while cards spin past (realistic crate ticker sample with natural deceleration pitch drop)
  function playTickSound(progressOrFreq = 0) {
    if (sfxVolume <= 0) return;
    const p = typeof progressOrFreq === 'number'
      ? (progressOrFreq > 1 ? Math.max(0, Math.min(1, (780 - progressOrFreq) / 240)) : progressOrFreq)
      : 0;
    const pitchRate = Math.max(0.72, Math.min(1.35, 1.22 - p * 0.38));
    const played = playSampledSound('roll_tick', { volume: 0.58, playbackRate: pitchRate });
    if (!played) {
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const freq = 780 - p * 240;
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.025);
        gain.gain.setValueAtTime(0.12 * sfxVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.025);
      } catch (e) {}
    }
  }

  // Sophisticated crystalline acoustic chime when starring a track
  function playStarSound() {
    if (sfxVolume <= 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t0 = ctx.currentTime;

      // Master gain node with warm lowpass filter (removes harsh digital high frequencies)
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(4200, t0);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(sfxVolume, t0);

      filter.connect(masterGain);
      masterGain.connect(ctx.destination);

      // 1. Crystal strike transient ping (tactile glass contact)
      const oscPing = ctx.createOscillator();
      const gainPing = ctx.createGain();
      oscPing.type = 'triangle';
      oscPing.frequency.setValueAtTime(3135.96, t0);
      gainPing.gain.setValueAtTime(0.08, t0);
      gainPing.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
      oscPing.connect(gainPing);
      gainPing.connect(filter);
      oscPing.start(t0);
      oscPing.stop(t0 + 0.05);

      // 2. Fundamental crystal bell resonance: E6 (1318.51 Hz)
      const oscRoot = ctx.createOscillator();
      const gainRoot = ctx.createGain();
      oscRoot.type = 'sine';
      oscRoot.frequency.setValueAtTime(1318.51, t0);
      gainRoot.gain.setValueAtTime(0.001, t0);
      gainRoot.gain.linearRampToValueAtTime(0.24, t0 + 0.004);
      gainRoot.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
      oscRoot.connect(gainRoot);
      gainRoot.connect(filter);
      oscRoot.start(t0);
      oscRoot.stop(t0 + 0.39);

      // 3. Shimmering harmonic fifth: B6 (1975.53 Hz) with micro 24ms stagger
      const tHarmonic = t0 + 0.024;
      const oscHarmonic = ctx.createOscillator();
      const gainHarmonic = ctx.createGain();
      oscHarmonic.type = 'sine';
      oscHarmonic.frequency.setValueAtTime(1975.53, tHarmonic);
      gainHarmonic.gain.setValueAtTime(0.001, tHarmonic);
      gainHarmonic.gain.linearRampToValueAtTime(0.18, tHarmonic + 0.004);
      gainHarmonic.gain.exponentialRampToValueAtTime(0.0001, tHarmonic + 0.32);
      oscHarmonic.connect(gainHarmonic);
      gainHarmonic.connect(filter);
      oscHarmonic.start(tHarmonic);
      oscHarmonic.stop(tHarmonic + 0.33);

      // 4. Warm acoustic sub-resonance: E5 (659.25 Hz)
      const oscWarmth = ctx.createOscillator();
      const gainWarmth = ctx.createGain();
      oscWarmth.type = 'sine';
      oscWarmth.frequency.setValueAtTime(659.25, t0);
      gainWarmth.gain.setValueAtTime(0.001, t0);
      gainWarmth.gain.linearRampToValueAtTime(0.12, t0 + 0.006);
      gainWarmth.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);
      oscWarmth.connect(gainWarmth);
      gainWarmth.connect(filter);
      oscWarmth.start(t0);
      oscWarmth.stop(t0 + 0.37);
    } catch (e) {}
  }

  // Soft tactile acoustic tap when un-starring a track
  function playUnstarSound() {
    if (sfxVolume <= 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, t0);
      osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.04);
      gain.gain.setValueAtTime(0.06 * sfxVolume, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.05);
    } catch (e) {}
  }

  // Tiered fanfare chimes
  function playFanfareSound(tier) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (tier === 'mythic' || tier === 'legendary') {
        const chord = tier === 'mythic' ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [440, 554.37, 659.25, 880];
        chord.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.06);
          gain.gain.setValueAtTime(0, now);
          gain.gain.setValueAtTime(0.2, now + idx * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.8);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.06);
          osc.stop(now + idx * 0.06 + 0.85);
        });
      } else if (tier === 'epic' || tier === 'rare') {
        const chord = [392.00, 493.88, 587.33];
        chord.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.05);
          gain.gain.setValueAtTime(0.15, now + idx * 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.5);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.05);
          osc.stop(now + idx * 0.05 + 0.55);
        });
      } else {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.26);
      }
    } catch (e) {}
  }

  // --- State Variables ---
  let activeUserId = null;
  let RNG_TRACKS = [];
  let gameInventory = {};
  let gameInventoryTimestamps = {};
  let starredTrackIds = new Set();
  let gameRolls = 0;
  let isSpinning = false;
  let isAutoRolling = false;
  let isAutoSkip = false;
  let activeWinnerCard = null;
  let activeArenaTrack = null;
  let activeBinderTrack = null;
  let isDraggingScrubArena = false;
  let isDraggingScrubBinder = false;
  let currentReelIndex = 42;
  let autoRollTimer = null;
  let rollAutoSkipTimer = null;
  let rollRegisterTimer = null;
  let rollNormalEndTimer = null;
  let rollScheduledTimers = [];
  let rollRafId = null;

  // --- DOM References ---
  const onboardingScreen = document.getElementById('onboardingScreen');
  const formFetchProfile = document.getElementById('formFetchProfile');
  const inputProfileUrl = document.getElementById('inputProfileUrl');
  const btnBuildCrate = document.getElementById('btnBuildCrate');
  const btnBuildText = document.getElementById('btnBuildText');
  const btnSpinner = document.getElementById('btnSpinner');
  const btnDemoIrfan = document.getElementById('btnDemoIrfan');
  const chkForceRefresh = document.getElementById('chkForceRefresh');

  const debugDropdown = document.getElementById('debugDropdown');
  const debugStatusDot = document.getElementById('debugStatusDot');
  const debugBadge = document.getElementById('debugBadge');
  const debugTerminal = document.getElementById('debugTerminal');

  const gameArenaScreen = document.getElementById('gameArenaScreen');
  const hudAccountSub = document.getElementById('hudAccountSub');
  const hudMastery = document.getElementById('hudMastery');
  const hudRolls = document.getElementById('hudRolls');
  const hudRarest = document.getElementById('hudRarest');
  const hudBinderCount = document.getElementById('hudBinderCount');
  const btnHudArena = document.getElementById('btnHudArena');
  const btnHudBinder = document.getElementById('btnHudBinder');
  const btnHudRates = document.getElementById('btnHudRates');
  const btnHudSettings = document.getElementById('btnHudSettings');
  const btnSwitchAccount = document.getElementById('btnSwitchAccount');

  const spinnerMachineWrap = document.getElementById('spinnerMachineWrap');
  const reelViewport = document.getElementById('reelViewport');
  const reelTrack = document.getElementById('reelTrack');
  const reelPointerTop = document.getElementById('reelPointerTop');
  const reelPointerBottom = document.getElementById('reelPointerBottom');
  const reelCenterline = document.getElementById('reelCenterline');

  const winnerSpotlight = document.getElementById('winnerSpotlight');
  const winnerArtWrap = document.getElementById('winnerArtWrap');
  const winnerArtImg = document.getElementById('winnerArtImg');
  const winnerArtHoverOverlay = document.getElementById('winnerArtHoverOverlay');
  const winnerArtHoverPlay = document.getElementById('winnerArtHoverPlay');
  const winnerArtHoverPause = document.getElementById('winnerArtHoverPause');
  const winnerPlaylistBadge = document.getElementById('winnerPlaylistBadge');
  const winnerTierPill = document.getElementById('winnerTierPill');
  const winnerTitle = document.getElementById('winnerTitle');
  const winnerArtist = document.getElementById('winnerArtist');
  const winnerSource = document.getElementById('winnerSource');
  const winnerSourceLink = document.getElementById('winnerSourceLink');
  const winnerOdds = document.getElementById('winnerOdds');
  const winnerCountBadge = document.getElementById('winnerCountBadge');
  const winnerSpotifyBtn = document.getElementById('winnerSpotifyBtn');
  const btnWinnerStar = document.getElementById('btnWinnerStar');

  // Winner Spotlight Audio Seeker
  const winnerAudioSeeker = document.getElementById('winnerAudioSeeker');
  const btnWinnerMiniPlay = document.getElementById('btnWinnerMiniPlay');
  const winnerMiniPlayIcon = document.getElementById('winnerMiniPlayIcon');
  const winnerMiniPauseIcon = document.getElementById('winnerMiniPauseIcon');
  const winnerScrubTrack = document.getElementById('winnerScrubTrack');
  const winnerScrubFill = document.getElementById('winnerScrubFill');
  const winnerScrubThumb = document.getElementById('winnerScrubThumb');
  const winnerTimeLabel = document.getElementById('winnerTimeLabel');

  const btnBigRoll = document.getElementById('btnBigRoll');
  const lblRollBtn = document.getElementById('lblRollBtn');
  const btnAutoRoll = document.getElementById('btnAutoRoll');
  const lblAutoRoll = document.getElementById('lblAutoRoll');
  const btnAutoSkip = document.getElementById('btnAutoSkip');
  const lblAutoSkip = document.getElementById('lblAutoSkip');
  const autoSkipSweep = document.getElementById('autoSkipSweep');

  const gameBinderModal = document.getElementById('gameBinderModal');
  const btnCloseBinderModal = document.getElementById('btnCloseBinderModal');
  const binderProgressText = document.getElementById('binderProgressText');
  const binderFilterBar = document.getElementById('binderFilterBar');
  const binderToolbar = document.getElementById('binderToolbar');
  const binderSearchInput = document.getElementById('binderSearchInput');
  const btnClearBinderSearch = document.getElementById('btnClearBinderSearch');
  const binderSortSelect = document.getElementById('binderSortSelect');
  const binderGridFull = document.getElementById('binderGridFull');
  let currentBinderFilter = 'all';

  // Docked Binder Audio Player
  const binderAudioDock = document.getElementById('binderAudioDock');
  const binderDockArt = document.getElementById('binderDockArt');
  const binderDockTitle = document.getElementById('binderDockTitle');
  const binderDockArtist = document.getElementById('binderDockArtist');
  const binderDockTier = document.getElementById('binderDockTier');
  const btnBinderDockPlay = document.getElementById('btnBinderDockPlay');
  const binderDockPlayIcon = document.getElementById('binderDockPlayIcon');
  const binderDockPauseIcon = document.getElementById('binderDockPauseIcon');
  const binderScrubTrack = document.getElementById('binderScrubTrack');
  const binderScrubFill = document.getElementById('binderScrubFill');
  const binderScrubThumb = document.getElementById('binderScrubThumb');
  const binderTimeLabel = document.getElementById('binderTimeLabel');
  const binderDockSpotifyBtn = document.getElementById('binderDockSpotifyBtn');

  const gameRatesModal = document.getElementById('gameRatesModal');
  const btnCloseRatesModal = document.getElementById('btnCloseRatesModal');
  const gameSettingsModal = document.getElementById('gameSettingsModal');
  const btnCloseSettingsModal = document.getElementById('btnCloseSettingsModal');
  const sfxVolumeSlider = document.getElementById('sfxVolumeSlider');
  const sfxVolumeBadge = document.getElementById('sfxVolumeBadge');
  const btnTestSfx = document.getElementById('btnTestSfx');
  const btnTestStarSfx = document.getElementById('btnTestStarSfx');
  const arenaAudioPlayer = document.getElementById('arenaAudioPlayer');
  const binderAudioPlayer = document.getElementById('binderAudioPlayer');

  let logCount = 0;
  function appendDebugLog(message, level = 'info', time = '') {
    logCount++;
    debugBadge.textContent = `${logCount} events`;
    const line = document.createElement('div');
    line.className = `terminal-line ${level}`;
    const timeStr = time ? `[${time}] ` : '';
    line.textContent = `${timeStr}${message}`;
    debugTerminal.appendChild(line);
    debugTerminal.scrollTop = debugTerminal.scrollHeight;
  }

  // --- SSE Profile Fetcher ---
  async function fetchAndBuildCrate(profileUrl, forceRefresh = false) {
    getAudioContext();
    btnBuildCrate.disabled = true;
    btnBuildText.textContent = 'Scanning Profile...';
    btnSpinner.classList.remove('hidden');
    debugStatusDot.className = 'debug-status-dot active';

    appendDebugLog(`Initiating profile request for: ${profileUrl}`, 'system');

    try {
      const response = await fetch('/api/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_url: profileUrl, force_refresh: forceRefresh })
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // Retain remainder

        for (const block of lines) {
          const trimmed = block.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            try {
              const data = JSON.parse(jsonStr);
              handleSseEvent(data);
            } catch (e) {
              console.error('SSE parse error:', e, jsonStr);
            }
          }
        }
      }
    } catch (err) {
      appendDebugLog(`Connection error: ${err.message}`, 'error');
      debugStatusDot.className = 'debug-status-dot error';
      if (debugDropdown) debugDropdown.open = true;
      btnBuildCrate.disabled = false;
      btnBuildText.textContent = 'Fetch & Build Crate';
      btnSpinner.classList.add('hidden');
    }
  }

  function handleSseEvent(ev) {
    if (ev.type === 'log') {
      appendDebugLog(ev.message, ev.level, ev.time);
    } else if (ev.type === 'error') {
      appendDebugLog(`Error: ${ev.message}`, 'error');
      debugStatusDot.className = 'debug-status-dot error';
      if (debugDropdown) debugDropdown.open = true;
      btnBuildCrate.disabled = false;
      btnBuildText.textContent = 'Fetch & Build Crate';
      btnSpinner.classList.add('hidden');
    } else if (ev.type === 'ready') {
      debugStatusDot.className = 'debug-status-dot success';
      btnBuildCrate.disabled = false;
      btnBuildText.textContent = 'Fetch & Build Crate';
      btnSpinner.classList.add('hidden');
      initializeCrateGame(ev);
    }
  }

  // --- Reset Game State on Profile Change ---
  function resetWinnerSpotlight() {
    activeWinnerCard = null;
    activeArenaTrack = null;
    if (winnerSpotlight) {
      winnerSpotlight.className = 'winner-spotlight-box tier-common';
    }
    if (winnerArtImg) {
      delete winnerArtImg.dataset.expectedTrackId;
      winnerArtImg.src = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect width=\'100\' height=\'100\' fill=\'%231e293b\'/%3E%3C/svg%3E';
      winnerArtImg.classList.remove('is-placeholder-art');
    }
    if (winnerPlaylistBadge) {
      winnerPlaylistBadge.style.display = 'none';
      winnerPlaylistBadge.src = '';
    }
    if (winnerAudioSeeker) winnerAudioSeeker.style.display = 'none';
    if (winnerTierPill) {
      winnerTierPill.textContent = 'READY TO ROLL';
      winnerTierPill.style.backgroundColor = '';
      winnerTierPill.style.color = '';
      winnerTierPill.style.border = '';
      winnerTierPill.style.borderColor = '';
    }
    if (winnerTitle) winnerTitle.textContent = 'Press ROLL to Spin Albums';
    if (winnerArtist) winnerArtist.textContent = 'Watch multiple album covers spin past in real-time';
    if (winnerSource) winnerSource.textContent = '-';
    if (winnerSourceLink) {
      winnerSourceLink.removeAttribute('href');
      winnerSourceLink.removeAttribute('data-uri');
      winnerSourceLink.removeAttribute('title');
      winnerSourceLink.style.pointerEvents = 'none';
    }
    if (winnerOdds) winnerOdds.textContent = '-';
    if (winnerCountBadge) winnerCountBadge.textContent = '';
    if (winnerSpotifyBtn) {
      winnerSpotifyBtn.style.display = 'none';
      winnerSpotifyBtn.href = '#';
      winnerSpotifyBtn.removeAttribute('data-uri');
    }
    if (btnWinnerStar) {
      btnWinnerStar.style.display = 'none';
      btnWinnerStar.classList.remove('is-starred');
      const starLabel = btnWinnerStar.querySelector('.star-label');
      if (starLabel) starLabel.textContent = 'Star';
    }
    updateArenaAudioIcons(false);
    syncArenaScrubbers(0, 30);
  }

  function resetBinder() {
    gameInventory = {};
    gameInventoryTimestamps = {};
    starredTrackIds = new Set();
    gameRolls = 0;
    activeBinderTrack = null;
    stopBinderAudio();
    if (binderAudioDock) {
      binderAudioDock.style.display = 'none';
    }
    if (binderDockArt) {
      delete binderDockArt.dataset.expectedTrackId;
    }
    currentBinderFilter = 'all';
    if (binderSearchInput) binderSearchInput.value = '';
    if (btnClearBinderSearch) btnClearBinderSearch.classList.add('hidden');
    if (binderSortSelect) binderSortSelect.value = 'recent-desc';
    if (binderFilterBar) {
      binderFilterBar.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
      const allChip = binderFilterBar.querySelector('.cat-chip[data-filter="all"]');
      if (allChip) allChip.classList.add('active');
    }
    renderBinder('all');
    updateBinderFilterLabels();
    updateGameTelemetry();
  }

  // --- Initialize Crate Game with Loaded Data ---
  function initializeCrateGame(data) {
    activeUserId = data.userId;
    RNG_TRACKS = data.tracks;

    // Reset UI
    resetBinder();
    resetWinnerSpotlight();
    stopOrFadeOutArenaAudio(0);
    stopBinderAudio();

    // Restore saved profile inventory, roll count, timestamps, and starred tracks
    if (activeUserId) {
      try {
        const savedInv = localStorage.getItem(`crate_rng_inv_${activeUserId}`);
        if (savedInv) gameInventory = JSON.parse(savedInv);
        const savedRolls = localStorage.getItem(`crate_rng_rolls_${activeUserId}`);
        if (savedRolls) gameRolls = parseInt(savedRolls, 10) || 0;
        const savedTimes = localStorage.getItem(`crate_rng_times_${activeUserId}`);
        if (savedTimes) gameInventoryTimestamps = JSON.parse(savedTimes);
        const savedStarred = localStorage.getItem(`crate_starred_${activeUserId}`);
        if (savedStarred) starredTrackIds = new Set(JSON.parse(savedStarred));
      } catch (e) {}
    }

    hudAccountSub.textContent = `User: ${activeUserId} \u2022 ${RNG_TRACKS.length} Tracks \u2022 ${data.playlistsCount} Playlists`;
    updateBinderFilterLabels();
    updateGameTelemetry();
    updateRatesModal();

    // Switch screens
    onboardingScreen.classList.add('hidden');
    gameArenaScreen.classList.remove('hidden');

    // Populate initial resting reel
    buildInitialReel();
  }

  function buildInitialReel() {
    reelTrack.innerHTML = '';
    const TOTAL = 30;
    for (let i = 0; i < TOTAL; i++) {
      const card = pickWeightedCard();
      reelTrack.appendChild(createReelCardElement(card));
    }
    currentReelIndex = 15;
    recenterReel(15);
  }

  function pickWeightedCard() {
    if (!RNG_TRACKS.length) return null;
    const totalWeight = RNG_TRACKS.reduce((sum, t) => sum + t.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const t of RNG_TRACKS) {
      if (rand < t.weight) return t;
      rand -= t.weight;
    }
    return RNG_TRACKS[0];
  }

  function createReelCardElement(card) {
    const div = document.createElement('div');
    div._cardData = card;
    div.className = `reel-card tier-${card.rarityTier}`;
    const isPlaceholder = isPlaceholderCover(card);
    const albumCover = card.album_cover_url || card.cover_url || card.playlist_cover_url || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect width=\'100\' height=\'100\' fill=\'%231e293b\'/%3E%3C/svg%3E';
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
      ensureTrackAlbumArt(card, div.querySelector('.reel-card-art'));
    }

    return div;
  }

  function htmlEscape(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Reel Carousel Animation & Dynamic Auto Skip ---
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
    rollScheduledTimers.forEach(id => clearTimeout(id));
    rollScheduledTimers = [];
    if (autoSkipSweep) autoSkipSweep.classList.remove('charging');
    if (btnAutoSkip) btnAutoSkip.classList.remove('is-skipping-active');
    reelPointerTop.classList.remove('pointer-engaging', 'caliper-pinch');
    reelPointerBottom.classList.remove('pointer-engaging', 'caliper-pinch');
    if (reelTrack) reelTrack.classList.remove('is-spinning');
  }

  let arenaAudioFadeInterval = null;
  let binderAudioFadeInterval = null;

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function syncArenaScrubbers(curr, dur) {
    if (!dur || isNaN(dur) || dur <= 0) dur = 30;
    const ratio = Math.max(0, Math.min(1, curr / dur));
    const percentStr = `${(ratio * 100).toFixed(1)}%`;
    const timeStr = `${formatTime(curr)} / ${formatTime(dur)}`;

    if (winnerScrubFill) winnerScrubFill.style.width = percentStr;
    if (winnerScrubThumb) winnerScrubThumb.style.left = percentStr;
    if (winnerTimeLabel) winnerTimeLabel.textContent = timeStr;
    if (winnerScrubTrack) winnerScrubTrack.setAttribute('aria-valuenow', Math.round(curr).toString());
  }

  function syncBinderScrubbers(curr, dur) {
    if (!dur || isNaN(dur) || dur <= 0) dur = 30;
    const ratio = Math.max(0, Math.min(1, curr / dur));
    const percentStr = `${(ratio * 100).toFixed(1)}%`;
    const timeStr = `${formatTime(curr)} / ${formatTime(dur)}`;

    if (binderScrubFill) binderScrubFill.style.width = percentStr;
    if (binderScrubThumb) binderScrubThumb.style.left = percentStr;
    if (binderTimeLabel) binderTimeLabel.textContent = timeStr;
    if (binderScrubTrack) binderScrubTrack.setAttribute('aria-valuenow', Math.round(curr).toString());
  }

  function populateBinderAudioDock(card) {
    if (!card || !binderAudioDock) return;
    binderAudioDock.style.display = 'flex';
    binderDockArt.dataset.expectedTrackId = card.id;
    const isPlaceholder = isPlaceholderCover(card);
    const initialCover = (card.spotify_id && clientArtCache[card.spotify_id]) || card.album_cover_url || card.cover_url || card.playlist_cover_url || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect width=\'100\' height=\'100\' fill=\'%231e293b\'/%3E%3C/svg%3E';
    binderDockArt.src = initialCover;
    binderDockArt.classList.toggle('is-placeholder-art', isPlaceholder);
    if (card.spotify_id && isPlaceholder) {
      ensureTrackAlbumArt(card, binderDockArt);
    }
    binderDockTitle.textContent = card.title;
    binderDockArtist.textContent = card.artist;
    binderDockTier.textContent = card.rarityName;
    binderDockTier.style.color = card.rarityColor;
    binderDockTier.style.borderColor = card.rarityColor;
    binderDockArt.style.borderColor = card.rarityColor || '';
    binderDockArt.style.outline = card.rarityColor ? `2px solid ${card.rarityColor}` : '';
    binderDockArt.style.outlineOffset = '1px';
    if (btnBinderDockPlay && card.rarityColor) {
      btnBinderDockPlay.style.background = card.rarityColor;
      btnBinderDockPlay.style.color = '#FFFFFF';
    }
    if (binderScrubFill && card.rarityColor) {
      binderScrubFill.style.background = card.rarityColor;
    }

    const appUri = card.uri || card.spotify_url;
    if (appUri) {
      binderDockSpotifyBtn.style.display = 'inline-flex';
      binderDockSpotifyBtn.href = appUri;
      binderDockSpotifyBtn.setAttribute('data-uri', appUri);
    } else {
      binderDockSpotifyBtn.style.display = 'none';
    }

    if (!card.preview_url) {
      btnBinderDockPlay.disabled = true;
      btnBinderDockPlay.style.opacity = '0.4';
      binderTimeLabel.textContent = 'No preview';
    } else {
      btnBinderDockPlay.disabled = false;
      btnBinderDockPlay.style.opacity = '1';
    }
  }

  function stopOrFadeOutArenaAudio(durationMs = 750) {
    if (arenaAudioFadeInterval) {
      clearInterval(arenaAudioFadeInterval);
      arenaAudioFadeInterval = null;
    }
    if (!arenaAudioPlayer) return;

    if (durationMs <= 0 || arenaAudioPlayer.paused || arenaAudioPlayer.ended || arenaAudioPlayer.currentTime === 0) {
      try {
        arenaAudioPlayer.pause();
        arenaAudioPlayer.currentTime = 0;
        arenaAudioPlayer.volume = 1;
      } catch (e) {}
      updateArenaAudioIcons(false);
      syncArenaScrubbers(0, arenaAudioPlayer.duration || 30);
      return;
    }

    const startVolume = arenaAudioPlayer.volume || 1;
    const startTime = performance.now();

    arenaAudioFadeInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const currentVol = Math.max(0, startVolume * (1 - progress));

      try {
        arenaAudioPlayer.volume = currentVol;
      } catch (e) {}

      if (progress >= 1) {
        clearInterval(arenaAudioFadeInterval);
        arenaAudioFadeInterval = null;
        try {
          arenaAudioPlayer.pause();
          arenaAudioPlayer.currentTime = 0;
          arenaAudioPlayer.volume = 1;
        } catch (e) {}
        updateArenaAudioIcons(false);
        syncArenaScrubbers(0, arenaAudioPlayer.duration || 30);
      }
    }, 25);
  }

  function playArenaTrack(cardOrUrl, startTime = 0) {
    if (arenaAudioFadeInterval) {
      clearInterval(arenaAudioFadeInterval);
      arenaAudioFadeInterval = null;
    }
    stopBinderAudio();
    if (!arenaAudioPlayer) return;

    let card = null;
    let url = '';

    if (typeof cardOrUrl === 'object' && cardOrUrl !== null) {
      card = cardOrUrl;
      url = card.preview_url || '';
      activeArenaTrack = card;
    } else if (typeof cardOrUrl === 'string') {
      url = cardOrUrl;
      if (activeWinnerCard && activeWinnerCard.preview_url === url) {
        card = activeWinnerCard;
      }
      activeArenaTrack = card || activeWinnerCard;
    }

    if (!url) {
      updateArenaAudioIcons(false);
      return;
    }

    try {
      arenaAudioPlayer.pause();
      arenaAudioPlayer.volume = 1;
      if (arenaAudioPlayer.src !== url) {
        arenaAudioPlayer.src = url;
      }
      arenaAudioPlayer.currentTime = startTime;
      const p = arenaAudioPlayer.play();
      if (p !== undefined) {
        p.then(() => {
          updateArenaAudioIcons(true);
          syncArenaScrubbers(arenaAudioPlayer.currentTime || 0, arenaAudioPlayer.duration || 30);
        }).catch(() => {
          updateArenaAudioIcons(false);
        });
      }
    } catch (e) {
      updateArenaAudioIcons(false);
    }
  }

  function toggleArenaPlayPause() {
    const track = activeArenaTrack || activeWinnerCard;
    if (!track || !track.preview_url || !arenaAudioPlayer) return;

    if (arenaAudioPlayer.paused) {
      stopBinderAudio();
      if (!arenaAudioPlayer.src || !arenaAudioPlayer.src.includes(track.preview_url)) {
        playArenaTrack(track);
      } else {
        arenaAudioPlayer.play()
          .then(() => {
            updateArenaAudioIcons(true);
          })
          .catch(() => {
            updateArenaAudioIcons(false);
          });
      }
    } else {
      arenaAudioPlayer.pause();
      updateArenaAudioIcons(false);
    }
  }

  function stopBinderAudio() {
    stopOrFadeOutBinderAudio(0);
  }

  function stopOrFadeOutBinderAudio(durationMs = 500) {
    if (binderAudioFadeInterval) {
      clearInterval(binderAudioFadeInterval);
      binderAudioFadeInterval = null;
    }
    if (!binderAudioPlayer) return;

    if (durationMs <= 0 || binderAudioPlayer.paused || binderAudioPlayer.ended || binderAudioPlayer.currentTime === 0) {
      try {
        binderAudioPlayer.pause();
        binderAudioPlayer.currentTime = 0;
        binderAudioPlayer.volume = 1;
      } catch (e) {}
      updateBinderAudioIcons(false);
      syncBinderScrubbers(0, binderAudioPlayer.duration || 30);
      return;
    }

    const startVolume = binderAudioPlayer.volume || 1;
    const startTime = performance.now();

    binderAudioFadeInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const currentVol = Math.max(0, startVolume * (1 - progress));

      try {
        binderAudioPlayer.volume = currentVol;
      } catch (e) {}

      if (progress >= 1) {
        clearInterval(binderAudioFadeInterval);
        binderAudioFadeInterval = null;
        try {
          binderAudioPlayer.pause();
          binderAudioPlayer.currentTime = 0;
          binderAudioPlayer.volume = 1;
        } catch (e) {}
        updateBinderAudioIcons(false);
        syncBinderScrubbers(0, binderAudioPlayer.duration || 30);
      }
    }, 25);
  }

  function playBinderTrack(card, startTime = 0) {
    if (binderAudioFadeInterval) {
      clearInterval(binderAudioFadeInterval);
      binderAudioFadeInterval = null;
    }
    stopOrFadeOutArenaAudio(0);
    if (!binderAudioPlayer || !card) return;

    activeBinderTrack = card;
    populateBinderAudioDock(card);

    const url = card.preview_url || '';
    if (!url) {
      updateBinderAudioIcons(false);
      return;
    }

    try {
      binderAudioPlayer.pause();
      binderAudioPlayer.volume = 1;
      if (binderAudioPlayer.src !== url) {
        binderAudioPlayer.src = url;
      }
      binderAudioPlayer.currentTime = startTime;
      const p = binderAudioPlayer.play();
      if (p !== undefined) {
        p.then(() => {
          updateBinderAudioIcons(true);
          syncBinderScrubbers(binderAudioPlayer.currentTime || 0, binderAudioPlayer.duration || 30);
        }).catch(() => {
          updateBinderAudioIcons(false);
        });
      }
    } catch (e) {
      updateBinderAudioIcons(false);
    }
  }

  function toggleBinderPlayPause() {
    const track = activeBinderTrack;
    if (!track || !track.preview_url || !binderAudioPlayer) return;

    if (binderAudioPlayer.paused) {
      stopOrFadeOutArenaAudio(0);
      if (!binderAudioPlayer.src || !binderAudioPlayer.src.includes(track.preview_url)) {
        playBinderTrack(track);
      } else {
        binderAudioPlayer.play()
          .then(() => updateBinderAudioIcons(true))
          .catch(() => updateBinderAudioIcons(false));
      }
    } else {
      binderAudioPlayer.pause();
      updateBinderAudioIcons(false);
    }
  }

  function setupArenaScrubber(trackEl) {
    if (!trackEl) return;

    function handleSeek(e) {
      const rect = trackEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = arenaAudioPlayer.duration || 30;
      const targetTime = ratio * dur;
      syncArenaScrubbers(targetTime, dur);
      if (!isNaN(dur)) {
        arenaAudioPlayer.currentTime = targetTime;
      }
    }

    trackEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      isDraggingScrubArena = true;
      trackEl.classList.add('is-dragging');
      try { trackEl.setPointerCapture(e.pointerId); } catch (_) {}
      handleSeek(e);
    });

    trackEl.addEventListener('pointermove', (e) => {
      if (!isDraggingScrubArena) return;
      handleSeek(e);
    });

    function stopDrag(e) {
      if (!isDraggingScrubArena) return;
      isDraggingScrubArena = false;
      trackEl.classList.remove('is-dragging');
      try { trackEl.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    trackEl.addEventListener('pointerup', stopDrag);
    trackEl.addEventListener('pointercancel', stopDrag);

    trackEl.addEventListener('keydown', (e) => {
      const dur = arenaAudioPlayer.duration || 30;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        arenaAudioPlayer.currentTime = Math.max(0, (arenaAudioPlayer.currentTime || 0) - 3);
        syncArenaScrubbers(arenaAudioPlayer.currentTime, dur);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        arenaAudioPlayer.currentTime = Math.min(dur, (arenaAudioPlayer.currentTime || 0) + 3);
        syncArenaScrubbers(arenaAudioPlayer.currentTime, dur);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleArenaPlayPause();
      }
    });
  }

  function setupBinderScrubber(trackEl) {
    if (!trackEl) return;

    function handleSeek(e) {
      const rect = trackEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur = binderAudioPlayer.duration || 30;
      const targetTime = ratio * dur;
      syncBinderScrubbers(targetTime, dur);
      if (!isNaN(dur)) {
        binderAudioPlayer.currentTime = targetTime;
      }
    }

    trackEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      isDraggingScrubBinder = true;
      trackEl.classList.add('is-dragging');
      try { trackEl.setPointerCapture(e.pointerId); } catch (_) {}
      handleSeek(e);
    });

    trackEl.addEventListener('pointermove', (e) => {
      if (!isDraggingScrubBinder) return;
      handleSeek(e);
    });

    function stopDrag(e) {
      if (!isDraggingScrubBinder) return;
      isDraggingScrubBinder = false;
      trackEl.classList.remove('is-dragging');
      try { trackEl.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    trackEl.addEventListener('pointerup', stopDrag);
    trackEl.addEventListener('pointercancel', stopDrag);

    trackEl.addEventListener('keydown', (e) => {
      const dur = binderAudioPlayer.duration || 30;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        binderAudioPlayer.currentTime = Math.max(0, (binderAudioPlayer.currentTime || 0) - 3);
        syncBinderScrubbers(binderAudioPlayer.currentTime, dur);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        binderAudioPlayer.currentTime = Math.min(dur, (binderAudioPlayer.currentTime || 0) + 3);
        syncBinderScrubbers(binderAudioPlayer.currentTime, dur);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleBinderPlayPause();
      }
    });
  }

  function executeSpin() {
    if (isSpinning || !RNG_TRACKS.length) return;
    getAudioContext();
    isSpinning = true;
    btnBigRoll.classList.add('is-spinning');
    clearActiveRollTimers();

    // Smoothly fade out previous audio preview for 0.75s if playing; stop binder audio
    stopOrFadeOutArenaAudio(750);
    stopBinderAudio();

    // Preserve the card currently resting in center under needle
    const previousCard = (reelTrack.children[currentReelIndex] && reelTrack.children[currentReelIndex]._cardData)
      || activeWinnerCard
      || pickWeightedCard();

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
    const cardWidth = (firstCard && firstCard.offsetWidth > 0) ? firstCard.offsetWidth : (cardRect && cardRect.width > 0 ? cardRect.width : 136);
    const cardTotalWidth = cardWidth + mLeft + mRight;
    const viewportWidth = reelViewport.clientWidth;
    const centerTarget = (viewportWidth / 2) - (cardTotalWidth / 2);

    // Exact alignment under pointer needle (0.00px diff)
    const startTranslateX = - (START_INDEX * cardTotalWidth) + centerTarget;
    const finalTranslateX = - (WINNER_INDEX * cardTotalWidth) + centerTarget;

    // Reset track position to START_INDEX so that the card is level and centered at start
    reelTrack.classList.add('is-spinning');
    reelTrack.style.transition = 'none';
    reelTrack.style.transform = `translateX(${startTranslateX}px)`;
    void reelTrack.offsetWidth;
    updateReelScales();

    const spinDuration = 3500;
    // Faster initial speed, then prolonged smooth deceleration
    const easingCurve = 'cubic-bezier(0.06, 0.72, 0.20, 1)';

    // Start full-speed roll from startTranslateX to finalTranslateX
    reelTrack.style.transition = `transform ${spinDuration}ms ${easingCurve}`;
    reelTrack.style.transform = `translateX(${finalTranslateX}px)`;

    // Synchronize mechanical ticker clicks precisely with visual card movement
    let lastCrossedCard = START_INDEX;
    let lastTickAudioTime = 0;

    function trackReelTick() {
      if (!isSpinning) return;
      try {
        const matrix = new DOMMatrixReadOnly(window.getComputedStyle(reelTrack).transform);
        const currentX = matrix.m41;
        const distanceTraversed = centerTarget - currentX;
        const currentCard = Math.floor((distanceTraversed + (cardTotalWidth * 0.5)) / cardTotalWidth);

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

      if (isSpinning) {
        rollRafId = requestAnimationFrame(trackReelTick);
      }
    }
    rollRafId = requestAnimationFrame(trackReelTick);

    function finalizeRoll() {
      clearActiveRollTimers();
      isSpinning = false;
      reelTrack.classList.remove('is-spinning');
      btnBigRoll.classList.remove('is-spinning');

      gameRolls++;
      const prevCount = gameInventory[winner.id] || 0;
      gameInventory[winner.id] = prevCount + 1;
      gameInventoryTimestamps[winner.id] = Date.now();
      localStorage.setItem(`crate_rng_rolls_${activeUserId}`, gameRolls.toString());
      localStorage.setItem(`crate_rng_inv_${activeUserId}`, JSON.stringify(gameInventory));
      localStorage.setItem(`crate_rng_times_${activeUserId}`, JSON.stringify(gameInventoryTimestamps));

      // 1. Dynamic Arena Shockwave impact
      if (spinnerMachineWrap) {
        spinnerMachineWrap.classList.remove('impact-shock');
        void spinnerMachineWrap.offsetWidth;
        spinnerMachineWrap.classList.add('impact-shock');
        setTimeout(() => spinnerMachineWrap.classList.remove('impact-shock'), 300);
      }

      // 2. Highlight winning card with impact pulse
      const allCards = reelTrack.children;
      if (allCards[WINNER_INDEX]) {
        allCards[WINNER_INDEX].classList.remove('winner-landed');
        void allCards[WINNER_INDEX].offsetWidth;
        allCards[WINNER_INDEX].classList.add('winner-landed');
      }
      updateReelScales();

      // 3. Sub-bass landing impact punch
      playLandingImpactBass();

      // 4. Reveal winner with album cover, playlist badge, and autoplay 30s preview
      showWinnerSpotlight(winner, prevCount === 0);
      updateGameTelemetry();
      playFanfareSound(winner.rarityTier);

      if (isAutoRolling) {
        autoRollTimer = setTimeout(executeSpin, isAutoSkip ? 1200 : 1800);
      }
    }

    // Dynamic Auto Skip with 0.1s Pointer Move Delay and Tactile Click Registration
    if (isAutoSkip) {
      if (autoSkipSweep) autoSkipSweep.classList.add('charging');
      if (btnAutoSkip) btnAutoSkip.classList.add('is-skipping-active');

      rollAutoSkipTimer = setTimeout(() => {
        rollScheduledTimers.forEach(id => clearTimeout(id));
        rollScheduledTimers = [];

        // PHASE 1: Initial 0.1s (100ms) delay - Pointer moves into the track
        // Prepare smooth 35px card glide into exact crosshairs as pointer engages
        const startGlideX = finalTranslateX + 35;
        reelTrack.style.transition = 'none';
        reelTrack.style.transform = `translateX(${startGlideX}px)`;
        void reelTrack.offsetWidth;

        // Animate card smoothly sliding into target over 100ms
        reelTrack.style.transition = 'transform 100ms cubic-bezier(0.12, 0.9, 0.25, 1)';
        reelTrack.style.transform = `translateX(${finalTranslateX}px)`;

        // Pointer moves into the track
        reelPointerTop.classList.add('pointer-engaging');
        reelPointerBottom.classList.add('pointer-engaging');
        playPointerSeekSound();

        // PHASE 2: After 0.1s (100ms) delay, it CLICKS and REGISTERS
        rollRegisterTimer = setTimeout(() => {
          rollRegisterTimer = null;

          // 1. Release engaging and trigger sharp Needle Caliper Pinch snap
          reelPointerTop.classList.remove('pointer-engaging');
          reelPointerBottom.classList.remove('pointer-engaging');

          reelPointerTop.classList.add('caliper-pinch');
          reelPointerBottom.classList.add('caliper-pinch');
          setTimeout(() => {
            reelPointerTop.classList.remove('caliper-pinch');
            reelPointerBottom.classList.remove('caliper-pinch');
          }, 240);

          // 2. Centerline Beam Flash
          reelCenterline.classList.add('beam-flash');
          setTimeout(() => reelCenterline.classList.remove('beam-flash'), 160);

          // 3. Winning card micro-recoil impact
          const winningCard = reelTrack.children[WINNER_INDEX];
          if (winningCard) {
            winningCard.classList.add('brake-recoil');
            setTimeout(() => winningCard.classList.remove('brake-recoil'), 100);
          }

          // 4. Sharp mechanical brake snap sound ("clicks")
          playMechanicalBrakeSound();

          // 5. Finalize and register the roll ("registers")
          if (btnAutoSkip) btnAutoSkip.classList.remove('is-skipping-active');
          finalizeRoll();
        }, 100);
      }, 750);
    } else {
      rollNormalEndTimer = setTimeout(finalizeRoll, spinDuration + 50);
    }
  }

  // --- Winner Spotlight Display ---
  function showWinnerSpotlight(card, isNew) {
    activeWinnerCard = card;
    activeArenaTrack = card;
    winnerSpotlight.className = `winner-spotlight-box tier-${card.rarityTier} pop`;
    const isPlaceholder = isPlaceholderCover(card);
    winnerArtImg.dataset.expectedTrackId = card.id;
    const initialCover = (card.spotify_id && clientArtCache[card.spotify_id]) || card.album_cover_url || card.cover_url || card.playlist_cover_url || 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect width=\'100\' height=\'100\' fill=\'%231e293b\'/%3E%3C/svg%3E';
    winnerArtImg.src = initialCover;
    winnerArtImg.classList.toggle('is-placeholder-art', isPlaceholder);

    // Show playlist cover badge beside playlist name
    if (card.playlist_cover_url) {
      winnerPlaylistBadge.src = card.playlist_cover_url;
      winnerPlaylistBadge.title = `From playlist: ${card.playlist_name}`;
      winnerPlaylistBadge.style.display = 'inline-block';
    } else {
      winnerPlaylistBadge.style.display = 'none';
    }

    // Lazy load true album art if missing
    if (card.spotify_id && isPlaceholder) {
      ensureTrackAlbumArt(card, winnerArtImg);
    }

    winnerTierPill.textContent = card.rarityName.toUpperCase();
    winnerTierPill.style.backgroundColor = card.rarityColor;
    const isLightTier = ['legendary', 'uncommon', 'common'].includes(card.rarityTier);
    winnerTierPill.style.color = isLightTier ? '#080B11' : '#FFFFFF';
    winnerTierPill.style.border = 'none';
    winnerTitle.textContent = card.title;
    winnerArtist.textContent = card.artist;
    winnerSource.textContent = card.playlist_name;
    const pUri = card.playlist_uri || (card.playlist_id ? `spotify:playlist:${card.playlist_id}` : null);
    const pUrl = card.playlist_url || (card.playlist_id ? `https://open.spotify.com/playlist/${card.playlist_id}` : '#');
    if (winnerSourceLink) {
      if (pUri || pUrl) {
        winnerSourceLink.href = pUri || pUrl;
        winnerSourceLink.setAttribute('data-uri', pUri || '');
        winnerSourceLink.title = `Open playlist '${card.playlist_name}' in Spotify app`;
        winnerSourceLink.style.pointerEvents = 'auto';
      } else {
        winnerSourceLink.removeAttribute('href');
        winnerSourceLink.removeAttribute('data-uri');
        winnerSourceLink.removeAttribute('title');
        winnerSourceLink.style.pointerEvents = 'none';
      }
    }
    winnerOdds.textContent = card.dropChance;
    winnerCountBadge.textContent = isNew ? 'FIRST SEEN' : 'DUPLICATE';

    // Star button state
    if (btnWinnerStar) {
      btnWinnerStar.style.display = 'inline-flex';
      const isStarred = starredTrackIds.has(card.id);
      btnWinnerStar.classList.toggle('is-starred', isStarred);
      const starLabel = btnWinnerStar.querySelector('.star-label');
      if (starLabel) starLabel.textContent = isStarred ? 'Starred' : 'Star';
    }

    // Native Spotify App URI
    const targetUri = card.uri || card.spotify_url;
    if (targetUri) {
      winnerSpotifyBtn.style.display = 'inline-flex';
      winnerSpotifyBtn.href = targetUri;
      winnerSpotifyBtn.setAttribute('data-uri', targetUri);
      winnerSpotifyBtn.title = `Play '${card.title}' in Spotify app`;
    } else {
      winnerSpotifyBtn.style.display = 'none';
    }

    // 30s Audio Preview Autoplay on Landing
    if (card.preview_url) {
      winnerAudioSeeker.style.display = 'flex';
      playArenaTrack(card);
    } else {
      winnerAudioSeeker.style.display = 'none';
      updateArenaAudioIcons(false);
    }
  }

  function updateArenaAudioIcons(isPlaying) {
    const playDisplay = isPlaying ? 'none' : 'block';
    const pauseDisplay = isPlaying ? 'block' : 'none';

    if (winnerMiniPlayIcon && winnerMiniPauseIcon) {
      winnerMiniPlayIcon.classList.toggle('hidden', isPlaying);
      winnerMiniPauseIcon.classList.toggle('hidden', !isPlaying);
      winnerMiniPlayIcon.style.display = playDisplay;
      winnerMiniPauseIcon.style.display = pauseDisplay;
    }

    if (winnerArtHoverPlay && winnerArtHoverPause) {
      winnerArtHoverPlay.classList.toggle('hidden', isPlaying);
      winnerArtHoverPause.classList.toggle('hidden', !isPlaying);
      winnerArtHoverPlay.style.display = playDisplay;
      winnerArtHoverPause.style.display = pauseDisplay;
    }
  }

  function updateBinderAudioIcons(isPlaying) {
    const playDisplay = isPlaying ? 'none' : 'block';
    const pauseDisplay = isPlaying ? 'block' : 'none';

    // Binder dock play button
    if (binderDockPlayIcon && binderDockPauseIcon) {
      binderDockPlayIcon.classList.toggle('hidden', isPlaying);
      binderDockPauseIcon.classList.toggle('hidden', !isPlaying);
      binderDockPlayIcon.style.display = playDisplay;
      binderDockPauseIcon.style.display = pauseDisplay;
    }

    // Binder grid tiles
    if (binderGridFull) {
      const selectedId = activeBinderTrack ? activeBinderTrack.id : null;
      binderGridFull.querySelectorAll('.binder-tile').forEach(tile => {
        const matchesPlaying = tile.dataset.cardId && tile.dataset.cardId === selectedId && isPlaying;
        const matchesSelected = tile.dataset.cardId && tile.dataset.cardId === selectedId;
        tile.classList.toggle('is-playing-card', Boolean(matchesPlaying));
        tile.classList.toggle('is-selected-card', Boolean(matchesSelected));
        const hint = tile.querySelector('.binder-tile-play-hint');
        if (hint) {
          hint.title = matchesPlaying ? 'Pause preview' : 'Play preview in Binder';
          hint.innerHTML = matchesPlaying
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="${activeBinderTrack ? (activeBinderTrack.rarityColor || 'white') : 'white'}"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
        }
      });
    }
  }

  // --- Telemetry & Binder ---
  function updateGameTelemetry() {
    const unlockedCount = Object.keys(gameInventory).length;
    hudMastery.textContent = `${unlockedCount} / ${RNG_TRACKS.length}`;
    hudRolls.textContent = gameRolls.toString();
    hudBinderCount.textContent = unlockedCount.toString();
    binderProgressText.textContent = `${unlockedCount} / ${RNG_TRACKS.length} Unlocked (${Math.round((unlockedCount / (RNG_TRACKS.length || 1)) * 100)}%)`;

    let highestTierRank = 0;
    let rarestName = '-';
    const tierRanks = { 'common': 1, 'uncommon': 2, 'rare': 3, 'epic': 4, 'legendary': 5, 'mythic': 6 };
    Object.keys(gameInventory).forEach(id => {
      const item = RNG_TRACKS.find(t => t.id === id);
      if (item && tierRanks[item.rarityTier] > highestTierRank) {
        highestTierRank = tierRanks[item.rarityTier];
        rarestName = item.rarityName;
      }
    });
    hudRarest.textContent = rarestName;
  }

  function updateRatesModal() {
    const ratesList = document.getElementById('ratesList');
    if (!ratesList) return;

    if (!RNG_TRACKS.length) {
      return;
    }

    const totalTracks = RNG_TRACKS.length;
    const totalWeight = RNG_TRACKS.reduce((sum, t) => sum + (t.weight || 0), 0);

    const tierOrder = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
    const tierMeta = {
      mythic: { name: 'Mythic', color: 'var(--tier-mythic)', desc: 'Exclusive' },
      legendary: { name: 'Legendary', color: 'var(--tier-legendary)', desc: 'Curated' },
      epic: { name: 'Epic', color: 'var(--tier-epic)', desc: 'Mid-size' },
      rare: { name: 'Rare', color: 'var(--tier-rare)', desc: 'Rotation' },
      uncommon: { name: 'Uncommon', color: 'var(--tier-uncommon)', desc: 'Popular' },
      common: { name: 'Common', color: 'var(--tier-common)', desc: 'Frequent' }
    };

    const tierTracks = {};
    const tierWeights = {};
    tierOrder.forEach(t => { tierTracks[t] = 0; tierWeights[t] = 0; });

    RNG_TRACKS.forEach(t => {
      const tier = t.rarityTier;
      if (tierTracks[tier] !== undefined) {
        tierTracks[tier]++;
        tierWeights[tier] += (t.weight || 0);
      }
    });

    ratesList.innerHTML = '';
    tierOrder.forEach(tier => {
      const meta = tierMeta[tier];
      const count = tierTracks[tier] || 0;
      const weight = tierWeights[tier] || 0;
      const rollProb = totalWeight > 0 ? (weight / totalWeight) : 0;
      const rollPct = (rollProb * 100).toFixed(1);
      const oddsNum = rollProb > 0 ? Math.round(1 / rollProb) : 0;
      const oddsText = oddsNum > 0 ? `1 in ${oddsNum.toLocaleString()} (${rollPct}%)` : '-';

      const row = document.createElement('div');
      row.className = 'rates-row';
      row.innerHTML = `
        <span class="tier-label-badge" style="background: rgba(255, 255, 255, 0.08); color: ${meta.color}; border: 1px solid ${meta.color};">${meta.name}</span>
        <span class="rates-desc">${meta.desc} &bull; <strong style="color: var(--text-main);">${count} tracks</strong></span>
        <strong class="rates-odds" style="color: ${meta.color};">${oddsText}</strong>
      `;
      ratesList.appendChild(row);
    });

    const ratesNote = document.getElementById('ratesNote');
    if (ratesNote) {
      ratesNote.textContent = `Rates calibrated dynamically from ${activeUserId ? activeUserId : 'user'}'s crate (${totalTracks} tracks across all playlists).`;
    }
  }

  function toggleTrackStarred(trackId, triggerEl = null) {
    if (!trackId) return;
    const wasStarred = starredTrackIds.has(trackId);
    if (wasStarred) {
      starredTrackIds.delete(trackId);
      playUnstarSound();
    } else {
      starredTrackIds.add(trackId);
      playStarSound();
    }
    const isStarred = !wasStarred;
    if (activeUserId) {
      try {
        localStorage.setItem(`crate_starred_${activeUserId}`, JSON.stringify([...starredTrackIds]));
      } catch (e) {}
    }
    // Update star button UI in spotlight
    if (btnWinnerStar && activeWinnerCard && activeWinnerCard.id === trackId) {
      btnWinnerStar.classList.toggle('is-starred', isStarred);
      const starLabel = btnWinnerStar.querySelector('.star-label');
      if (starLabel) starLabel.textContent = isStarred ? 'Starred' : 'Star';
      if (isStarred) {
        btnWinnerStar.classList.remove('star-animating');
        void btnWinnerStar.offsetWidth;
        btnWinnerStar.classList.add('star-animating');
      }
    }
    if (triggerEl && isStarred) {
      triggerEl.classList.remove('star-animating');
      void triggerEl.offsetWidth;
      triggerEl.classList.add('star-animating');
    }
    updateBinderFilterLabels();
    // If binder is open, re-render to update star buttons on tiles
    if (gameBinderModal && (gameBinderModal.classList.contains('open') || gameBinderModal.open)) {
      renderBinder(currentBinderFilter);
    }
  }

  function updateBinderFilterLabels() {
    const unlockedIds = Object.keys(gameInventory);
    const unlockedCards = RNG_TRACKS.filter(t => unlockedIds.includes(t.id));
    const starredCount = unlockedCards.filter(t => starredTrackIds.has(t.id)).length;

    const tierCounts = {
      all: unlockedCards.length,
      starred: starredCount,
      mythic: unlockedCards.filter(t => t.rarityTier === 'mythic').length,
      legendary: unlockedCards.filter(t => t.rarityTier === 'legendary').length,
      epic: unlockedCards.filter(t => t.rarityTier === 'epic').length,
      rare: unlockedCards.filter(t => t.rarityTier === 'rare').length,
      uncommon: unlockedCards.filter(t => t.rarityTier === 'uncommon').length,
      common: unlockedCards.filter(t => t.rarityTier === 'common').length,
    };

    binderFilterBar.querySelectorAll('.cat-chip').forEach(chip => {
      const f = chip.getAttribute('data-filter');
      const count = tierCounts[f] !== undefined ? tierCounts[f] : 0;
      if (f === 'starred') {
        chip.innerHTML = `★ Starred (<span id="binderCatStarredCount">${count}</span>)`;
        chip.classList.toggle('empty-tier', count === 0);
        return;
      }
      const baseName = {
        all: 'All Cards',
        mythic: 'Mythic (0.5%)',
        legendary: 'Legendary (2.5%)',
        epic: 'Epic (7.0%)',
        rare: 'Rare (14.0%)',
        uncommon: 'Uncommon (26.0%)',
        common: 'Common (50.0%)'
      }[f] || f;

      chip.textContent = `${baseName} (${count})`;
      chip.classList.toggle('empty-tier', count === 0 && f !== 'all');
    });
  }

  function renderBinder(filter = currentBinderFilter) {
    currentBinderFilter = filter;
    binderGridFull.innerHTML = '';
    const unlockedIds = Object.keys(gameInventory);

    let displayed = RNG_TRACKS.filter(t => unlockedIds.includes(t.id));
    if (filter === 'starred') {
      displayed = displayed.filter(t => starredTrackIds.has(t.id));
    } else if (filter !== 'all') {
      displayed = displayed.filter(t => t.rarityTier === filter);
    }

    const searchQuery = (binderSearchInput ? binderSearchInput.value : '').trim().toLowerCase();
    if (searchQuery) {
      displayed = displayed.filter(t => {
        const titleMatch = (t.title || '').toLowerCase().includes(searchQuery);
        const artistMatch = (t.artist || '').toLowerCase().includes(searchQuery);
        const playlistMatch = (t.playlist_name || '').toLowerCase().includes(searchQuery);
        return titleMatch || artistMatch || playlistMatch;
      });
    }

    if (btnClearBinderSearch) {
      btnClearBinderSearch.classList.toggle('hidden', !searchQuery);
    }

    if (displayed.length === 0) {
      const hasAnyUnlocked = unlockedIds.length > 0;
      let emptyTitle = '';
      let emptyText = '';
      let actionButton = '';

      if (searchQuery) {
        emptyTitle = 'No matching tracks found';
        emptyText = `No unlocked tracks match "${htmlEscape(searchQuery)}". Try another search or clear the filter.`;
        actionButton = `<button class="btn-empty-reset" id="btnEmptyClearSearch" type="button">Clear Search</button>`;
      } else if (filter === 'starred') {
        emptyTitle = 'No starred tracks yet';
        emptyText = 'Click the star icon on any card in the spotlight or binder to save your favorites!';
        actionButton = hasAnyUnlocked
          ? `<button class="btn-empty-reset" id="btnEmptyReset" type="button">Show All Unlocked (${unlockedIds.length})</button>`
          : `<button class="btn-empty-reset" id="btnEmptyGoArena" type="button">Spin in Arena</button>`;
      } else if (filter !== 'all') {
        emptyTitle = `No ${filter} cards unlocked yet`;
        emptyText = `Spin crates in the Arena to discover and unlock ${filter} rarity tracks!`;
        actionButton = hasAnyUnlocked
          ? `<button class="btn-empty-reset" id="btnEmptyReset" type="button">Show All Unlocked (${unlockedIds.length})</button>`
          : `<button class="btn-empty-reset" id="btnEmptyGoArena" type="button">Spin in Arena</button>`;
      } else {
        emptyTitle = 'No cards unlocked yet';
        emptyText = 'Spin crates in the Arena to discover and unlock tracks for your binder!';
        actionButton = `<button class="btn-empty-reset" id="btnEmptyGoArena" type="button">Spin in Arena</button>`;
      }

      binderGridFull.innerHTML = `
        <div class="binder-empty-card">
          <div class="binder-empty-icon">&#128451;</div>
          <div class="binder-empty-title">${emptyTitle}</div>
          <div class="binder-empty-text">${emptyText}</div>
          ${actionButton}
        </div>
      `;
      const btnClearSearch = document.getElementById('btnEmptyClearSearch');
      if (btnClearSearch) {
        btnClearSearch.addEventListener('click', () => {
          if (binderSearchInput) binderSearchInput.value = '';
          if (btnClearBinderSearch) btnClearBinderSearch.classList.add('hidden');
          renderBinder(currentBinderFilter);
          if (binderSearchInput) binderSearchInput.focus();
        });
      }
      const btnReset = document.getElementById('btnEmptyReset');
      if (btnReset) {
        btnReset.addEventListener('click', () => {
          binderFilterBar.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
          const allChip = binderFilterBar.querySelector('.cat-chip[data-filter="all"]');
          if (allChip) allChip.classList.add('active');
          renderBinder('all');
        });
      }
      const btnGoArena = document.getElementById('btnEmptyGoArena');
      if (btnGoArena) {
        btnGoArena.addEventListener('click', closeBinderModal);
      }
      return;
    }

    const tierOrder = { 'mythic': 6, 'legendary': 5, 'epic': 4, 'rare': 3, 'uncommon': 2, 'common': 1 };
    const sortMode = binderSortSelect ? binderSortSelect.value : 'rarity-desc';

    displayed.sort((a, b) => {
      if (sortMode === 'rarity-desc') {
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
        const diff = (gameInventory[b.id] || 0) - (gameInventory[a.id] || 0);
        if (diff !== 0) return diff;
        return (tierOrder[b.rarityTier] || 0) - (tierOrder[a.rarityTier] || 0);
      }
      return 0;
    });

    displayed.forEach(card => {
      const count = gameInventory[card.id];
      const tile = document.createElement('div');
      const isCardPlaying = activeBinderTrack && activeBinderTrack.id === card.id && binderAudioPlayer && !binderAudioPlayer.paused;
      const isCardSelected = activeBinderTrack && activeBinderTrack.id === card.id;
      tile.className = `binder-tile tier-${card.rarityTier}${isCardPlaying ? ' is-playing-card' : ''}${isCardSelected ? ' is-selected-card' : ''}`;
      tile.dataset.cardId = card.id;
      const appUri = card.uri || card.spotify_url;

      const isPlaceholder = isPlaceholderCover(card);
      const albumCover = (card.spotify_id && clientArtCache[card.spotify_id]) || card.album_cover_url || card.cover_url || card.playlist_cover_url || '';
      const playlistCover = card.playlist_cover_url || '';
      const isStarred = starredTrackIds.has(card.id);

      tile.innerHTML = `
        <div class="binder-tile-art-wrap">
          <img class="binder-tile-art ${isPlaceholder ? 'is-placeholder-art' : ''}" src="${albumCover}" alt="${htmlEscape(card.title)}" loading="lazy" />
          <button class="binder-card-star-btn ${isStarred ? 'is-starred' : ''}" data-star-id="${card.id}" type="button" aria-label="Star track" title="${isStarred ? 'Starred track' : 'Star this track'}">★</button>
          <span class="binder-tile-count">x${count}</span>
          ${playlistCover ? `<img class="binder-tile-playlist-badge" src="${playlistCover}" alt="Playlist" title="From playlist: ${htmlEscape(card.playlist_name)}" loading="lazy" />` : ''}
          ${card.preview_url ? `
            <div class="binder-tile-play-hint" title="${isCardPlaying ? 'Pause preview' : 'Play preview in Binder'}">
              ${isCardPlaying ? `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${card.rarityColor || 'white'}"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              ` : `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              `}
            </div>
          ` : ''}
        </div>
        <div class="binder-tile-title" title="${htmlEscape(card.title)}">${htmlEscape(card.title)}</div>
        <div class="binder-tile-artist" title="${htmlEscape(card.artist)}">${htmlEscape(card.artist)}</div>
        ${appUri ? `
          <a class="btn-binder-spotify" href="${appUri}" title="Play in Spotify app" onclick="event.stopPropagation(); window.location.href = '${appUri}'; return false;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.502 17.31c-.218.358-.68.472-1.038.254-2.846-1.738-6.427-2.13-10.648-1.167-.406.094-.813-.16-.906-.566-.094-.406.16-.813.566-.906 4.628-1.057 8.583-.615 11.77 1.332.358.218.472.68.256 1.053zm1.47-3.26c-.274.444-.86.588-1.304.314-3.259-2.003-8.228-2.583-12.083-1.413-.497.15-1.028-.135-1.178-.632-.15-.497.135-1.028.632-1.178 4.412-1.34 9.897-.692 13.62 1.599.444.274.588.86.314 1.31zm.126-3.393c-3.908-2.321-10.354-2.535-14.093-1.398-.598.182-1.233-.162-1.415-.76-.182-.598.162-1.233.76-1.415 4.301-1.306 11.418-1.054 15.908 1.611.538.319.715 1.02.396 1.558-.319.538-1.02.715-1.558.396z"/>
            </svg>
            <span>Listen on Spotify</span>
          </a>
        ` : ''}
      `;

      if (card.spotify_id && isPlaceholder) {
        const tileImg = tile.querySelector('.binder-tile-art');
        if (tileImg) tileImg.dataset.expectedTrackId = card.id;
        ensureTrackAlbumArt(card, tileImg);
      }

      const starBtn = tile.querySelector('.binder-card-star-btn');
      if (starBtn) {
        starBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleTrackStarred(card.id, starBtn);
        });
      }

      tile.addEventListener('click', () => {
        // If clicking currently playing track, toggle play/pause
        if (activeBinderTrack && activeBinderTrack.id === card.id && card.preview_url) {
          toggleBinderPlayPause();
          return;
        }

        activeBinderTrack = card;
        populateBinderAudioDock(card);
        updateBinderAudioIcons(Boolean(card.preview_url));

        if (card.preview_url) {
          playBinderTrack(card);
        } else {
          stopBinderAudio();
        }
      });

      binderGridFull.appendChild(tile);
    });
  }

  function updateReelScales() {
    if (!reelTrack || !reelViewport) return;
    const cards = reelTrack.children;
    if (!cards.length) return;
    const viewportRect = reelViewport.getBoundingClientRect();
    const centerX = viewportRect.left + (viewportRect.width / 2);
    const maxDist = (viewportRect.width / 2) + 80;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cardRect = card.getBoundingClientRect();
      const cardCenterX = cardRect.left + (cardRect.width / 2);
      const dist = Math.abs(centerX - cardCenterX);
      const normDist = Math.min(dist / maxDist, 1);
      // Center card is 1.0 (or 1.08 with pulse), edges scale down smoothly to 0.70
      const scale = 1 - (normDist * 0.30);
      // Edge cards dim slightly to 0.65 opacity for extra depth
      const opacity = 1 - (normDist * 0.35);

      card.style.setProperty('--card-scale', scale.toFixed(3));
      card.style.setProperty('--card-opacity', opacity.toFixed(3));
    }
  }

  function recenterReel(index) {
    const firstCard = reelTrack.firstElementChild;
    if (!firstCard) return;
    const cardRect = firstCard.getBoundingClientRect();
    const cardStyle = window.getComputedStyle(firstCard);
    const mLeft = parseFloat(cardStyle.marginLeft) || 6;
    const mRight = parseFloat(cardStyle.marginRight) || 6;
    const cardWidth = (firstCard && firstCard.offsetWidth > 0) ? firstCard.offsetWidth : (cardRect && cardRect.width > 0 ? cardRect.width : 136);
    const cardTotalWidth = cardWidth + mLeft + mRight;
    const viewportWidth = reelViewport.clientWidth;
    const centerTarget = (viewportWidth / 2) - (cardTotalWidth / 2);
    const targetX = - (index * cardTotalWidth) + centerTarget;
    reelTrack.style.transition = 'none';
    reelTrack.style.transform = `translateX(${targetX}px)`;
    updateReelScales();
  }

  // --- Event Listeners ---
  formFetchProfile.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = inputProfileUrl.value.trim();
    if (!url) return;
    fetchAndBuildCrate(url, chkForceRefresh.checked);
  });

  btnDemoIrfan.addEventListener('click', () => {
    inputProfileUrl.value = 'https://open.spotify.com/user/2jp1yf3h1h49zye21bxnxk0w5';
    fetchAndBuildCrate(inputProfileUrl.value, false);
  });

  btnBigRoll.addEventListener('click', executeSpin);

  btnAutoRoll.addEventListener('click', () => {
    isAutoRolling = !isAutoRolling;
    btnAutoRoll.classList.toggle('active', isAutoRolling);
    btnBigRoll.classList.toggle('is-auto-rolling', isAutoRolling);
    btnAutoRoll.setAttribute('aria-pressed', isAutoRolling ? 'true' : 'false');
    btnAutoRoll.title = isAutoRolling ? 'Auto-Roll: ON (Click to stop)' : 'Auto-Roll (Lock continuous spinning)';
    if (lblAutoRoll) lblAutoRoll.textContent = isAutoRolling ? 'Auto-Roll: ON' : 'Auto-Roll: OFF';
    if (isAutoRolling && !isSpinning) {
      executeSpin();
    } else if (!isAutoRolling && autoRollTimer) {
      clearTimeout(autoRollTimer);
      autoRollTimer = null;
    }
  });

  btnAutoSkip.addEventListener('click', () => {
    isAutoSkip = !isAutoSkip;
    btnAutoSkip.classList.toggle('active', isAutoSkip);
    btnAutoSkip.setAttribute('aria-pressed', isAutoSkip ? 'true' : 'false');
    btnAutoSkip.title = isAutoSkip ? 'Auto Skip: ON (Click to disable)' : 'Auto Skip (Snap immediately at 0.75s)';
    if (lblAutoSkip) lblAutoSkip.textContent = isAutoSkip ? 'Auto Skip: ON' : 'Auto Skip: OFF';
  });

  winnerSpotifyBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const uri = winnerSpotifyBtn.getAttribute('data-uri') || (activeWinnerCard ? (activeWinnerCard.uri || activeWinnerCard.spotify_url) : '');
    if (uri) {
      window.location.href = uri;
    }
  });

  if (winnerSourceLink) {
    winnerSourceLink.addEventListener('click', (e) => {
      const uri = winnerSourceLink.getAttribute('data-uri');
      if (uri) {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = uri;
      }
    });
  }

  if (btnWinnerStar) {
    btnWinnerStar.addEventListener('click', () => {
      if (activeWinnerCard) toggleTrackStarred(activeWinnerCard.id, btnWinnerStar);
    });
  }

  if (winnerArtWrap) {
    winnerArtWrap.addEventListener('click', toggleArenaPlayPause);
    winnerArtWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleArenaPlayPause();
      }
    });
  }

  if (binderDockArt) {
    binderDockArt.addEventListener('click', toggleBinderPlayPause);
  }

  if (btnWinnerMiniPlay) btnWinnerMiniPlay.addEventListener('click', toggleArenaPlayPause);
  if (btnBinderDockPlay) btnBinderDockPlay.addEventListener('click', toggleBinderPlayPause);

  if (binderDockSpotifyBtn) {
    binderDockSpotifyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const uri = binderDockSpotifyBtn.getAttribute('data-uri') || (activeBinderTrack ? (activeBinderTrack.uri || activeBinderTrack.spotify_url) : '');
      if (uri) {
        window.location.href = uri;
      }
    });
  }

  setupArenaScrubber(winnerScrubTrack);
  setupBinderScrubber(binderScrubTrack);

  arenaAudioPlayer.addEventListener('timeupdate', () => {
    if (!isDraggingScrubArena) {
      syncArenaScrubbers(arenaAudioPlayer.currentTime || 0, arenaAudioPlayer.duration || 30);
    }
  });

  arenaAudioPlayer.addEventListener('loadedmetadata', () => {
    syncArenaScrubbers(arenaAudioPlayer.currentTime || 0, arenaAudioPlayer.duration || 30);
  });

  arenaAudioPlayer.addEventListener('ended', () => {
    updateArenaAudioIcons(false);
    syncArenaScrubbers(0, arenaAudioPlayer.duration || 30);
  });

  arenaAudioPlayer.addEventListener('pause', () => {
    updateArenaAudioIcons(false);
  });
  arenaAudioPlayer.addEventListener('play', () => {
    updateArenaAudioIcons(true);
  });

  binderAudioPlayer.addEventListener('timeupdate', () => {
    if (!isDraggingScrubBinder) {
      syncBinderScrubbers(binderAudioPlayer.currentTime || 0, binderAudioPlayer.duration || 30);
    }
  });

  binderAudioPlayer.addEventListener('loadedmetadata', () => {
    syncBinderScrubbers(binderAudioPlayer.currentTime || 0, binderAudioPlayer.duration || 30);
  });

  binderAudioPlayer.addEventListener('ended', () => {
    updateBinderAudioIcons(false);
    syncBinderScrubbers(0, binderAudioPlayer.duration || 30);
  });

  binderAudioPlayer.addEventListener('pause', () => updateBinderAudioIcons(false));
  binderAudioPlayer.addEventListener('play', () => updateBinderAudioIcons(true));

  function closeBinderModal() {
    stopOrFadeOutBinderAudio(500);
    gameBinderModal.classList.remove('open');
    btnHudArena.classList.add('active');
    btnHudBinder.classList.remove('active');
  }

  btnHudArena.addEventListener('click', closeBinderModal);

  function openBinderModal() {
    stopOrFadeOutArenaAudio(500);
    btnHudBinder.classList.add('active');
    btnHudArena.classList.remove('active');

    // Always reset filter tabs back to "All Cards"
    currentBinderFilter = 'all';
    if (binderSearchInput) binderSearchInput.value = '';
    if (btnClearBinderSearch) btnClearBinderSearch.classList.add('hidden');
    if (binderSortSelect) binderSortSelect.value = 'rarity-desc';

    binderFilterBar.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    const allChip = binderFilterBar.querySelector('.cat-chip[data-filter="all"]');
    if (allChip) allChip.classList.add('active');

    updateBinderFilterLabels();
    renderBinder('all');

    if (activeBinderTrack && RNG_TRACKS.some(t => t.id === activeBinderTrack.id)) {
      populateBinderAudioDock(activeBinderTrack);
      syncBinderScrubbers(binderAudioPlayer.currentTime || 0, binderAudioPlayer.duration || 30);
      updateBinderAudioIcons(!binderAudioPlayer.paused);
    } else if (activeWinnerCard && gameInventory[activeWinnerCard.id] && gameInventory[activeWinnerCard.id] > 0) {
      activeBinderTrack = activeWinnerCard;
      populateBinderAudioDock(activeWinnerCard);
      syncBinderScrubbers(0, 30);
      updateBinderAudioIcons(false);
    } else if (binderAudioDock) {
      binderAudioDock.style.display = 'none';
    }

    gameBinderModal.classList.add('open');
  }

  btnHudBinder.addEventListener('click', openBinderModal);
  btnCloseBinderModal.addEventListener('click', closeBinderModal);

  // Modal backdrop click-outside dismissal
  gameBinderModal.addEventListener('click', (e) => {
    if (e.target === gameBinderModal) {
      closeBinderModal();
    }
  });

  btnHudRates.addEventListener('click', () => {
    updateRatesModal();
    gameRatesModal.classList.add('open');
  });
  btnCloseRatesModal.addEventListener('click', () => gameRatesModal.classList.remove('open'));
  gameRatesModal.addEventListener('click', (e) => {
    if (e.target === gameRatesModal) {
      gameRatesModal.classList.remove('open');
    }
  });

  // Settings modal listeners
  if (btnHudSettings && gameSettingsModal) {
    btnHudSettings.addEventListener('click', () => {
      if (sfxVolumeSlider) sfxVolumeSlider.value = Math.round(sfxVolume * 100);
      if (sfxVolumeBadge) sfxVolumeBadge.textContent = `${Math.round(sfxVolume * 100)}%`;
      gameSettingsModal.classList.add('open');
    });
  }
  if (btnCloseSettingsModal && gameSettingsModal) {
    btnCloseSettingsModal.addEventListener('click', () => gameSettingsModal.classList.remove('open'));
  }
  if (gameSettingsModal) {
    gameSettingsModal.addEventListener('click', (e) => {
      if (e.target === gameSettingsModal) {
        gameSettingsModal.classList.remove('open');
      }
    });
  }
  if (sfxVolumeSlider) {
    sfxVolumeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      sfxVolume = isNaN(val) ? 0.8 : Math.max(0, Math.min(1, val / 100));
      if (sfxVolumeBadge) sfxVolumeBadge.textContent = `${Math.round(sfxVolume * 100)}%`;
      try {
        localStorage.setItem('crate_sfx_volume', sfxVolume.toString());
      } catch (err) {}
    });
  }
  if (btnTestSfx) {
    btnTestSfx.addEventListener('click', () => {
      playSampledSound('roll_tick', { volume: 0.8, playbackRate: 1.0 });
      setTimeout(() => {
        playMechanicalBrakeSound();
      }, 140);
    });
  }
  if (btnTestStarSfx) {
    btnTestStarSfx.addEventListener('click', () => {
      playStarSound();
    });
  }

  // Binder search and sort listeners
  if (binderSearchInput) {
    binderSearchInput.addEventListener('input', () => {
      const hasVal = Boolean(binderSearchInput.value.trim());
      if (btnClearBinderSearch) {
        btnClearBinderSearch.classList.toggle('hidden', !hasVal);
      }
      renderBinder(currentBinderFilter);
    });
  }

  if (btnClearBinderSearch) {
    btnClearBinderSearch.addEventListener('click', () => {
      if (binderSearchInput) binderSearchInput.value = '';
      btnClearBinderSearch.classList.add('hidden');
      renderBinder(currentBinderFilter);
      if (binderSearchInput) binderSearchInput.focus();
    });
  }

  if (binderSortSelect) {
    binderSortSelect.addEventListener('change', () => {
      renderBinder(currentBinderFilter);
    });
  }

  binderFilterBar.querySelectorAll('.cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      binderFilterBar.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentBinderFilter = chip.getAttribute('data-filter') || 'all';
      renderBinder(currentBinderFilter);
    });
  });

  btnSwitchAccount.addEventListener('click', () => {
    if (isSpinning) return;
    stopOrFadeOutArenaAudio(0);
    stopBinderAudio();
    if (autoRollTimer) clearTimeout(autoRollTimer);
    clearActiveRollTimers();
    isAutoRolling = false;
    btnAutoRoll.classList.remove('active');
    btnBigRoll.classList.remove('is-auto-rolling');
    btnAutoRoll.setAttribute('aria-pressed', 'false');
    btnAutoRoll.title = 'Auto-Roll (Lock continuous spinning)';
    if (lblAutoRoll) lblAutoRoll.textContent = 'Auto-Roll: OFF';

    closeBinderModal();
    gameRatesModal.classList.remove('open');
    if (gameSettingsModal) gameSettingsModal.classList.remove('open');

    resetWinnerSpotlight();
    resetBinder();

    gameArenaScreen.classList.add('hidden');
    onboardingScreen.classList.remove('hidden');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      if (!gameArenaScreen.classList.contains('hidden') && !isSpinning && document.activeElement.tagName !== 'INPUT') {
        executeSpin();
      }
    }
    if (e.key === 'Escape') {
      closeBinderModal();
      gameRatesModal.classList.remove('open');
      if (gameSettingsModal) gameSettingsModal.classList.remove('open');
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    resizeArenaCanvas();
    if (gameArenaScreen.classList.contains('hidden') || isSpinning) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => recenterReel(currentReelIndex), 80);
  });

})();
