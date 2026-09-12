#!/usr/bin/env python3
"""
Spotify Crate RNG - Backend Server
Zero-dependency HTTP server with SSE (Server-Sent Events) live streaming.
Scrapes Spotify profile playlists, fetches track embeds, calculates dynamic rarity,
and serves the standalone Crate RNG game.
"""

import http.server
import urllib.request
import urllib.parse
import json
import re
import os
import sys
import time
import functools
import statistics
import hashlib
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, "dist")
PUBLIC_DIR = DIST_DIR if os.path.exists(DIST_DIR) else os.path.join(BASE_DIR, "public")
DATA_DIR = os.path.join(BASE_DIR, "data")
PORT = 8080

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
}

def extract_spotify_target(input_str):
    """Detect whether input is a playlist URL/ID or user profile URL/ID."""
    raw = input_str.strip()
    if "spotify.com/playlist/" in raw:
        pid = raw.split("spotify.com/playlist/")[1].split("?")[0].split("/")[0].strip()
        return ("playlist", pid)
    if raw.startswith("spotify:playlist:"):
        pid = raw.split(":")[-1].strip()
        return ("playlist", pid)
    if "spotify.com/user/" in raw:
        uid = raw.split("spotify.com/user/")[1].split("?")[0].split("/")[0].strip()
        return ("user", uid)
    if raw.startswith("spotify:user:"):
        uid = raw.split(":")[-1].strip()
        return ("user", uid)
    clean = raw.split("?")[0].strip()
    return ("user", clean)

def extract_user_id(profile_input):
    """Extract clean Spotify user ID or playlist ID from URL or raw username."""
    _, target_id = extract_spotify_target(profile_input)
    return target_id

def scrape_user_profile(user_id):
    """Scrape display name and avatar URL from Spotify profile via OpenGraph metadata."""
    url = f"https://open.spotify.com/user/{user_id}"
    # Crawler user-agent prompts Spotify to return pre-rendered OpenGraph metadata
    req = urllib.request.Request(url, headers={"User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"})
    info = {"displayName": user_id, "avatarUrl": None}
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        m_title = re.search(r'property=[\'"]og:title[\'"]\s+content=[\'"]([^\'"]+)[\'"]', html)
        if m_title:
            name = m_title.group(1).strip()
            if name and name.lower() != "spotify":
                info["displayName"] = name
        m_img = re.search(r'property=[\'"]og:image[\'"]\s+content=[\'"]([^\'"]+)[\'"]', html)
        if m_img:
            img_url = m_img.group(1).strip()
            if img_url and ("spotifycdn.com" in img_url or "scdn.co" in img_url):
                info["avatarUrl"] = img_url
    except Exception:
        pass
    return info

def scrape_playlists_urllib(user_id):
    """Scrape playlist IDs and names from profile using initialState and HTML regex."""
    url = f"https://open.spotify.com/user/{user_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    playlists = {}
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        # 1. First attempt: Parse initialState JSON embedded by Spotify
        m_state = re.search(r'<script id="initialState"[^>]*>(.*?)</script>', html, re.DOTALL)
        if m_state:
            import base64
            try:
                decoded = base64.b64decode(m_state.group(1).strip()).decode("utf-8", errors="ignore")
                state_data = json.loads(decoded)
                items = state_data.get("entities", {}).get("items", {})
                for k, entity in items.items():
                    if entity.get("__typename") == "User":
                        for p_item in entity.get("publicPlaylistsV2", {}).get("items", []):
                            p_data = p_item.get("data", {})
                            uri = p_data.get("uri") or p_item.get("_uri", "")
                            p_id = uri.split(":")[-1] if uri else ""
                            if len(p_id) == 22:
                                playlists[p_id] = p_data.get("name") or "Playlist"
            except Exception:
                pass

        # 2. Fallback / supplementary regex for direct href links
        matches = re.findall(r'href=[\'"]/playlist/([a-zA-Z0-9]{22})[\'"]', html)
        for pid in set(matches):
            if pid not in playlists:
                playlists[pid] = "Playlist"
    except Exception:
        pass
    return playlists

