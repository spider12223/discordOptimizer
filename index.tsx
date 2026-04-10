import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

let autoFlushInterval: ReturnType<typeof setInterval> | null = null;
let idleTimeout: ReturnType<typeof setTimeout> | null = null;
let stanceTimeout: ReturnType<typeof setTimeout> | null = null;
let lastActivity = Date.now();
let scrollHandler: (() => void) | null = null;
let scrollerEl: Element | null = null;
let mutationObserver: MutationObserver | null = null;
let cdnObserver: MutationObserver | null = null;
let isIdle = false;
let isStanceMode = false;
let stanceMutationPaused = false;
let styleElement: HTMLStyleElement | null = null;
let stanceStyleElement: HTMLStyleElement | null = null;
let originalDispatch: typeof FluxDispatcher.dispatch | null = null;
let presenceThrottleMap: Map<string, number> = new Map();

const VOICE_SAFE_EVENTS = new Set([
    "VOICE_STATE_UPDATES",
    "VOICE_STATE_UPDATE",
    "VOICE_CHANNEL_SELECT",
    "VOICE_CHANNEL_STATUS_UPDATE",
    "VOICE_SERVER_UPDATE",
    "RTC_CONNECTION_STATE",
    "RTC_CONNECTION_VIDEO",
    "RTC_CONNECTION_AUDIO",
    "RTC_CONNECTION_LOSS_RATE",
    "RTC_CONNECTION_PING",
    "SPEAKING",
    "AUDIO_SET_LOCAL_VOLUME",
    "AUDIO_SET_MODE",
    "AUDIO_TOGGLE_SELF_MUTE",
    "AUDIO_TOGGLE_SELF_DEAF",
    "AUDIO_TOGGLE_LOCAL_MUTE",
    "MEDIA_ENGINE_SET_VIDEO_DEVICE",
    "MEDIA_ENGINE_SET_AUDIO_INPUT",
    "MEDIA_ENGINE_SET_AUDIO_OUTPUT",
    "MEDIA_ENGINE_SET_GO_LIVE_SOURCE",
    "STREAM_CREATE",
    "STREAM_UPDATE",
    "STREAM_DELETE",
    "STREAM_START",
    "STREAM_STOP",
    "STREAM_SERVER_UPDATE",
    "STREAM_QUALITY_UPDATE",
    "CALL_CREATE",
    "CALL_UPDATE",
    "CALL_DELETE",
    "CHANNEL_UPDATES",
    "CONNECTION_OPEN",
    "CONNECTION_CLOSED",
    "GUILD_CREATE",
    "GUILD_DELETE",
    "SESSION_REPLACE",
    "READY",
    "RESUMED"
]);

const BASE_CSS = `
[class*="typing-"] [class*="text-"] {
    animation: none !important;
}
[class*="spinnerItem-"] {
    animation-duration: 0s !important;
}
[class*="pulseContainer-"] {
    animation: none !important;
}
[class*="shine-"] {
    display: none !important;
}
[class*="premiumIconAnimation-"] {
    animation: none !important;
}
[class*="newMessagesBar-"] {
    transition: none !important;
}
[class*="messageListItem-"] {
    transition: none !important;
}
[class*="hoverBar-"] {
    transition: none !important;
}
`;

const STANCE_CSS = `
[class*="typing-"]:not([class*="call"]):not([class*="voice"]) {
    display: none !important;
}
[class*="nowPlayingColumn-"] {
    display: none !important;
}
[class*="memberList-"]:not([class*="call"]):not([class*="voice"]),
[class*="members-"]:not([class*="call"]):not([class*="voice"]) {
    display: none !important;
}
[class*="emojiPicker-"], [class*="stickerPicker-"] {
    display: none !important;
}
[class*="gifPickerPageContainer-"] {
    display: none !important;
}
[class*="activityFeed-"] {
    display: none !important;
}
[class*="profilePanel-"]:not([class*="call"]):not([class*="voice"]) {
    display: none !important;
}
[class*="lottieCanvas-"]:not([class*="call"]):not([class*="voice"]) {
    display: none !important;
}
[class*="animatedEmoji-"] {
    visibility: hidden !important;
}
[class*="unread-"]:not([class*="voice"]) {
    display: none !important;
}
[class*="numberBadge-"] {
    display: none !important;
}
`;

