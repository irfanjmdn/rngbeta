from playwright.sync_api import sync_playwright
import time
import os

output_dir = r"C:\Users\Irfan\.gemini\antigravity-cli\brain\ca43a1a1-fb40-4657-90b7-de15ffb4ef98"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 840}, device_scale_factor=2)
    page.goto("http://127.0.0.1:8080")
    page.wait_for_selector("#btnDemoIrfan", state="visible")
    page.click("#btnDemoIrfan")
    page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=15000)

    # Enable auto-skip for fast multi-rolls until we get a non-common tier
    page.click("#btnAutoSkip")
    time.sleep(0.2)

    found_tier = None
    for attempt in range(12):
        page.click("#btnBigRoll")
        time.sleep(1.2)
        tier_text = page.evaluate("() => document.getElementById('winnerTierPill').textContent.trim()")
        print(f"Roll {attempt + 1}: landed {tier_text}")
        if tier_text in ['RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'UNCOMMON']:
            found_tier = tier_text
            break

    time.sleep(0.5)
    page.screenshot(path=os.path.join(output_dir, f"aura_tier_{found_tier.lower() if found_tier else 'common'}.png"))
    print(f"Captured screenshot for {found_tier} tier aura!")

    browser.close()
