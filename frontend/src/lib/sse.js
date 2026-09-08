import {
  activeMode,
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
import { loadLastfmCrateClient } from './modes/lastfmEngine.js';
import { loadSpotifyCrateClient } from './modes/spotifyEngine.js';

/**
 * Shared SSE event dispatcher factory.
 * Scopes user data and state initialization to the selected mode.
 */
function createSseHandler(mode) {
  return function handleSseEvent(ev) {
    if (ev.type === 'log') {
      appendLog(ev.message, ev.level, ev.time);
    } else if (ev.type === 'error') {
      appendLog(`Error: ${ev.message}`, 'error');
      debugStatus.set('error');
      isBuildingCrate.set(false);
    } else if (ev.type === 'ready') {
      debugStatus.set('success');
      isBuildingCrate.set(false);

      activeMode.set(mode);

      // Reset active rounds
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

      loadUserData(ev.userId, mode);
      isCrateReady.set(true);
    }
  };
}

/**
 * Primary coordinator function to fetch and build crate according to selected mode.
 * @param {string} inputStr Username or profile URL
 * @param {'lastfm' | 'spotify'} mode Engine selection
 * @param {boolean} forceRefresh Whether to force live scraping (Spotify)
 */
export async function fetchAndBuildCrate(inputStr, mode = 'lastfm', forceRefresh = false) {
  getAudioContext();
  isBuildingCrate.set(true);
  debugStatus.set('active');
  activeMode.set(mode);

  const cleanInput = (inputStr || '').trim();
  const onEvent = createSseHandler(mode);

  if (mode === 'lastfm') {
    let lastfmUser = cleanInput;
    if (lastfmUser.toLowerCase().includes('last.fm/user/')) {
      lastfmUser = lastfmUser.split('last.fm/user/')[1].split('/')[0].split('?')[0].trim();
    } else if (lastfmUser.startsWith('lastfm:')) {
      lastfmUser = lastfmUser.split('lastfm:')[1].trim();
    }
    appendLog(`Initiating Last.fm request for user: ${lastfmUser}`, 'system');
    await loadLastfmCrateClient(lastfmUser, onEvent);
  } else {
    appendLog(`Initiating Spotify request for input: ${cleanInput}`, 'system');
    await loadSpotifyCrateClient(cleanInput, forceRefresh, onEvent);
  }
}