function getSettings() {
    return Vencord.Settings.plugins.DiscordOptimizer;
}

function isInVoiceChannel(): boolean {
    try {
        const voiceStateStore = Vencord.Webpack.findByProps("getVoiceStateForUser");
        const userStore = Vencord.Webpack.findByProps("getCurrentUser");
        const currentUser = userStore?.getCurrentUser();
        if (!currentUser) return false;
        const state = voiceStateStore?.getVoiceStateForUser(currentUser.id);
        return !!(state?.channelId);
    } catch {
        return false;
    }
}

function isVoiceVideoElement(el: HTMLElement): boolean {
    const voiceSelectors = [
        '[class*="callContainer"]',
        '[class*="voiceCallWrapper"]',
        '[class*="videoWrapper"]',
        '[class*="streamPreview"]',
        '[class*="participantsContainer"]',
        '[class*="videoGrid"]',
        '[class*="pipeContainer"]',
        '[class*="webcam"]',
        '[class*="voiceChannelDetails"]',
        '[class*="rtcConnection"]',
        '[class*="voiceChannel"]',
        '[class*="channelCall"]',
        '[class*="liveIndicator"]'
    ];
    for (const selector of voiceSelectors) {
        if (el.closest(selector)) return true;
    }
    return false;
}

function injectBaseCSS() {
    const settings = getSettings();
    if (!settings?.killAnimations) return;
    if (styleElement) return;
    styleElement = document.createElement("style");
    styleElement.id = "discord-optimizer-base";
    styleElement.textContent = BASE_CSS;
    document.head.appendChild(styleElement);
}

function removeBaseCSS() {
    if (styleElement) {
        styleElement.remove();
        styleElement = null;
    }
}

function injectStanceCSS() {
    if (stanceStyleElement) return;
    stanceStyleElement = document.createElement("style");
    stanceStyleElement.id = "discord-optimizer-stance";
    stanceStyleElement.textContent = STANCE_CSS;
    document.head.appendChild(stanceStyleElement);
}

function removeStanceCSS() {
    if (stanceStyleElement) {
        stanceStyleElement.remove();
        stanceStyleElement = null;
    }
}

function downscaleCDNImages() {
    try {
        const settings = getSettings();
        if (!settings?.downscaleImages) return;

        const maxSize = settings?.imageMaxSize ?? 256;
        const images = document.querySelectorAll('img[src*="cdn.discordapp.com"], img[src*="media.discordapp.net"]');

        images.forEach((img) => {
            const imgEl = img as HTMLImageElement;
            if (imgEl.dataset.optimizerDownscaled === "true") return;
            if (isVoiceVideoElement(imgEl)) return;

            const src = imgEl.src;
            if (src.includes("avatar") || src.includes("emoji") || src.includes("sticker")) return;

            try {
                const url = new URL(src);
                const currentSize = parseInt(url.searchParams.get("size") || "0", 10);

                if (currentSize === 0 || currentSize > maxSize) {
                    url.searchParams.set("size", String(maxSize));
                    url.searchParams.set("quality", "lossless");
                    imgEl.dataset.originalCdnSrc = imgEl.src;
                    imgEl.src = url.toString();
                    imgEl.dataset.optimizerDownscaled = "true";
                }
            } catch {}
        });
    } catch (e) {
        console.error("[DiscordOptimizer] CDN downscale failed:", e);
    }
}

function restoreCDNImages() {
    const downscaled = document.querySelectorAll('[data-optimizer-downscaled="true"]');
    downscaled.forEach((el) => {
        const imgEl = el as HTMLImageElement;
        if (imgEl.dataset.originalCdnSrc) {
            imgEl.src = imgEl.dataset.originalCdnSrc;
            delete imgEl.dataset.originalCdnSrc;
        }
        delete imgEl.dataset.optimizerDownscaled;
    });
}

function setupCDNObserver() {
    const settings = getSettings();
    if (!settings?.downscaleImages) return;

    cdnObserver = new MutationObserver(() => {
        if (!stanceMutationPaused) {
            downscaleCDNImages();
        }
    });
    cdnObserver.observe(document.body, { childList: true, subtree: true });
}