def scrape_playlists_playwright(user_id, sse_emitter=None):
    """Scrape playlist IDs from profile using Playwright for JS-rendered profiles."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {}

    playlists = {}
    if sse_emitter:
        sse_emitter("Launching browser engine to inspect profile playlists...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        url = f"https://open.spotify.com/user/{user_id}"
        page.goto(url, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(2000)

        # Scroll to load public playlists
        for _ in range(3):
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(800)

        links = page.locator('a[href*="/playlist/"]').all()
        for a in links:
            try:
                href = a.get_attribute("href")
                text = a.inner_text().strip()
                if href and "/playlist/" in href:
                    pid = href.split("/playlist/")[1].split("?")[0]
                    if len(pid) == 22 and pid not in playlists:
                        playlists[pid] = text or "Curated Playlist"
            except Exception:
                continue

        browser.close()
    return playlists

def fetch_playlist_embed(pid):
    """Fetch track details and metadata via Spotify embed endpoint without API keys."""
    embed_url = f"https://open.spotify.com/embed/playlist/{pid}"
    req = urllib.request.Request(embed_url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="ignore")

    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
    if not m:
        return None

    data = json.loads(m.group(1))
    entity = (
        data.get("props", {})
        .get("pageProps", {})
        .get("state", {})
        .get("data", {})
        .get("entity", {})
    )
    return entity

def compute_dynamic_rarity_tracks(playlists_data):
    """Calculate dynamic rarity tiers based on playlist sizes and appearances."""
    track_map = {}
    for p in playlists_data:
        p_name = p.get("name", "Playlist")
        p_id = p.get("id", "")
        p_uri = p.get("uri") or (f"spotify:playlist:{p_id}" if p_id else "")
        p_url = f"https://open.spotify.com/playlist/{p_id}" if p_id else ""
        p_cover = ""
        cover_art = p.get("coverArt", {})
        if isinstance(cover_art, dict) and cover_art.get("sources"):
            p_cover = cover_art["sources"][0].get("url", "")
        p_tracks = p.get("trackList", [])

        for t in p_tracks:
            title = t.get("title", "").strip()
            artist = t.get("subtitle", "").strip()
            if not title or not artist:
                continue

            audio_preview = t.get("audioPreview")
            preview_url = t.get("preview_url") or (audio_preview.get("url", "") if isinstance(audio_preview, dict) else "")

            track_key = f"{title.lower()}||{artist.lower()}"
            if track_key not in track_map:
                track_map[track_key] = {
                    "title": title,
                    "artist": artist,
                    "uri": t.get("uri", ""),
                    "preview_url": "",
                    "raw_preview_url": preview_url,
                    "cover_url": p_cover,
                    "duration_ms": t.get("duration", 0),
                    "playlists": []
                }
            track_map[track_key]["playlists"].append({
                "name": p_name,
                "cover_url": p_cover,
                "count": len(p_tracks),
                "id": p_id,
                "uri": p_uri,
                "url": p_url
            })

    ART_CACHE_FILE = os.path.join(DATA_DIR, "album_art_cache.json")
    art_cache = {}
    if os.path.exists(ART_CACHE_FILE):
        try:
            with open(ART_CACHE_FILE, "r", encoding="utf-8") as f:
                art_cache = json.load(f)
        except Exception:
            art_cache = {}

    # --- Dynamic Rarity Formula (Percentile Pyramid + Bayesian Prior) ---
    playlist_sizes = [len(p.get("trackList", [])) for p in playlists_data if len(p.get("trackList", [])) > 0]
    median_playlist_size = float(statistics.median(playlist_sizes)) if playlist_sizes else 25.0
    prior_weight = 8.0  # Smooths tiny playlists (< 10 tracks) toward profile median

    # 1. Compute smooth scarcity scores
    is_single_playlist = len(playlists_data) == 1
    scores = {}
    for key, t in track_map.items():
        p_list = t["playlists"]
        app_count = len(p_list)

        if is_single_playlist:
            # Single playlist: rank deterministically using track hash
            h = int(hashlib.md5(key.encode("utf-8")).hexdigest()[:8], 16)
            score = float(h)
        else:
            eff_sizes = []
            for p in p_list:
                raw_n = max(1, p["count"])
                # Bayesian smoothing: small playlists (< 10 tracks) smoothly regress toward median
                smoothed_n = (raw_n + prior_weight * (median_playlist_size / 10.0)) / (1.0 + prior_weight / 10.0)
                eff_sizes.append(smoothed_n)

            min_eff_size = min(eff_sizes)
            # Scarcity: smaller effective playlist size = rarer; appearing in multiple playlists = more common
            score = ((100.0 / min_eff_size) ** 1.3) / (app_count ** 0.75)
        scores[key] = score

    # 2. Percentile ranking across entire user crate
    sorted_keys = sorted(track_map.keys(), key=lambda k: scores[k], reverse=True)
    total_unique = len(sorted_keys)

    raw_specs = {}
    tier_counts = {
        "mythic": 0, "legendary": 0, "epic": 0, "rare": 0, "uncommon": 0, "common": 0
    }

    for rank, key in enumerate(sorted_keys):
        pct = (rank + 0.5) / max(1, total_unique)

        if pct <= 0.012:  # Top ~1.2%
            tier = "mythic"
            name = "Mythic"
            color = "#F43F5E"
            t_pct = pct / 0.012
            target_odds = 200
        elif pct <= 0.045:  # Next ~3.3%
            tier = "legendary"
            name = "Legendary"
            color = "#F59E0B"
            t_pct = (pct - 0.012) / (0.045 - 0.012)
            target_odds = 40
        elif pct <= 0.125:  # Next ~8%
            tier = "epic"
            name = "Epic"
            color = "#A855F7"
            t_pct = (pct - 0.045) / (0.125 - 0.045)
            target_odds = 14
        elif pct <= 0.28:  # Next ~15.5%
            tier = "rare"
            name = "Rare"
            color = "#3B82F6"
            t_pct = (pct - 0.125) / (0.28 - 0.125)
            target_odds = 7
        elif pct <= 0.55:  # Next ~27%
            tier = "uncommon"
            name = "Uncommon"
            color = "#10B981"
            t_pct = (pct - 0.28) / (0.55 - 0.28)
            target_odds = 4
        else:  # Bottom 45%
            tier = "common"
            name = "Common"
            color = "#94A3B8"
            t_pct = (pct - 0.55) / (1.0 - 0.55)
            target_odds = 2

        tier_counts[tier] += 1
        raw_specs[key] = (tier, name, color, target_odds, t_pct)

    # Dynamic target probabilities (calibrated for balanced crate roll experience)
    tier_target_probs = {
        "mythic": 0.005,      # 0.50% (1 in 200)
        "legendary": 0.025,   # 2.50% (1 in 40)
        "epic": 0.070,        # 7.00% (1 in 14)
        "rare": 0.140,        # 14.00% (1 in 7)
        "uncommon": 0.260,    # 26.00% (1 in 4)
        "common": 0.500       # 50.00% (1 in 2)
    }

    tier_specs = {}
    for key, (tier, name, color, target_odds, t_pct) in raw_specs.items():
        count = max(1, tier_counts[tier])
        target_prob = tier_target_probs[tier]
        # Pool weight allocation per tier out of 100,000
        pool_weight = 100000.0 * target_prob
        # Fine-grain weight variation within tier based on rank
        fine_mod = 0.85 + (0.30 * (1.0 - t_pct))
        track_weight = max(1, int(round((pool_weight / count) * fine_mod)))
        drop_chance_str = f"1 in {target_odds:,}"
        tier_specs[key] = (tier, name, color, drop_chance_str, track_weight)

    META_CACHE_FILE = os.path.join(DATA_DIR, "track_meta_cache.json")
    meta_cache = {}
    if os.path.exists(META_CACHE_FILE):
        try:
            with open(META_CACHE_FILE, "r", encoding="utf-8") as f:
                meta_cache = json.load(f)
        except Exception:
            meta_cache = {}

    all_tracks = []
    for key, t in track_map.items():
        p_list = t["playlists"]
        rarity_tier, rarity_name, rarity_color, drop_chance, weight = tier_specs[key]

        spotify_id = t["uri"].split(":")[-1] if t["uri"] else ""
        spotify_url = f"https://open.spotify.com/track/{spotify_id}" if spotify_id else ""
        playlist_cover = p_list[0]["cover_url"]
        album_cover = art_cache.get(spotify_id, "")

        all_tracks.append({
            "id": key,
            "spotify_id": spotify_id,
            "title": t["title"],
            "artist": t["artist"],
            "album_cover_url": album_cover or playlist_cover,
            "playlist_cover_url": playlist_cover,
            "cover_url": album_cover or playlist_cover,
            "playlist_name": p_list[0]["name"],
            "playlist_id": p_list[0].get("id", ""),
            "playlist_uri": p_list[0].get("uri", ""),
            "playlist_url": p_list[0].get("url", ""),
            "preview_url": "",
            "raw_preview_url": t.get("raw_preview_url", "") or t.get("preview_url", ""),
            "uri": t["uri"] or (f"spotify:track:{spotify_id}" if spotify_id else ""),
            "spotify_url": spotify_url,
            "rarityTier": rarity_tier,
            "rarityName": rarity_name,
            "rarityColor": rarity_color,
            "dropChance": drop_chance,
            "weight": weight,
            "release_date": meta_cache.get(spotify_id, "")
        })

    return all_tracks


LASTFM_API_KEYS = [
    "a93da16045abb894cb7a4482255247bb",
    "d64ba82baaf21554416b25365c114455",
    "ffd6c3e445e45d0d4bc124184853b772",
    "0356663ee33a0a5d27428b1f63011652",
    "b25b959554ed76058ac220b7b2e0a026"
]


def request_lastfm_api(method, params, headers=None, sse_log_fn=None):
    """Call Last.fm API with automatic key failover on rate limits."""
    if headers is None:
        headers = {"User-Agent": "CrateRNG/2.0"}
    for idx, key in enumerate(LASTFM_API_KEYS):
        all_params = {"method": method, "api_key": key, "format": "json"}
        all_params.update(params)
        qs = urllib.parse.urlencode(all_params)
        url = f"https://ws.audioscrobbler.com/2.0/?{qs}"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
                if data.get("error") == 29:
                    if sse_log_fn:
                        sse_log_fn(f"Key #{idx + 1} rate limited. Switching to backup key...", "warning")
                    continue
                if "error" in data:
                    raise Exception(data.get("message") or f"Last.fm error {data.get('error')}")
                return data
        except urllib.error.HTTPError as he:
            if he.code == 429:
                if sse_log_fn:
                    sse_log_fn(f"Key #{idx + 1} hit HTTP 429. Switching to backup key...", "warning")
                continue
            raise
        except Exception:
            if idx < len(LASTFM_API_KEYS) - 1:
                continue
            raise
    raise Exception("All Last.fm API keys rate limited.")


def fetch_lastfm_crate(username, sse_log_fn=None):
    """Fetch user's top tracks from Last.fm and format them as Crate RNG tracks."""
    headers = {"User-Agent": "CrateRNG/2.0"}
    
    if sse_log_fn:
        sse_log_fn(f"Fetching Last.fm user info for '{username}'...")
        
    user_info = {"displayName": username, "avatarUrl": None, "playcount": 0}
    try:
        u_data = request_lastfm_api("user.getinfo", {"user": username}, headers=headers, sse_log_fn=sse_log_fn)
        if u_data:
            u = u_data.get("user", {})
            user_info["displayName"] = u.get("name") or username
            images = u.get("image", [])
            if images and isinstance(images, list):
                user_info["avatarUrl"] = images[-1].get("#text") or None
    except Exception as e:
        if sse_log_fn:
            sse_log_fn(f"Notice getting user info: {e}", "warning")

    if sse_log_fn:
        sse_log_fn(f"Fetching listening history from Last.fm for '{username}'...", "info")

    raw_scrobbles = []
    # 1. Fetch page 1
    total_pages = 1
    try:
        t_data = request_lastfm_api("user.getrecenttracks", {"user": username, "limit": 200, "page": 1}, headers=headers, sse_log_fn=sse_log_fn)
        if t_data:
            batch = t_data.get("recenttracks", {}).get("track", [])
            raw_scrobbles.extend(batch)
            total_pages = int(t_data.get("recenttracks", {}).get("@attr", {}).get("totalPages", 1))
            total_scrobbles = int(t_data.get("recenttracks", {}).get("@attr", {}).get("total", len(batch)))
            if sse_log_fn:
                sse_log_fn(f"Found {total_scrobbles:,} all-time scrobbles across {total_pages} pages.", "info")
    except Exception as e:
        if sse_log_fn:
            sse_log_fn(f"Notice fetching initial page: {e}", "warning")

    if not raw_scrobbles:
        return None, None

    # Build timeline pages spanning newest, intermediate milestones, and oldest scrobbles
    if total_pages <= 6:
        extra_pages = list(range(2, total_pages + 1))
    else:
        sampled = {
            2, 3,
            round(total_pages * 0.25),
            round(total_pages * 0.50),
            round(total_pages * 0.75),
            total_pages - 1,
            total_pages
        }
        sampled.discard(1)
        extra_pages = sorted([p for p in sampled if 1 < p <= total_pages])

    if extra_pages and sse_log_fn:
        sse_log_fn(f"Sampling listening timeline across pages: {', '.join(map(str, extra_pages))}...", "info")

    for p in extra_pages:
        try:
            t_data = request_lastfm_api("user.getrecenttracks", {"user": username, "limit": 200, "page": p}, headers=headers, sse_log_fn=sse_log_fn)
            if t_data:
                batch = t_data.get("recenttracks", {}).get("track", [])
                raw_scrobbles.extend(batch)
            time.sleep(0.15)
        except Exception as e:
            if sse_log_fn:
                sse_log_fn(f"Notice fetching page {p}: {e}", "warning")

    if not raw_scrobbles:
        return None, None

    now_ts = int(time.time())
    track_dict = {}
    for t in raw_scrobbles:
        title = t.get("name", "").strip()
        artist_obj = t.get("artist", {})
        artist = (artist_obj.get("#text") if isinstance(artist_obj, dict) else str(artist_obj)).strip()
        if not title or not artist:
            continue
        key = (title.lower(), artist.lower())

        is_now_playing = t.get("@attr", {}).get("nowplaying") == "true"
        date_obj = t.get("date", {})
        uts = now_ts if is_now_playing else int(date_obj.get("uts", 0))
        date_text = "Now Playing" if is_now_playing else date_obj.get("#text", "Past listen")

        images = t.get("image", [])
        cover_url = images[-1].get("#text") if (images and isinstance(images, list)) else ""

        if key not in track_dict:
            track_dict[key] = {
                "title": title,
                "artist": artist,
                "last_played_uts": uts,
                "last_played_text": date_text,
                "cover_url": cover_url,
                "url": t.get("url", f"https://www.last.fm/user/{username}"),
                "play_count": 1
            }
        else:
            track_dict[key]["play_count"] += 1
            if uts > track_dict[key]["last_played_uts"]:
                track_dict[key]["last_played_uts"] = uts
                track_dict[key]["last_played_text"] = date_text

    unique_tracks = list(track_dict.values())
    # Sort ascending: lowest timestamp (oldest last played) = rank 0 = Mythic
    unique_tracks.sort(key=lambda x: x["last_played_uts"])

    total = len(unique_tracks)
    if sse_log_fn:
        sse_log_fn(f"Compiled {total} unique tracks from listening history.", "success")
        sse_log_fn("Calculating rarity: oldest played = Mythic, newest played = Common...", "info")

    all_tracks = []
    
    tier_target_probs = {
        "mythic": 0.005,
        "legendary": 0.025,
        "epic": 0.070,
        "rare": 0.140,
        "uncommon": 0.260,
        "common": 0.500
    }
    
    tier_counts = {"mythic": 0, "legendary": 0, "epic": 0, "rare": 0, "uncommon": 0, "common": 0}
    temp_specs = []
    for rank in range(total):
        pct = (rank + 0.5) / max(1, total)
        if pct <= 0.012:
            tier, name, color, odds, t_pct = "mythic", "Mythic", "#F43F5E", 200, pct / 0.012
        elif pct <= 0.045:
            tier, name, color, odds, t_pct = "legendary", "Legendary", "#F59E0B", 40, (pct - 0.012) / (0.045 - 0.012)
        elif pct <= 0.125:
            tier, name, color, odds, t_pct = "epic", "Epic", "#A855F7", 14, (pct - 0.045) / (0.125 - 0.045)
        elif pct <= 0.28:
            tier, name, color, odds, t_pct = "rare", "Rare", "#3B82F6", 7, (pct - 0.125) / (0.28 - 0.125)
        elif pct <= 0.55:
            tier, name, color, odds, t_pct = "uncommon", "Uncommon", "#10B981", 4, (pct - 0.28) / (0.55 - 0.28)
        else:
            tier, name, color, odds, t_pct = "common", "Common", "#94A3B8", 2, (pct - 0.55) / (1.0 - 0.55)
        tier_counts[tier] += 1
        temp_specs.append((tier, name, color, odds, t_pct))

    for i, t in enumerate(unique_tracks):
        tier, name, color, odds, t_pct = temp_specs[i]
        
        count = max(1, tier_counts[tier])
        target_prob = tier_target_probs[tier]
        pool_weight = 100000.0 * target_prob
        fine_mod = 0.85 + (0.30 * (1.0 - t_pct))
        track_weight = max(1, int(round((pool_weight / count) * fine_mod)))
        drop_chance_str = f"1 in {odds:,}"

        track_id = f"lastfm:{username}:{i}"
        all_tracks.append({
            "id": track_id,
            "spotify_id": "",
            "title": t["title"],
            "artist": t["artist"],
            "album_cover_url": t["cover_url"],
            "playlist_cover_url": t["cover_url"],
            "cover_url": t["cover_url"],
            "playlist_name": f"Last played: {t['last_played_text']}",
            "playlist_id": f"lastfm_{username}",
            "playlist_uri": "",
            "playlist_url": t["url"],
            "preview_url": "",
            "uri": "",
            "spotify_url": t["url"],
            "rarityTier": tier,
            "rarityName": name,
            "rarityColor": color,
            "dropChance": drop_chance_str,
            "weight": track_weight,
            "release_date": ""
        })

    return user_info, all_tracks


