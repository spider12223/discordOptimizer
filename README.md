# DiscordOptimizer

A Vencord userplugin that aggressively reduces Discord's RAM usage. Built for people who game alongside Discord or run it on low-end hardware.

Discord's Electron client regularly eats 1-2GB+ of RAM. This plugin tackles every major cause — cached messages, offscreen media, CSS animations, CDN image sizes, Flux event spam, and more — while keeping voice chat completely untouched.

## Features

### Always-On Optimizations
These run silently in the background without affecting your experience:

- **Message cache trimming** — Caps cached messages per channel (default 50). Discord normally hoards hundreds in RAM.
- **Offscreen media unloading** — Hides images, embeds, and videos that scroll out of view using `content-visibility`.
- **Video pausing** — Pauses any video element that leaves the viewport.
- **CSS animation killer** — Strips unnecessary animations: hover effects, Nitro shine, pulse indicators, message transitions, spinners. Saves GPU compositor layers.
- **CDN image downscaling** — Rewrites Discord CDN URLs to request smaller images (default 512px instead of 1024px). Barely visible, halves image memory.
- **Presence throttling** — Rate-limits online/offline/playing status updates to once per 5 seconds per user. In large servers this blocks thousands of wasted events per minute. **Never throttles users in your voice channel.**
- **GIF freeze** — Optionally replaces animated GIFs with their first static frame.
- **Spellcheck disable** — Kills Chromium's spellcheck dictionary (~30MB sitting in memory).

### Stance Mode
Heavy optimization that activates when you tab out of Discord. Perfect for gaming — Discord goes into sleep mode but your voice chat stays perfect.

**Triggers:** Alt-tab, minimize, switch to another window. Activates after configurable delay (default 3 minutes).

**What it does when active:**
- Drops message cache to 10 per channel
- Hides ALL chat media, embeds, banners, animated avatars
- Pauses all non-VC videos and canvas elements
- Freezes GIF reactions and sticker animations
- Hides member list, profile panels, activity feed, emoji/sticker pickers
- Blocks Flux events: typing indicators, message ack, unread updates, notifications, activity updates
- Disconnects MutationObserver (stops all DOM watching overhead)
- Switches auto-flush to every 2 minutes
- Increases presence throttle to 30 seconds

**What it never touches:**
- Voice connection, audio, RTC events
- Stream/screen share state
- Call state and updates
- Voice channel UI elements
- Presence updates for people in your VC

**Everything restores instantly when you tab back in.**

### VC Safety

The plugin has a whitelist of 35+ voice-related Flux events that are **never blocked or throttled** under any circumstances. Every DOM operation checks `isVoiceVideoElement()` before modifying anything. Presence throttling looks up who's in your voice channel and always lets their updates through.

## Installation

Requires [Vencord built from source](https://docs.vencord.dev/installing/custom-plugins/).

### Automatic (Windows)

1. Download the latest release
2. Extract the zip
3. Run `install.bat`
4. It finds your Vencord folder, copies the plugin, and optionally builds for you

### Manual

```bash
cd Vencord/src/userplugins
git clone https://github.com/spider12223/discordOptimizer.git
cd ../..
pnpm build
```

Restart Discord, then enable **DiscordOptimizer** in Settings → Vencord → Plugins.

## Settings

| Setting | Default | Description |
|---|---|---|
| Stance Mode | On | Heavy optimization when tabbed out |
| Stance Delay | 3 min | Time before stance mode activates |
| Kill Animations | On | Remove unnecessary CSS animations |
| Downscale Images | On | Request smaller images from Discord CDN |
| Image Max Size | 512px | CDN downscale target (128/256/512/1024) |
| Throttle Presence | On | Rate-limit status updates (VC-safe) |
| Disable Spellcheck | Off | Kill Chromium spellcheck dictionary |
| Max Cached Messages | 50 | Messages kept per channel (stance forces 10) |
| Flush Interval | 15 min | Auto cache flush timer |
| Idle Flush | 10 min | Inactivity cleanup timer |
| Hide Offscreen Media | On | Unload scrolled-out media |
| Pause Offscreen Videos | On | Pause off-viewport videos |
| Disable GIF Autoplay | Off | Freeze GIFs to first frame |
| Disable Sticker Animations | Off | Stop animated stickers |

## Recommended: Low-End / Gaming Setup

For maximum RAM savings alongside games:

- Stance Mode → **On**
- Stance Delay → **1 min**
- Max Cached Messages → **10**
- Flush Interval → **5 min**
- Idle Flush → **5 min**
- Disable GIF Autoplay → **On**
- Disable Sticker Animations → **On**
- Image Max Size → **256px**
- Disable Spellcheck → **On**

## How It Works

This plugin uses **zero webpack patches** — everything runs at runtime through DOM manipulation, CSS injection, Flux dispatcher interception, and scroll/mutation observers. This means it won't break when Discord updates their client.

## License

GPL-3.0-or-later
