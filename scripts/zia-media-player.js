// Extracted from Zia by z1n-k; MIT licensed (src/js/08-music-and-sound-bars.js, main).
// Zia media player: artwork glow, progress ring and time left on the media card,
// per-space tint behind it (--zia-media-space-bg), its opacity prefs
// (zia.media-player.opacity.collapsed / .expanded), sound bars on playing tabs,
// and the card's artwork / channel avatar / live marking.
// Optional prefs: zia.media.keep-with-pip, zia.media.youtube-channel-art,
// zia.media.tint-active-space.
(() => {
  if (window.__zia_media_playerLoaded) return;
  window.__zia_media_playerLoaded = true;

  const root = document.documentElement;
  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  // --- helpers Zia provides elsewhere ----------------------------------------
  const notedErrors = new Set();
  function noteError(where, err) {
    if (notedErrors.has(where)) return;
    notedErrors.add(where);
    console.debug(`[bubble-clean] ${where}:`, err);
  }

  // a setting (or several) watched for as long as the window is open
  function watchPrefs(names, fn) {
    for (const name of [names].flat()) {
      Services.prefs.addObserver(name, fn);
    }
    window.addEventListener("unload", () => {
      for (const name of [names].flat()) {
        Services.prefs.removeObserver(name, fn);
      }
    });
  }

  // --- the media player itself -----------------------------------------------

  // Use the media tab's own space, not whichever space is currently visible.
  function mediaWorkspaceColor(element) {
    const browser = element.__ziaCard?.browser;
    const tab = browser && gBrowser.getTabForBrowser(browser);
    const manager = window.gZenWorkspaces;
    // zia.media.tint-active-space: the space you're in, not the playing tab's
    const followActive = Services.prefs.getBoolPref("zia.media.tint-active-space", false);
    const id = (!followActive && tab?.getAttribute("zen-workspace-id")) || manager?.activeWorkspace;
    try {
      const workspace = manager?.getWorkspaceFromId?.(id);
      const colors = workspace?.theme?.gradientColors || [];
      const color = (colors.find((entry) => entry.isPrimary) || colors[Math.floor(colors.length / 2)])?.c;
      if (Array.isArray(color) && color.length >= 3 && color.slice(0, 3).every(Number.isFinite)) {
        return `rgb(${color.slice(0, 3).join(",")})`;
      }
      if (typeof color === "string" && CSS.supports("color", color)) return color;
      const space = manager?.workspaceElement?.(id);
      return getComputedStyle(space || root).getPropertyValue("--zen-primary-color").trim() || "#806b76";
    } catch {
      return "#806b76";
    }
  }

  const workspaceTints = new Map();
  function readableWorkspaceTint(color) {
    if (workspaceTints.has(color)) return workspaceTints.get(color);
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#806b76";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    let rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const luminance = (values) => values.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    // Preserve the workspace hue, limiting brightness for the white labels.
    while (luminance(rgb) > 0.12) rgb = rgb.map((value) => value * 0.96);
    const tint = `rgb(${rgb.map(Math.round).join(", ")})`;
    if (workspaceTints.size >= 64) workspaceTints.clear();
    workspaceTints.set(color, tint);
    return tint;
  }

  function updateMediaWorkspace(element) {
    try {
      const color = readableWorkspaceTint(mediaWorkspaceColor(element));
      if (element.style.getPropertyValue("--zia-media-space-bg") !== color) {
        element.style.setProperty("--zia-media-space-bg", color);
      }
    } catch (err) {
      noteError("media workspace tint", err);
    }
  }

  // The toolbar holds the active space's tint as a default, which every card
  // inherits: a card that loses its own value (Zen rebuilds or restyles cards
  // on some sites) shows the space colour instead of the CSS fallback.
  function updateToolbarTint() {
    const toolbar = document.getElementById("zen-media-controls-toolbar");
    if (toolbar) updateMediaWorkspace(toolbar);
  }

  function updateAllMediaTints() {
    updateToolbarTint();
    for (const element of document.querySelectorAll(".zen-media-card")) updateMediaWorkspace(element);
  }

  function watchMediaWorkspace() {
    let frame = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateAllMediaTints();
      });
    };
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["style", "zen-default-theme"] });
    const tabObserver = new MutationObserver(schedule);
    tabObserver.observe(gBrowser.tabContainer, {
      subtree: true, attributes: true, attributeFilter: ["zen-workspace-id"],
    });
    // Cards come and go (and are restyled) on their own: tint them straight
    // away, whatever else the media glow does in the same frame.
    const toolbar = document.getElementById("zen-media-controls-toolbar");
    const cardObserver = new MutationObserver(schedule);
    if (toolbar) {
      cardObserver.observe(toolbar, {
        subtree: true, childList: true, attributes: true, attributeFilter: ["style", "hidden"],
      });
    }
    window.addEventListener("ZenWorkspacesUIUpdate", schedule);
    Services.prefs.addObserver("zen.workspaces.active", schedule);
    Services.prefs.addObserver("zia.media.tint-active-space", schedule);
    window.addEventListener("unload", () => {
      themeObserver.disconnect();
      tabObserver.disconnect();
      cardObserver.disconnect();
      Services.prefs.removeObserver("zen.workspaces.active", schedule);
      Services.prefs.removeObserver("zia.media.tint-active-space", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    }, { once: true });
    schedule();
  }

  function watchMediaOpacity() {
    const prefix = "zia.media-player.opacity.";
    const defaults = Services.prefs.getDefaultBranch("");
    const settings = [["collapsed", 40], ["expanded", 90]];
    for (const [state, value] of settings) {
      defaults.setStringPref(prefix + state, String(value));
    }
    const update = () => {
      for (const [state, fallback] of settings) {
        let value = fallback;
        try {
          const input = Services.prefs.getStringPref(prefix + state, String(fallback))
            .trim().replace(/%$/, "").trim();
          const number = input === "" ? NaN : Number(input);
          if (Number.isFinite(number)) value = Math.max(0, Math.min(100, number));
        } catch {}
        root.style.setProperty(`--zia-media-opacity-${state}`, `${value}%`);
      }
    };
    Services.prefs.addObserver(prefix, update);
    window.addEventListener("unload", () => Services.prefs.removeObserver(prefix, update), { once: true });
    update();
  }

  const mediaColorCache = new Map();

  function artUrlOf(card) {
    const artwork = card.querySelector(".zen-media-focus-button[zia-art]")?.getAttribute("zia-art");
    if (artwork) {
      return artwork;
    }
    const favicon = card.querySelector(".zen-media-focus-button[zia-favicon]")?.getAttribute("zia-favicon");
    if (favicon) {
      return favicon;
    }
    const img = card.querySelector(".zen-media-focus-button image, .zen-media-focus-button .toolbarbutton-icon");
    if (!img) {
      return "";
    }
    const src = img.getAttribute("src") || img.src || "";
    if (src) {
      return src;
    }
    const listStyle = getComputedStyle(img).listStyleImage || "";
    const match = listStyle.match(/url\(["']?(.*?)["']?\)/);
    return match ? match[1] : "";
  }

  function boost([r, g, b]) {
    const avg = (r + g + b) / 3;
    const k = 1.6;
    return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(avg + (v - avg) * k))));
  }

  // the image's pixels at size by size, or null
  function readPixels(url, size) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElementNS(XHTML_NS, "canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          resolve(ctx.getImageData(0, 0, size, size).data);
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function readArtColors(url) {
    const size = 24;
    const data = await readPixels(url, size);
    if (!data) {
      return null;
    }
    const halves = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (data[i + 3] < 128) {
          continue;
        }
        const h = halves[x < size / 2 ? 0 : 1];
        h[0] += data[i];
        h[1] += data[i + 1];
        h[2] += data[i + 2];
        h[3]++;
      }
    }
    const colors = halves.map((h) => (h[3] ? boost([h[0] / h[3], h[1] / h[3], h[2] / h[3]]) : null));
    if (!colors[0] && !colors[1]) {
      return null;
    }
    const a = colors[0] || colors[1];
    const b = colors[1] || colors[0];
    return [`rgb(${a.join(", ")})`, `rgb(${b.join(", ")})`];
  }

  async function cachedArtColors(url) {
    if (!mediaColorCache.has(url)) {
      mediaColorCache.set(url, await readArtColors(url));
    }
    return mediaColorCache.get(url);
  }

  // up to three of the favicon's strongest hues, for the selected tab's glow;
  // null for grey, white and black icons (the glow stays white)
  async function readFaviconPalette(url) {
    const data = await readPixels(url, 32);
    if (!data) {
      return null;
    }
    const bins = Array.from({ length: 12 }, () => [0, 0, 0, 0]);
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 128) {
        continue;
      }
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0;
      if (sat < 0.3 || max < 60) {
        continue;
      }
      let hue;
      if (max === r) {
        hue = ((g - b) / (max - min) + 6) % 6;
      } else if (max === g) {
        hue = (b - r) / (max - min) + 2;
      } else {
        hue = (r - g) / (max - min) + 4;
      }
      const bin = bins[Math.floor(hue * 2) % 12];
      bin[0] += r * sat;
      bin[1] += g * sat;
      bin[2] += b * sat;
      bin[3] += sat;
    }
    const ranked = bins.filter((bin) => bin[3] >= 6).sort((x, y) => y[3] - x[3]);
    if (!ranked.length) {
      return null;
    }
    const top = ranked[0][3];
    const colors = ranked
      .filter((bin) => bin[3] >= top * 0.12)
      .slice(0, 3)
      .map((bin) => bin.slice(0, 3).map((v) => Math.round(v / bin[3])));
    if (colors.length === 1) {
      const [r, g, b] = colors[0];
      colors.push([r, g, b].map((v) => Math.round(v + (255 - v) * 0.35)));
      colors.push([r, g, b].map((v) => Math.round(v * 0.7)));
    } else if (colors.length === 2) {
      colors.push(colors[0].map((v, k) => Math.round((v + colors[1][k]) / 2)));
    }
    return colors.map((c) => `rgb(${c.join(", ")})`);
  }

  const faviconPaletteCache = new Map();

  const ARTWORK_WAIT_MS = 1500;

  async function updateCardGlow(card) {
    const url = artUrlOf(card);
    if (card.__ziaArtUrl === url) {
      return;
    }
    card.__ziaArtUrl = url;
    const isArtwork = !!card.querySelector(".zen-media-focus-button[zia-art]");
    if (!isArtwork) {
      if (!card.hasAttribute("zia-glow-ready")) {
        card.setAttribute("zia-glow-pending", "true");
      }
      await new Promise((resolve) => setTimeout(resolve, ARTWORK_WAIT_MS));
      if (card.__ziaArtUrl !== url) {
        return;
      }
    }

    const colors = await cachedArtColors(url);
    if (card.__ziaArtUrl !== url) {
      return;
    }
    if (colors) {
      card.style.setProperty("--zia-media-glow-a", colors[0]);
      card.style.setProperty("--zia-media-glow-b", colors[1]);
    } else {
      card.style.removeProperty("--zia-media-glow-a");
      card.style.removeProperty("--zia-media-glow-b");
    }
    card.removeAttribute("zia-glow-pending");
    card.setAttribute("zia-glow-ready", "true");
    card.__ziaColors = colors;
    paintSoundBars(card, colors);
  }

  const soundBarCache = new Map();

  function lighten(color, amount = 0.35) {
    const m = String(color).match(/\d+(\.\d+)?/g);
    if (!m) {
      return "rgb(255, 255, 255)";
    }
    const [r, g, b] = m.map(Number).map((v) => Math.round(v + (255 - v) * amount));
    return `rgb(${r}, ${g}, ${b})`;
  }

  let soundBarToken = 0;
  // four bars, shrinking to dots when muted
  const BAR_X = [1.6, 5.2, 8.8, 12.4];
  const BAR_W = 2;
  const BAR_REST = [
    [4.5, 7],
    [2.5, 11],
    [3.5, 9],
    [5.25, 5.5],
  ];

  // dark in light mode: white bars went missing on the white selected tab
  const plainBarInk = () => (root.hasAttribute("zia-light") ? "rgb(28, 28, 32)" : "rgb(255, 255, 255)");
  let barInkWatched = false;
  function watchBarInk() {
    if (barInkWatched) {
      return;
    }
    barInkWatched = true;
    new MutationObserver(redrawSoundBars).observe(root, { attributes: true, attributeFilter: ["zia-light"] });
  }

  function soundBarImages(colors) {
    watchBarInk();
    const ink = plainBarInk();
    const key = colors ? colors.join("|") : ink;
    let images = soundBarCache.get(key);
    if (images) {
      return images;
    }
    const a = colors ? lighten(colors[0]) : ink;
    const b = colors ? lighten(colors[1]) : ink;
    const gradient = `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="1.6" y1="0" x2="14.4" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
    const image = (style, bars) =>
      `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${gradient}${style}<g fill="url(#g)">${bars}</g></svg>`)}`;
    const resting = BAR_X.map((x, i) => `<rect x="${x}" y="${BAR_REST[i][0]}" width="${BAR_W}" height="${BAR_REST[i][1]}" rx="1"/>`).join("");
    const wave = image(
      `<style>rect{transform-box:fill-box;transform-origin:center;animation:grow .26s cubic-bezier(.2,.9,.3,1) both,z .6s .26s ease-in-out infinite alternate}` +
        [0.55, 0.68, 0.5, 0.74].map((d, i) => `.b${i}{animation-duration:.26s,${d}s;animation-delay:0s,${(0.26 + i * 0.05).toFixed(2)}s}`).join("") +
        `@keyframes grow{from{height:2px;y:7px}to{height:11px;y:2.5px}}` +
        `@keyframes z{from{transform:scaleY(.22)}to{transform:scaleY(1)}}` +
        `@media (prefers-reduced-motion:reduce){rect{animation:none;transform:scaleY(.6)}}` +
        `</style>`,
      BAR_X.map((x, i) => `<rect class="b${i}" x="${x}" y="2.5" width="${BAR_W}" height="11" rx="1"/>`).join("")
    );
    const dots = image(
      `<style>rect{animation:shrink .28s cubic-bezier(.4,0,.2,1) forwards}@keyframes shrink{to{height:${BAR_W}px;y:${8 - BAR_W / 2}px}}` +
        `@media (prefers-reduced-motion:reduce){rect{animation-duration:1ms}}` +
        `</style>`,
      resting
    );
    images = { waveData: wave, dotsData: dots, stillData: image("", resting) };
    soundBarCache.set(key, images);
    return images;
  }

  function freshSoundBars(colors) {
    const images = soundBarImages(colors);
    const n = ++soundBarToken;
    return {
      wave: `url("${images.waveData}#${n}")`,
      dots: `url("${images.dotsData}#${n}")`,
      still: `url("${images.stillData}")`,
    };
  }

  function applyCardSoundBars(element) {
    const fresh = freshSoundBars(element.__ziaColors ?? null);
    element.style.setProperty("--zia-sound-wave", fresh.wave);
    element.style.setProperty("--zia-sound-still", fresh.still);
    element.style.setProperty("--zia-sound-muted", fresh.dots);
  }

  function watchCardSoundState(element) {
    if (element.__ziaSoundWatch) {
      return;
    }
    element.__ziaSoundWatch = true;
    let last = "";
    new MutationObserver(() => {
      const state = `${element.classList.contains("playing")}|${element.hasAttribute("muted")}`;
      if (state !== last) {
        last = state;
        applyCardSoundBars(element);
      }
    }).observe(element, { attributes: true, attributeFilter: ["class", "muted"] });
  }

  const soundBarCards = new Set();

  function paintSoundBars(card, colors) {
    soundBarCards.add(card);
    card.__ziaColors = colors;
    applyCardSoundBars(card);
    watchCardSoundState(card);
    repaintSoundTabs();
  }

  // a tab's bars are drawn before its player's colours are known: recolour them as
  // they arrive (tabs whose colours haven't changed are left alone)
  function repaintSoundTabs() {
    for (const tab of gBrowser.tabs) {
      paintTabSoundBars(tab);
    }
  }

  function tabMediaColors(tab) {
    const toolbar = document.getElementById("zen-media-controls-toolbar");
    for (const element of toolbar?.querySelectorAll(".zen-media-card") || []) {
      if (element.__ziaCard?.browser === tab.linkedBrowser) {
        return element.__ziaColors ?? null;
      }
    }
    return null;
  }

  // Until the player has the artwork's colours, the site's own colours stand in.
  function tabFallbackColors(tab) {
    const url = tab.getAttribute("image") || "";
    const palette = faviconPaletteCache.get(url);
    if (palette === undefined) {
      readFaviconPalette(url).then((result) => {
        faviconPaletteCache.set(url, result);
        if (result) {
          paintTabSoundBars(tab);
        }
      });
      return null;
    }
    return palette ? [palette[0], palette[1] || palette[0]] : null;
  }

  function applyTabSoundBars(tab) {
    const essential = tab.hasAttribute("zen-essential");
    const tinted = !essential && Services.prefs.getBoolPref("zia.tabs.favicon-glow", false);
    const colors = tinted ? tabMediaColors(tab) || tabFallbackColors(tab) : null;
    const key = `${colors ? colors.join("|") : plainBarInk()}|${essential}|${tab.hasAttribute("soundplaying")}|${tab.hasAttribute("muted")}`;
    if (tab.__ziaSoundKey === key) {
      return;
    }
    tab.__ziaSoundKey = key;
    const fresh = freshSoundBars(colors);
    tab.style.setProperty("--zia-sound-wave", fresh.wave);
    tab.style.setProperty("--zia-sound-muted", fresh.dots);
  }

  function ensureTabSound(tab) {
    if (tab.querySelector(".zia-tab-sound")) {
      return;
    }
    const content = tab.querySelector(".tab-content");
    if (!content) {
      return;
    }
    const bars = document.createElementNS(XHTML_NS, "span");
    bars.className = "zia-tab-sound";
    bars.setAttribute("role", "button");
    bars.addEventListener("mousedown", (event) => event.stopPropagation());
    bars.addEventListener("click", (event) => {
      event.stopPropagation();
      tab.toggleMuteAudio();
    });
    const before =
      content.querySelector(":scope > .tab-audio-button") || content.querySelector(":scope > .tab-label-container");
    content.insertBefore(bars, before);
  }

  function paintTabSoundBars(tab) {
    if (tab?.hasAttribute("soundplaying") || tab?.hasAttribute("muted")) {
      ensureTabSound(tab);
      applyTabSoundBars(tab);
      const bars = tab.querySelector(".zia-tab-sound");
      bars?.setAttribute("title", tab.hasAttribute("muted") ? "Unmute tab" : "Mute tab");
    }
  }

  // every playing tab and player redrawn
  function redrawSoundBars() {
    repaintSoundTabs();
    for (const card of soundBarCards) {
      if (!card.isConnected) {
        soundBarCards.delete(card);
        continue;
      }
      try {
        applyCardSoundBars(card);
      } catch (err) {
        noteError("music and sound bars: redraw", err);
      }
    }
  }

  function watchTabSoundBars() {
    watchPrefs("zia.tabs.favicon-glow", repaintSoundTabs);
    gBrowser.tabContainer.addEventListener("TabAttrModified", (event) => {
      const changed = event.detail?.changed || [];
      if (changed.includes("soundplaying") || changed.includes("muted")) {
        paintTabSoundBars(event.target);
      }
      if (changed.includes("image")) {
        for (const element of document.querySelectorAll(".zen-media-card")) {
          const card = element.__ziaCard;
          if (card?.browser === event.target.linkedBrowser) {
            try {
              card.updateIcon();
            } catch (err) {
              noteError("music and sound bars: watchTabSoundBars", err);
            }
          }
        }
      }
    });
    repaintSoundTabs();
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  let ringCount = 0;

  function ensureRing(button) {
    if (!button || button.querySelector(":scope > .zia-ring")) {
      return;
    }
    const id = `zia-ring-gradient-${++ringCount}`;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "zia-ring");
    svg.setAttribute("viewBox", "0 0 46 46");
    svg.setAttribute("aria-hidden", "true");

    const make = (tag, attrs, parent) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attrs)) {
        el.setAttribute(name, value);
      }
      parent.appendChild(el);
      return el;
    };
    const gradient = make("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "1" }, make("defs", {}, svg));
    make("stop", { offset: "0", style: "stop-color: var(--zia-media-glow-a)" }, gradient);
    make("stop", { offset: "1", style: "stop-color: var(--zia-media-glow-b)" }, gradient);
    // starts top middle and runs clockwise, as progress reads; round where this
    // Firefox can't draw a squircle (as the artwork is then)
    const squircle = typeof CSS === "undefined" || CSS.supports("corner-shape", "round");
    const shape = { d: squircle ? "M23.00 1.00 L30.50 1.00 L35.98 1.09 L38.33 1.38 L40.08 1.85 L41.47 2.53 L42.59 3.41 L43.47 4.53 L44.15 5.92 L44.62 7.67 L44.91 10.02 L45.00 15.50 L45.00 30.50 L44.91 35.98 L44.62 38.33 L44.15 40.08 L43.47 41.47 L42.59 42.59 L41.47 43.47 L40.08 44.15 L38.33 44.62 L35.98 44.91 L30.50 45.00 L15.50 45.00 L10.02 44.91 L7.67 44.62 L5.92 44.15 L4.53 43.47 L3.41 42.59 L2.53 41.47 L1.85 40.08 L1.38 38.33 L1.09 35.98 L1.00 30.50 L1.00 15.50 L1.09 10.02 L1.38 7.67 L1.85 5.92 L2.53 4.53 L3.41 3.41 L4.53 2.53 L5.92 1.85 L7.67 1.38 L10.02 1.09 L15.50 1.00 L23.00 1.00 Z" : "M23 1 L35 1 A10 10 0 0 1 45 11 L45 35 A10 10 0 0 1 35 45 L11 45 A10 10 0 0 1 1 35 L1 11 A10 10 0 0 1 11 1 Z", fill: "none", "stroke-width": "2", pathLength: "100" };
    make("path", { ...shape, class: "zia-ring-track" }, svg);
    make("path", {
      ...shape,
      class: "zia-ring-fill",
      stroke: `url(#${id})`,
      "stroke-linecap": "round",
      "stroke-dasharray": "0 100",
      "stroke-opacity": "0",
    }, svg);
    button.appendChild(svg);
  }

  const faviconTints = new Map();

  function tintFromColors(colors) {
    const m = String(colors?.[0] || "").match(/\d+(\.\d+)?/g);
    if (!m) {
      return "rgb(44, 44, 46)";
    }
    const [r, g, b] = m.map(Number).map((v) => Math.round(v * 0.32 + 26));
    return `rgb(${r}, ${g}, ${b})`;
  }

  async function showFaviconTile(card, button, art) {
    if (art) {
      button.removeAttribute("zia-favicon");
      button.removeAttribute("zia-initial");
      return;
    }
    const tab = card.browser && gBrowser.getTabForBrowser(card.browser);
    let icon =
      tab?.getAttribute("image") ||
      (tab && gBrowser.getIcon?.(tab)) ||
      card.browser?.mIconURL ||
      (card.browser?.currentURI?.spec ? `page-icon:${card.browser.currentURI.spec}` : "");
    if (/defaultFavicon|globe/i.test(icon)) {
      icon = "";
    }
    if (!icon) {
      let host = "";
      try {
        host = card.browser?.currentURI?.displayHost?.replace(/^www\./, "") || "";
      } catch (err) {
        host = "";
      }
      button.setAttribute("zia-favicon", "");
      button.setAttribute("zia-initial", (host[0] || "♪").toUpperCase());
      button.style.removeProperty("--zia-media-favicon");
      button.style.setProperty("--zia-favicon-tint", "rgb(52, 52, 56)");
      return;
    }
    button.removeAttribute("zia-initial");
    button.setAttribute("zia-favicon", icon);
    button.style.setProperty("--zia-media-favicon", `url("${icon.replace(/"/g, "%22")}")`);
    let tint = faviconTints.get(icon);
    if (!tint) {
      tint = tintFromColors(await cachedArtColors(icon));
      faviconTints.set(icon, tint);
    }
    if (button.getAttribute("zia-favicon") === icon) {
      button.style.setProperty("--zia-favicon-tint", tint);
    }
  }

  const FLIP_OUT_MS = 200;
  const FLIP_IN_MS = 380;

  function flipArtwork(button, swap) {
    const icon = button.querySelector(":scope > .toolbarbutton-icon") || button.querySelector("image");
    if (!icon || typeof icon.animate !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      swap();
      return;
    }
    button.__ziaFlip?.cancel();
    const turnAway = icon.animate(
      [{ transform: "perspective(240px) rotateY(0deg)" }, { transform: "perspective(240px) rotateY(90deg)" }],
      { duration: FLIP_OUT_MS, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" }
    );
    button.__ziaFlip = turnAway;
    turnAway.finished
      .then(() => {
        swap();
        const turnBack = icon.animate(
          [
            { transform: "perspective(240px) rotateY(-90deg)" },
            { transform: "perspective(240px) rotateY(8deg)", offset: 0.75 },
            { transform: "perspective(240px) rotateY(0deg)" },
          ],
          { duration: FLIP_IN_MS, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" }
        );
        button.__ziaFlip = turnBack;
        turnAway.cancel();
      })
      .catch(() => {});
  }

  function setRing(card, fraction) {
    const fill = card.focusButton?.querySelector(".zia-ring-fill");
    if (!fill) {
      return;
    }
    const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
    fill.style.strokeDasharray = pct > 0.2 ? `${pct.toFixed(2)} 100` : "0 100";
    fill.style.strokeOpacity = pct > 0.2 ? "1" : "0";
  }

  function showTimeLeft(card) {
    const durationEl = card.durationEl;
    const bar = card.progressBar;
    if (!bar || !card.duration || card.duration >= 900_000) {
      setRing(card, 0);
      return;
    }
    const fraction = Number(bar.value) / 100;
    setRing(card, fraction);
    if (durationEl) {
      const played = fraction * card.duration;
      durationEl.textContent = `-${card.formatSecondsToTime(Math.max(0, card.duration - played))}`;
    }
  }

  function watchTimeLeft(card) {
    const el = card.currentTimeEl;
    if (!el || el.__ziaTimeLeft) {
      return;
    }
    el.__ziaTimeLeft = true;
    new MutationObserver(() => showTimeLeft(card)).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  const isStandInArtwork = (src) =>
    !src || /^(jar|chrome|resource|moz-src):/i.test(src) || /defaultFavicon|globe/i.test(src);

  function bestArtwork(artwork) {
    if (!Array.isArray(artwork)) {
      return "";
    }
    artwork = artwork.filter((a) => !isStandInArtwork(a?.src));
    if (!artwork.length) {
      return "";
    }
    const area = (a) =>
      Math.max(
        0,
        ...String(a.sizes || "")
          .split(/\s+/)
          .map((size) => size.split("x").reduce((w, h) => (parseInt(w) || 0) * (parseInt(h) || 0)))
      );
    return artwork.sort((x, y) => area(y) - area(x))[0]?.src || "";
  }

  // Zen hides a card while its video is in picture-in-picture, so the card's own
  // picture-in-picture button took the card away; this option keeps it
  const KEEP_WITH_PIP_PREF = "zia.media.keep-with-pip";

  function keepWithPip() {
    try {
      return Services.prefs.getBoolPref(KEEP_WITH_PIP_PREF, true);
    } catch (err) {
      return true;
    }
  }

  function keepCardsWithPip() {
    const front = window.gZenMediaController?.frontCard;
    const proto = front && Object.getPrototypeOf(front);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, "shouldBeVisible");
    if (!desc?.get) {
      return false;
    }
    if (desc.get.__zia) {
      return true;
    }
    const original = desc.get;
    const patched = function () {
      try {
        // (fullscreen is Zen's to decide, as before)
        if (keepWithPip() && !this.isSharing && this.controller?.isBeingUsedInPIPModeOrFullscreen && !document.fullscreenElement && !window.fullScreen) {
          return gBrowser.selectedBrowser.browserId !== this.browser.browserId;
        }
      } catch (err) {
        noteError("music and sound bars: keepCardsWithPip", err);
      }
      return original.call(this);
    };
    patched.__zia = true;
    Object.defineProperty(proto, "shouldBeVisible", { ...desc, get: patched });

    const refreshCards = () => {
      for (const element of document.querySelectorAll("#zen-media-controls-toolbar .zen-media-card")) {
        try {
          element.__ziaCard?.refreshVisibility?.();
        } catch (err) {
          noteError("music and sound bars: keepCardsWithPip (2)", err);
        }
      }
    };
    watchPrefs(KEEP_WITH_PIP_PREF, refreshCards);
    return true;
  }

  function ziaActor(browser) {
    try {
      return browser?.browsingContext?.currentWindowGlobal?.getActor("Zia") || null;
    } catch (err) {
      return null;
    }
  }

  // Kick streams have no artwork: the channel's picture instead, asked of Kick
  // once per channel (actors/ZiaChild.sys.mjs)
  const kickAvatars = new Map();

  function kickSlug(browser) {
    try {
      const uri = browser?.currentURI;
      if (!/^(www\.)?kick\.com$/.test(uri?.host || "")) {
        return "";
      }
      const slug = uri.filePath.split("/")[1] || "";
      return /^[\w-]+$/.test(slug) ? slug.toLowerCase() : "";
    } catch (err) {
      return "";
    }
  }

  function kickAvatar(card) {
    const slug = kickSlug(card.browser);
    if (!slug) {
      return "";
    }
    if (kickAvatars.has(slug)) {
      return kickAvatars.get(slug) || "";
    }
    kickAvatars.set(slug, null);
    const actor = ziaActor(card.browser);
    if (!actor) {
      kickAvatars.delete(slug);
      return "";
    }
    try {
      actor
        .sendQuery("Zia:KickAvatar", { slug })
        .then((pic) => {
          kickAvatars.set(slug, pic || "");
          if (pic && kickSlug(card.browser) === slug) {
            card.updateIcon();
          }
        })
        .catch(() => kickAvatars.delete(slug));
    } catch (err) {
      kickAvatars.delete(slug);
    }
    return "";
  }

  // optional: a YouTube video shows its channel's picture, asked again a few
  // times while the page is still putting it up
  const YOUTUBE_AVATAR_PREF = "zia.media.youtube-channel-art";
  const youTubeAvatars = new Map();

  function youTubeVideo(browser) {
    try {
      const uri = browser?.currentURI;
      if (!/^(www\.|m\.)?youtube\.com$/.test(uri?.host || "")) {
        return "";
      }
      const url = new URL(uri.spec);
      const id = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|live)\/([\w-]+)/)?.[1] || "";
      return /^[\w-]+$/.test(id) ? id : "";
    } catch (err) {
      return "";
    }
  }

  function youTubeAvatar(card) {
    try {
      if (!Services.prefs.getBoolPref(YOUTUBE_AVATAR_PREF, false)) {
        return "";
      }
    } catch (err) {
      return "";
    }
    const video = youTubeVideo(card.browser);
    if (!video) {
      return "";
    }
    const known = youTubeAvatars.get(video);
    if (known?.pic || known?.asking) {
      return known.pic || "";
    }
    const tries = (known?.tries || 0) + 1;
    if (tries > 6) {
      return "";
    }
    const actor = ziaActor(card.browser);
    if (!actor) {
      return "";
    }
    youTubeAvatars.set(video, { asking: true, tries });
    actor
      .sendQuery("Zia:YouTubeAvatar", {})
      .then((pic) => {
        youTubeAvatars.set(video, { pic: pic || "", tries });
        if (youTubeVideo(card.browser) !== video) {
          return;
        }
        if (pic) {
          card.updateIcon();
        } else {
          setTimeout(() => {
            if (youTubeVideo(card.browser) === video) {
              card.updateIcon();
            }
          }, 1500);
        }
      })
      .catch(() => youTubeAvatars.set(video, { tries }));
    return "";
  }

  // A YouTube live stream reports a position and length, so Zen showed a jumping
  // progress line: YouTube's player is asked, and the card shows LIVE instead.
  const youTubeLiveChecked = new WeakMap();

  function markLiveStream(card) {
    const element = card.element;
    const browser = card.browser;
    if (!element || !browser) {
      return;
    }
    let host = "";
    try {
      host = browser.currentURI?.host || "";
    } catch (err) {
      host = "";
    }
    // a Kick channel's page is live; its player reports a few seconds at a time,
    // which looped the progress line every three seconds
    if (/^(www\.)?kick\.com$/.test(host)) {
      let path = "";
      try {
        path = browser.currentURI.filePath;
      } catch (err) {
        path = "";
      }
      element.toggleAttribute("zia-live", /^\/[\w-]+\/?$/.test(path));
      return;
    }
    if (!/(^|\.)youtube\.com$/.test(host)) {
      element.removeAttribute("zia-live");
      return;
    }
    const spec = browser.currentURI.spec;
    const last = youTubeLiveChecked.get(element);
    if (last && last.spec === spec && Date.now() - last.at < 10000) {
      return;
    }
    youTubeLiveChecked.set(element, { spec, at: Date.now() });
    ziaActor(browser)
      ?.sendQuery("Zia:YouTubeLive", {})
      .then((live) => {
        if (card.browser?.currentURI?.spec === spec) {
          element.toggleAttribute("zia-live", !!live);
        }
      })
      .catch(() => {});
  }

  function useMediaArtwork() {
    const front = window.gZenMediaController?.frontCard;
    const proto = front && Object.getPrototypeOf(front);
    if (!proto || typeof proto.updateIcon !== "function" || proto.updateIcon.__zia) {
      return !!proto?.updateIcon?.__zia;
    }
    const originalPosition = proto.updatePosition;
    if (typeof originalPosition === "function") {
      proto.updatePosition = function (...args) {
        const result = originalPosition.apply(this, args);
        try {
          const known = this.element.__ziaCard === this;
          this.element.__ziaCard = this;
          watchTimeLeft(this);
          showTimeLeft(this);
          markLiveStream(this);
          if (!known) {
            repaintSoundTabs();
          }
        } catch (err) {
          noteError("music and sound bars: useMediaArtwork", err);
        }
        return result;
      };
    }

    const original = proto.updateIcon;
    // Zen drops a card if setting it up throws, so nothing here may throw: a slip
    // over a Kick stream's picture had left Kick with no card at all
    const patched = function () {
      original.call(this);
      try {
        dressCardIcon(this);
      } catch (err) {
        noteError("music and sound bars: updateIcon", err);
      }
    };
    patched.__zia = true;
    proto.updateIcon = patched;
    try {
      front.updateIcon();
      front.updatePosition?.();
    } catch (err) {
      noteError("music and sound bars: showArt", err);
    }
    return true;
  }

  function dressCardIcon(card) {
    if (card.element && card.element.__ziaCard !== card) {
      card.element.__ziaCard = card;
      repaintSoundTabs();
    }
    const button = card.focusButton;
    let art = "";
    try {
      art = bestArtwork(card.controller?.getMetadata?.()?.artwork);
    } catch (err) {
      noteError("music and sound bars: useMediaArtwork (2)", err);
    }
    art = youTubeAvatar(card) || art;
    if (!art) {
      art = kickAvatar(card);
    }
    if (!button) {
      return;
    }
    ensureRing(button);
    if (art) {
      const previous = button.getAttribute("zia-art");
      button.setAttribute("zia-art", art);
      const showArt = () => button.style.setProperty("--zia-media-art", `url("${art.replace(/"/g, "%22")}")`);
      if (previous && previous !== art) {
        flipArtwork(button, showArt);
      } else {
        showArt();
      }
    } else {
      button.removeAttribute("zia-art");
      button.style.removeProperty("--zia-media-art");
    }
    showFaviconTile(card, button, art);
  }

  function watchMediaGlow() {
    const toolbar = document.getElementById("zen-media-controls-toolbar");
    if (!toolbar) {
      return;
    }
    let frame = null;
    let artworkReady = false;
    let keptWithPip = false;
    const refresh = () => {
      frame = null;
      updateToolbarTint();
      for (const card of toolbar.querySelectorAll(".zen-media-card")) {
        updateMediaWorkspace(card);
      }
      try {
        if (!artworkReady) {
          artworkReady = useMediaArtwork();
        }
      } catch (err) {
        noteError("media artwork", err);
      }
      try {
        if (!keptWithPip) {
          keptWithPip = keepCardsWithPip();
        }
      } catch (err) {
        noteError("keep with pip", err);
      }
      for (const card of toolbar.querySelectorAll(".zen-media-card")) {
        updateMediaWorkspace(card);
        updateCardGlow(card);
      }
    };
    new MutationObserver(() => {
      if (!frame) {
        frame = requestAnimationFrame(refresh);
      }
    }).observe(toolbar, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "style", "image", "hidden", "zia-art", "zia-favicon"],
    });
    refresh();
  }

  // Zen drops a card if asking its media's position fails, and Kick's live player
  // never answers, so since Zen 1.23 Kick had no card. An active controller with
  // no position now answers an endless one (no progress line, as for any live
  // stream), and tabs already playing are offered to Zen again.
  function cardForPositionlessMedia() {
    // on the controller's own type: the one this window knows by name isn't it
    const answerPosition = (controller) => {
      const proto = controller && Object.getPrototypeOf(controller);
      const own = proto?.getPositionState;
      if (typeof own !== "function" || own.__zia) {
        return;
      }
      const patched = function () {
        try {
          return own.call(this);
        } catch (err) {
          if (!this.isActive) {
            throw err;
          }
          // an endless length: Zen hides the progress line and the card reads LIVE
          return { duration: Infinity, playbackRate: 1, position: 0 };
        }
      };
      patched.__zia = true;
      Object.defineProperty(proto, "getPositionState", { value: patched, writable: true, configurable: true, enumerable: true });
    };

    const manager = window.gZenMediaController;
    if (!manager || typeof manager.activateMediaControls !== "function" || manager.activateMediaControls.__zia) {
      return;
    }
    const original = manager.activateMediaControls;
    const activate = function (controller, browser) {
      try {
        answerPosition(controller);
      } catch (err) {
        noteError("music and sound bars: answerPosition", err);
      }
      return original.call(this, controller, browser);
    };
    activate.__zia = true;
    manager.activateMediaControls = activate;

    for (const tab of gBrowser.tabs) {
      if (!tab.hasAttribute("soundplaying")) {
        continue;
      }
      try {
        manager.activateMediaControls(tab.linkedBrowser.browsingContext?.mediaController, tab.linkedBrowser);
      } catch (err) {
        noteError("music and sound bars: cardForPositionlessMedia", err);
      }
    }
  }

  // A card dragged out of the sidebar like a toolbar button broke Zen's player
  // until restart, and nothing on it uses drags, so no drag starts there.
  function keepMediaCardsInPlace() {
    window.addEventListener(
      "dragstart",
      (event) => {
        if (event.target?.closest?.("#zen-media-controls-toolbar")) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
  }

  // --- start-up (what Zia's start() calls for these) ---------------------------
  function safely(name, fn) {
    try {
      fn();
    } catch (err) {
      console.error(`[bubble-clean] ${name} failed:`, err);
    }
  }

  function start() {
    safely("watchMediaOpacity", watchMediaOpacity);
    safely("watchMediaWorkspace", watchMediaWorkspace);
    safely("watchMediaGlow", watchMediaGlow);
    safely("cardForPositionlessMedia", cardForPositionlessMedia);
    safely("keepMediaCardsInPlace", keepMediaCardsInPlace);
    safely("watchTabSoundBars", watchTabSoundBars);
  }

  if (window.gBrowserInit?.delayedStartupFinished) {
    start();
  } else {
    const observer = (subject) => {
      if (subject === window) {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
        start();
      }
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  }
})();
