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
} from './store.js';
import { getAudioContext } from './audio.js';

export async function fetchAndBuildCrate(profileUrl, forceRefresh = false) {
  getAudioContext();
  isBuildingCrate.set(true);
  debugStatus.set('active');
  appendLog(`Initiating profile request for: ${profileUrl}`, 'system');

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
    appendLog(`Connection error: ${err.message}`, 'error');
    debugStatus.set('error');
    isBuildingCrate.set(false);
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
