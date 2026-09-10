/**
 * Web Audio Engine for Spotify Crate RNG
 * Sampled mechanical SFX, procedural chimes, and master volume singleton.
 */

let audioCtx = null;
const soundBuffers = {};

export function getAudioContext() {
  if (!audioCtx && typeof window !== 'undefined') {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

let analyserNode = null;
let audioDataArray = null;
let analyserSilentGain = null;

export function getAnalyserNode() {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (!analyserNode) {
    try {
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.65;
      audioDataArray = new Uint8Array(analyserNode.frequencyBinCount);

      // Silent pull tap: ensures the Web Audio rendering graph continually computes
      // FFT frames for the analyser without emitting audible audio to the destination.
      analyserSilentGain = ctx.createGain();
      analyserSilentGain.gain.setValueAtTime(0, ctx.currentTime);
      analyserNode.connect(analyserSilentGain);
      analyserSilentGain.connect(ctx.destination);
    } catch (e) {
      return null;
    }
  }
  return analyserNode;
}

/**
 * Returns the destination node for audible audio (SFX and master music bus).
 * Crucially routes directly to hardware ctx.destination, completely bypassing
 * the visualizer AnalyserNode so SFX never bleeds into visualization metrics.
 */
export function getAudioDestinationNode() {
  const ctx = getAudioContext();
  return ctx ? ctx.destination : null;
}

// Backward compatibility helper
export function getReactivityAnalyser() {
  return getAnalyserNode();
}

/**
 * Connects an HTML5 audio element into the Web Audio API graph.
 * Only Spotify music elements pass through here.
 * The raw music source is tapped directly into the isolated AnalyserNode,
 * ensuring clean analysis without compression squashing or SFX bleed.
 */
export function connectMediaElement(audioEl, isArena = false) {
  if (!audioEl || audioEl._webAudioConnected) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const source = ctx.createMediaElementSource(audioEl);

    // 1. Audible playback routing
    if (isArena) {
      const lowpass = getArenaLowpassNode();
      if (lowpass) {
        source.connect(lowpass);
      } else {
        const dest = getAudioDestinationNode();
        if (dest) source.connect(dest);
      }
    } else {
      const musicBus = getMusicBusNode() || getAudioDestinationNode();
      if (musicBus) {
        source.connect(musicBus);
      }
    }

    // 2. Isolated visualizer tap (Spotify music only)
    const analyser = getAnalyserNode();
    if (analyser) {
      source.connect(analyser);
    }

    audioEl._webAudioConnected = true;
  } catch (e) {}
}

let rollingFloor = 0.08;
let rollingCeiling = 0.45;
let lastPeakTime = 0;
let currentPeakIntensity = 0;
let prevRaw = 0;

/**
 * Extracts bass energy and detects transient beat peaks in the unified sub-bass/bass band (20 Hz - 150 Hz).
 * Features:
 * - Direct RMS calculation across 20 Hz - 150 Hz (captures sub rumble and kick punch, removes vocal/synth fundamentals).
 * - Asymmetric floor tracking: slow rise (preserves transient delta) and fast fall (tracks pauses).
 * - Dynamic range scaling: maps [floor, ceiling] smoothly into [0.0, 1.0] across both quiet/filtered and loud/full-spectrum audio.
 * - Headroom-relative onset detection: cutoff stays bounded within [floor, ceiling], preventing cutoff overflow above 1.0.
 */
export function getTargetBassPeakMetrics(minHz = 20, maxHz = 150) {
  const node = getAnalyserNode();
  if (!node || !audioDataArray) {
    return { energy: 0, peak: 0, raw: 0 };
  }
  try {
    const ctx = getAudioContext();
    const sampleRate = ctx ? ctx.sampleRate : 44100;
    const binSize = sampleRate / node.fftSize;
    const startBin = Math.max(1, Math.floor(minHz / binSize));
    const endBin = Math.min(audioDataArray.length - 1, Math.ceil(maxHz / binSize));

    node.getByteFrequencyData(audioDataArray);
    let sumSq = 0;
    let count = 0;
    for (let i = startBin; i <= endBin; i++) {
      const val = audioDataArray[i] / 255;
      sumSq += val * val;
      count++;
    }
    if (count === 0) return { energy: 0, peak: 0, raw: 0 };

    // RMS magnitude over target bass band
    const raw = Math.sqrt(sumSq / count);
    const now = performance.now();

    // 1. Asymmetric Floor Tracking:
    // Tracks baseline between beats. Slow rise (0.006) ensures bass beats do not elevate the floor.
    // Fast decay (0.06) allows rapid recovery during breakdowns or pauses.
    const floorSpeed = raw > rollingFloor ? 0.006 : 0.06;
    rollingFloor += (raw - rollingFloor) * floorSpeed;
    rollingFloor = Math.max(0.005, Math.min(0.65, rollingFloor));

    // 2. Rolling Peak Ceiling Tracking:
    // Captures track maximums with fast attack (0.25) and holds headroom with slow decay (0.005).
    const ceilingSpeed = raw > rollingCeiling ? 0.25 : 0.005;
    rollingCeiling += (raw - rollingCeiling) * ceilingSpeed;
    rollingCeiling = Math.max(rollingFloor + 0.08, Math.min(1.0, rollingCeiling));

    // 3. Dynamic Range Normalization: maps [floor, ceiling] to [0.0, 1.0]
    const dynamicRange = Math.max(0.08, rollingCeiling - rollingFloor);
    const normalizedEnergy = Math.max(0, Math.min(1.0, (raw - rollingFloor) / dynamicRange));

    // 4. Headroom-Relative Peak / Onset Detection:
    const rise = Math.max(0, raw - prevRaw);
    prevRaw = raw;

    // Decisive peak cutoff avoids false positives on off-beat bass wobble
    const peakCutoff = rollingFloor + dynamicRange * 0.52;
    const minRiseThreshold = Math.max(0.018, dynamicRange * 0.16);

    // Smooth exponential decay envelope
    currentPeakIntensity *= 0.88;

    if (raw > peakCutoff && rise > minRiseThreshold && now - lastPeakTime > 200) {
      const spikeStrength = Math.min(1.0, (raw - peakCutoff) / Math.max(0.04, rollingCeiling - peakCutoff));
      currentPeakIntensity = Math.max(currentPeakIntensity, spikeStrength);
      lastPeakTime = now;
    }

    return {
      energy: normalizedEnergy,
      peak: currentPeakIntensity,
      raw
    };
  } catch (e) {
    return { energy: 0, peak: 0, raw: 0 };
  }
}

export function getSubBassEnergy(minHz = 20, maxHz = 150) {
  const metrics = getTargetBassPeakMetrics(minHz, maxHz);
  return metrics.energy;
}

export function getBassEnergy() {
  return getSubBassEnergy(20, 150);
}

export function getAudioVisualizerData() {
  const metrics = getTargetBassPeakMetrics(20, 150);
  const node = getAnalyserNode();
  if (!node || !audioDataArray) {
    return { bass: 0, mids: 0, beat: false, beatIntensity: 0 };
  }
  try {
    const ctx = getAudioContext();
    const sampleRate = ctx ? ctx.sampleRate : 44100;
    const binSize = sampleRate / node.fftSize;
    const midsStartBin = Math.max(1, Math.floor(400 / binSize));
    const midsEndBin = Math.min(audioDataArray.length - 1, Math.ceil(2500 / binSize));
    let midsSum = 0;
    let midsCount = 0;
    for (let i = midsStartBin; i <= midsEndBin; i++) {
      midsSum += audioDataArray[i];
      midsCount++;
    }
    const currentMids = midsCount > 0 ? midsSum / (midsCount * 255) : 0;

    return {
      bass: metrics.energy,
      mids: currentMids,
      beat: metrics.peak > 0.35,
      beatIntensity: metrics.peak
    };
  } catch (e) {
    return { bass: 0, mids: 0, beat: false, beatIntensity: 0 };
  }
}

let sfxVolume = 0.8;
if (typeof localStorage !== 'undefined') {
  try {
    const saved = localStorage.getItem('crate_sfx_volume');
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        sfxVolume = parsed;
      }
    }
  } catch (e) {}
}