function patchFluxDispatcher() {
    if (originalDispatch) return;
    originalDispatch = FluxDispatcher.dispatch.bind(FluxDispatcher);

    FluxDispatcher.dispatch = function (event: any) {
        if (!event?.type) return originalDispatch!(event);

        if (VOICE_SAFE_EVENTS.has(event.type)) {
            return originalDispatch!(event);
        }

        const settings = getSettings();
        const inVC = isInVoiceChannel();

        if (isStanceMode && !inVC) {
            const blockedInStance = [
                "TYPING_START",
                "TYPING_STOP",
                "MESSAGE_ACK",
                "GUILD_MEMBER_LIST_UPDATE",
                "CHANNEL_UNREAD_UPDATE",
                "NOTIFICATION_CREATE",
                "ACTIVITY_START",
                "ACTIVITY_UPDATE"
            ];

            if (blockedInStance.includes(event.type)) {
                return;
            }
        }

        if (isStanceMode && inVC) {
            const safeToBlockInVC = [
                "TYPING_START",
                "TYPING_STOP",
                "MESSAGE_ACK",
                "CHANNEL_UNREAD_UPDATE",
                "NOTIFICATION_CREATE",
                "ACTIVITY_START",
                "ACTIVITY_UPDATE"
            ];

            if (safeToBlockInVC.includes(event.type)) {
                return;
            }
        }

        if (settings?.throttlePresence && event.type === "PRESENCE_UPDATES") {
            if (inVC && event.updates) {
                try {
                    const voiceStateStore = Vencord.Webpack.findByProps("getVoiceStatesForChannel");
                    const userStore = Vencord.Webpack.findByProps("getCurrentUser");
                    const currentUser = userStore?.getCurrentUser();
                    const myState = voiceStateStore?.getVoiceStateForUser?.(currentUser?.id);
                    const channelId = myState?.channelId;

                    if (channelId) {
                        const voiceStates = voiceStateStore?.getVoiceStatesForChannel?.(channelId);
                        const voiceUserIds = new Set(
                            voiceStates ? Object.values(voiceStates).map((s: any) => s.userId) : []
                        );

                        const now = Date.now();
                        const throttleMs = isStanceMode ? 30000 : 5000;

                        event.updates = event.updates.filter((update: any) => {
                            const userId = update.user?.id;
                            if (!userId) return true;
                            if (voiceUserIds.has(userId)) return true;

                            const lastUpdate = presenceThrottleMap.get(userId) || 0;
                            if (now - lastUpdate < throttleMs) return false;
                            presenceThrottleMap.set(userId, now);
                            return true;
                        });

                        if (event.updates.length === 0) return;
                        return originalDispatch!(event);
                    }
                } catch {}
            }

            const now = Date.now();
            const throttleMs = isStanceMode ? 30000 : 5000;

            if (event.updates) {
                event.updates = event.updates.filter((update: any) => {
                    const userId = update.user?.id;
                    if (!userId) return true;

                    const lastUpdate = presenceThrottleMap.get(userId) || 0;
                    if (now - lastUpdate < throttleMs) return false;
                    presenceThrottleMap.set(userId, now);
                    return true;
                });

                if (event.updates.length === 0) return;
            }
        }

        return originalDispatch!(event);
    };
}

function unpatchFluxDispatcher() {
    if (originalDispatch) {
        FluxDispatcher.dispatch = originalDispatch;
        originalDispatch = null;
    }
    presenceThrottleMap.clear();
}

function flushMessageCache() {
    try {
        const dispatchFn = originalDispatch || FluxDispatcher.dispatch.bind(FluxDispatcher);
        dispatchFn({ type: "MESSAGE_CACHE_CLEANUP" });

        const messageStore = Vencord.Webpack.findByProps("getMessage", "getMessages");

        if (messageStore?._channelMessages) {
            const settings = getSettings();
            const maxMessages = isStanceMode ? 10 : (settings?.maxCachedMessages ?? 50);
            let flushed = 0;

            for (const channelId in messageStore._channelMessages) {
                const messages = messageStore._channelMessages[channelId];
                if (messages?._array && messages._array.length > maxMessages) {
                    const removed = messages._array.length - maxMessages;
                    messages._array.splice(0, removed);
                    messages._map = new Map(messages._array.map((m: any) => [m.id, m]));
                    flushed += removed;
                }
            }

            if (flushed > 0) {
                console.log(`[DiscordOptimizer] Flushed ${flushed} cached messages`);
            }
        }
    } catch (e) {
        console.error("[DiscordOptimizer] Cache flush failed:", e);
    }
}