# ==============================================================================
# SECTION: LAST.FM STREAM HANDLER (ISOLATED)
# ==============================================================================
def handle_lastfm_fetch(profile_url, send_event, log_msg):
    """Handle Last.fm scrobble crate construction and SSE streaming."""
    lastfm_user = profile_url
    if profile_url.startswith("lastfm:"):
        lastfm_user = profile_url.split("lastfm:")[1].strip()
    elif "last.fm/user/" in profile_url.lower():
        lastfm_user = profile_url.split("last.fm/user/")[1].split("/")[0].split("?")[0].strip()

    log_msg(f"Target Last.fm Account: {lastfm_user}", "info")
    u_info, lf_tracks = fetch_lastfm_crate(lastfm_user, sse_log_fn=lambda m, lvl="info": log_msg(m, lvl))
    if not lf_tracks:
        send_event({"type": "error", "message": f"Could not find tracks for Last.fm user '{lastfm_user}'."})
        return

    mythic_cnt = sum(1 for t in lf_tracks if t["rarityTier"] == "mythic")
    legend_cnt = sum(1 for t in lf_tracks if t["rarityTier"] == "legendary")
    epic_cnt = sum(1 for t in lf_tracks if t["rarityTier"] == "epic")
    rare_cnt = sum(1 for t in lf_tracks if t["rarityTier"] == "rare")
    uncommon_cnt = sum(1 for t in lf_tracks if t["rarityTier"] == "uncommon")
    common_cnt = sum(1 for t in lf_tracks if t["rarityTier"] == "common")

    log_msg(f"Library compiled: {len(lf_tracks)} unique tracks from Last.fm listening history.", "success")
    log_msg(f"Rarity Distribution -> Mythic: {mythic_cnt}, Legendary: {legend_cnt}, Epic: {epic_cnt}, Rare: {rare_cnt}, Uncommon: {uncommon_cnt}, Common: {common_cnt}", "info")
    log_msg("Crate RNG initialized. Ready to roll!", "success")

    send_event({
        "type": "ready",
        "userId": u_info.get("displayName") or lastfm_user,
        "rawUserId": lastfm_user,
        "avatarUrl": u_info.get("avatarUrl"),
        "playlistsCount": 1,
        "tracksCount": len(lf_tracks),
        "tracks": lf_tracks,
        "distribution": {
            "mythic": mythic_cnt,
            "legendary": legend_cnt,
            "epic": epic_cnt,
            "rare": rare_cnt,
            "uncommon": uncommon_cnt,
            "common": common_cnt
        }
    })