export function getSfxVolume() {
  return sfxVolume;
}

export function setSfxVolume(val) {
  sfxVolume = Math.max(0, Math.min(1, val));
  try {
    localStorage.setItem('crate_sfx_volume', sfxVolume.toString());
  } catch (e) {}
}


let musicNormalizerNode = null;
let musicGainNode = null;
let musicLimiterNode = null;
let musicFadeGainNode = null;
let musicUserVolumeGainNode = null;

let musicMasterVolume = 0.8;
if (typeof localStorage !== 'undefined') {
  try {
    const saved = localStorage.getItem('crate_music_volume');
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        musicMasterVolume = parsed;
      }
    }
  } catch (e) {}
}

export function getMusicVolume() {
  return musicMasterVolume;
}

export function setMusicVolume(val) {
  musicMasterVolume = Math.max(0, Math.min(1, val));
  try {
    localStorage.setItem('crate_music_volume', musicMasterVolume.toString());
  } catch (e) {}
  if (musicUserVolumeGainNode) {
    const ctx = getAudioContext();
    if (ctx) {
      try {
        musicUserVolumeGainNode.gain.cancelScheduledValues(ctx.currentTime);
        musicUserVolumeGainNode.gain.setValueAtTime(musicMasterVolume, ctx.currentTime);
      } catch (e) {
        musicUserVolumeGainNode.gain.value = musicMasterVolume;
      }
    } else {
      musicUserVolumeGainNode.gain.value = musicMasterVolume;
    }
  }
}

