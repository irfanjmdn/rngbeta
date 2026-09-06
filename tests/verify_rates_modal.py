import os
import sys
from playwright.sync_api import sync_playwright

def test_rates_modal():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        
        # Test 1: Desktop View
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto("http://127.0.0.1:8080")
        page.click("#btnDemoIrfan")
        
        # Agree to Desktop Notice
        page.wait_for_selector("#btnAgreeNotice", timeout=10000)
        page.click("#btnAgreeNotice")

        # Wait for Game Arena
        page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=15000)
        page.wait_for_selector("#btnHudRates", timeout=5000)
        
        # Open Rates Modal
        page.click("#btnHudRates")
        page.wait_for_selector("#gameRatesModal.open", timeout=5000)
        page.wait_for_timeout(600)
        
        # Capture Desktop screenshot
        desktop_screenshot = "tests/rates_modal_desktop.png"
        page.screenshot(path=desktop_screenshot)
        print(f"Desktop screenshot saved to {desktop_screenshot}")
        
        # Verify text content of rows
        rows = page.query_selector_all("#ratesList .rates-row")
        print(f"Total rates rows found: {len(rows)}")
        assert len(rows) == 6, f"Expected 6 rows, got {len(rows)}"
        
        expected_odds = [
            ("Mythic", "1 in 200 (0.5%)"),
            ("Legendary", "1 in 40 (2.5%)"),
            ("Epic", "1 in 14 (7.0%)"),
            ("Rare", "1 in 7 (14.0%)"),
            ("Uncommon", "1 in 4 (26.0%)"),
            ("Common", "1 in 2 (50.0%)"),
        ]
        
        for idx, (tier_name, exp_odds) in enumerate(expected_odds):
            badge = rows[idx].query_selector(".tier-label-badge").inner_text()
            desc = rows[idx].query_selector(".rates-desc").inner_text()
            odds = rows[idx].query_selector(".rates-odds").inner_text()
            print(f"Row {idx+1}: [{badge}] {desc} -> {odds}")
            assert tier_name.lower() in badge.lower(), f"Expected {tier_name} in badge, got {badge}"
            assert exp_odds == odds, f"Expected {exp_odds}, got {odds}"
            assert "%" not in desc, f"Description contains unexpected percent symbol: {desc}"
            
        # Test 2: Mobile View
        mobile_page = browser.new_page(viewport={"width": 390, "height": 844})
        mobile_page.goto("http://127.0.0.1:8080")
        mobile_page.wait_for_selector("#btnDemoIrfan", timeout=10000)
        mobile_page.click("#btnDemoIrfan")
        mobile_page.wait_for_selector("#btnAgreeNotice", timeout=10000)
        mobile_page.click("#btnAgreeNotice")
        mobile_page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=15000)
        mobile_page.wait_for_selector("#btnHudRates", timeout=5000)
            
        mobile_page.click("#btnHudRates")
        mobile_page.wait_for_selector("#gameRatesModal.open", timeout=5000)
        mobile_page.wait_for_timeout(600)
        
        mobile_screenshot = "tests/rates_modal_mobile.png"
        mobile_page.screenshot(path=mobile_screenshot)
        print(f"Mobile screenshot saved to {mobile_screenshot}")
        
        # Test 3: Verify Binder Chips Odds
        mobile_page.click("#btnCloseRatesModal")
        mobile_page.wait_for_timeout(300)
        mobile_page.click("#btnHudBinder")
        mobile_page.wait_for_selector("#gameBinderModal.open", timeout=5000)
        
        chips = mobile_page.query_selector_all("#binderFilterBar .cat-chip")
        chip_texts = [c.inner_text() for c in chips]
        safe_chips = [ct.encode("ascii", "replace").decode("ascii") for ct in chip_texts]
        print(f"Binder filter chip texts: {safe_chips}")
        
        expected_chips = [
            "Mythic (0.5%)",
            "Legendary (2.5%)",
            "Epic (7.0%)",
            "Rare (14.0%)",
            "Uncommon (26.0%)",
            "Common (50.0%)"
        ]
        for exp in expected_chips:
            found = any(exp in ct for ct in chip_texts)
            assert found, f"Expected chip matching '{exp}' not found in {chip_texts}"
            
        browser.close()
        print("ALL TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_rates_modal()