function nukeEmbedMedia() {
    try {
        const settings = getSettings();
        if (!settings?.hideOffscreenMedia && !isStanceMode) return;

        const selectors = [
            '[class*="imageContainer-"]',
            '[class*="embedImage"]',
            '[class*="embedVideo"]',
            '[class*="embedThumbnail"]',
            '[class*="gifFavoriteButton"]',
            '[class*="mosaic"]'
        ];

        const elements = document.querySelectorAll(selectors.join(", "));
        const viewportHeight = window.innerHeight;

        elements.forEach((el) => {
            const htmlEl = el as HTMLElement;
            if (isVoiceVideoElement(htmlEl)) return;

            if (isStanceMode) {
                if (htmlEl.dataset.optimizerHidden !== "true") {
                    htmlEl.style.visibility = "hidden";
                    htmlEl.style.contentVisibility = "hidden";
                    htmlEl.dataset.optimizerHidden = "true";
                }
                return;
            }

            const rect = el.getBoundingClientRect();
            if (rect.bottom < -viewportHeight || rect.top > viewportHeight * 3) {
                if (htmlEl.dataset.optimizerHidden !== "true") {
                    htmlEl.style.visibility = "hidden";
                    htmlEl.style.contentVisibility = "hidden";
                    htmlEl.dataset.optimizerHidden = "true";
                }
            }
        });
    } catch (e) {
        console.error("[DiscordOptimizer] Embed cleanup failed:", e);
    }
}

function restoreVisibleMedia() {
    try {
        if (isStanceMode) return;

        const hidden = document.querySelectorAll('[data-optimizer-hidden="true"]');
        const viewportHeight = window.innerHeight;

        hidden.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.bottom >= -viewportHeight && rect.top <= viewportHeight * 3) {
                const htmlEl = el as HTMLElement;
                htmlEl.style.visibility = "";
                htmlEl.style.contentVisibility = "";
                delete htmlEl.dataset.optimizerHidden;
            }
        });
    } catch (e) {
        console.error("[DiscordOptimizer] Media restore failed:", e);
    }
}

function pauseOffscreenVideos() {
    try {
        const settings = getSettings();
        if (!settings?.pauseOffscreenVideos && !isStanceMode) return;

        const videos = document.querySelectorAll("video");
        const viewportHeight = window.innerHeight;

        videos.forEach((video) => {
            if (isVoiceVideoElement(video)) return;

            if (isStanceMode) {
                if (!video.paused) {
                    video.pause();
                    video.dataset.optimizerPaused = "true";
                }
                return;
            }

            const rect = video.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > viewportHeight) {
                if (!video.paused) {
                    video.pause();
                    video.dataset.optimizerPaused = "true";
                }
            } else if (video.dataset.optimizerPaused === "true") {
                video.play().catch(() => {});
                delete video.dataset.optimizerPaused;
            }
        });
    } catch (e) {
        console.error("[DiscordOptimizer] Video pause failed:", e);
    }
}

function killGifAutoplay() {
    try {
        const settings = getSettings();
        if (!settings?.disableGifAutoplay && !isStanceMode) return;

        const gifs = document.querySelectorAll('img[src*=".gif"]');
        gifs.forEach((img) => {
            const imgEl = img as HTMLImageElement;
            if (imgEl.dataset.optimizerGifStopped === "true") return;
            if (isVoiceVideoElement(imgEl)) return;

            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            imgEl.addEventListener("load", () => {
                canvas.width = imgEl.naturalWidth;
                canvas.height = imgEl.naturalHeight;
                ctx.drawImage(imgEl, 0, 0);
                try {
                    const staticFrame = canvas.toDataURL("image/png");
                    imgEl.dataset.originalGif = imgEl.src;
                    imgEl.src = staticFrame;
                    imgEl.dataset.optimizerGifStopped = "true";
                } catch {}
            }, { once: true });
        });
    } catch (e) {
        console.error("[DiscordOptimizer] GIF freeze failed:", e);
    }
}

function disableSpellcheck() {
    const settings = getSettings();
    if (!settings?.disableSpellcheck) return;

    const textAreas = document.querySelectorAll('[class*="textArea-"] [role="textbox"]');
    textAreas.forEach((el) => {
        el.setAttribute("spellcheck", "false");
    });
}