export function getMusicBusNode() {
  const ctx = getAudioContext();
  if (!ctx) return null;

  if (!musicNormalizerNode) {
    try {
      musicNormalizerNode = ctx.createDynamicsCompressor();
      musicNormalizerNode.threshold.setValueAtTime(-22, ctx.currentTime);
      musicNormalizerNode.knee.setValueAtTime(20, ctx.currentTime);
      musicNormalizerNode.ratio.setValueAtTime(6, ctx.currentTime);
      musicNormalizerNode.attack.setValueAtTime(0.005, ctx.currentTime);
      musicNormalizerNode.release.setValueAtTime(0.18, ctx.currentTime);

      musicGainNode = ctx.createGain();
      musicGainNode.gain.setValueAtTime(1.35, ctx.currentTime);

      musicLimiterNode = ctx.createDynamicsCompressor();
      musicLimiterNode.threshold.setValueAtTime(-1.5, ctx.currentTime);
      musicLimiterNode.knee.setValueAtTime(0, ctx.currentTime);
      musicLimiterNode.ratio.setValueAtTime(20, ctx.currentTime);
      musicLimiterNode.attack.setValueAtTime(0.001, ctx.currentTime);
      musicLimiterNode.release.setValueAtTime(0.05, ctx.currentTime);

      musicFadeGainNode = ctx.createGain();
      musicFadeGainNode.gain.setValueAtTime(1, ctx.currentTime);

      musicUserVolumeGainNode = ctx.createGain();
      musicUserVolumeGainNode.gain.setValueAtTime(musicMasterVolume, ctx.currentTime);

      const dest = getAudioDestinationNode();
      musicNormalizerNode.connect(musicGainNode);
      musicGainNode.connect(musicLimiterNode);
      musicLimiterNode.connect(musicFadeGainNode);
      musicFadeGainNode.connect(musicUserVolumeGainNode);
      musicUserVolumeGainNode.connect(dest);
    } catch (e) {
      return getAudioDestinationNode();
    }
  }

  return musicNormalizerNode;
}

