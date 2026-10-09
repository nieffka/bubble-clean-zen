// Extracted from Zia by z1n-k; MIT licensed.
// Zia media player
(() => {
  if (window.__zia_media_playerLoaded) return;
  window.__zia_media_playerLoaded = true;
  const root = document.documentElement;

  // Use the media tab's own space, not whichever space is currently visible.
  function mediaWorkspaceColor(element) {
    const browser = element.__ziaCard?.browser;
    const tab = browser && gBrowser.getTabForBrowser(browser);
    const manager = window.gZenWorkspaces;
    const id = tab?.getAttribute("zen-workspace-id") || manager?.activeWorkspace;
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
    const color = readableWorkspaceTint(mediaWorkspaceColor(element));
    if (element.style.getPropertyValue("--zia-media-space-bg") !== color) {
      element.style.setProperty("--zia-media-space-bg", color);
    }
  }

  function watchMediaWorkspace() {
    let frame = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        for (const element of document.querySelectorAll(".zen-media-card")) updateMediaWorkspace(element);
      });
    };
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["style", "zen-default-theme"] });
    const tabObserver = new MutationObserver(schedule);
    tabObserver.observe(gBrowser.tabContainer, {
      subtree: true, attributes: true, attributeFilter: ["zen-workspace-id"],
    });
    window.addEventListener("ZenWorkspacesUIUpdate", schedule);
    Services.prefs.addObserver("zen.workspaces.active", schedule);
    window.addEventListener("unload", () => {
      themeObserver.disconnect();
      tabObserver.disconnect();
      Services.prefs.removeObserver("zen.workspaces.active", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    }, { once: true });
    schedule();
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

  function readArtColors(url) {
    return new Promise((resolve) => {
      if (!url) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const size = 24;
          const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
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
          const colors = halves.map((h) =>
            h[3] ? boost([h[0] / h[3], h[1] / h[3], h[2] / h[3]]) : null
          );
          if (!colors[0] && !colors[1]) {
            resolve(null);
            return;
          }
          const a = colors[0] || colors[1];
          const b = colors[1] || colors[0];
          resolve([`rgb(${a.join(", ")})`, `rgb(${b.join(", ")})`]);
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

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

    let colors = mediaColorCache.get(url);
    if (colors === undefined) {
      colors = await readArtColors(url);
      mediaColorCache.set(url, colors);
    }
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
  const BAR_X = [1.6, 5.2, 8.8, 12.4];
  const BAR_REST = [
    [4.5, 7],
    [2.5, 11],
    [3.5, 9],
    [5.25, 5.5],
  ];

  function soundBarImages(colors) {
    const key = colors ? colors.join("|") : "white";
    let images = soundBarCache.get(key);
    if (images) {
      return images;
    }
    const a = colors ? lighten(colors[0]) : "rgb(255, 255, 255)";
    const b = colors ? lighten(colors[1]) : "rgb(255, 255, 255)";
    const gradient = `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="1.6" y1="0" x2="14.4" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
    const moving = [[0.55], [0.68], [0.5], [0.74]];
    const wave =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${gradient}` +
      `<style>rect{transform-box:fill-box;transform-origin:center;animation:grow .26s cubic-bezier(.2,.9,.3,1) both,z .6s .26s ease-in-out infinite alternate}` +
      moving.map(([d], i) => `.b${i}{animation-duration:.26s,${d}s;animation-delay:0s,${(0.26 + i * 0.05).toFixed(2)}s}`).join("") +
      `@keyframes grow{from{height:2px;y:7px}to{height:11px;y:2.5px}}` +
      `@keyframes z{from{transform:scaleY(.22)}to{transform:scaleY(1)}}` +
      `@media (prefers-reduced-motion:reduce){rect{animation:none;transform:scaleY(.6)}}</style>` +
      `<g fill="url(#g)">` +
      BAR_X.map((x, i) => `<rect class="b${i}" x="${x}" y="2.5" width="2" height="11" rx="1"/>`).join("") +
      `</g></svg>`;
    const dots =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${gradient}` +
      `<style>rect{animation:shrink .28s cubic-bezier(.4,0,.2,1) forwards}@keyframes shrink{to{height:2px;y:7px}}` +
      `@media (prefers-reduced-motion:reduce){rect{animation-duration:1ms}}</style>` +
      `<g fill="url(#g)">` +
      BAR_X.map((x, i) => `<rect x="${x}" y="${BAR_REST[i][0]}" width="2" height="${BAR_REST[i][1]}" rx="1"/>`).join("") +
      `</g></svg>`;
    const encoded = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
    images = { waveData: encoded(wave), dotsData: encoded(dots) };
    soundBarCache.set(key, images);
    return images;
  }

  function freshSoundBars(colors) {
    const images = soundBarImages(colors);
    const n = ++soundBarToken;
    return { wave: `url("${images.waveData}#${n}")`, dots: `url("${images.dotsData}#${n}")` };
  }

  function applyCardSoundBars(element) {
    const fresh = freshSoundBars(element.__ziaColors ?? null);
    element.style.setProperty("--zia-sound-wave", fresh.wave);
    element.style.setProperty("--zia-sound-still", fresh.dots);
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

  function paintSoundBars(card, colors) {
    card.__ziaColors = colors;
    applyCardSoundBars(card);
    watchCardSoundState(card);
  }

  function watchMediaTabIcons() {
    gBrowser.tabContainer.addEventListener("TabAttrModified", (event) => {
      const changed = event.detail?.changed || [];
      if (changed.includes("image")) {
        for (const element of document.querySelectorAll(".zen-media-card")) {
          const card = element.__ziaCard;
          if (card?.browser === event.target.linkedBrowser) {
            try {
              card.updateIcon();
            } catch (err) {
            }
          }
        }
      }
    });
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
    const shape = { x: "1", y: "1", width: "44", height: "44", rx: "10", fill: "none", "stroke-width": "2", pathLength: "100" };
    make("rect", { ...shape, class: "zia-ring-track" }, svg);
    make("rect", {
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
      console.info("[Zia] Player: no site icon found for", host || card.browser?.currentURI?.spec, "- showing a letter tile.");
      return;
    }
    button.removeAttribute("zia-initial");
    button.setAttribute("zia-favicon", icon);
    button.style.setProperty("--zia-media-favicon", `url("${icon.replace(/"/g, "%22")}")`);
    let tint = faviconTints.get(icon);
    if (!tint) {
      let colors = mediaColorCache.get(icon);
      if (colors === undefined) {
        colors = await readArtColors(icon);
        mediaColorCache.set(icon, colors);
      }
      tint = tintFromColors(colors);
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
      .catch(() => {
      });
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
    return [...artwork].sort((x, y) => area(y) - area(x))[0]?.src || "";
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
          this.element.__ziaCard = this;
          watchTimeLeft(this);
          showTimeLeft(this);
        } catch (err) {
        }
        return result;
      };
    }

    const original = proto.updateIcon;
    const patched = function () {
      original.call(this);
      if (this.element) {
        this.element.__ziaCard = this;
      }
      const button = this.focusButton;
      let art = "";
      try {
        art = bestArtwork(this.controller?.getMetadata?.()?.artwork);
      } catch (err) {
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
      showFaviconTile(this, button, art);
    };
    patched.__zia = true;
    proto.updateIcon = patched;
    try {
      front.updateIcon();
      front.updatePosition?.();
    } catch (err) {
    }
    return true;
  }

  function watchMediaGlow() {
    const toolbar = document.getElementById("zen-media-controls-toolbar");
    if (!toolbar) {
      return;
    }
    let frame = null;
    let artworkReady = false;
    const refresh = () => {
      frame = null;
      if (!artworkReady) {
        artworkReady = useMediaArtwork();
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

  function start() {
    watchMediaOpacity();
    watchMediaGlow();
    watchMediaTabIcons();
    watchMediaWorkspace();
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