function enableSpellcheck() {
    const textAreas = document.querySelectorAll('[class*="textArea-"] [role="textbox"]');
    textAreas.forEach((el) => {
        el.setAttribute("spellcheck", "true");
    });
}

function enterStanceMode() {
    if (isStanceMode) return;

    const settings = getSettings();
    if (!settings?.stanceMode) return;

    isStanceMode = true;
    console.log("[DiscordOptimizer] STANCE MODE — activated" + (isInVoiceChannel() ? " (VC-safe mode)" : ""));

    stanceMutationPaused = true;
    if (mutationObserver) mutationObserver.disconnect();
    if (cdnObserver) cdnObserver.disconnect();

    injectStanceCSS();
    flushMessageCache();
    nukeEmbedMedia();

    const videos = document.querySelectorAll("video");
    videos.forEach((video) => {
        if (isVoiceVideoElement(video)) return;
        if (!video.paused) {
            video.pause();
            video.dataset.optimizerPaused = "true";
        }
    });

    const stickerElements = document.querySelectorAll('[class*="stickerAsset"]');
    stickerElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (isVoiceVideoElement(htmlEl)) return;
        if (htmlEl.tagName === "VIDEO" || htmlEl.tagName === "CANVAS") {
            (htmlEl as HTMLVideoElement).pause?.();
            htmlEl.style.visibility = "hidden";
            htmlEl.dataset.optimizerHidden = "true";
        }
    });

    const reactionGifs = document.querySelectorAll('[class*="reactionInner"] img[src*=".gif"]');
    reactionGifs.forEach((el) => {
        const imgEl = el as HTMLImageElement;
        imgEl.dataset.originalSrc = imgEl.src;
        imgEl.src = "";
        imgEl.dataset.optimizerHidden = "true";
    });

    const avatarAnimations = document.querySelectorAll('[class*="avatar"] img[src*=".gif"], [class*="avatar"] video');
    avatarAnimations.forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (isVoiceVideoElement(htmlEl)) return;
        if (htmlEl.tagName === "VIDEO") {
            (htmlEl as HTMLVideoElement).pause();
            htmlEl.dataset.optimizerPaused = "true";
        } else if (htmlEl.tagName === "IMG") {
            const imgEl = htmlEl as HTMLImageElement;
            if (imgEl.src.includes(".gif")) {
                imgEl.dataset.originalSrc = imgEl.src;
                imgEl.src = imgEl.src.replace(".gif", ".webp");
                imgEl.dataset.optimizerHidden = "true";
            }
        }
    });

    const banners = document.querySelectorAll('[class*="banner"]:not([class*="call"]):not([class*="voice"]) img, [class*="banner"]:not([class*="call"]):not([class*="voice"]) video');
    banners.forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (isVoiceVideoElement(htmlEl)) return;
        if (htmlEl.tagName === "VIDEO") {
            (htmlEl as HTMLVideoElement).pause();
            htmlEl.dataset.optimizerPaused = "true";
        }
        htmlEl.style.visibility = "hidden";
        htmlEl.dataset.optimizerHidden = "true";
    });

    const canvases = document.querySelectorAll("canvas");
    canvases.forEach((canvas) => {
        if (isVoiceVideoElement(canvas)) return;
        canvas.style.visibility = "hidden";
        canvas.dataset.optimizerHidden = "true";
    });

    try {
        const emojiStore = Vencord.Webpack.findByProps("getEmojiURL");
        if (emojiStore?._cache) emojiStore._cache.clear?.();
    } catch {}

    if (autoFlushInterval) clearInterval(autoFlushInterval);
    autoFlushInterval = setInterval(() => {
        flushMessageCache();
    }, 2 * 60 * 1000);
}