export function setMusicFadeLevel(targetLevel, durationSec = 0.05) {
  const ctx = getAudioContext();
  if (!ctx || !musicFadeGainNode) return;
  const clamped = Math.max(0.0001, Math.min(1.0, targetLevel));
  try {
    musicFadeGainNode.gain.cancelScheduledValues(ctx.currentTime);
    musicFadeGainNode.gain.setTargetAtTime(clamped, ctx.currentTime, durationSec);
  } catch (e) {
    musicFadeGainNode.gain.value = clamped;
  }
}

export function fadeInMusic(durationSec = 0.15) {
  setMusicFadeLevel(1.0, durationSec);
}

let arenaLowpassNode = null;
let arenaReverbConvolver = null;
let arenaReverbWetGain = null;
let currentLowpassCutoff = 20000;

export function getArenaLowpassNode() {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (!arenaLowpassNode) {
    try {
      arenaLowpassNode = ctx.createBiquadFilter();
      arenaLowpassNode.type = 'lowpass';
      arenaLowpassNode.frequency.setValueAtTime(currentLowpassCutoff, ctx.currentTime);
      arenaLowpassNode.Q.setValueAtTime(0.707, ctx.currentTime);

      const musicBus = getMusicBusNode() || getAudioDestinationNode() || ctx.destination;
      arenaLowpassNode.connect(musicBus);

      arenaReverbConvolver = ctx.createConvolver();
      arenaReverbConvolver.buffer = createHallImpulseResponse(ctx);
      arenaReverbWetGain = ctx.createGain();
      arenaReverbWetGain.gain.setValueAtTime(0, ctx.currentTime);

      arenaLowpassNode.connect(arenaReverbConvolver);
      arenaReverbConvolver.connect(arenaReverbWetGain);
      arenaReverbWetGain.connect(musicBus);
    } catch (e) {
      return null;
    }
  }
  return arenaLowpassNode;
}

function createHallImpulseResponse(ctx) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * 2.4);
  const ir = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const decay = Math.pow(1 - t, 3);
      const early = i < sampleRate * 0.08 ? Math.random() * 0.7 : 0;
      const tail = (Math.random() * 2 - 1) * decay;
      data[i] = early + tail;
    }
  }
  return ir;
}

export function setArenaReverbWet(wetLevel, timeConstant = 0.25) {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (!arenaReverbWetGain) return;
  const clamped = Math.max(0, Math.min(1, wetLevel));
  try {
    arenaReverbWetGain.gain.cancelScheduledValues(ctx.currentTime);
    arenaReverbWetGain.gain.setTargetAtTime(clamped, ctx.currentTime, timeConstant);
  } catch (e) {
    arenaReverbWetGain.gain.value = clamped;
  }
}

export function setArenaLowpassFilter(enabled, lowCutoff = 500, _highCutoff = 100, timeConstant = 0.25) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const targetLowFreq = enabled ? lowCutoff : 20000;
  currentLowpassCutoff = targetLowFreq;

  const lowpass = getArenaLowpassNode();
  if (lowpass) {
    try {
      lowpass.frequency.cancelScheduledValues(ctx.currentTime);
      lowpass.frequency.setTargetAtTime(targetLowFreq, ctx.currentTime, timeConstant);
    } catch (e) {
      lowpass.frequency.value = targetLowFreq;
    }
  }
}


export function playSpringCoilSound() {
  if (sfxVolume <= 0) return;
  playSampledSound('spring_coil', { volume: 0.65, playbackRate: 1.15 });
}

export function playNearMissSound() {
  if (sfxVolume <= 0) return;
  playSampledSound('near_miss', { volume: 0.75, playbackRate: 1.0 });
}

export function playUiTapSound() {
  if (sfxVolume <= 0) return;
  playSampledSound('ui_tap', { volume: 0.45, playbackRate: 1.0 });
}

export function playDuplicateStampSound() {
  if (sfxVolume <= 0) return;
  playSampledSound('stamp_duplicate', { volume: 0.85, playbackRate: 0.95 });
}

