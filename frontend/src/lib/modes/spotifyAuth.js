/**
 * Spotify PKCE Authentication and Web API client.
 * Runs 100% in the browser on static hosts (GitHub Pages) with zero backend.
 */

const SPOTIFY_AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

const STORAGE_KEY_TOKEN = "crate_spotify_access_token";
const STORAGE_KEY_EXPIRY = "crate_spotify_token_expiry";
const STORAGE_KEY_CLIENT_ID = "crate_spotify_client_id";
const STORAGE_KEY_VERIFIER = "crate_spotify_code_verifier";

function getRedirectUri() {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function generateRandomString(length) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values).map((x) => possible[x % possible.length]).join("");
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64urlencode(a) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(a)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function getSavedClientId() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEY_CLIENT_ID) || "";
}

export function saveClientId(clientId) {
  if (typeof window === "undefined") return;
  if (clientId) {
    localStorage.setItem(STORAGE_KEY_CLIENT_ID, clientId.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_CLIENT_ID);
  }
}

export function getAccessToken() {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(STORAGE_KEY_TOKEN);
  const expiry = parseInt(localStorage.getItem(STORAGE_KEY_EXPIRY) || "0", 10);
  if (!token || Date.now() > expiry) {
    return null;
  }
  return token;
}

export function disconnectSpotify() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_EXPIRY);
  sessionStorage.removeItem(STORAGE_KEY_VERIFIER);
}

export async function loginWithSpotify(clientId) {
  if (!clientId) throw new Error("Client ID is required.");
  saveClientId(clientId);

  const verifier = generateRandomString(64);
  sessionStorage.setItem(STORAGE_KEY_VERIFIER, verifier);

  const hashed = await sha256(verifier);
  const challenge = base64urlencode(hashed);
  const redirectUri = getRedirectUri();

  const scopes = [
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-read-private",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: scopes,
  });

  window.location.href = `${SPOTIFY_AUTH_ENDPOINT}?${params.toString()}`;
}

export async function handleAuthCallback() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;

  const verifier = sessionStorage.getItem(STORAGE_KEY_VERIFIER);
  const clientId = getSavedClientId();
  if (!verifier || !clientId) return null;

  const redirectUri = getRedirectUri();
  const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  // Clean URL query params without reloading
  window.history.replaceState({}, document.title, redirectUri);
  sessionStorage.removeItem(STORAGE_KEY_VERIFIER);

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error_description || "Spotify token exchange failed.");
  }

  const data = await response.json();
  const expiry = Date.now() + (data.expires_in - 60) * 1000;
  localStorage.setItem(STORAGE_KEY_TOKEN, data.access_token);
  localStorage.setItem(STORAGE_KEY_EXPIRY, String(expiry));

  return data.access_token;
}

export async function fetchCurrentUserProfile(token) {
  const res = await fetch(`${SPOTIFY_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not fetch profile (HTTP ${res.status})`);
  return res.json();
}