function exitStanceMode() {
    if (!isStanceMode) return;

    isStanceMode = false;
    console.log("[DiscordOptimizer] STANCE MODE — deactivated");

    removeStanceCSS();

    const allHidden = document.querySelectorAll('[data-optimizer-hidden="true"]');
    allHidden.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.visibility = "";
        htmlEl.style.contentVisibility = "";

        if (htmlEl.dataset.originalSrc) {
            (htmlEl as HTMLImageElement).src = htmlEl.dataset.originalSrc;
            delete htmlEl.dataset.originalSrc;
        }

        delete htmlEl.dataset.optimizerHidden;
    });

    const pausedVideos = document.querySelectorAll('[data-optimizer-paused="true"]');
    pausedVideos.forEach((el) => {
        const video = el as HTMLVideoElement;
        video.play?.().catch(() => {});
        delete video.dataset.optimizerPaused;
    });

    const frozenGifs = document.querySelectorAll('[data-optimizer-gif-stopped="true"]');
    frozenGifs.forEach((el) => {
        const imgEl = el as HTMLImageElement;
        if (imgEl.dataset.originalGif) {
            imgEl.src = imgEl.dataset.originalGif;
            delete imgEl.dataset.originalGif;
        }
        delete imgEl.dataset.optimizerGifStopped;
    });

    stanceMutationPaused = false;
    if (mutationObserver) {
        mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (cdnObserver) {
        cdnObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (autoFlushInterval) clearInterval(autoFlushInterval);
    const settings = getSettings();
    const interval = settings?.flushIntervalMinutes ?? 15;
    if (interval > 0) {
        autoFlushInterval = setInterval(() => {
            flushMessageCache();
            nukeEmbedMedia();
            pauseOffscreenVideos();
            killGifAutoplay();
            downscaleCDNImages();
        }, interval * 60 * 1000);
    }

    presenceThrottleMap.clear();
}

function onVisibilityChange() {
    const settings = getSettings();
    if (!settings?.stanceMode) return;

    if (document.hidden) {
        const stanceDelay = (settings?.stanceDelayMinutes ?? 3) * 60 * 1000;
        stanceTimeout = setTimeout(() => {
            if (document.hidden) enterStanceMode();
        }, stanceDelay);
    } else {
        if (stanceTimeout) {
            clearTimeout(stanceTimeout);
            stanceTimeout = null;
        }
        if (isStanceMode) exitStanceMode();
    }
}

function onWindowBlur() {
    const settings = getSettings();
    if (!settings?.stanceMode) return;

    const stanceDelay = (settings?.stanceDelayMinutes ?? 3) * 60 * 1000;
    if (stanceTimeout) clearTimeout(stanceTimeout);

    stanceTimeout = setTimeout(() => {
        if (document.hidden || !document.hasFocus()) {
            enterStanceMode();
        }
    }, stanceDelay);
}

function onWindowFocus() {
    if (stanceTimeout) {
        clearTimeout(stanceTimeout);
        stanceTimeout = null;
    }
    if (isStanceMode) exitStanceMode();
}

function aggressiveIdleCleanup() {
    if (isStanceMode) return;
    isIdle = true;
    console.log("[DiscordOptimizer] Idle cleanup triggered");

    flushMessageCache();

    try {
        const videos = document.querySelectorAll("video");
        videos.forEach((video) => {
            if (isVoiceVideoElement(video)) return;
            if (!video.paused) {
                video.pause();
                video.dataset.optimizerPaused = "true";
            }
        });

        const stickerElements = document.querySelectorAll('[class*="stickerAsset"]');
        stickerElements.forEach((el) => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.tagName === "VIDEO" || htmlEl.tagName === "CANVAS") {
                (htmlEl as HTMLVideoElement).pause?.();
                htmlEl.style.visibility = "hidden";
                htmlEl.dataset.optimizerHidden = "true";
            }
        });

        const reactionGifs = document.querySelectorAll('[class*="reactionInner"] img[src*=".gif"]');
        reactionGifs.forEach((el) => {
            const imgEl = el as HTMLImageElement;
            imgEl.dataset.originalSrc = imgEl.src;
            imgEl.src = "";
            imgEl.dataset.optimizerHidden = "true";
        });

        const offscreenSelectors = [
            '[class*="imageContainer"]',
            '[class*="embedImage"]',
            '[class*="embedVideo"]',
            '[class*="embedThumbnail"]',
            '[class*="mosaic"]'
        ];
        const allMedia = document.querySelectorAll(offscreenSelectors.join(", "));
        const viewportHeight = window.innerHeight;

        allMedia.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const htmlEl = el as HTMLElement;
            if (rect.bottom < 0 || rect.top > viewportHeight) {
                htmlEl.style.visibility = "hidden";
                htmlEl.style.contentVisibility = "hidden";
                htmlEl.dataset.optimizerHidden = "true";
            }
        });
    } catch (e) {
        console.error("[DiscordOptimizer] Idle cleanup failed:", e);
    }
}

