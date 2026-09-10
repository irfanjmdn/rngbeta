import asyncio
import os
import sys
import time
from playwright.async_api import async_playwright

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

TEST_PORT = 8080
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"
TEST_DIR = os.path.dirname(os.path.abspath(__file__))

async def verify_branding_and_logout():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={"width": 1366, "height": 850})
        page = await context.new_page()

        print(f"Navigating to {BASE_URL}...", flush=True)
        await page.goto(BASE_URL)

        # 1. Verify Start-up Splash Screen with bold trackrolling font and fade-out shrink animation
        splash = await page.wait_for_selector(".startup-splash-screen", timeout=2000)
        assert splash is not None, "Splash screen not displayed on start!"
        splash_text = await page.text_content(".startup-splash-brand")
        assert "trackrolling" in splash_text.lower(), f"Unexpected splash text: {splash_text}"
        print(f"PASS: Splash screen rendered with text '{splash_text}'", flush=True)

        screenshot_splash = os.path.join(TEST_DIR, "splash_screen_startup.png")
        await page.screenshot(path=screenshot_splash)

        # Wait for splash screen fade-out and shrink animation
        await page.wait_for_selector(".startup-splash-screen.is-hiding", timeout=3000)
        print("PASS: Splash screen initiated fade-out + shrink animation.", flush=True)
        await page.wait_for_selector(".startup-splash-screen", state="detached", timeout=3000)
        print("PASS: Splash screen completely faded and removed.", flush=True)

        # 2. Enter game arena via Last.fm
        btn_choose = await page.wait_for_selector("#btnChooseLastfm", timeout=5000)
        await btn_choose.click()
        input_el = await page.wait_for_selector("#inputLastfmUser", timeout=5000)
        await input_el.fill("irfanjmdn")
        btn_build = await page.wait_for_selector("#btnBuildCrate")
        await btn_build.click()

        notice_btn = await page.wait_for_selector("#btnAgreeNotice", timeout=60000)
        await notice_btn.click()
        await page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=10000)
        print("PASS: Game arena loaded.", flush=True)

        # 3. Verify HUD Branding is 'trackrolling'
        brand_title = await page.text_content(".hud-brand-title")
        assert "trackrolling" in brand_title.lower(), f"HUD brand title is not trackrolling: '{brand_title}'"
        print(f"PASS: HUD brand title correctly displays '{brand_title.strip()}'.", flush=True)

        # 4. Test Logout button interaction
        logout_btn = await page.wait_for_selector("#btnSwitchAccount")

        # Initial state: default icon is visible
        icon_visible = await page.is_visible(".logout-default-icon")
        assert icon_visible, "Default lightning icon not visible initially!"

        # Hover state: text says 'LOG OUT?'
        await logout_btn.hover()
        await page.wait_for_timeout(100)
        hover_text = await page.text_content(".logout-hover-text")
        assert "LOG OUT?" in hover_text, f"Expected 'LOG OUT?' on hover, got '{hover_text}'"
        print(f"PASS: Hover shows '{hover_text.strip()}'.", flush=True)

        # Hold state: mouse down -> kaomoji appears
        btn_box = await logout_btn.bounding_box()
        await page.mouse.move(btn_box["x"] + btn_box["width"] / 2, btn_box["y"] + btn_box["height"] / 2)
        await page.mouse.down()
        await page.wait_for_timeout(300)
        holding_text = await page.text_content(".logout-hover-text")
        assert holding_text.strip() != "LOG OUT?" and len(holding_text.strip()) > 0, f"Expected hold kaomoji, got '{holding_text}'"
        print(f"PASS: Hold displays kaomoji '{holding_text.strip()}'.", flush=True)

        # Release state (without moving mouse): release kaomoji appears and STAYS
        await page.mouse.up()
        await page.wait_for_timeout(300)
        released_text = await page.text_content(".logout-hover-text")
        assert released_text.strip() != "LOG OUT?" and len(released_text.strip()) > 0, f"Expected release kaomoji, got '{released_text}'"
        print(f"PASS: After release, kaomoji stays: '{released_text.strip()}'.", flush=True)

        # Wait another 400ms while still hovering to verify it DOES NOT revert to LOG OUT?
        await page.wait_for_timeout(400)
        still_released = await page.text_content(".logout-hover-text")
        assert still_released.strip() == released_text.strip(), f"Kaomoji did not stay! Got: '{still_released}'"
        print("PASS: Kaomoji stayed continuously while hovered.", flush=True)

        # Unhover state: move cursor away
        # Inspect what text is rendered the moment cursor leaves
        await page.mouse.move(10, 10)
        immediate_text = await page.evaluate("() => document.querySelector('.logout-hover-text').textContent.trim()")
        assert immediate_text != "LOG OUT?", f"FLAW: 'LOG OUT?' flashed on unhover! Got: '{immediate_text}'"
        print(f"PASS: On unhover, text is not 'LOG OUT?' (rendered: '{immediate_text}').", flush=True)

        await page.wait_for_timeout(300)
        icon_restored = await page.is_visible(".logout-default-icon")
        assert icon_restored, "Default lightning icon not restored on unhover!"
        print("PASS: Default icon immediately restored on unhover without 'LOG OUT?' flash.", flush=True)

        screenshot_final = os.path.join(TEST_DIR, "branding_logout_verified.png")
        await page.screenshot(path=screenshot_final)
        print(f"PASS: Saved verification screenshot to {screenshot_final}", flush=True)

        await browser.close()
        print("SUCCESS: All branding, loading animation, and logout button fixes verified!", flush=True)

if __name__ == "__main__":
    asyncio.run(verify_branding_and_logout())
