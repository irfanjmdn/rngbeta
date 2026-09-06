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

def extract_user_id(profile_input):
    """Extract clean Spotify user ID from URL or raw username."""
    profile_input = profile_input.strip()
    if "spotify.com/user/" in profile_input:
        part = profile_input.split("spotify.com/user/")[1]
        user_id = part.split("?")[0].split("/")[0].strip()
        return user_id
    if profile_input.startswith("spotify:user:"):
        return profile_input.split(":")[-1].strip()
    return profile_input.split("?")[0].strip()

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
    """Scrape playlist IDs from profile using urllib."""
    url = f"https://open.spotify.com/user/{user_id}"
    req = urllib.request.Request(url, headers=HEADERS)
    playlists = {}
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        # Extract playlist links
        matches = re.findall(r'href=[\'"]/playlist/([a-zA-Z0-9]{22})[\'"]', html)
        for pid in set(matches):
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
                    "preview_url": preview_url,
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
    scores = {}
    for key, t in track_map.items():
        p_list = t["playlists"]
        app_count = len(p_list)

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
            "preview_url": t["preview_url"],
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


def fetch_lastfm_crate(username, sse_log_fn=None):
    """Fetch user's top tracks from Last.fm and format them as Crate RNG tracks."""
    api_key = "b25b959554ed76058ac220b7b2e0a026"
    headers = {"User-Agent": "CrateRNG/1.0"}
    
    if sse_log_fn:
        sse_log_fn(f"Fetching Last.fm user info for '{username}'...")
        
    user_url = f"https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user={urllib.parse.quote(username)}&api_key={api_key}&format=json"
    user_info = {"displayName": username, "avatarUrl": None, "playcount": 0}
    try:
        req = urllib.request.Request(user_url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            u_data = json.loads(resp.read().decode())
            u = u_data.get("user", {})
            user_info["displayName"] = u.get("name") or username
            images = u.get("image", [])
            if images and isinstance(images, list):
                user_info["avatarUrl"] = images[-1].get("#text") or None
    except Exception as e:
        if sse_log_fn:
            sse_log_fn(f"Notice getting user info: {e}", "warning")

    if sse_log_fn:
        sse_log_fn(f"Fetching recent listening history from Last.fm for '{username}'...", "info")

    raw_scrobbles = []
    for page_num in (1, 2, 3):
        tracks_url = f"https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user={urllib.parse.quote(username)}&limit=200&page={page_num}&api_key={api_key}&format=json"
        try:
            req = urllib.request.Request(tracks_url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                t_data = json.loads(resp.read().decode())
                batch = t_data.get("recenttracks", {}).get("track", [])
                if not batch:
                    break
                raw_scrobbles.extend(batch)
        except Exception as e:
            if sse_log_fn:
                sse_log_fn(f"Notice fetching page {page_num}: {e}", "warning")
            break

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

        super().do_GET()

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

            is_lastfm = profile_url.startswith("lastfm:") or "last.fm/user/" in profile_url.lower()
            if is_lastfm:
                if profile_url.startswith("lastfm:"):
                    lastfm_user = profile_url.split("lastfm:")[1].strip()
                else:
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
                return

            if not user_id:
                log_msg("Invalid Spotify profile link or username provided.", "error")
                send_event({"type": "error", "message": "Invalid profile link."})
                return

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
            return

        self.send_error(404, "Not Found")

class CrateRngServer(http.server.ThreadingHTTPServer):
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