function restoreFromIdle() {
    if (!isIdle) return;
    isIdle = false;

    try {
        const hidden = document.querySelectorAll('[data-optimizer-hidden="true"]');
        hidden.forEach((el) => {
            const htmlEl = el as HTMLElement;
            htmlEl.style.visibility = "";
            htmlEl.style.contentVisibility = "";

            if (htmlEl.dataset.originalSrc) {
                (htmlEl as HTMLImageElement).src = htmlEl.dataset.originalSrc;
                delete htmlEl.dataset.originalSrc;
            }

            if (htmlEl.dataset.optimizerPaused === "true") {
                (htmlEl as HTMLVideoElement).play?.().catch(() => {});
                delete htmlEl.dataset.optimizerPaused;
            }

            delete htmlEl.dataset.optimizerHidden;
        });
    } catch (e) {
        console.error("[DiscordOptimizer] Restore from idle failed:", e);
    }
}

function resetIdleTimer() {
    lastActivity = Date.now();
    if (idleTimeout) clearTimeout(idleTimeout);
    if (isIdle) restoreFromIdle();

    const settings = getSettings();
    const idleMinutes = settings?.idleFlushMinutes ?? 10;

    idleTimeout = setTimeout(() => {
        aggressiveIdleCleanup();
    }, idleMinutes * 60 * 1000);
}

function attachScrollListener() {
    if (scrollHandler && scrollerEl) {
        scrollerEl.removeEventListener("scroll", scrollHandler);
    }

    const scroller = document.querySelector('[class*="messagesWrapper"] [class*="scroller"]');
    if (scroller && scroller !== scrollerEl) {
        scrollerEl = scroller;

        let ticking = false;
        scrollHandler = () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(() => {
                    nukeEmbedMedia();
                    restoreVisibleMedia();
                    pauseOffscreenVideos();
                    ticking = false;
                });
            }
        };

        scrollerEl.addEventListener("scroll", scrollHandler, { passive: true });
    }
}

