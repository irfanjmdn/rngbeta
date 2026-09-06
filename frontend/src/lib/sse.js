import {
  activeUserId,
  rngTracks,
  playlistsCount,
  debugStatus,
  isBuildingCrate,
  isCrateReady,
  appendLog,
  loadUserData,
  activeWinnerCard,
  activeArenaTrack,
  activeBinderTrack,
  gameInventory,
  gameInventoryTimestamps,
  starredTrackIds,
  gameRolls,
  userAvatarUrl,
} from './store.js';
import { getAudioContext } from './audio.js';

async function loadStaticDemoCrate(profileUrl) {
  appendLog('Server API offline. Launching client-side static demo...', 'warning');
  appendLog('Reminder: This game is only optimized for desktop screens.', 'info');

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  await wait(180);
  appendLog(`Parsing target Spotify profile: ${profileUrl}`, 'info');

  await wait(240);
  appendLog('[1/10] Loading public playlist \'3mmc\'...', 'info');
  appendLog('  -> \'3mmc\' contains 72 tracks.', 'success');

  await wait(220);
  appendLog('[2/10] Loading public playlist \'Speed Garage / UKG / Bassline\'...', 'info');
  appendLog('  -> \'Speed Garage / UKG / Bassline\' contains 98 tracks.', 'success');

  await wait(200);
  appendLog('Extracting remaining public playlists...', 'info');

  await wait(250);
  appendLog('Calculating dynamic rarity weights across all tracks...', 'info');

  try {
    const base = import.meta.env.BASE_URL || '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const dataUrl = `${prefix}data/demo_crate.json`;
    const res = await fetch(dataUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const demoPayload = await res.json();

    appendLog(`Library compiled: ${demoPayload.tracks.length} total unique tracks across ${demoPayload.playlistsCount} playlists.`, 'success');
    appendLog(`Rarity Distribution -> Mythic: ${demoPayload.distribution.mythic}, Legendary: ${demoPayload.distribution.legendary}, Epic: ${demoPayload.distribution.epic}, Rare: ${demoPayload.distribution.rare}, Uncommon: ${demoPayload.distribution.uncommon}, Common: ${demoPayload.distribution.common}`, 'info');
    appendLog('Crate RNG initialized. Ready to roll!', 'success');
    appendLog(`Profile verified: ${demoPayload.userId}`, 'success');

    await wait(200);
    handleSseEvent(demoPayload);
  } catch (loadErr) {
    appendLog(`Static demo failed: ${loadErr.message}`, 'error');
    debugStatus.set('error');
    isBuildingCrate.set(false);
  }
}

export async function fetchAndBuildCrate(profileUrl, forceRefresh = false) {
  getAudioContext();
  isBuildingCrate.set(true);
  debugStatus.set('active');
  appendLog(`Initiating profile request for: ${profileUrl}`, 'system');

  const isStaticHost = typeof window !== 'undefined' && (
    window.location.hostname.endsWith('github.io') ||
    window.location.protocol === 'file:'
  );

  if (isStaticHost) {
    await loadStaticDemoCrate(profileUrl);
    return;
  }

  try {
    const response = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_url: profileUrl, force_refresh: forceRefresh }),
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
      buffer = lines.pop(); // Keep remainder

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
    appendLog(`Connection notice: ${err.message}`, 'warning');
    await loadStaticDemoCrate(profileUrl);
  }
}

function handleSseEvent(ev) {
  if (ev.type === 'log') {
    appendLog(ev.message, ev.level, ev.time);
  } else if (ev.type === 'error') {
    appendLog(`Error: ${ev.message}`, 'error');
    debugStatus.set('error');
    isBuildingCrate.set(false);
  } else if (ev.type === 'ready') {
    debugStatus.set('success');
    isBuildingCrate.set(false);

    // Reset current round
    activeWinnerCard.set(null);
    activeArenaTrack.set(null);
    activeBinderTrack.set(null);

    // Initialize user data
    activeUserId.set(ev.userId);
    userAvatarUrl.set(ev.avatarUrl || null);
    rngTracks.set(ev.tracks || []);
    playlistsCount.set(ev.playlistsCount || 0);

    // Reset/load inventory
    gameInventory.set({});
    gameInventoryTimestamps.set({});
    starredTrackIds.set(new Set());
    gameRolls.set(0);

    loadUserData(ev.userId);
    isCrateReady.set(true);
  }
}
