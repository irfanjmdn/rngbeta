import { writable, derived } from 'svelte/store';
import { playStarSound, playUnstarSound } from './audio.js';

export const activeMode = writable('lastfm'); // 'lastfm' | 'spotify'
export const activeUserId = writable(null);
export const rngTracks = writable([]);
export const playlistsCount = writable(0);
export const gameInventory = writable({});
export const gameInventoryTimestamps = writable({});
export const starredTrackIds = writable(new Set());
export const gameRolls = writable(0);

export const isSpinning = writable(false);
export const reelVelocity = writable(0);
export const reelCurrentX = writable(null);
export const isAutoRolling = writable(false);
export const isAutoSkip = writable(false);
export const isRollNudgeActive = writable(false);
export const isRollShimmerActive = writable(false);
export const autoRollMode = writable(
  typeof localStorage !== 'undefined' && localStorage.getItem('crate_autoroll_mode') === 'on_track_end'
    ? 'on_track_end'
    : 'immediate'
); // 'immediate' | 'on_track_end'

export const activeWinnerCard = writable(null);
export const activeArenaTrack = writable(null);
export const activeBinderTrack = writable(null);

export const isArenaPlaying = writable(false);
export const isBinderPlaying = writable(false);
export const arenaAudioTime = writable({ current: 0, duration: 30 });
export const binderAudioTime = writable({ current: 0, duration: 30 });

export const debugLogs = writable([
  { level: 'system', message: 'Ready. Enter a Spotify profile URL and click \'Fetch & Build Crate\'.' }
]);
export const debugStatus = writable('idle'); // 'idle' | 'active' | 'success' | 'error'
export const isBuildingCrate = writable(false);
export const isCrateReady = writable(false);
export const isLoggingOut = writable(false);

export const activeModal = writable(null); // 'binder' | 'rates' | 'settings' | null

// Telemetry derived stores
export const unlockedCount = derived(gameInventory, ($inv) => Object.keys($inv).length);
export const masteryText = derived([unlockedCount, rngTracks], ([$count, $tracks]) => `${$count} / ${$tracks.length}`);
export const masteryPercent = derived([unlockedCount, rngTracks], ([$count, $tracks]) => {
  if (!$tracks.length) return 0;
  return Math.round(($count / $tracks.length) * 100);
});

export const userAvatarUrl = writable(null);

export const rarestRolledInfo = derived([gameInventory, rngTracks], ([$inv, $tracks]) => {
  const tierRanks = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 };
  const tierColors = {
    mythic: '#F43F5E',
    legendary: '#F59E0B',
    epic: '#A855F7',
    rare: '#3B82F6',
    uncommon: '#10B981',
    common: '#94A3B8'
  };
  let highestRank = 0;
  let rarestName = '-';
  let rarestColor = '#94A3B8';
  Object.keys($inv).forEach((id) => {
    const item = $tracks.find((t) => t.id === id);
    if (item && tierRanks[item.rarityTier] > highestRank) {
      highestRank = tierRanks[item.rarityTier];
      rarestName = item.rarityName;
      rarestColor = item.rarityColor || tierColors[item.rarityTier] || '#94A3B8';
    }
  });
  return { name: rarestName, color: rarestColor };
});

export const rarestRolled = derived(rarestRolledInfo, ($info) => $info.name);

function getStoreMode() {
  let m = 'lastfm';
  activeMode.subscribe((val) => {
    if (val) m = val;
  })();
  return m;
}

// Load saved data for user scoped by mode
export function loadUserData(userId, mode = null) {
  if (!userId) return;
  const currentMode = mode || getStoreMode();
  try {
    const modeInvKey = `crate_rng_inv_${currentMode}_${userId}`;
    const modeRollsKey = `crate_rng_rolls_${currentMode}_${userId}`;
    const modeTimesKey = `crate_rng_times_${currentMode}_${userId}`;
    const modeStarredKey = `crate_starred_${currentMode}_${userId}`;

    let savedInv = localStorage.getItem(modeInvKey);
    let savedRolls = localStorage.getItem(modeRollsKey);
    let savedTimes = localStorage.getItem(modeTimesKey);
    let savedStarred = localStorage.getItem(modeStarredKey);

    // Backwards compatibility for lastfm primary mode if mode key not yet written
    if (!savedInv && currentMode === 'lastfm') {
      savedInv = localStorage.getItem(`crate_rng_inv_${userId}`);
      savedRolls = localStorage.getItem(`crate_rng_rolls_${userId}`);
      savedTimes = localStorage.getItem(`crate_rng_times_${userId}`);
      savedStarred = localStorage.getItem(`crate_starred_${userId}`);
    }

    if (savedInv) gameInventory.set(JSON.parse(savedInv));
    if (savedRolls) gameRolls.set(parseInt(savedRolls, 10) || 0);
    if (savedTimes) gameInventoryTimestamps.set(JSON.parse(savedTimes));
    if (savedStarred) starredTrackIds.set(new Set(JSON.parse(savedStarred)));
  } catch (e) {}
}

