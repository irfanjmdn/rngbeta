---
name: Spotify Crate RNG
description: Roblox-style track crate slot machine and album binder powered by Spotify.
colors:
  bg-base: "#06080D"
  bg-card: "#0C1018"
  surface-1: "#101520"
  surface-2: "#161D2B"
  surface-hover: "#1E273A"
  brand-green: "#10B981"
  brand-red: "#E11D48"
  tier-common: "#94A3B8"
  tier-uncommon: "#10B981"
  tier-rare: "#3B82F6"
  tier-epic: "#A855F7"
  tier-legendary: "#F59E0B"
  tier-mythic: "#F43F5E"
  text-main: "#F8FAFC"
  text-muted: "#8E9BAE"
  text-dim: "#546274"
typography:
  display:
    fontFamily: "Unbounded, Plus Jakarta Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "0.06em"
  body:
    fontFamily: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.brand-green}"
    textColor: "#032014"
    rounded: "{rounded.none}"
    padding: "12px 24px"
  monolith-panel:
    backgroundColor: "{colors.bg-card}"
    rounded: "{rounded.none}"
---

# Design System: Spotify Crate RNG

## 1. Overview

**Creative North Star: "Brutalist Avionics Arcade"**

Spotify Crate RNG combines tactile vinyl digging with high-stakes arcade casino mechanics. Interfaces prioritize stark contrast, matte charcoal chassis, razor geometric cuts, and instant mechanical feedback.

The system explicitly rejects SaaS genericism: gradient text, decorative glassmorphism blur, rounded pill overload, and pastel AI slop. Surfaces are dark, authoritative, and functional.

**Key Characteristics:**
- Solid matte surfaces without glowing outline borders.
- Flat sharp geometric components (zero border-radius on cards, pips, and drawer tiles).
- Clean sans-serif typography pairing (Unbounded for punchy titles and values, Plus Jakarta Sans for labels).
- Vibrant rarity spectrum accents used with precision.

## 2. Colors

A deep dark slate palette with hyper-saturated arcade rarity tiers and crisp monochrome text.

### Primary
- **Arcade Emerald** (#10B981): The primary system action and confirmation color.
- **Logout Ruby** (#E11D48): The high-impact hold-to-exit and destructive color.

### Rarity Tiers
- **Common** (#94A3B8): Slate grey.
- **Uncommon** (#10B981): Emerald green.
- **Rare** (#3B82F6): Azure blue.
- **Epic** (#A855F7): Neon purple.
- **Legendary** (#F59E0B): Warm amber gold.
- **Mythic** (#F43F5E): Hyper ruby red.

### Neutral
- **Base Background** (#06080D): Deepest obsidian floor.
- **Card Chassis** (#0C1018): Solid matte dark slate container.
- **Surface Level 2** (#161D2B): Action tile resting fill.
- **Surface Hover** (#1E273A): Hover state highlight.
- **Text Main** (#F8FAFC): Crisp high-contrast white.
- **Text Muted** (#8E9BAE): Secondary label slate.

**The Flat-By-Default Rule.** Surfaces do not use outer border outlines or box-shadow halos. Tone-on-tone contrast separates functional zones.

## 3. Typography

**Display Font:** Unbounded (geometric sans-serif)
**Body Font:** Plus Jakarta Sans (clean sans-serif)

### Hierarchy
- **Display**: Unbounded, weight 900, uppercase, letter-spacing 0.08em. Used for rarity titles, counters, and modal headers.
- **Title**: Unbounded, weight 800, letter-spacing 0.04em. Used for section headers and track names.
- **Body**: Plus Jakarta Sans, weight 600, line-height 1.5. Used for descriptions and table data.
- **Label**: Plus Jakarta Sans, weight 800, letter-spacing 0.06em, uppercase. Used for buttons, tags, and status pips.

**The No-Monospace Rule.** Primary UI labels, badges, and counters use crisp geometric sans-serif fonts instead of generic monospace typewriter fonts.

## 4. Elevation

The system is strictly flat with zero ambient box-shadows. Depth is achieved via tonal surface stacking (#06080D base -> #0C1018 card -> #161D2B tile -> #1E273A hover).

**The Zero-Outline Rule.** Containers do not use 1px border outlines around every element. Borders are prohibited except for hairline dividers separating distinct rows.

## 5. Components

### Modals & Dialogs
- **Chassis:** Flat matte container (#0C1018), square corners (border-radius: 0), subtle 1px hairline perimeter divider (rgba(255,255,255,0.08)).
- **Header:** Bold Unbounded title, solid square close button with high-contrast hover.
- **Content Panes:** High-density tabular layouts with clean hairline row dividers.

### Buttons & Keys
- **Primary:** Solid #10B981 fill with #032014 bold text, zero border-radius.
- **Surface Tile:** Flat #161D2B fill, transitions to #1E273A on hover.

### Progress Bars
- **Style:** Multi-segment continuous bar displaying proportional rarity tier colors with a dark empty remainder track.

## 6. Do's and Don'ts

### Do:
- **Do** use flat matte surfaces with high contrast text.
- **Do** use border-radius: 0 for cards, chips, and modal sheets.
- **Do** use distinct rarity colors to communicate drop probabilities and collection tiers.
- **Do** maintain instant keyboard and pointer interactivity.

### Don't:
- **Don't** use glowing drop shadows, colorful gradient borders, or glassmorphism blurs.
- **Don't** use rounded pill buttons or curved container corners.
- **Don't** use decorative monospace fonts for primary interface titles.
- **Don't** clutter modal views with unnecessary decorative card wrappers.