export async function fetchUserLibraryPlaylists(token) {
  let url = `${SPOTIFY_API_BASE}/me/playlists?limit=50`;
  const playlists = [];
  while (url && playlists.length < 100) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Could not fetch playlists (HTTP ${res.status})`);
    const data = await res.json();
    playlists.push(...(data.items || []));
    url = data.next;
  }
  return playlists;
}

export async function fetchOtherUserPlaylists(token, userId) {
  const cleanId = userId.trim();
  let url = `${SPOTIFY_API_BASE}/users/${encodeURIComponent(cleanId)}/playlists?limit=50`;
  const playlists = [];
  try {
    while (url && playlists.length < 50) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) break;
      const data = await res.json();
      playlists.push(...(data.items || []));
      url = data.next;
    }
  } catch (e) {
    // Ignore pagination errors
  }
  return playlists;
}

export async function fetchFullPlaylistTracks(token, playlistId) {
  let url = `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks?limit=100`;
  const tracks = [];
  while (url && tracks.length < 200) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    for (const item of data.items || []) {
      if (item && item.track) {
        tracks.push(item.track);
      }
    }
    url = data.next;
  }
  return tracks;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function compileMultiPlaylistCrate(token, selectedPlaylists, onProgress) {
  const trackMap = new Map();
  const totalP = selectedPlaylists.length;

  for (let i = 0; i < totalP; i++) {
    const p = selectedPlaylists[i];
    const pName = p.name || "Playlist";
    const pId = p.id || "";
    const pCover = (p.images && p.images.length > 0) ? p.images[0].url : "";
    if (onProgress) onProgress(`[${i + 1}/${totalP}] Fetching '${pName}'...`);

    const tracks = await fetchFullPlaylistTracks(token, pId);
    for (const t of tracks) {
      const title = (t.name || "").trim();
      const artist = (t.artists && t.artists.length > 0) ? t.artists.map((a) => a.name).join(", ").trim() : "";
      if (!title || !artist) continue;

      const key = `${title.toLowerCase()}||${artist.toLowerCase()}`;
      const coverUrl = (t.album && t.album.images && t.album.images.length > 0) ? t.album.images[0].url : pCover;
      // Prefer empty preview_url so the multi-tier Apple/iTunes 30s resolver resolves full previews
      const previewUrl = "";
      const spotifyUrl = t.external_urls?.spotify || (t.id ? `https://open.spotify.com/track/${t.id}` : "");

      if (!trackMap.has(key)) {
        trackMap.set(key, {
          id: key,
          spotify_id: t.id || "",
          title,
          artist,
          album_cover_url: coverUrl,
          playlist_cover_url: pCover,
          cover_url: coverUrl,
          playlist_name: pName,
          playlist_id: pId,
          playlist_uri: p.uri || "",
          playlist_url: p.external_urls?.spotify || `https://open.spotify.com/playlist/${pId}`,
          preview_url: previewUrl,
          uri: t.uri || "",
          spotify_url: spotifyUrl,
          duration_ms: t.duration_ms || 0,
          source: "spotify",
          source_url: spotifyUrl,
          playlists: [],
        });
      }

      trackMap.get(key).playlists.push({
        name: pName,
        id: pId,
        cover_url: pCover,
        count: tracks.length,
      });
    }
  }

  const allTrackItems = Array.from(trackMap.values());
  if (allTrackItems.length === 0) {
    throw new Error("No playable tracks found in selected playlists.");
  }

  if (onProgress) onProgress("Calculating dynamic rarity pyramid across all tracks...");

  const isSingle = totalP === 1;
  const scores = new Map();
  for (const t of allTrackItems) {
    if (isSingle) {
      scores.set(t.id, hashString(t.id));
    } else {
      const appCount = t.playlists.length;
      const minSize = Math.min(...t.playlists.map((x) => Math.max(1, x.count)));
      const score = Math.pow(100.0 / minSize, 1.3) / Math.pow(appCount, 0.75);
      scores.set(t.id, score);
    }
  }

  allTrackItems.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));

  const total = allTrackItems.length;
  const tierTargetProbs = {
    mythic: 0.005,
    legendary: 0.025,
    epic: 0.070,
    rare: 0.140,
    uncommon: 0.260,
    common: 0.500,
  };

  const tierCounts = { mythic: 0, legendary: 0, epic: 0, rare: 0, uncommon: 0, common: 0 };
  const tempSpecs = [];

  for (let rank = 0; rank < total; rank++) {
    const pct = (rank + 0.5) / Math.max(1, total);
    let tier, name, color, odds, tPct;
    if (pct <= 0.012) {
      tier = "mythic"; name = "Mythic"; color = "#F43F5E"; odds = 200; tPct = pct / 0.012;
    } else if (pct <= 0.045) {
      tier = "legendary"; name = "Legendary"; color = "#F59E0B"; odds = 40; tPct = (pct - 0.012) / (0.045 - 0.012);
    } else if (pct <= 0.125) {
      tier = "epic"; name = "Epic"; color = "#A855F7"; odds = 14; tPct = (pct - 0.045) / (0.125 - 0.045);
    } else if (pct <= 0.28) {
      tier = "rare"; name = "Rare"; color = "#3B82F6"; odds = 7; tPct = (pct - 0.125) / (0.28 - 0.125);
    } else if (pct <= 0.55) {
      tier = "uncommon"; name = "Uncommon"; color = "#10B981"; odds = 4; tPct = (pct - 0.28) / (0.55 - 0.28);
    } else {
      tier = "common"; name = "Common"; color = "#94A3B8"; odds = 2; tPct = (pct - 0.55) / (1.0 - 0.55);
    }
    tierCounts[tier]++;
    tempSpecs.push({ tier, name, color, odds, tPct });
  }

  const finalTracks = allTrackItems.map((t, idx) => {
    const spec = tempSpecs[idx];
    const count = Math.max(1, tierCounts[spec.tier]);
    const targetProb = tierTargetProbs[spec.tier];
    const poolWeight = 100000.0 * targetProb;
    const fineMod = 0.85 + (0.30 * (1.0 - spec.tPct));
    const weight = Math.max(1, Math.round((poolWeight / count) * fineMod));

    return {
      ...t,
      rarityTier: spec.tier,
      rarityName: spec.name,
      rarityColor: spec.color,
      dropChance: `1 in ${spec.odds.toLocaleString()}`,
      weight,
      release_date: "",
    };
  });

  return {
    type: "ready",
    userId: selectedPlaylists[0]?.owner?.display_name || "Spotify Crate",
    rawUserId: selectedPlaylists[0]?.owner?.id || "spotify",
    avatarUrl: selectedPlaylists[0]?.images?.[0]?.url || null,
    playlistsCount: selectedPlaylists.length,
    tracksCount: finalTracks.length,
    tracks: finalTracks,
    distribution: tierCounts,
  };
}