export function playTierLandingSound(tier = 'common') {
  if (sfxVolume <= 0) return;
  playLandingImpactBass();
  playMechanicalBrakeSound();
  const soundKey = `tier_reveal_${tier}`;
  if (soundBuffers[soundKey]) {
    playSampledSound(soundKey, { volume: 0.85, playbackRate: 1.0 });
  }
}
export async function loadSoundBuffer(name, url) {
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

export function preloadRollSounds() {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  loadSoundBuffer('roll_tick', `${prefix}sounds/roll_tick.wav`);
  loadSoundBuffer('roll_latch', `${prefix}sounds/roll_latch.wav`);
  loadSoundBuffer('roll_drop', `${prefix}sounds/roll_drop.wav`);
  loadSoundBuffer('seek_tick', `${prefix}sounds/kenney_tick.wav`);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => preloadRollSounds(), { once: true });
  window.addEventListener('keydown', () => preloadRollSounds(), { once: true });
}

export function playSampledSound(bufferName, { volume = 1.0, playbackRate = 1.0 } = {}) {
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
    gain.connect(getAudioDestinationNode() || ctx.destination);
    source.start(ctx.currentTime);
    return true;
  } catch (e) {
    return false;
  }
}

export function playTickSound(progressOrFreq = 0) {
  if (sfxVolume <= 0) return;
  const p = typeof progressOrFreq === 'number'
    ? (progressOrFreq > 1 ? Math.max(0, Math.min(1, (780 - progressOrFreq) / 240)) : progressOrFreq)
    : 0;
  // Minuscule random pitch shift (approx +/- 30 cents) to eliminate repetitive machine-gun monotony
  const pitchJitter = 1 + (Math.random() - 0.5) * 0.036;
  const basePitchRate = Math.max(0.72, Math.min(1.35, 1.22 - p * 0.38));
  const pitchRate = basePitchRate * pitchJitter;
  const played = playSampledSound('roll_tick', { volume: 0.58, playbackRate: pitchRate });
  if (!played) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const freq = (780 - p * 240) * pitchJitter;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.025);
      gain.gain.setValueAtTime(0.12 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
      osc.connect(gain);
      gain.connect(getAudioDestinationNode() || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.025);
    } catch (e) {}
  }
}

export function playPointerSeekSound() {
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
      gain.connect(getAudioDestinationNode() || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.095);
    } catch (e) {}
  }
}

export function playMechanicalBrakeSound() {
  if (sfxVolume <= 0) return;
  const played = playSampledSound('roll_latch', { volume: 0.95, playbackRate: 1.0 });
  if (!played) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const dest = getAudioDestinationNode() || ctx.destination;
      const now = ctx.currentTime;

      const oscClick = ctx.createOscillator();
      const gainClick = ctx.createGain();
      oscClick.type = 'triangle';
      oscClick.frequency.setValueAtTime(1800, now);
      oscClick.frequency.exponentialRampToValueAtTime(600, now + 0.025);
      gainClick.gain.setValueAtTime(0.35 * sfxVolume, now);
      gainClick.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
      oscClick.connect(gainClick);
      gainClick.connect(dest);
      oscClick.start(now);
      oscClick.stop(now + 0.025);

      const oscHigh = ctx.createOscillator();
      const gainHigh = ctx.createGain();
      oscHigh.type = 'triangle';
      oscHigh.frequency.setValueAtTime(1150, now);
      oscHigh.frequency.exponentialRampToValueAtTime(320, now + 0.045);
      gainHigh.gain.setValueAtTime(0.28 * sfxVolume, now);
      gainHigh.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      oscHigh.connect(gainHigh);
      gainHigh.connect(dest);
      oscHigh.start(now);
      oscHigh.stop(now + 0.045);

      const oscLow = ctx.createOscillator();
      const gainLow = ctx.createGain();
      oscLow.type = 'sine';
      oscLow.frequency.setValueAtTime(160, now);
      oscLow.frequency.exponentialRampToValueAtTime(45, now + 0.08);
      gainLow.gain.setValueAtTime(0.4 * sfxVolume, now);
      gainLow.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      oscLow.connect(gainLow);
      gainLow.connect(dest);
      oscLow.start(now);
      oscLow.stop(now + 0.08);
    } catch (e) {}
  }
}

