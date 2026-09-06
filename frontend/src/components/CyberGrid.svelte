<script>
  import { onMount } from 'svelte';
  import { activeWinnerCard, isSpinning, reelVelocity, reelCurrentX } from '../lib/store.js';
  import { getTargetBassPeakMetrics } from '../lib/audio.js';

  let canvas;
  let animId;
  let width = 0;
  let height = 0;

  const TIER_COLORS = {
    mythic: '#F43F5E',
    legendary: '#F59E0B',
    epic: '#A855F7',
    rare: '#3B82F6',
    uncommon: '#10B981',
    common: '#94A3B8',
    default: '#1DB954'
  };

  const TIER_SPEEDS = {
    mythic: 70,
    legendary: 52,
    epic: 38,
    rare: 28,
    uncommon: 20,
    common: 15,
    default: 18
  };

  function hexToRgb(hex) {
    if (!hex) return { r: 29, g: 185, b: 84 };
    const clean = hex.replace('#', '');
    if (clean.length === 3) {
      return {
        r: parseInt(clean[0] + clean[0], 16),
        g: parseInt(clean[1] + clean[1], 16),
        b: parseInt(clean[2] + clean[2], 16)
      };
    }
    return {
      r: parseInt(clean.substring(0, 2), 16) || 29,
      g: parseInt(clean.substring(2, 4), 16) || 185,
      b: parseInt(clean.substring(4, 6), 16) || 84
    };
  }

  $: rawTier = $activeWinnerCard?.rarityTier ? String($activeWinnerCard.rarityTier).toLowerCase() : 'default';
  $: tierColor = $activeWinnerCard?.rarityColor || TIER_COLORS[rawTier] || TIER_COLORS.default;
  $: tierRgb = hexToRgb(tierColor);
  $: baseRaritySpeed = TIER_SPEEDS[rawTier] || TIER_SPEEDS.default;

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width || window.innerWidth;
      height = rect.height || window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
  }

  onMount(() => {
    resize();
    window.addEventListener('resize', resize);

    const ctx = canvas.getContext('2d');
    let smoothedEnergy = 0;
    let smoothedPeak = 0;
    let gridOffset = 0;
    let currentScrollSpeed = 18;
    let wasSpinning = false;
    let prevReelX = null;
    let lastTime = performance.now();
    let currentR = tierRgb.r;
    let currentG = tierRgb.g;
    let currentB = tierRgb.b;

    function render(timestamp) {
      if (!ctx || width === 0 || height === 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
      lastTime = timestamp;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Read audio transient peaks and energy in unified bass band (20 Hz - 150 Hz)
      const metrics = getTargetBassPeakMetrics(20, 150);
      smoothedEnergy = smoothedEnergy * 0.88 + metrics.energy * 0.12;

      // Smooth attack and gentle decay for peak impulses (eliminates choppiness)
      const peakTarget = metrics.peak;
      const peakLerp = peakTarget > smoothedPeak ? 0.40 : 0.08;
      smoothedPeak += (peakTarget - smoothedPeak) * peakLerp;

      // Baseline resting speed scales directly with card rarity tier
      const audioSpeedBoost = (smoothedEnergy * 14) + (smoothedPeak * 22);
      const normalTargetSpeed = baseRaritySpeed + audioSpeedBoost;

      if ($isSpinning && $reelCurrentX !== null) {
        if (prevReelX !== null) {
          const deltaX = $reelCurrentX - prevReelX;
          // Follow almost exactly the reel's displacement and direction (1:1 lockstep),
          // including the settling nudge, ignoring large jumps from teleports
          if (Math.abs(deltaX) < 600) {
            gridOffset += deltaX;
            if (dt > 0.0001) {
              currentScrollSpeed = deltaX / dt;
            }
          }
        }
        prevReelX = $reelCurrentX;
        wasSpinning = true;
      } else {
        prevReelX = null;
        // Tactile snap stop: freeze grid velocity immediately when reel lands on chosen track
        if (wasSpinning) {
          currentScrollSpeed = 0;
          wasSpinning = false;
        }

        // Normal forward speed restored smoothly after tactile snap stop
        currentScrollSpeed += (normalTargetSpeed - currentScrollSpeed) * 0.08;
        gridOffset += currentScrollSpeed * dt;
      }

      const cellSize = 64;
      const cx = width / 2;
      const cy = height / 2;
      const maxDist = Math.hypot(cx, cy);

      // Stable focal fish-eye lens distortion
      const k = 0.12;

      function distort(x, y) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        const normDist = Math.min(1.0, dist / maxDist);
        // Spherical cosine roll-off: center bulges gently, edges stay grounded
        const factor = 1 + k * Math.cos(normDist * (Math.PI / 2));
        return [cx + dx * factor, cy + dy * factor];
      }

      const xShift = ((gridOffset % cellSize) + cellSize) % cellSize;

      // Smoothly transition current RGB toward active rarity tier color
      currentR += (tierRgb.r - currentR) * 0.08;
      currentG += (tierRgb.g - currentG) * 0.08;
      currentB += (tierRgb.b - currentB) * 0.08;

      const r = Math.round(currentR);
      const g = Math.round(currentG);
      const b = Math.round(currentB);

      // Grid line static styling matching rarity color: clean constant brightness without audio pulsing
      const baseAlpha = 0.14;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${baseAlpha})`;
      ctx.lineWidth = 1.15;

      ctx.beginPath();

      const margin = cellSize * 1.5;
      const step = 28; // Sampling step for smooth lens curvature

      // Horizontally straight grid lines with subtle focal fish-eye distortion
      ctx.beginPath();
      for (let y = -cellSize; y <= height + cellSize; y += cellSize) {
        const [startX, startY] = distort(-margin, y);
        ctx.moveTo(startX, startY);
        for (let x = -margin + step; x <= width + margin; x += step) {
          const [px, py] = distort(x, y);
          ctx.lineTo(px, py);
        }
        const [endX, endY] = distort(width + margin, y);
        ctx.lineTo(endX, endY);
      }
      ctx.stroke();

      // Vertically straight moving grid lines with subtle focal fish-eye distortion
      ctx.beginPath();
      for (let x = -margin + xShift; x <= width + margin; x += cellSize) {
        const [startX, startY] = distort(x, -margin);
        ctx.moveTo(startX, startY);
        for (let y = -margin + step; y <= height + margin; y += step) {
          const [px, py] = distort(x, y);
          ctx.lineTo(px, py);
        }
        const [endX, endY] = distort(x, height + margin);
        ctx.lineTo(endX, endY);
      }
      ctx.stroke();

      ctx.restore();
      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      if (animId) cancelAnimationFrame(animId);
    };
  });
</script>

<div class="cyber-grid-wrapper" aria-hidden="true">
  <canvas bind:this={canvas} class="cyber-grid-canvas"></canvas>
</div>

<style>
  .cyber-grid-wrapper {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
    overflow: hidden;
  }

  .cyber-grid-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