export default definePlugin({
    name: "DiscordOptimizer",
    description: "Reduces Discord RAM usage with stance mode, animation killing, CDN downscaling, presence throttling, and smart cache management. Fully VC-safe.",
    authors: [{ name: "Zayed", id: 0n }],

    options: {
        stanceMode: {
            description: "Stance Mode — heavy optimization when Discord is tabbed out (VC-safe)",
            type: OptionType.BOOLEAN,
            default: true,
        },
        stanceDelayMinutes: {
            description: "Minutes tabbed out before Stance Mode kicks in",
            type: OptionType.SLIDER,
            default: 3,
            markers: [1, 2, 3, 5, 10],
            stickToMarkers: false,
        },
        killAnimations: {
            description: "Kill unnecessary CSS animations (hover effects, shine, pulse, transitions)",
            type: OptionType.BOOLEAN,
            default: true,
        },
        downscaleImages: {
            description: "Downscale Discord CDN images to save memory",
            type: OptionType.BOOLEAN,
            default: true,
        },
        imageMaxSize: {
            description: "Max image size in pixels when downscaling",
            type: OptionType.SLIDER,
            default: 512,
            markers: [128, 256, 512, 1024],
            stickToMarkers: true,
        },
        throttlePresence: {
            description: "Throttle presence updates — never throttles users in your VC",
            type: OptionType.BOOLEAN,
            default: true,
        },
        disableSpellcheck: {
            description: "Disable spellcheck in message input (saves ~30MB)",
            type: OptionType.BOOLEAN,
            default: false,
        },
        maxCachedMessages: {
            description: "Max messages per channel cache (Stance Mode forces 10)",
            type: OptionType.SLIDER,
            default: 50,
            markers: [10, 25, 50, 100, 200],
            stickToMarkers: false,
        },
        flushIntervalMinutes: {
            description: "Auto-flush interval in minutes (0 = disabled)",
            type: OptionType.SLIDER,
            default: 15,
            markers: [0, 5, 10, 15, 30, 60],
            stickToMarkers: false,
        },
        idleFlushMinutes: {
            description: "Minutes of inactivity before aggressive cleanup",
            type: OptionType.SLIDER,
            default: 10,
            markers: [5, 10, 15, 30],
            stickToMarkers: false,
        },
        hideOffscreenMedia: {
            description: "Unload images/videos that scroll out of view",
            type: OptionType.BOOLEAN,
            default: true,
        },
        pauseOffscreenVideos: {
            description: "Pause videos that are off-screen",
            type: OptionType.BOOLEAN,
            default: true,
        },
        disableGifAutoplay: {
            description: "Freeze GIFs to their first frame (no animation)",
            type: OptionType.BOOLEAN,
            default: false,
        },
        disableStickerAnimations: {
            description: "Stop animated sticker playback",
            type: OptionType.BOOLEAN,
            default: false,
        },
    },

    start() {
        const settings = getSettings();
        const interval = settings?.flushIntervalMinutes ?? 15;

        patchFluxDispatcher();
        injectBaseCSS();

        if (interval > 0) {
            autoFlushInterval = setInterval(() => {
                flushMessageCache();
                nukeEmbedMedia();
                pauseOffscreenVideos();
                killGifAutoplay();
                downscaleCDNImages();
                disableSpellcheck();
            }, interval * 60 * 1000);
        }

        document.addEventListener("mousemove", resetIdleTimer, { passive: true });
        document.addEventListener("keydown", resetIdleTimer, { passive: true });
        document.addEventListener("click", resetIdleTimer, { passive: true });

        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("blur", onWindowBlur);
        window.addEventListener("focus", onWindowFocus);

        const idleMinutes = settings?.idleFlushMinutes ?? 10;
        idleTimeout = setTimeout(() => {
            aggressiveIdleCleanup();
        }, idleMinutes * 60 * 1000);

        mutationObserver = new MutationObserver(() => {
            if (stanceMutationPaused) return;
            attachScrollListener();
            killGifAutoplay();
            disableSpellcheck();
        });
        mutationObserver.observe(document.body, { childList: true, subtree: true });

        setupCDNObserver();

        setTimeout(() => {
            attachScrollListener();
            killGifAutoplay();
            downscaleCDNImages();
            disableSpellcheck();
        }, 3000);

        console.log("[DiscordOptimizer] Started — stance:", settings?.stanceMode ? "ON" : "OFF",
            "| animations:", settings?.killAnimations ? "KILLED" : "normal",
            "| CDN downscale:", settings?.downscaleImages ? `${settings?.imageMaxSize}px` : "OFF",
            "| presence throttle:", settings?.throttlePresence ? "ON" : "OFF");
    },

    stop() {
        if (autoFlushInterval) {
            clearInterval(autoFlushInterval);
            autoFlushInterval = null;
        }
        if (idleTimeout) {
            clearTimeout(idleTimeout);
            idleTimeout = null;
        }
        if (stanceTimeout) {
            clearTimeout(stanceTimeout);
            stanceTimeout = null;
        }
        if (scrollHandler && scrollerEl) {
            scrollerEl.removeEventListener("scroll", scrollHandler);
            scrollHandler = null;
            scrollerEl = null;
        }
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
        if (cdnObserver) {
            cdnObserver.disconnect();
            cdnObserver = null;
        }

        document.removeEventListener("mousemove", resetIdleTimer);
        document.removeEventListener("keydown", resetIdleTimer);
        document.removeEventListener("click", resetIdleTimer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);

        unpatchFluxDispatcher();
        removeBaseCSS();
        removeStanceCSS();

        if (isStanceMode) exitStanceMode();
        if (isIdle) restoreFromIdle();

        const allHidden = document.querySelectorAll('[data-optimizer-hidden="true"]');
        allHidden.forEach((el) => {
            const htmlEl = el as HTMLElement;
            htmlEl.style.visibility = "";
            htmlEl.style.contentVisibility = "";
            delete htmlEl.dataset.optimizerHidden;
        });

        const frozenGifs = document.querySelectorAll('[data-optimizer-gif-stopped="true"]');
        frozenGifs.forEach((el) => {
            const imgEl = el as HTMLImageElement;
            if (imgEl.dataset.originalGif) {
                imgEl.src = imgEl.dataset.originalGif;
                delete imgEl.dataset.originalGif;
            }
            delete imgEl.dataset.optimizerGifStopped;
        });

        restoreCDNImages();
        enableSpellcheck();

        isStanceMode = false;
        isIdle = false;
        stanceMutationPaused = false;

        console.log("[DiscordOptimizer] Stopped — everything reverted");
    },
});
