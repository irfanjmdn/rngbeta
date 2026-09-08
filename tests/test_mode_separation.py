import asyncio
import os
import sys
from playwright.async_api import async_playwright

BASE_URL = "http://localhost:8080"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1366, "height": 850})

        # Clear sessionStorage and localStorage first
        await page.goto(BASE_URL)
        await page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
        await page.reload()

        # Step 1: Mode Select screen
        btn_lastfm = await page.wait_for_selector("#btnChooseLastfm", timeout=5000)
        assert await btn_lastfm.is_visible(), "Mode select screen not visible"
        print("PASS: Mode select screen visible.")

        # Click Last.fm
        await btn_lastfm.click()
        btn_build = await page.wait_for_selector("#btnBuildCrate", timeout=5000)
        print("PASS: Onboarding entry form loaded.")

        # Enter username "rj" and build crate
        input_user = await page.wait_for_selector("#inputLastfmUser")
        await input_user.fill("rj")
        await btn_build.click()

        # Wait for desktop reminder (Last.fm API samples timeline across several pages)
        btn_agree = await page.wait_for_selector("#btnAgreeNotice", timeout=35000)
        await btn_agree.click()
        print("PASS: Last.fm crate loaded and entered arena.")

        # Wait for arena roll button
        btn_roll = await page.wait_for_selector("#btnBigRoll", timeout=5000)
        assert await btn_roll.is_visible(), "Roll button not visible"

        # Check initial localStorage keys
        storage_keys = await page.evaluate("() => Object.keys(localStorage)")
        print(f"Storage keys after Last.fm crate load: {storage_keys}")
        assert any("lastfm" in k for k in storage_keys), "No lastfm-scoped keys in localStorage"

        # Perform 1 spin
        await btn_roll.click()
        # Wait for spin to finish (takes ~4s)
        await page.wait_for_timeout(4500)
        print("PASS: Last.fm roll executed.")

        # Check roll count in storage
        lastfm_rolls = await page.evaluate("""() => {
            const k = Object.keys(localStorage).find(x => x.startsWith('crate_rng_rolls_lastfm'));
            return k ? localStorage.getItem(k) : null;
        }""")
        print(f"Last.fm roll count: {lastfm_rolls}")
        assert lastfm_rolls == "1", f"Expected lastfm roll count 1, got {lastfm_rolls}"

        # Trigger switch account via HUD button
        btn_logout = await page.wait_for_selector("#btnSwitchAccount")
        # Hold for 2.5 seconds to complete logout
        box = await btn_logout.bounding_box()
        await page.mouse.move(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
        await page.mouse.down()
        await page.wait_for_timeout(2500)
        await page.mouse.up()
        await page.wait_for_timeout(800)

        # Verify returned to mode select screen
        btn_select_spotify = await page.wait_for_selector("#btnChooseSpotify", timeout=5000)
        assert await btn_select_spotify.is_visible(), "Did not return to mode select screen"
        print("PASS: Returned to mode select screen after account switch.")

        # Click Spotify
        await btn_select_spotify.click()
        btn_build_spotify = await page.wait_for_selector("#btnBuildCrate", timeout=5000)
        print("PASS: Spotify entry form loaded.")

        # Enter Spotify playlist and build crate
        input_spotify = await page.wait_for_selector("#inputSpotifyProfile")
        await input_spotify.fill("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")
        await btn_build_spotify.click()

        # Check if desktop notice is needed or already agreed in session
        try:
            btn_agree2 = await page.wait_for_selector("#btnAgreeNotice", timeout=5000)
            if await btn_agree2.is_visible():
                await btn_agree2.click()
        except Exception:
            pass

        await page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=15000)
        print("PASS: Spotify crate loaded and entered arena.")

        # Check roll count on HUD for Spotify (should be 0, not 1 from Last.fm!)
        hud_roll_text = await page.text_content("#hudRolls")
        print(f"Spotify initial roll HUD count: '{hud_roll_text.strip()}'")
        assert "0" in hud_roll_text, f"Expected 0 rolls for Spotify, got {hud_roll_text}"

        # Roll once on Spotify
        btn_roll2 = await page.wait_for_selector("#btnBigRoll", timeout=5000)
        await btn_roll2.click()
        await page.wait_for_timeout(4500)

        spotify_rolls = await page.evaluate("""() => {
            const k = Object.keys(localStorage).find(x => x.startsWith('crate_rng_rolls_spotify'));
            return k ? localStorage.getItem(k) : null;
        }""")
        print(f"Spotify roll count in localStorage: {spotify_rolls}")
        assert spotify_rolls == "1", f"Expected spotify roll count 1, got {spotify_rolls}"

        # Check that Last.fm roll count is still 1 and isolated
        lastfm_rolls_after = await page.evaluate("""() => {
            const k = Object.keys(localStorage).find(x => x.startsWith('crate_rng_rolls_lastfm'));
            return k ? localStorage.getItem(k) : null;
        }""")
        print(f"Last.fm roll count after Spotify roll: {lastfm_rolls_after}")
        assert lastfm_rolls_after == "1", f"Expected lastfm roll count still 1, got {lastfm_rolls_after}"

        print("ALL VERIFICATION CHECKS PASSED!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