# ==============================================================================
# SECTION: SOUNDCLOUD STREAM HANDLER (ISOLATED)
# ==============================================================================
SOUNDCLOUD_STREAM_CACHE = {}
LATEST_SOUNDCLOUD_CLIENT_ID = "Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo"


def extract_soundcloud_username(input_str):
    """Extract clean SoundCloud username from URL or raw input."""
    raw = (input_str or "").strip()
    if "soundcloud.com/" in raw:
        parts = raw.split("soundcloud.com/")[1].split("?")[0].split("/")
        return parts[0].strip()
    if raw.startswith("soundcloud:"):
        return raw.split(":")[-1].strip()
    return raw.split("?")[0].strip()


def refresh_soundcloud_client_id():
    """Scrape a fresh client_id from soundcloud.com when credentials expire."""
    global LATEST_SOUNDCLOUD_CLIENT_ID
    try:
        req = urllib.request.Request("https://soundcloud.com/discover", headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        m = re.search(r"window\.__sc_hydration\s*=\s*(\[.*?\]);</script>", html, re.DOTALL)
        if m:
            data = json.loads(m.group(1))
            for item in data:
                if item.get("hydratable") == "apiClient":
                    cid = item.get("data", {}).get("id")
                    if cid:
                        LATEST_SOUNDCLOUD_CLIENT_ID = cid
                        return cid
    except Exception:
        pass
    return LATEST_SOUNDCLOUD_CLIENT_ID


def resolve_soundcloud_profile(username, sse_log_fn=None):
    """Scrape user ID, display name, avatar, and active client_id from SoundCloud profile."""
    global LATEST_SOUNDCLOUD_CLIENT_ID
    url = f"https://soundcloud.com/{username}/likes"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        if sse_log_fn:
            sse_log_fn(f"Could not load SoundCloud page for '{username}': {e}", "warning")
        return LATEST_SOUNDCLOUD_CLIENT_ID, None

    m = re.search(r"window\.__sc_hydration\s*=\s*(\[.*?\]);</script>", html, re.DOTALL)
    if not m:
        return LATEST_SOUNDCLOUD_CLIENT_ID, None

    try:
        data = json.loads(m.group(1))
    except Exception:
        return LATEST_SOUNDCLOUD_CLIENT_ID, None

    client_id = LATEST_SOUNDCLOUD_CLIENT_ID
    user_info = None
    for item in data:
        if item.get("hydratable") == "apiClient":
            cid = item.get("data", {}).get("id")
            if cid:
                client_id = cid
                LATEST_SOUNDCLOUD_CLIENT_ID = cid
        elif item.get("hydratable") == "user":
            user_info = item.get("data")

    return client_id, user_info


def fetch_soundcloud_likes(user_id, client_id, sse_log_fn=None, max_pages=10):
    """Fetch liked tracks from SoundCloud API v2 using cursor pagination."""
    headers = dict(HEADERS)
    url = f"https://api-v2.soundcloud.com/users/{user_id}/likes?limit=200&client_id={client_id}"
    all_items = []
    page = 1

    while url and page <= max_pages:
        if sse_log_fn:
            sse_log_fn(f"Fetching liked tracks from SoundCloud (batch {page}/{max_pages})...", "info")
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            items = data.get("collection", [])
            all_items.extend(items)
            next_href = data.get("next_href")
            if next_href and len(items) > 0:
                if "client_id=" not in next_href:
                    sep = "&" if "?" in next_href else "?"
                    next_href += f"{sep}client_id={client_id}"
                url = next_href
                page += 1
                time.sleep(0.1)
            else:
                break
        except Exception as e:
            if sse_log_fn:
                sse_log_fn(f"Notice while fetching likes batch {page}: {e}", "warning")
            break

    return all_items


def compute_soundcloud_rarity_tracks(likes_data, username, user_id, client_id, user_avatar=None):
    """Format liked tracks into Crate RNG cards ranked by like age (oldest = Mythic)."""
    track_map = {}
    for item in likes_data:
        t = item.get("track")
        if not t or not isinstance(t, dict):
            continue

        title = (t.get("title") or "").strip()
        u = t.get("user") or {}
        artist = (u.get("username") or "").strip()
        t_id = t.get("id")
        if not title or not artist or not t_id:
            continue

        created_at_str = item.get("created_at") or t.get("created_at") or ""
        liked_ts = 0
        liked_date_text = "Past like"
        if created_at_str:
            try:
                clean_iso = created_at_str.replace("Z", "+00:00")
                dt = datetime.fromisoformat(clean_iso)
                liked_ts = dt.timestamp()
                liked_date_text = dt.strftime("%b %d, %Y")
            except Exception:
                liked_date_text = created_at_str[:10]

        raw_art = t.get("artwork_url") or u.get("avatar_url") or ""
        cover_url = raw_art.replace("-large.", "-t500x500.") if raw_art else ""

        # Locate progressive audio transcoding for direct MP3 playback
        media = t.get("media") or {}
        transcodings = media.get("transcodings") or []
        prog_tc = None
        for tc in transcodings:
            fmt = tc.get("format") or {}
            if fmt.get("protocol") == "progressive":
                prog_tc = tc.get("url")
                break

        preview_url = ""
        if prog_tc:
            preview_url = f"/api/soundcloud/stream?url={urllib.parse.quote(prog_tc)}&client_id={client_id}"

        key = str(t_id)
        if key not in track_map:
            track_map[key] = {
                "t_id": t_id,
                "title": title,
                "artist": artist,
                "liked_ts": liked_ts,
                "liked_date_text": liked_date_text,
                "cover_url": cover_url or user_avatar or "",
                "permalink_url": t.get("permalink_url") or f"https://soundcloud.com/{username}",
                "preview_url": preview_url,
                "playback_count": t.get("playback_count") or 0,
            }

    unique_tracks = list(track_map.values())
    if not unique_tracks:
        return [], {"mythic": 0, "legendary": 0, "epic": 0, "rare": 0, "uncommon": 0, "common": 0}

    # Sort ascending by liked timestamp: oldest like = rank 0 = Mythic, newest = Common
    unique_tracks.sort(key=lambda x: x["liked_ts"])

    total = len(unique_tracks)
    tier_target_probs = {
        "mythic": 0.005,
        "legendary": 0.025,
        "epic": 0.070,
        "rare": 0.140,
        "uncommon": 0.260,
        "common": 0.500,
    }

    tier_counts = {"mythic": 0, "legendary": 0, "epic": 0, "rare": 0, "uncommon": 0, "common": 0}
    temp_specs = []
    for rank in range(total):
        pct = (rank + 0.5) / max(1, total)
        if pct <= 0.012:
            tier, name, color, odds, t_pct = "mythic", "Mythic", "#F43F5E", 200, pct / 0.012
        elif pct <= 0.045:
            tier, name, color, odds, t_pct = "legendary", "Legendary", "#F59E0B", 40, (pct - 0.012) / (0.045 - 0.012)
        elif pct <= 0.125:
            tier, name, color, odds, t_pct = "epic", "Epic", "#A855F7", 14, (pct - 0.045) / (0.125 - 0.045)
        elif pct <= 0.28:
            tier, name, color, odds, t_pct = "rare", "Rare", "#3B82F6", 7, (pct - 0.125) / (0.28 - 0.125)
        elif pct <= 0.55:
            tier, name, color, odds, t_pct = "uncommon", "Uncommon", "#10B981", 4, (pct - 0.28) / (0.55 - 0.28)
        else:
            tier, name, color, odds, t_pct = "common", "Common", "#94A3B8", 2, (pct - 0.55) / (1.0 - 0.55)
        tier_counts[tier] += 1
        temp_specs.append((tier, name, color, odds, t_pct))

    all_tracks = []
    for i, t in enumerate(unique_tracks):
        tier, name, color, odds, t_pct = temp_specs[i]
        count = max(1, tier_counts[tier])
        target_prob = tier_target_probs[tier]
        pool_weight = 100000.0 * target_prob
        fine_mod = 0.85 + (0.30 * (1.0 - t_pct))
        track_weight = max(1, int(round((pool_weight / count) * fine_mod)))
        drop_chance_str = f"1 in {odds:,}"

        track_id = f"soundcloud:{user_id}:{t['t_id']}"
        all_tracks.append({
            "id": track_id,
            "spotify_id": "",
            "title": t["title"],
            "artist": t["artist"],
            "album_cover_url": t["cover_url"],
            "playlist_cover_url": user_avatar or t["cover_url"],
            "cover_url": t["cover_url"],
            "playlist_name": f"Liked on: {t['liked_date_text']}",
            "playlist_id": f"soundcloud_{user_id}",
            "playlist_uri": "",
            "playlist_url": f"https://soundcloud.com/{username}/likes",
            "preview_url": t["preview_url"],
            "uri": t["permalink_url"],
            "spotify_url": t["permalink_url"],
            "source": "soundcloud",
            "source_url": t["permalink_url"],
            "rarityTier": tier,
            "rarityName": name,
            "rarityColor": color,
            "dropChance": drop_chance_str,
            "weight": track_weight,
            "release_date": "",
        })

    return all_tracks, tier_counts


def handle_soundcloud_fetch(profile_url, send_event, log_msg, force_refresh=False):
    """Handle SoundCloud liked tracks crate construction and SSE streaming."""
    username = extract_soundcloud_username(profile_url)
    if not username:
        send_event({"type": "error", "message": "Invalid SoundCloud username or profile URL."})
        return

    log_msg(f"Target SoundCloud User: {username}", "info")
    cache_file = os.path.join(DATA_DIR, f"cache_soundcloud_{username.lower()}.json")

    if not force_refresh and os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("tracks"):
                log_msg(f"Loaded {len(cached['tracks'])} tracks from server cache for '{username}'.", "success")
                log_msg("Crate RNG initialized. Ready to roll!", "success")
                send_event(cached)
                return
        except Exception:
            pass

    log_msg(f"Resolving profile and active session keys for '{username}'...", "info")
    client_id, user_info = resolve_soundcloud_profile(username, sse_log_fn=lambda m, lvl="info": log_msg(m, lvl))
    if not user_info:
        send_event({"type": "error", "message": f"Could not find public profile for SoundCloud user '{username}'."})
        return

    display_name = user_info.get("username") or username
    user_id = user_info.get("id")
    avatar_url = user_info.get("avatar_url")
    likes_count = user_info.get("likes_count", 0)

    log_msg(f"Found SoundCloud user '{display_name}' ({likes_count:,} public likes).", "success")
    if likes_count == 0:
        send_event({"type": "error", "message": f"User '{display_name}' does not have any public liked songs."})
        return

    likes_data = fetch_soundcloud_likes(user_id, client_id, sse_log_fn=lambda m, lvl="info": log_msg(m, lvl), max_pages=10)
    if not likes_data:
        send_event({"type": "error", "message": f"No liked tracks could be retrieved for '{display_name}'."})
        return

    log_msg(f"Retrieved {len(likes_data)} liked tracks. Analyzing like age timeline (oldest = Mythic)...", "info")
    sc_tracks, tier_counts = compute_soundcloud_rarity_tracks(likes_data, username, user_id, client_id, user_avatar=avatar_url)

    if not sc_tracks:
        send_event({"type": "error", "message": "Failed to compile crate tracks from likes."})
        return

    log_msg(f"Library compiled: {len(sc_tracks)} unique tracks from SoundCloud likes.", "success")
    log_msg(
        f"Rarity Distribution -> Mythic: {tier_counts['mythic']}, Legendary: {tier_counts['legendary']}, Epic: {tier_counts['epic']}, Rare: {tier_counts['rare']}, Uncommon: {tier_counts['uncommon']}, Common: {tier_counts['common']}",
        "info"
    )
    log_msg("Crate RNG initialized. Ready to roll!", "success")

    payload = {
        "type": "ready",
        "userId": display_name,
        "rawUserId": username,
        "avatarUrl": avatar_url,
        "playlistsCount": 1,
        "tracksCount": len(sc_tracks),
        "tracks": sc_tracks,
        "distribution": tier_counts,
    }

    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    except Exception:
        pass

    send_event(payload)


# ==============================================================================
# SECTION: SPOTIFY STREAM HANDLER (ISOLATED)
# ==============================================================================
def handle_spotify_fetch(profile_input, send_event, log_msg, force_refresh=False):
    """Handle Spotify profile / playlist crate construction and SSE streaming."""
    if not profile_input:
        log_msg("Invalid Spotify playlist link or profile provided.", "error")
        send_event({"type": "error", "message": "Invalid Spotify link or profile."})
        return

    target_type, target_id = extract_spotify_target(profile_input)

    # Reject direct playlist URLs: only user profiles are supported
    if target_type == "playlist":
        log_msg("Direct playlist links are not supported. Please enter a Spotify user profile URL or username.", "error")
        send_event({"type": "error", "message": "Only Spotify user profile URLs are supported (e.g. open.spotify.com/user/<username>)."})
        return

    # --- User Profile Multi-Playlist Scan Flow ---
    user_id = target_id
    log_msg(f"Target Spotify Account: {user_id}", "info")
    cache_file = os.path.join(DATA_DIR, f"cache_{user_id}.json")

    # Check cache
    playlists_data = []
    if os.path.exists(cache_file) and not force_refresh:
        log_msg("Local cached profile data found.", "success")
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                playlists_data = json.load(f)
            log_msg(f"Loaded {len(playlists_data)} playlists from local cache.", "info")
        except Exception as e:
            log_msg(f"Could not read cache: {e}. Re-scraping...", "warning")
            playlists_data = []

    # If not in cache, scrape live
    if not playlists_data:
        log_msg(f"Scanning public playlists on Spotify profile: {user_id}...", "info")
        found_playlists = scrape_playlists_urllib(user_id)
        if len(found_playlists) < 3:
            log_msg("Invoking browser engine for full playlist discovery...", "info")
            def sse_sub(msg): log_msg(msg, "info")
            pw_playlists = scrape_playlists_playwright(user_id, sse_sub)
            found_playlists.update(pw_playlists)

        log_msg(f"Discovered {len(found_playlists)} public playlists on profile.", "success")

        if not found_playlists:
            log_msg("No public playlists found on this profile.", "error")
            send_event({"type": "error", "message": "No public playlists found."})
            return

        # Fetch tracks for each playlist via embed
        total_p = len(found_playlists)
        for idx, pid in enumerate(found_playlists.keys(), 1):
            p_title = found_playlists[pid]
            log_msg(f"[{idx}/{total_p}] Extracting playlist '{p_title}' ({pid})...", "info")
            try:
                entity = fetch_playlist_embed(pid)
                if entity:
                    playlists_data.append(entity)
                    track_cnt = len(entity.get("trackList", []))
                    log_msg(f"  -> '{entity.get('name')}' contains {track_cnt} tracks.", "success")
                else:
                    log_msg(f"  -> Warning: Embed data empty for {pid}", "warning")
            except Exception as err:
                log_msg(f"  -> Error fetching {pid}: {err}", "warning")
            time.sleep(0.15)

        # Save to cache
        if playlists_data:
            try:
                with open(cache_file, "w", encoding="utf-8") as f:
                    json.dump(playlists_data, f, indent=2)
                log_msg(f"Cached {len(playlists_data)} playlists to disk.", "info")
            except Exception:
                pass

    # Calculate dynamic rarity
    log_msg("Calculating dynamic rarity weights across all tracks...", "info")
    all_tracks = compute_dynamic_rarity_tracks(playlists_data)

    mythic_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "mythic")
    legend_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "legendary")
    epic_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "epic")
    rare_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "rare")
    uncommon_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "uncommon")
    common_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "common")

    log_msg(f"Library compiled: {len(all_tracks)} total unique tracks across {len(playlists_data)} playlists.", "success")
    log_msg(f"Rarity Distribution -> Mythic: {mythic_cnt}, Legendary: {legend_cnt}, Epic: {epic_cnt}, Rare: {rare_cnt}, Uncommon: {uncommon_cnt}, Common: {common_cnt}", "info")
    log_msg("Crate RNG initialized. Ready to roll!", "success")

    log_msg(f"Fetching user profile details for '{user_id}'...", "info")
    user_profile = scrape_user_profile(user_id)
    if user_profile.get("displayName"):
        log_msg(f"Profile verified: {user_profile['displayName']}", "success")

    send_event({
        "type": "ready",
        "userId": user_profile.get("displayName") or user_id,
        "rawUserId": user_id,
        "avatarUrl": user_profile.get("avatarUrl"),
        "playlistsCount": len(playlists_data),
        "tracksCount": len(all_tracks),
        "tracks": all_tracks,
        "distribution": {
            "mythic": mythic_cnt,
            "legendary": legend_cnt,
            "epic": epic_cnt,
            "rare": rare_cnt,
            "uncommon": uncommon_cnt,
            "common": common_cnt
        }
    })


