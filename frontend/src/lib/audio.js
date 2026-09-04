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

export function getAnalyserNode() {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (!analyserNode) {
    try {
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.7;
      analyserNode.connect(ctx.destination);
      audioDataArray = new Uint8Array(analyserNode.frequencyBinCount);
    } catch (e) {
      return null;
    }
  }
  return analyserNode;
}

export function getAudioDestinationNode() {
  const analyser = getAnalyserNode();
  if (analyser) return analyser;
  const ctx = getAudioContext();
  return ctx ? ctx.destination : null;
}

export function connectMediaElement(audioEl) {
  if (!audioEl || audioEl._webAudioConnected) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const analyser = getAnalyserNode();
    if (!analyser) return;
    const source = ctx.createMediaElementSource(audioEl);
    source.connect(analyser);
    audioEl._webAudioConnected = true;
  } catch (e) {}
}

export function getBassEnergy() {
  if (!analyserNode || !audioDataArray) return 0;
  try {
    analyserNode.getByteFrequencyData(audioDataArray);
    const count = 3;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += audioDataArray[i];
    }
    const normalized = sum / (count * 255);
    return Math.min(1.0, Math.pow(normalized, 1.5) * 1.4);
  } catch (e) {
    return 0;
  }
}

let rollingEnergyAvg = 0.35;
let lastBeatTimestamp = 0;

export function getAudioVisualizerData() {
  if (!analyserNode || !audioDataArray) {
    return { bass: 0, mids: 0, beat: false, beatIntensity: 0 };
  }
  try {
    analyserNode.getByteFrequencyData(audioDataArray);

    let bassSum = 0;
    for (let i = 1; i <= 4; i++) {
      bassSum += audioDataArray[i] || 0;
    }
    const currentBass = bassSum / (4 * 255);

    let midsSum = 0;
    for (let i = 5; i <= 14; i++) {
      midsSum += audioDataArray[i] || 0;
    }
    const currentMids = midsSum / (10 * 255);

    const now = performance.now();
    let isBeat = false;
    let beatIntensity = 0;

    if (currentBass > rollingEnergyAvg * 1.25 && currentBass > 0.28 && now - lastBeatTimestamp > 210) {
      isBeat = true;
      beatIntensity = Math.min(1.0, (currentBass - rollingEnergyAvg) / (1.0 - rollingEnergyAvg + 0.01));
      lastBeatTimestamp = now;
    }

    rollingEnergyAvg = rollingEnergyAvg * 0.93 + currentBass * 0.07;

    return {
      bass: currentBass,
      mids: currentMids,
      beat: isBeat,
      beatIntensity,
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
  loadSoundBuffer('roll_tick', '/sounds/roll_tick.wav');
  loadSoundBuffer('roll_latch', '/sounds/roll_latch.wav');
  loadSoundBuffer('roll_drop', '/sounds/roll_drop.wav');
  loadSoundBuffer('seek_tick', '/sounds/kenney_tick.wav');
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