export function playLandingImpactBass() {
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
    gain.connect(getAudioDestinationNode() || ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch (e) {}
}

export function playStarSound() {
  if (sfxVolume <= 0) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4200, t0);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(sfxVolume, t0);

    filter.connect(masterGain);
    masterGain.connect(getAudioDestinationNode() || ctx.destination);

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

    const oscRoot = ctx.createOscillator();
    const gainRoot = ctx.createGain();
    oscRoot.type = 'sine';
    oscRoot.frequency.setValueAtTime(1318.51, t0);
    gainRoot.gain.setValueAtTime(0.001, t0);
    gainRoot.linearRampToValueAtTime(0.24, t0 + 0.004);
    gainRoot.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
    oscRoot.connect(gainRoot);
    gainRoot.connect(filter);
    oscRoot.start(t0);
    oscRoot.stop(t0 + 0.39);

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

export function playUnstarSound() {
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
    gain.connect(getAudioDestinationNode() || ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.05);
  } catch (e) {}
}

export function playFanfareSound(tier) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dest = getAudioDestinationNode() || ctx.destination;

    if (tier === 'mythic' || tier === 'legendary') {
      const chord = tier === 'mythic' ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [440, 554.37, 659.25, 880];
      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);
        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.2 * sfxVolume, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.8);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.82);
      });
    } else if (tier === 'epic') {
      const chord = [349.23, 440, 523.25];
      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);
        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.16 * sfxVolume, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.5);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.52);
      });
    } else if (tier === 'rare') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12);
      gain.gain.setValueAtTime(0.12 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.26);
    }
  } catch (e) {}
}


export function stopAllMediaAudio() {
  if (typeof document === 'undefined') return;
  try {
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach((el) => {
      try {
        el.pause();
        el.currentTime = 0;
      } catch (e) {}
    });
  } catch (e) {}
}

export function startLogoutRumble() {
  if (sfxVolume <= 0) {
    return { setIntensity: () => {}, stop: () => {} };
  }

  try {
    const ctx = getAudioContext();
    if (!ctx) return { setIntensity: () => {}, stop: () => {} };
    const now = ctx.currentTime;
    const dest = getAudioDestinationNode() || ctx.destination;

    // Immediately lowpass duck currently playing music and engage hall reverb
    const lowpass = getArenaLowpassNode();
    const prevCutoff = currentLowpassCutoff;
    if (lowpass) {
      try {
        lowpass.frequency.cancelScheduledValues(now);
        lowpass.frequency.setTargetAtTime(380, now, 0.02);
      } catch (e) {
        lowpass.frequency.value = 380;
      }
    }
    setArenaReverbWet(0.4, 0.05);

    // Sub-bass rumble layered oscillators
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(42, now);

    const oscHarmonic = ctx.createOscillator();
    oscHarmonic.type = 'sine';
    oscHarmonic.frequency.setValueAtTime(84, now);
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.setValueAtTime(0.35, now);
    oscHarmonic.connect(harmonicGain);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);

    osc.connect(filter);
    harmonicGain.connect(filter);

    const tremoloGain = ctx.createGain();
    tremoloGain.gain.setValueAtTime(1.0, now);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(26, now);

    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0.2, now);

    lfo.connect(lfoGain);
    lfoGain.connect(tremoloGain.gain);

    filter.connect(tremoloGain);

    const START_DB = -28;
    const MAX_DB = -15;
    const dbToGain = (db) => Math.pow(10, db / 20);

    const masterGain = ctx.createGain();
    const initialGain = dbToGain(START_DB) * sfxVolume;
    masterGain.gain.setValueAtTime(initialGain, now);

    tremoloGain.connect(masterGain);
    masterGain.connect(dest);

    osc.start(now);
    oscHarmonic.start(now);
    lfo.start(now);

    let stopped = false;

    return {
      setIntensity(ratio) {
        if (stopped) return;
        const t = ctx.currentTime;
        const clamped = Math.max(0, Math.min(1, ratio));
        const targetFreq = 42 + clamped * 28;
        osc.frequency.setTargetAtTime(targetFreq, t, 0.04);
        oscHarmonic.frequency.setTargetAtTime(targetFreq * 2, t, 0.04);

        const currentDb = START_DB + clamped * (MAX_DB - START_DB);
        const targetGain = dbToGain(currentDb) * sfxVolume;
        masterGain.gain.setTargetAtTime(targetGain, t, 0.04);

        const fadeLevel = 1 - clamped * clamped;
        setMusicFadeLevel(Math.max(0.0001, fadeLevel), 0.05);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        masterGain.gain.setTargetAtTime(0.0001, t, 0.05);

        if (lowpass) {
          try {
            lowpass.frequency.cancelScheduledValues(t);
            lowpass.frequency.setTargetAtTime(prevCutoff, t, 0.25);
          } catch (e) {
            lowpass.frequency.value = prevCutoff;
          }
        }

        setArenaReverbWet(0, 0.25);

        setTimeout(() => {
          try {
            osc.stop();
            oscHarmonic.stop();
            lfo.stop();
            osc.disconnect();
            oscHarmonic.disconnect();
            harmonicGain.disconnect();
            filter.disconnect();
            tremoloGain.disconnect();
            lfo.disconnect();
            lfoGain.disconnect();
            masterGain.disconnect();
          } catch (e) {}
        }, 120);
      }
    };
  } catch (e) {
    return { setIntensity: () => {}, stop: () => {} };
  }
}