http.server.SimpleHTTPRequestHandler.extensions_map['.webmanifest'] = 'application/manifest+json'


class CrateRngServerHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/art":
            query = urllib.parse.parse_qs(parsed.query)
            track_id = query.get("id", [""])[0]
            if not track_id:
                self.send_response(400)
                self.end_headers()
                return

            art_cache_file = os.path.join(DATA_DIR, "album_art_cache.json")
            cache = {}
            if os.path.exists(art_cache_file):
                try:
                    with open(art_cache_file, "r", encoding="utf-8") as f:
                        cache = json.load(f)
                except Exception:
                    cache = {}

            meta_cache_file = os.path.join(DATA_DIR, "track_meta_cache.json")
            meta_cache = {}
            if os.path.exists(meta_cache_file):
                try:
                    with open(meta_cache_file, "r", encoding="utf-8") as f:
                        meta_cache = json.load(f)
                except Exception:
                    meta_cache = {}

            album_url = cache.get(track_id, "")
            rel_date = meta_cache.get(track_id, "")

            # Fetch on-demand via Spotify embed if missing release date
            if not rel_date:
                try:
                    embed_url = f"https://open.spotify.com/embed/track/{track_id}"
                    req = urllib.request.Request(embed_url, headers=HEADERS)
                    with urllib.request.urlopen(req, timeout=3.5) as resp:
                        html = resp.read().decode("utf-8", errors="ignore")
                    m_date = re.search(r'"releaseDate":\s*\{\s*"isoString":\s*"([^"]+)"', html)
                    if m_date:
                        rel_date = m_date.group(1)
                except Exception as e:
                    print(f"DEBUG embed date fetch error for {track_id}: {e}", flush=True)

            # Fallback to iTunes song search if Spotify embed failed or was rate limited
            if not rel_date:
                q_title = query.get("title", [""])[0]
                q_artist = query.get("artist", [""])[0]
                query_term = f"{q_artist} {q_title}".strip()
                if query_term:
                    try:
                        itunes_url = f"https://itunes.apple.com/search?term={urllib.parse.quote(query_term)}&entity=song&limit=1"
                        req = urllib.request.Request(itunes_url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req, timeout=3.5) as resp:
                            idata = json.loads(resp.read().decode("utf-8"))
                            if idata.get("results"):
                                rel_date = idata["results"][0].get("releaseDate", "")
                    except Exception as e:
                        print(f"DEBUG itunes date search error for {query_term}: {e}", flush=True)

            if rel_date and track_id not in meta_cache:
                meta_cache[track_id] = rel_date
                with open(meta_cache_file, "w", encoding="utf-8") as f:
                    json.dump(meta_cache, f, indent=2)

            # Fetch on-demand via Spotify oEmbed if missing cover art
            if not album_url:
                try:
                    o_url = f"https://open.spotify.com/oembed?url=https://open.spotify.com/track/{track_id}"
                    req = urllib.request.Request(o_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                    with urllib.request.urlopen(req, timeout=3.5) as resp:
                        odata = json.loads(resp.read().decode("utf-8"))
                        album_url = odata.get("thumbnail_url", "")
                        if album_url:
                            cache[track_id] = album_url
                            with open(art_cache_file, "w", encoding="utf-8") as f:
                                json.dump(cache, f, indent=2)
                except Exception as e:
                    print(f"DEBUG art fetch error for {track_id}: {e}", flush=True)

            body = json.dumps({
                "id": track_id,
                "album_cover_url": album_url,
                "release_date": rel_date
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        elif parsed.path == "/api/cache-check":
            query = urllib.parse.parse_qs(parsed.query)
            user_input = query.get("user", [""])[0]
            user_id = extract_user_id(user_input)
            cache_file = os.path.join(DATA_DIR, f"cache_{user_id}.json")
            if os.path.exists(cache_file):
                try:
                    with open(cache_file, "r", encoding="utf-8") as f:
                        cached_data = json.load(f)
                    body = json.dumps({
                        "cached": True,
                        "userId": user_id,
                        "playlistsCount": len(cached_data) if isinstance(cached_data, list) else 0
                    }).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                except Exception:
                    pass
            body = json.dumps({"cached": False, "userId": user_id}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path.startswith("/api/deezer"):
            query_str = self.path.split("?", 1)[1] if "?" in self.path else ""
            params = urllib.parse.parse_qs(query_str)
            q = params.get("q", [""])[0]
            if not q:
                self.send_response(400)
                self.end_headers()
                return
            deezer_url = f"https://api.deezer.com/search?q={urllib.parse.quote(q)}&limit=5"
            try:
                req = urllib.request.Request(deezer_url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=5) as res:
                    data = res.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                body = json.dumps({"error": str(e), "data": []}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
        if self.path.startswith("/api/soundcloud/stream"):
            query_str = self.path.split("?", 1)[1] if "?" in self.path else ""
            params = urllib.parse.parse_qs(query_str)
            tc_url = params.get("url", [""])[0]
            cid = params.get("client_id", [""])[0] or LATEST_SOUNDCLOUD_CLIENT_ID
            if not tc_url:
                self.send_response(400)
                self.end_headers()
                return

            cache_key = f"{tc_url}:{cid}"
            stream_mp3 = SOUNDCLOUD_STREAM_CACHE.get(cache_key)
            if not stream_mp3:
                for attempt in range(2):
                    try:
                        sep = "&" if "?" in tc_url else "?"
                        target = f"{tc_url}{sep}client_id={cid}"
                        s_req = urllib.request.Request(target, headers=HEADERS)
                        with urllib.request.urlopen(s_req, timeout=8) as s_resp:
                            s_data = json.loads(s_resp.read().decode("utf-8"))
                            stream_mp3 = s_data.get("url")
                            if stream_mp3:
                                SOUNDCLOUD_STREAM_CACHE[cache_key] = stream_mp3
                                break
                    except urllib.error.HTTPError as e:
                        if e.code in (401, 403) and attempt == 0:
                            cid = refresh_soundcloud_client_id()
                            cache_key = f"{tc_url}:{cid}"
                            continue
                        self.send_response(502)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.end_headers()
                        self.wfile.write(json.dumps({"error": f"HTTP {e.code}: {e.reason}"}).encode("utf-8"))
                        return
                    except Exception as e:
                        self.send_response(502)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.end_headers()
                        self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
                        return

            if not stream_mp3:
                self.send_response(404)
                self.end_headers()
                return

            if ".m3u8" in stream_mp3 or "/hls" in stream_mp3:
                self.send_response(415)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "HLS stream unsupported in direct player"}).encode("utf-8"))
                return

            accept = self.headers.get("Accept", "")
            if "application/json" in accept and "audio/" not in accept:
                body = json.dumps({"url": stream_mp3}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(302)
                self.send_header("Location", stream_mp3)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
            return

        super().do_GET()

    def end_headers(self):
        if hasattr(self, "path"):
            if self.path in ("/sw.js", "/sw.js/"):
                self.send_header("Service-Worker-Allowed", "/")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            elif self.path in ("/manifest.webmanifest", "/manifest.json"):
                self.send_header("Content-Type", "application/manifest+json")
                self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/fetch":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                payload = json.loads(body)
            except Exception:
                payload = {}

            profile_url = payload.get("profile_url", "").strip()
            force_refresh = payload.get("force_refresh", False)
            user_id = extract_user_id(profile_url)


            mode = payload.get("mode")
            if not mode:
                if "last.fm" in profile_url.lower() or profile_url.startswith("lastfm:"):
                    mode = "lastfm"
                elif "soundcloud" in profile_url.lower() or profile_url.startswith("soundcloud:"):
                    mode = "soundcloud"
                else:
                    mode = "spotify"

            # Start SSE Stream
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            def send_event(event_dict):
                msg = f"data: {json.dumps(event_dict)}\n\n"
                try:
                    self.wfile.write(msg.encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    pass

            def log_msg(text, level="info"):
                send_event({"type": "log", "level": level, "message": text, "time": time.strftime("%H:%M:%S")})

            if mode == "lastfm":
                handle_lastfm_fetch(profile_url, send_event, log_msg)
            elif mode == "soundcloud":
                handle_soundcloud_fetch(profile_url, send_event, log_msg, force_refresh)
            else:
                handle_spotify_fetch(profile_url, send_event, log_msg, force_refresh)
            return

        self.send_error(404, "Not Found")

class CrateRngServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # Ignore client disconnect / pipe errors cleanly
        exc_type, exc_val, _ = sys.exc_info()
        if exc_type in (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return
        super().handle_error(request, client_address)

def run(port=PORT):
    handler = functools.partial(CrateRngServerHandler, directory=PUBLIC_DIR)
    server_address = ("", port)
    httpd = CrateRngServer(server_address, handler)
    print(f"Spotify Crate RNG Server running at http://localhost:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == "__main__":
    p = PORT
    if len(sys.argv) > 1:
        try:
            p = int(sys.argv[1])
        except ValueError:
            pass
    run(p)
