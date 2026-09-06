import asyncio
import os
import sys
import time
from playwright.async_api import async_playwright

TEST_PORT = 8080
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"

async def run_feature_tests():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={"width": 1366, "height": 850})
        page = await context.new_page()

        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(str(err)))

        print("1. Loading app...")
        await page.goto(BASE_URL)
        try:
            await page.wait_for_load_state("networkidle", timeout=2000)
        except Exception:
            await page.wait_for_load_state("domcontentloaded")

        # Load demo profile
        await page.click("#btnDemoIrfan")
        await page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=10000)
        print("PASS: App loaded demo profile.")

        # Enable Auto Skip for quick rolling
        await page.click("#btnAutoSkip")

        # Roll 1
        await page.click("#btnBigRoll")
        await page.wait_for_selector("#btnBigRoll.is-spinning")
        await page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=4000)

        # Verify star button visible in winner spotlight
        btn_star = await page.wait_for_selector("#btnWinnerStar")
        assert await btn_star.is_visible(), "Star button not visible in spotlight!"
        star_text = await page.text_content("#btnWinnerStar .star-label")
        assert star_text.strip() == "Star", f"Expected 'Star', got '{star_text}'"
        print("PASS: Winner spotlight displays star button with 'Star'.")

        # Click Star button in spotlight
        await btn_star.click()
        await page.wait_for_timeout(200)

        star_classes = await btn_star.get_attribute("class")
        assert "is-starred" in star_classes, f"Star button missing is-starred class: {star_classes}"
        star_text_after = await page.text_content("#btnWinnerStar .star-label")
        assert star_text_after.strip() == "Starred", f"Expected 'Starred', got '{star_text_after}'"
        print("PASS: Winner spotlight star button toggled to 'Starred' and gained .is-starred class.")

        # Check localStorage persistence
        starred_stored = await page.evaluate("() => localStorage.getItem('crate_starred_2jp1yf3h1h49zye21bxnxk0w5')")
        assert starred_stored is not None, "Starred track not in localStorage!"
        assert len(starred_stored) > 2, f"Starred array empty in localStorage: {starred_stored}"
        print(f"PASS: localStorage updated with starred track: {starred_stored}")

        # Roll 2 to get another track
        await page.click("#btnBigRoll")
        await page.wait_for_selector("#btnBigRoll.is-spinning")
        await page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=4000)

        # Open Binder
        await page.click("#btnHudBinder")
        await page.wait_for_selector("#gameBinderModal.open")
        await page.wait_for_timeout(300)

        # Verify Starred filter chip count
        starred_chip_text = await page.text_content('.cat-chip[data-filter="starred"]')
        print(f"Starred chip text: '{starred_chip_text}'")
        assert "★ Starred (1)" in starred_chip_text or "Starred (1)" in starred_chip_text, f"Unexpected chip text: {starred_chip_text}"
        print("PASS: Starred filter chip reflects count 1.")

        # Click Starred filter chip
        await page.click('.cat-chip[data-filter="starred"]')
        await page.wait_for_timeout(200)

        starred_tiles = await page.query_selector_all(".binder-tile")
        assert len(starred_tiles) == 1, f"Expected exactly 1 starred tile displayed, got {len(starred_tiles)}"
        star_btn_on_tile = await starred_tiles[0].query_selector(".binder-card-star-btn")
        assert star_btn_on_tile is not None, "Star button missing on binder tile!"
        tile_star_class = await star_btn_on_tile.get_attribute("class")
        assert "is-starred" in tile_star_class, f"Tile star button missing .is-starred: {tile_star_class}"
        print("PASS: Starred filter only shows the starred track with gold star button.")

        # Un-star track directly from the binder tile
        await star_btn_on_tile.click()
        await page.wait_for_timeout(300)

        # Empty state should show since 0 tracks are starred now
        empty_title = await page.text_content(".binder-empty-title")
        assert "No starred tracks yet" in empty_title, f"Unexpected empty title: {empty_title}"
        starred_chip_text_empty = await page.text_content('.cat-chip[data-filter="starred"]')
        assert "(0)" in starred_chip_text_empty, f"Expected count (0), got {starred_chip_text_empty}"
        print("PASS: Un-starring from tile clears starred view, shows custom empty state, and updates counter to (0).")

        # Test Recently Owned sort
        # Go back to All Cards
        await page.click('.cat-chip[data-filter="all"]')
        await page.wait_for_timeout(200)

        # Select Recently Owned
        await page.select_option("#binderSortSelect", "recent-desc")
        await page.wait_for_timeout(200)

        all_tiles = await page.query_selector_all(".binder-tile")
        assert len(all_tiles) >= 1, "Expected tiles in binder"
        print(f"PASS: Recently Owned sort executed successfully with {len(all_tiles)} tiles.")

        # Close Binder and check spotlight star button sync
        await page.click("#btnCloseBinderModal")
        await page.wait_for_timeout(200)

        # If the winner currently in spotlight was the one unstarred, spotlight star button should reflect it
        spotlight_is_starred = "is-starred" in (await btn_star.get_attribute("class"))
        print(f"Spotlight star button sync status: is_starred={spotlight_is_starred}")

        assert len(console_errors) == 0, f"Encountered console errors: {console_errors}"
        print("ALL STARRED TRACKS AND BINDER ENHANCEMENTS VERIFIED WITH 0 ERRORS!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_feature_tests())