export function playLogoutConfirmSound() {
  if (sfxVolume <= 0) return;
  playSampledSound('caliper_snap', { volume: 0.85, playbackRate: 0.95 });
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.22);
    gain.gain.setValueAtTime(0.55 * sfxVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(getAudioDestinationNode() || ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (e) {}
}

export function playLogoutSquareSound(stepIndex = 1) {
  if (sfxVolume <= 0) return;
  const rates = [1.0, 1.22, 1.45];
  const rate = rates[Math.max(0, Math.min(2, stepIndex - 1))] || 1.0;
  const played = playSampledSound('ui_tap', { volume: 0.55, playbackRate: rate });
  if (!played) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const baseFreq = 440 * rate;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.04);
      gain.gain.setValueAtTime(0.22 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc.connect(gain);
      gain.connect(getAudioDestinationNode() || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  }
}

export function playLogoutCancelPipSound(stepIndex = 1) {
  if (sfxVolume <= 0) return;
  const rates = [1.4, 1.15, 0.9];
  const rate = rates[Math.max(0, Math.min(2, stepIndex - 1))] || 1.0;
  const played = playSampledSound('ui_tap', { volume: 0.35, playbackRate: rate });
  if (!played) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const baseFreq = 520 * rate;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, now + 0.035);
      gain.gain.setValueAtTime(0.15 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(getAudioDestinationNode() || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.045);
    } catch (e) {}
  }
}

export function playRollNudgeSound() {
  if (sfxVolume <= 0) return;
  const played = playSampledSound('seek_tick', { volume: 0.38, playbackRate: 1.4 });
  if (!played) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const dest = getAudioDestinationNode() || ctx.destination;

      // Soft dual-tone tactile chime: 780Hz -> 1040Hz
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(784, now); // G5
      osc1.frequency.exponentialRampToValueAtTime(1046.5, now + 0.09); // C6
      osc2.frequency.setValueAtTime(1175, now); // D6
      osc2.frequency.exponentialRampToValueAtTime(1568, now + 0.07); // G6

      gain.gain.setValueAtTime(0.14 * sfxVolume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(dest);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.17);
      osc2.stop(now + 0.17);
    } catch (e) {}
  }
}

