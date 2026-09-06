import json
import os
import sys

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import server

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    cache_path = os.path.join(root_dir, "data", "cache_2jp1yf3h1h49zye21bxnxk0w5.json")
    out_dir = os.path.join(root_dir, "frontend", "public", "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "demo_crate.json")

    with open(cache_path, "r", encoding="utf-8") as f:
        playlists_data = json.load(f)

    all_tracks = server.compute_dynamic_rarity_tracks(playlists_data)
    user_profile = server.scrape_user_profile("2jp1yf3h1h49zye21bxnxk0w5")

    mythic_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "mythic")
    legend_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "legendary")
    epic_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "epic")
    rare_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "rare")
    uncommon_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "uncommon")
    common_cnt = sum(1 for t in all_tracks if t["rarityTier"] == "common")

    demo_payload = {
        "type": "ready",
        "userId": user_profile.get("displayName") or "aij",
        "rawUserId": "2jp1yf3h1h49zye21bxnxk0w5",
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
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(demo_payload, f, indent=2)

    print(f"Generated {out_path} with {len(all_tracks)} tracks.")

if __name__ == "__main__":
    main()
