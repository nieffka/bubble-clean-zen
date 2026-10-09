// Extracted from Zia by z1n-k; MIT licensed.
// Zia: picture-in-picture, loaded into each picture-in-picture window by
// zia.uc.js. It restyles Firefox's controls like Dia's (zia-pip.css) and lets
// the window tuck into the side of the screen. Self-contained, so it keeps
// working whichever browser window opened it.
(() => {
  if (window.__ziaPipLoaded) {
    return;
  }
  window.__ziaPipLoaded = true;

  const HTML = "http://www.w3.org/1999/xhtml";
  const SHEET_URL = "chrome://sine/content/bubble-clean-zen/scripts/zia-pip.css";
  const root = document.documentElement;
  const controls = document.getElementById("controls");
  if (!controls) {
    return;
  }
  const pref = (name, fallback) => {
    try {
      return Services.prefs.getBoolPref(name, fallback);
    } catch (err) {
      return fallback;
    }
  };

  // The page only allows chrome: URLs, so the styles come from a real file.
  // A user sheet from windowUtils isn't subject to the page's rules at all;
  // the <link> is a fallback.
  try {
    window.windowUtils.loadSheetUsingURIString(SHEET_URL, window.windowUtils.AUTHOR_SHEET);
  } catch (err) {
    const link = document.createElementNS(HTML, "link");
    link.rel = "stylesheet";
    link.href = SHEET_URL;
    document.head.appendChild(link);
  }

  const make = (tag, className, parent) => {
    const el = document.createElementNS(HTML, tag);
    el.className = className;
    parent.appendChild(el);
    return el;
  };

  // Zia's own top bar: "Back to Tab", the site, the tuck button, "Minimise"
  // and "Close".
  // Firefox's corner buttons fight any restyling, so they're hidden and
  // ours press them.
  const topBar = make("div", "zia-pip-top", controls);
  const back = make("button", "zia-pip-pill zia-pip-back control-item", topBar);
  back.textContent = "Back to Tab";
  const host = make("div", "zia-pip-host control-item", topBar);
  let sourceBrowser = null;
  try {
    // (newer Firefox moved it)
    let PictureInPicture = null;
    for (const url of [
      "moz-src:///toolkit/components/pictureinpicture/PictureInPicture.sys.mjs",
      "resource://gre/modules/PictureInPicture.sys.mjs",
    ]) {
      try {
        ({ PictureInPicture } = ChromeUtils.importESModule(url));
        break;
      } catch (err) {}
    }
    sourceBrowser = PictureInPicture.weakWinToBrowser?.get(window) || null;
    host.textContent = sourceBrowser?.currentURI?.host || "";
  } catch (err) {
    console.debug("[Zia] picture-in-picture: site name", err);
  }
  const end = make("div", "zia-pip-end", topBar);
  const tuckButton = make("button", "zia-pip-pill zia-pip-tuck-button control-item", end);
  // Minimise puts picture-in-picture away and leaves the video playing in
  // its tab: Zen's own minimize button, which closes without the pause
  // Close does first
  const minimiseButton = make("button", "zia-pip-pill zia-pip-minimise control-item", end);
  minimiseButton.textContent = "Minimise";
  const closeButton = make("button", "zia-pip-pill zia-pip-close control-item", end);
  closeButton.textContent = "Close";
  // Keep our clicks away from Firefox's own click handling on #controls.
  const press = (id) => (event) => {
    event.stopPropagation();
    document.getElementById(id)?.click();
  };
  back.addEventListener("click", press("unpip"));
  closeButton.addEventListener("click", press("close"));
  minimiseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const zenMinimize = document.getElementById("minimize");
    if (zenMinimize) {
      zenMinimize.click();
    } else if (typeof Player !== "undefined" && typeof Player.closePipWindow === "function") {
      Player.closePipWindow({ reason: "CloseButton" });
    } else {
      window.close();
    }
  });

  const sliver = make("div", "zia-pip-sliver", document.body);

  // Sound and time, bottom left: Firefox's own mute button, volume line and
  // time, gathered into one group while Dia's look is on (and put back
  // where they were when it's off). Firefox only shows mute and volume
  // behind a pref; they work either way, so Zia shows them itself.
  const sound = make("div", "zia-pip-sound", controls);
  const soundParts = ["audio", "audio-scrubber", "timestamp"]
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .map((el) => ({ el, parent: el.parentNode, next: el.nextSibling, wasHidden: el.hidden }));
  const placeSound = (dia) => {
    for (const part of soundParts) {
      if (dia) {
        if (part.el.id !== "timestamp") {
          part.el.hidden = false;
        }
        sound.appendChild(part.el);
      } else if (part.el.parentNode === sound) {
        part.parent.insertBefore(part.el, part.next?.parentNode === part.parent ? part.next : null);
        if (part.el.id !== "timestamp") {
          part.el.hidden = part.wasHidden;
        }
      }
    }
  };

  // Rounded corners on Windows, as macOS gives the window: Firefox rounds
  // only its own frosted pop-ups there, so Zia asks Windows itself (11 and
  // later; Windows 10 has no rounded windows and ignores it)
  let roundedCorners = null;
  const roundCorners = (on) => {
    if (Services.appinfo.OS !== "WINNT" || roundedCorners === on) {
      return;
    }
    let dwm = null;
    try {
      const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const handle = window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle;
      if (!handle) {
        return;
      }
      dwm = ctypes.open("dwmapi.dll");
      const setAttribute = dwm.declare(
        "DwmSetWindowAttribute",
        ctypes.winapi_abi,
        ctypes.long,
        ctypes.voidptr_t,
        ctypes.uint32_t,
        ctypes.voidptr_t,
        ctypes.uint32_t
      );
      const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
      const corner = ctypes.uint32_t(on ? 2 : 0); // round, or Windows' default
      setAttribute(ctypes.voidptr_t(ctypes.UInt64(handle)), DWMWA_WINDOW_CORNER_PREFERENCE, corner.address(), 4);
      roundedCorners = on;
    } catch (err) {
      console.debug("[Zia] picture-in-picture: rounded corners", err);
    } finally {
      dwm?.close();
    }
  };

  const applyPrefs = () => {
    root.toggleAttribute("zia-dia", pref("zia.pip.dia-style", true));
    placeSound(root.hasAttribute("zia-dia"));
    root.toggleAttribute("zia-tuck-on", pref("zia.pip.tuck", true));
    roundCorners(root.hasAttribute("zia-dia"));
  };
  applyPrefs();
  Services.prefs.addObserver("zia.pip.", applyPrefs);
  window.addEventListener("unload", () => Services.prefs.removeObserver("zia.pip.", applyPrefs));

  // Live streams get no progress line or time. Firefox hides them only for a
  // video with no length at all, but most live streams report one that keeps
  // growing. Zen's own player counts 900,000 seconds or more as live; Zia
  // asks the tab's media controller and does the same.
  const LIVE_SECONDS = 900000;
  try {
    const controller = sourceBrowser?.browsingContext?.mediaController;
    if (controller) {
      const showLive = (duration) => root.toggleAttribute("zia-live", Number.isFinite(duration) ? duration >= LIVE_SECONDS : duration === Infinity);
      try {
        showLive(controller.getPositionState()?.duration);
      } catch (err) {
        // No position yet; the event below brings it
      }
      const onPosition = (event) => showLive(event.duration);
      controller.addEventListener("positionstatechange", onPosition);
      window.addEventListener("unload", () => controller.removeEventListener("positionstatechange", onPosition));
    }
  } catch (err) {
    console.debug("[Zia] picture-in-picture: live check", err);
  }

  // Firefox skips 5 seconds; Dia's buttons skip 15, so each press skips three times.
  let repeating = false;
  for (const id of ["seekBackward", "seekForward"]) {
    const button = document.getElementById(id);
    button?.addEventListener("click", () => {
      if (repeating || !root.hasAttribute("zia-dia")) {
        return;
      }
      repeating = true;
      try {
        button.click();
        button.click();
      } finally {
        repeating = false;
      }
    });
  }

  // Tucking. The window tucks into the left or right side, the bottom or a
  // bottom corner of its screen, wherever there's no other screen beyond it (with two screens side by side, a tucked
  // window at the edge they share would just show on the other one). Ways
  // in: the tuck button, which uses the default spot (Zia's settings, or
  // "Make this the default" in the picker beside it); the picker itself; or
  // throw the window at a side or corner. Let go with a good part of it past
  // the side, or flick it at one, and it springs the rest of the way in, and
  // a throw that lands near a corner is pulled into the corner.
  // Tucked, only a strip (a side) or a small square (a corner) shows.
  // Pointing at it nudges the video out a little; clicking brings it out.
  // Holding it: drag inward to pull the window out, or drag along the side
  // to move it, where it snaps into a corner near the end of a side and
  // becomes a side again when dragged out of the corner along an edge.
  // Once out, it stays out until it's tucked again.
  const SLIVER = 24; // strip showing on a side
  const NUB = 44; // square showing in a corner
  const NUDGE = 12;
  const TUCK_OFF = 0.3; // this much of the window past a side tucks it
  const FLING_SPEED = 1.2; // px per ms toward a side as it's let go
  const FLING_REACH = 160; // and within this many px of that side
  const MAGNET = 40; // this close to a corner, it's pulled into the corner
  const UNSNAP = 48; // dragged this far out of a corner, it's a side again
  const MARGIN = 16;
  const SPOT_PREF = "zia.pip.tuck-spot";
  // No top spots: macOS won't move a window up past the top of the screen
  const SPOTS = ["left", "right", "bottom-left", "bottom", "bottom-right"];
  // Which way the arrows point (the chevron points left at 0deg)
  const TURN = { right: 0, left: 180, top: -90, bottom: 90, "top-right": -45, "top-left": -135, "bottom-right": 45, "bottom-left": 135 };
  let state = "free"; // "free" or "tucked"
  let spot = null;
  let animating = false;
  let lastX = window.screenX;
  let lastY = window.screenY;
  let movedAt = 0;
  let trail = []; // [time, x, y] while the window is being dragged
  let glideId = 0;

  const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
  const W = () => window.outerWidth;
  const H = () => window.outerHeight;
  const screenBox = () => {
    const s = window.screen;
    return { left: s.availLeft, top: s.availTop, right: s.availLeft + s.availWidth, bottom: s.availTop + s.availHeight };
  };

  // Which sides have no other screen beyond them
  let screenManager = null;
  try {
    screenManager = Cc["@mozilla.org/gfx/screenmanager;1"].getService(Ci.nsIScreenManager);
  } catch (err) {
    console.debug("[Zia] picture-in-picture: screens", err);
  }
  // All in the screen list's own units (desktop pixels: device pixels over
  // the screen's scale). Probed from the page's own measures, which are in
  // CSS pixels, the probes landed on the wrong screen wherever Windows
  // scales the display: the right side read as facing another screen, and
  // with one on the left as well, no side was left to tuck into.
  const desktopRect = (screen) => {
    const left = {};
    const top = {};
    const width = {};
    const height = {};
    screen.GetRect(left, top, width, height);
    const f = screen.contentsScaleFactor || 1;
    return { L: left.value / f, T: top.value / f, R: (left.value + width.value) / f, B: (top.value + height.value) / f };
  };
  const screenAt = (x, y) => {
    try {
      const screen = screenManager.screenForRect(Math.round(x), Math.round(y), 1, 1);
      const r = desktopRect(screen);
      return x >= r.L && x < r.R && y >= r.T && y < r.B ? r : null;
    } catch (err) {
      return null;
    }
  };
  // the screen the window's middle is on
  const ownScreen = () => {
    const dpr = window.devicePixelRatio || 1;
    const cx = (window.screenX + W() / 2) * dpr;
    const cy = (window.screenY + H() / 2) * dpr;
    try {
      let screen = screenManager.screenForRect(Math.round(cx), Math.round(cy), 1, 1);
      const f = screen.contentsScaleFactor || 1;
      if (f !== 1) {
        screen = screenManager.screenForRect(Math.round(cx / f), Math.round(cy / f), 1, 1);
      }
      return desktopRect(screen);
    } catch (err) {
      return null;
    }
  };
  const openSides = () => {
    const own = screenManager ? ownScreen() : null;
    if (!own) {
      return { left: true, right: true, top: true, bottom: true, corner: () => true };
    }
    const { L, T, R, B } = own;
    const other = (x, y) => {
      const r = screenAt(x, y);
      return !!r && (r.L !== L || r.T !== T);
    };
    const xs = [0.15, 0.5, 0.85].map((f) => L + (R - L) * f);
    const ys = [0.15, 0.5, 0.85].map((f) => T + (B - T) * f);
    return {
      left: !ys.some((y) => other(L - 2, y)),
      right: !ys.some((y) => other(R + 1, y)),
      top: !xs.some((x) => other(x, T - 2)),
      bottom: !xs.some((x) => other(x, B + 1)),
      corner: (v, h) => !other(h === "left" ? L - 2 : R + 1, v === "top" ? T - 2 : B + 1),
    };
  };
  const spotOpen = (name, open = openSides()) => {
    if (!SPOTS.includes(name)) {
      return false;
    }
    const parts = name.split("-");
    return parts.every((part) => open[part]) && (parts.length === 1 || open.corner(parts[0], parts[1]));
  };

  // Where the window sits tucked into `name`, with `extra` more of it
  // showing, keeping its place along the side
  const tuckedPos = (name, extra = 0, at = null) => {
    const b = screenBox();
    const w = W();
    const h = H();
    let x = clamp(at?.[0] ?? window.screenX, b.left, b.right - w);
    let y = clamp(at?.[1] ?? window.screenY, b.top, b.bottom - h);
    const show = (name.includes("-") ? NUB : SLIVER) + extra;
    if (name.endsWith("left")) {
      x = b.left - w + show;
    }
    if (name.endsWith("right")) {
      x = b.right - show;
    }
    if (name.startsWith("top")) {
      y = b.top - h + show;
    }
    if (name.startsWith("bottom")) {
      y = b.bottom - show;
    }
    return [Math.round(x), Math.round(y)];
  };
  // Where the window sits fully back on the screen, by the spot it was in
  const outPos = () => {
    const b = screenBox();
    const w = W();
    const h = H();
    let x = clamp(window.screenX, b.left + MARGIN, b.right - w - MARGIN);
    let y = clamp(window.screenY, b.top + MARGIN, b.bottom - h - MARGIN);
    if (spot?.endsWith("left")) {
      x = b.left + MARGIN;
    }
    if (spot?.endsWith("right")) {
      x = b.right - w - MARGIN;
    }
    if (spot?.startsWith("top")) {
      y = b.top + MARGIN;
    }
    if (spot?.startsWith("bottom")) {
      y = b.bottom - h - MARGIN;
    }
    return [Math.round(x), Math.round(y)];
  };

  // How far the window is past an open side, as a share of TUCK_OFF: 0 on
  // the screen, 1 where letting go would tuck it. It frosts the video over
  // as it goes (zia-pip.css).
  const veil = (progress) => root.style.setProperty("--zia-veil", Math.min(1, Math.max(0, progress)).toFixed(3));
  const offSides = () => {
    const b = screenBox();
    const x = window.screenX;
    const y = window.screenY;
    return {
      left: (b.left - x) / W(),
      right: (x + W() - b.right) / W(),
      top: (b.top - y) / H(),
      bottom: (y + H() - b.bottom) / H(),
    };
  };
  const pastSide = () => {
    const open = openSides();
    const off = offSides();
    return Math.max(0, ...["left", "right", "top", "bottom"].filter((side) => open[side]).map((side) => off[side])) / TUCK_OFF;
  };

  // A side that's near one end: pulled into that corner if it's open
  const magnetise = (name, open) => {
    if (name.includes("-")) {
      return name;
    }
    const b = screenBox();
    const vertical = name === "left" || name === "right";
    const start = vertical ? window.screenY - b.top : window.screenX - b.left;
    const end = vertical ? b.bottom - (window.screenY + H()) : b.right - (window.screenX + W());
    const corner = (other) => (vertical ? `${other}-${name}` : `${name}-${other}`);
    if (start < MAGNET && spotOpen(corner(vertical ? "top" : "left"), open)) {
      return corner(vertical ? "top" : "left");
    }
    if (end < MAGNET && spotOpen(corner(vertical ? "bottom" : "right"), open)) {
      return corner(vertical ? "bottom" : "right");
    }
    return name;
  };

  // Where the window was let go: far enough past a side, or flicked at one
  const thrownTo = () => {
    const b = screenBox();
    const open = openSides();
    const off = offSides();
    const x = window.screenX;
    const y = window.screenY;
    let vx = 0;
    let vy = 0;
    const last = trail.at(-1);
    const first = last && trail.find(([time]) => last[0] - time <= 150);
    if (first && first !== last) {
      vx = (last[1] - first[1]) / (last[0] - first[0] || 1);
      vy = (last[2] - first[2]) / (last[0] - first[0] || 1);
    }
    const go = {
      left: open.left && (off.left >= TUCK_OFF || (vx < -FLING_SPEED && x - b.left < FLING_REACH)),
      right: open.right && (off.right >= TUCK_OFF || (vx > FLING_SPEED && b.right - (x + W()) < FLING_REACH)),
      top: false,
      bottom: open.bottom && (off.bottom >= TUCK_OFF || (vy > FLING_SPEED && b.bottom - (y + H()) < FLING_REACH)),
    };
    const v = go.top ? "top" : go.bottom ? "bottom" : "";
    const h = go.left ? "left" : go.right ? "right" : "";
    if (v && h) {
      if (spotOpen(`${v}-${h}`, open)) {
        return `${v}-${h}`;
      }
      return Math.max(off[v], 0) > Math.max(off[h], 0) ? v : h;
    }
    const name = v || h;
    return name ? magnetise(name, open) : null;
  };

  // The default spot: the setting if it's open here, otherwise the nearest
  // open side (left or right first, as before), else the nearest open spot
  const defaultSpot = () => {
    const open = openSides();
    let wanted = "nearest";
    try {
      wanted = Services.prefs.getStringPref(SPOT_PREF, "nearest");
    } catch (err) {
      // the setting isn't there yet
    }
    if (SPOTS.includes(wanted) && spotOpen(wanted, open)) {
      return wanted;
    }
    const b = screenBox();
    const cx = window.screenX + W() / 2;
    const cy = window.screenY + H() / 2;
    const anchor = (name) => [
      name.endsWith("left") ? b.left : name.endsWith("right") ? b.right : cx,
      name.startsWith("top") ? b.top : name.startsWith("bottom") ? b.bottom : cy,
    ];
    let best = null;
    let bestScore = Infinity;
    for (const name of SPOTS) {
      if (!spotOpen(name, open)) {
        continue;
      }
      const [ax, ay] = anchor(name);
      const penalty = name === "left" || name === "right" ? 0 : name.includes("-") ? 100000 : 50000;
      const score = Math.hypot(ax - cx, ay - cy) + penalty;
      if (score < bestScore) {
        bestScore = score;
        best = name;
      }
    }
    return best;
  };

  const updateButton = () => {
    const name = spot || defaultSpot();
    root.toggleAttribute("zia-no-tuck", !name);
    if (name) {
      root.style.setProperty("--zia-tuck-button-turn", `${TURN[name]}deg`);
    }
    tuckButton.setAttribute("tooltip", "Tuck away · right-click for where");
  };
  const setSpot = (name) => {
    spot = name;
    root.setAttribute("zia-tucked", name);
    root.style.setProperty("--zia-tuck-turn", `${TURN[name]}deg`);
  };

  // A newer glide takes over from one still running.
  // `spring` runs a little past the end and settles back
  const glide = (x, y, duration = 280, done = null, spring = false) => {
    animating = true;
    const id = ++glideId;
    const fromX = window.screenX;
    const fromY = window.screenY;
    const start = performance.now();
    const step = (now) => {
      if (id !== glideId) {
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const eased = spring ? 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2) : 1 - Math.pow(1 - t, 3);
      window.moveTo(Math.round(fromX + (x - fromX) * eased), Math.round(fromY + (y - fromY) * eased));
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        animating = false;
        lastX = window.screenX;
        lastY = window.screenY;
        done?.();
      }
    };
    requestAnimationFrame(step);
  };
  const tuck = (name) => {
    if (!name) {
      return;
    }
    state = "tucked";
    setSpot(name);
    root.removeAttribute("zia-nudged");
    root.removeAttribute("zia-emerging");
    closePicker();
    updateButton();
    glide(...tuckedPos(name), 360, null, true);
  };
  const nudge = (out) => {
    if (state !== "tucked" || root.hasAttribute("zia-nudged") === out) {
      return;
    }
    root.toggleAttribute("zia-nudged", out);
    glide(...tuckedPos(spot, out ? NUDGE : 0), 160);
  };
  // The strip stays over the window's edge and fades as the window slides
  // in, so no slice of video flashes at the side of the screen first. Once
  // out, the window is free and stays where it is.
  const slideOut = (duration = 280) => {
    root.removeAttribute("zia-nudged");
    root.setAttribute("zia-emerging", "");
    glide(...outPos(), duration, release);
  };
  const release = () => {
    state = "free";
    spot = null;
    root.removeAttribute("zia-tucked");
    root.removeAttribute("zia-nudged");
    root.removeAttribute("zia-emerging");
    updateButton();
  };

  // The picker: a small map of the screen with its eight spots, the ones
  // facing another screen greyed out. It opens from a right-click on the
  // tuck button (it had a chevron of its own beside it)
  const picker = make("div", "zia-pip-picker", document.body);
  const pickerTitle = make("div", "zia-pip-picker-title", picker);
  pickerTitle.textContent = "Tuck into…";
  const pickerMap = make("div", "zia-pip-picker-map", picker);
  const spotButtons = {};
  for (const name of SPOTS) {
    const button = make("button", "zia-pip-spot", pickerMap);
    button.dataset.spot = name;
    button.style.setProperty("--zia-spot-turn", `${TURN[name] + 180}deg`);
    button.title = name.replace("-", " ");
    spotButtons[name] = button;
  }
  const pickerRow = make("label", "zia-pip-picker-row", picker);
  const makeDefault = document.createElementNS(HTML, "input");
  makeDefault.type = "checkbox";
  pickerRow.append(makeDefault, document.createTextNode("Make this the default"));
  const closePicker = () => root.removeAttribute("zia-picking");
  const openPicker = () => {
    const open = openSides();
    const current = (() => {
      try {
        return Services.prefs.getStringPref(SPOT_PREF, "nearest");
      } catch (err) {
        return "nearest";
      }
    })();
    for (const [name, button] of Object.entries(spotButtons)) {
      button.disabled = !spotOpen(name, open);
      button.toggleAttribute("zia-default", name === current);
    }
    makeDefault.checked = false;
    root.setAttribute("zia-picking", "");
  };
  for (const eventName of ["click", "mousedown", "mouseup", "dblclick"]) {
    picker.addEventListener(eventName, (event) => event.stopPropagation());
  }
  pickerMap.addEventListener("click", (event) => {
    const button = event.target.closest(".zia-pip-spot");
    if (!button || button.disabled) {
      return;
    }
    if (makeDefault.checked) {
      try {
        Services.prefs.setStringPref(SPOT_PREF, button.dataset.spot);
      } catch (err) {
        console.debug("[Zia] picture-in-picture: default spot", err);
      }
    }
    if (state === "free") {
      tuck(button.dataset.spot);
    }
    closePicker();
  });
  tuckButton.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (root.hasAttribute("zia-picking")) {
      closePicker();
    } else {
      openPicker();
    }
  });
  document.addEventListener("mousedown", (event) => {
    if (!picker.contains(event.target) && event.target !== tuckButton) {
      closePicker();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePicker();
    }
  });

  tuckButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state === "free") {
      tuck(defaultSpot());
    }
  });
  updateButton();

  // Dragging the tucked strip
  const PULL_OUT = 4;
  let dragFrom = null;
  let dragMode = null; // null until the pointer has moved: "along" or "out"
  let snapping = false;
  let pointer = null; // the latest pointer position during a drag
  let settleUntil = 0; // just after a drag, the window may still be arriving
  const inward = (name) => {
    const x = name.endsWith("left") ? 1 : name.endsWith("right") ? -1 : 0;
    const y = name.startsWith("top") ? 1 : name.startsWith("bottom") ? -1 : 0;
    const length = Math.hypot(x, y) || 1;
    return [x / length, y / length];
  };
  const restartDrag = (event) => {
    dragFrom = { x: event.screenX, y: event.screenY, windowX: window.screenX, windowY: window.screenY };
  };
  // Into a corner, with a little spring, like a magnet
  const snapTo = (name, event) => {
    setSpot(name);
    snapping = true;
    glide(...tuckedPos(name), 200, () => {
      snapping = false;
      restartDrag(pointer || event);
    }, true);
  };
  // Out of a corner along one of its edges: that side again, a little way
  // from the corner so it doesn't snap straight back
  const unsnapTo = (name, fromCorner, event) => {
    const b = screenBox();
    let at = [window.screenX, window.screenY];
    if (name === "left" || name === "right") {
      at = [0, fromCorner.startsWith("top") ? b.top + MAGNET + 10 : b.bottom - H() - MAGNET - 10];
    } else {
      at = [fromCorner.endsWith("left") ? b.left + MAGNET + 10 : b.right - W() - MAGNET - 10, 0];
    }
    setSpot(name);
    snapping = true;
    glide(...tuckedPos(name, 0, at), 180, () => {
      snapping = false;
      restartDrag(pointer || event);
    }, true);
  };
  const moveAlong = (event) => {
    const b = screenBox();
    const dx = event.screenX - dragFrom.x;
    const dy = event.screenY - dragFrom.y;
    if (spot.includes("-")) {
      const [v, h] = spot.split("-");
      const alongSide = v === "top" ? dy : -dy; // down the left or right side
      const alongTop = h === "left" ? dx : -dx; // along the top or bottom
      if (alongSide > UNSNAP && alongSide >= alongTop && spotOpen(h)) {
        unsnapTo(h, spot, event);
      } else if (alongTop > UNSNAP && spotOpen(v)) {
        unsnapTo(v, spot, event);
      }
      return;
    }
    const vertical = spot === "left" || spot === "right";
    let [x, y] = tuckedPos(spot);
    if (vertical) {
      y = dragFrom.windowY + dy;
      if (y < b.top + MAGNET - 8 && spotOpen(`top-${spot}`)) {
        snapTo(`top-${spot}`, event);
        return;
      }
      if (y + H() > b.bottom - MAGNET + 8 && spotOpen(`bottom-${spot}`)) {
        snapTo(`bottom-${spot}`, event);
        return;
      }
      y = clamp(y, b.top, b.bottom - H());
    } else {
      x = dragFrom.windowX + dx;
      if (x < b.left + MAGNET - 8 && spotOpen(`${spot}-left`)) {
        snapTo(`${spot}-left`, event);
        return;
      }
      if (x + W() > b.right - MAGNET + 8 && spotOpen(`${spot}-right`)) {
        snapTo(`${spot}-right`, event);
        return;
      }
      x = clamp(x, b.left, b.right - W());
    }
    window.moveTo(x, y);
    lastX = x;
    lastY = y;
  };
  // Pulling out follows the pointer, never back past the tucked position.
  // Once it's fully on the screen and the pointer keeps going, it's out:
  // the same drag carries on moving it freely, with no letting go first.
  const FREE_AFTER = 12;
  const moveOut = (event) => {
    const b = screenBox();
    const dx = event.screenX - dragFrom.x;
    const dy = event.screenY - dragFrom.y;
    const [tx, ty] = tuckedPos(spot);
    const [ox, oy] = outPos();
    const acrossX = spot.endsWith("left") || spot.endsWith("right");
    const acrossY = spot.startsWith("top") || spot.startsWith("bottom");
    const past = (raw, tucked, out) => (out - tucked) * (raw - out) > 0 && Math.abs(raw - out) > FREE_AFTER;
    if ((acrossX && past(dragFrom.windowX + dx, tx, ox)) || (acrossY && past(dragFrom.windowY + dy, ty, oy))) {
      veil(0);
      release();
      dragMode = "free";
      root.setAttribute("zia-dragging", "free");
      dragFrom = { x: event.screenX, y: event.screenY, windowX: window.screenX, windowY: window.screenY };
      moveFree(event);
      return;
    }
    const x = acrossX ? clamp(dragFrom.windowX + dx, Math.min(tx, ox), Math.max(tx, ox)) : clamp(dragFrom.windowX + dx, b.left, b.right - W());
    const y = acrossY ? clamp(dragFrom.windowY + dy, Math.min(ty, oy), Math.max(ty, oy)) : clamp(dragFrom.windowY + dy, b.top, b.bottom - H());
    const parts = [];
    if (acrossX) {
      parts.push((x - tx) / (ox - tx || 1));
    }
    if (acrossY) {
      parts.push((y - ty) / (oy - ty || 1));
    }
    veil(1 - Math.max(...parts, 0));
    window.moveTo(Math.round(x), Math.round(y));
    lastX = Math.round(x);
    lastY = Math.round(y);
  };

  // Out and still held: the window follows the pointer anywhere, as if it
  // were being dragged by its video, and can be tucked away again the same
  // way (past a side or flicked at one when let go)
  const moveFree = (event) => {
    const x = Math.round(dragFrom.windowX + event.screenX - dragFrom.x);
    const y = Math.round(dragFrom.windowY + event.screenY - dragFrom.y);
    window.moveTo(x, y);
    lastX = x;
    lastY = y;
    const now = Date.now();
    if (now - movedAt > 300) {
      trail = [];
    }
    movedAt = now;
    trail.push([now, x, y]);
    if (trail.length > 20) {
      trail.shift();
    }
    const past = pastSide();
    root.toggleAttribute("zia-leaving", past > 0);
    veil(past);
  };

  sliver.addEventListener("mouseenter", () => nudge(true));
  sliver.addEventListener("mouseleave", () => {
    if (!dragFrom) {
      nudge(false);
    }
  });
  sliver.addEventListener("pointerdown", (event) => {
    if (state !== "tucked" || event.button !== 0) {
      return;
    }
    glideId++;
    animating = false;
    snapping = false;
    restartDrag(event);
    dragMode = null;
    sliver.setPointerCapture(event.pointerId);
  });
  sliver.addEventListener("pointermove", (event) => {
    if (!dragFrom) {
      return;
    }
    pointer = { screenX: event.screenX, screenY: event.screenY };
    if (snapping) {
      return;
    }
    if (!dragMode) {
      const dx = event.screenX - dragFrom.x;
      const dy = event.screenY - dragFrom.y;
      const length = Math.hypot(dx, dy);
      if (length < PULL_OUT) {
        return;
      }
      const [ix, iy] = inward(spot);
      dragMode = (dx * ix + dy * iy) / length > 0.75 ? "out" : "along";
      root.setAttribute("zia-dragging", dragMode);
      root.removeAttribute("zia-nudged");
      // Start from where the window is now, nudge and all
      restartDrag(event);
      return;
    }
    if (dragMode === "free") {
      moveFree(event);
    } else if (dragMode === "out") {
      moveOut(event);
    } else {
      moveAlong(event);
    }
  });
  const endDrag = (event) => {
    if (!dragFrom) {
      return;
    }
    const mode = dragMode;
    dragFrom = null;
    pointer = null;
    settleUntil = Date.now() + 300;
    dragMode = null;
    root.removeAttribute("zia-dragging");
    if (sliver.hasPointerCapture?.(event.pointerId)) {
      sliver.releasePointerCapture(event.pointerId);
    }
    if (mode === "free") {
      // Let go: tucked if it was taken past a side or flicked at one,
      // otherwise it stays where it was dropped
      const name = thrownTo();
      trail = [];
      if (name) {
        veil(1);
        tuck(name);
      } else {
        veil(0);
      }
      setTimeout(() => root.removeAttribute("zia-leaving"), 120);
    } else if (mode === "out") {
      // Pulled out: it stays out, sliding the rest of the way onto the screen
      slideOut(200);
    } else if (mode === "along") {
      if (!snapping && !sliver.matches(":hover")) {
        nudge(false);
      }
    } else if (event.type === "pointerup" && state === "tucked") {
      // A click, not a drag
      slideOut();
    }
  };
  sliver.addEventListener("pointerup", endDrag);
  sliver.addEventListener("pointercancel", endDrag);

  // A playlist moving on to its next video (or a video changing shape) has
  // Firefox fit the window to it again. Tucked, the window's middle is off
  // the screen, so Firefox took it for lost and put it back on screen at
  // its default size, and that move counted as dragging it out. Tucked, it
  // keeps its height, takes the new video's shape and stays tucked.
  const fitToVideo = window.resizeToVideo;
  if (typeof fitToVideo === "function") {
    window.resizeToVideo = function (rect) {
      if (state !== "tucked" || !spot || document.fullscreenElement || !(rect?.width > 0 && rect?.height > 0)) {
        return fitToVideo.apply(this, arguments);
      }
      const height = H();
      const width = Math.max(136, Math.round((height * rect.width) / rect.height));
      glideId++;
      animating = false;
      settleUntil = Date.now() + 800;
      window.resizeTo(width, height);
      const retuck = () => {
        if (state !== "tucked" || !spot) {
          return;
        }
        const [x, y] = tuckedPos(spot, root.hasAttribute("zia-nudged") ? NUDGE : 0);
        window.moveTo(x, y);
        lastX = x;
        lastY = y;
      };
      // (again once the new size has taken: a right or bottom tuck goes by it)
      retuck();
      requestAnimationFrame(retuck);
      setTimeout(retuck, 120);
      return undefined;
    };
  }

  setInterval(() => {
    const enabled = pref("zia.pip.tuck", true);
    if (!enabled || document.fullscreenElement) {
      if (state !== "free") {
        release();
      }
      return;
    }
    // Zia is moving the window itself: gliding it, or following a drag of
    // the tucked strip. The window's position can lag a moment behind, so
    // none of that counts as the window being dragged.
    if (animating || dragFrom || snapping) {
      return;
    }
    const x = window.screenX;
    const y = window.screenY;
    const now = Date.now();
    if (state === "tucked" && (now < settleUntil || (Math.abs(x - lastX) <= 1 && Math.abs(y - lastY) <= 1))) {
      lastX = x;
      lastY = y;
      return;
    }
    // Any other move is the window being dragged.
    if (x !== lastX || y !== lastY) {
      if (now - movedAt > 300) {
        trail = [];
      }
      lastX = x;
      lastY = y;
      movedAt = now;
      trail.push([now, x, y]);
      if (trail.length > 20) {
        trail.shift();
      }
      if (state !== "free") {
        release();
      }
      const past = pastSide();
      root.toggleAttribute("zia-leaving", past > 0);
      veil(past);
      updateButton();
      return;
    }
    // Just let go after a drag (never where Firefox first puts it): tuck if
    // it was thrown at a side or corner.
    const sinceMove = now - movedAt;
    if (state === "free" && trail.length && sinceMove > 200) {
      const name = thrownTo();
      trail = [];
      if (name) {
        veil(1);
        tuck(name);
      } else {
        veil(0);
      }
      // Tucked, the strip's own frosting takes over; otherwise it clears
      setTimeout(() => root.removeAttribute("zia-leaving"), 120);
    }
  }, 40);
})();