export function saveUserData(userId, inv, rolls, times, starred = null, mode = null) {
  if (!userId) return;
  const currentMode = mode || getStoreMode();
  try {
    localStorage.setItem(`crate_rng_inv_${currentMode}_${userId}`, JSON.stringify(inv));
    localStorage.setItem(`crate_rng_rolls_${currentMode}_${userId}`, rolls.toString());
    localStorage.setItem(`crate_rng_times_${currentMode}_${userId}`, JSON.stringify(times));
    if (starred !== null && starred !== undefined) {
      localStorage.setItem(`crate_starred_${currentMode}_${userId}`, JSON.stringify([...starred]));
    }
  } catch (e) {}
}

export function toggleStar(trackId) {
  if (!trackId) return;
  let isStarredNow = false;
  let currentUserId = null;

  activeUserId.subscribe((u) => (currentUserId = u))();

  starredTrackIds.update((set) => {
    const next = new Set(set);
    if (next.has(trackId)) {
      next.delete(trackId);
      playUnstarSound();
      isStarredNow = false;
    } else {
      next.add(trackId);
      playStarSound();
      isStarredNow = true;
    }
    if (currentUserId) {
      try {
        const currentMode = getStoreMode();
        localStorage.setItem(`crate_starred_${currentMode}_${currentUserId}`, JSON.stringify([...next]));
      } catch (e) {}
    }
    return next;
  });

  return isStarredNow;
}

export function appendLog(message, level = 'info', time = '') {
  debugLogs.update((logs) => [...logs, { message, level, time }]);
}

function loadRecentProfilesFromStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('crate_recent_profiles');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Sanitize entries to ensure fetchTarget exists
    return parsed.map((p) => {
      const fetchTarget = (p.input || p.fetchTarget || (p.mode === 'lastfm' ? p.userId : '') || '').trim();
      return {
        ...p,
        fetchTarget: fetchTarget || p.userId,
        displayName: p.displayName || p.userId,
      };
    });
  } catch (e) {
    return [];
  }
}

export const recentProfiles = writable(loadRecentProfilesFromStorage());

export function saveRecentProfile(profile) {
  if (!profile || (!profile.userId && !profile.fetchTarget)) return;
  const target = (profile.fetchTarget || profile.input || profile.rawUserId || profile.userId || '').trim();
  const display = (profile.displayName || profile.userId || target).trim();

  recentProfiles.update((list) => {
    const filtered = list.filter(
      (p) => !(
        ((p.fetchTarget && p.fetchTarget.toLowerCase() === target.toLowerCase()) ||
         (p.userId && p.userId.toLowerCase() === display.toLowerCase())) &&
        p.mode === profile.mode
      )
    );
    const updated = [
      {
        userId: display,
        displayName: display,
        fetchTarget: target,
        mode: profile.mode,
        input: target,
        avatarUrl: profile.avatarUrl || null,
        tracksCount: profile.tracksCount || 0,
        playlistsCount: profile.playlistsCount || 0,
        lastLoaded: Date.now(),
      },
      ...filtered,
    ].slice(0, 6);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('crate_recent_profiles', JSON.stringify(updated));
      }
    } catch (e) {}
    return updated;
  });
}

export function removeRecentProfile(identifier, mode) {
  recentProfiles.update((list) => {
    const cleanId = (identifier || '').toLowerCase();
    const updated = list.filter(
      (p) => !(
        ((p.fetchTarget && p.fetchTarget.toLowerCase() === cleanId) ||
         (p.userId && p.userId.toLowerCase() === cleanId)) &&
        p.mode === mode
      )
    );
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('crate_recent_profiles', JSON.stringify(updated));
      }
    } catch (e) {}
    return updated;
  });
}

export function clearRecentProfiles() {
  recentProfiles.set([]);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('crate_recent_profiles');
    }
  } catch (e) {}
}

