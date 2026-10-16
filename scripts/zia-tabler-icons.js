// Extracted from Zia by z1n-k; MIT licensed (zia.uc.js icon picker, chrome.css, icons/).
(() => {
  if (window.__bubbleTablerLoaded) return;
  window.__bubbleTablerLoaded = true;

  const root = document.documentElement;
  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  const notedErrors = new Set();
  function noteError(where, err) {
    if (notedErrors.has(where)) return;
    notedErrors.add(where);
    console.error(`[bubble-clean] tabler icons: ${where}:`, err);
  }

  const ICON_ROOT = "chrome://sine/content/bubble-clean-zen/icons";
  const ICON_HOST = "zia-tabler";
  const ICON_DIR = `resource://${ICON_HOST}`;
  const ICON_STYLE_PREF = "zia.icons.style";
  let iconIndex = null;
  let iconPackReady = null;

  function iconPackPath() {
    const holder = {};
    Services.scriptloader.loadSubScript(`${ICON_ROOT}/tabler-pack.js`, holder);
    return PathUtils.join(PathUtils.profileDir, "zia-icons", `tabler-${holder.ZiaTablerPack}.zip`);
  }

  // a resource:// host pointed at a folder or zip, unless it already is
  function pointResource(host, spec) {
    const handler = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    const uri = Services.io.newURI(spec);
    if (!handler.hasSubstitution(host) || handler.getSubstitution(host).spec !== uri.spec) {
      handler.setSubstitution(host, uri);
    }
  }

  function pointAtIconPack(pack) {
    pointResource(ICON_HOST, `jar:${PathUtils.toFileURI(pack)}!/`);
  }

  // Folder and space icons are drawn as Zen restores them, before the rest
  // of Zia starts, so once the pack is there it's pointed at the moment this
  // script loads.
  try {
    const pack = iconPackPath();
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(pack);
    if (file.exists()) {
      pointAtIconPack(pack);
    }
  } catch (err) {
    noteError("icon pack: early", err);
  }

  // Anything that still asked for an icon before the pack was ready (the
  // first start with it) is drawn again.
  function redrawPackIcons() {
    const prefixes = [`${ICON_DIR}/`];
    for (const image of document.querySelectorAll("image, img")) {
      for (const name of ["src", "href"]) {
        const url = image.getAttribute(name);
        if (prefixes.some((prefix) => url?.startsWith(prefix))) {
          image.setAttribute(name, "");
          image.setAttribute(name, url);
          if (image.style.opacity === "0") {
            image.style.opacity = "1";
          }
        }
      }
    }
  }

  // The bundle's icons as a zip ({outline,filled}/name.svg and the LICENSE),
  // stored rather than compressed: it's only ever read from the profile.
  let crcTable = null;
  const crc32 = (bytes) => {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  function zipOf(entries) {
    const encoder = new TextEncoder();
    const items = entries.map(([name, text]) => {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(text);
      return { nameBytes, data, crc: crc32(data) };
    });
    let size = 22;
    for (const item of items) {
      size += 30 + 46 + 2 * item.nameBytes.length + item.data.length;
    }
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let at = 0;
    const u16 = (v) => {
      view.setUint16(at, v, true);
      at += 2;
    };
    const u32 = (v) => {
      view.setUint32(at, v, true);
      at += 4;
    };
    const DATE = 0x21; // 1 January 1980
    for (const item of items) {
      item.offset = at;
      u32(0x04034b50);
      u16(10);
      u16(0);
      u16(0);
      u16(0);
      u16(DATE);
      u32(item.crc);
      u32(item.data.length);
      u32(item.data.length);
      u16(item.nameBytes.length);
      u16(0);
      out.set(item.nameBytes, at);
      at += item.nameBytes.length;
      out.set(item.data, at);
      at += item.data.length;
    }
    const directory = at;
    for (const item of items) {
      u32(0x02014b50);
      u16(20);
      u16(10);
      u16(0);
      u16(0);
      u16(0);
      u16(DATE);
      u32(item.crc);
      u32(item.data.length);
      u32(item.data.length);
      u16(item.nameBytes.length);
      u16(0);
      u16(0);
      u16(0);
      u16(0);
      u32(0o644 << 16);
      u32(item.offset);
      out.set(item.nameBytes, at);
      at += item.nameBytes.length;
    }
    const directorySize = at - directory;
    u32(0x06054b50);
    u16(0);
    u16(0);
    u16(items.length);
    u16(items.length);
    u32(directorySize);
    u32(directory);
    u16(0);
    return out;
  }

  async function packFromBundle() {
    const holder = {};
    Services.scriptloader.loadSubScript(`${ICON_ROOT}/tabler-bundle.js`, holder);
    const { head, icons } = holder.ZiaTablerBundle;
    const entries = [];
    for (const style of Object.keys(icons).sort()) {
      for (const name of Object.keys(icons[style]).sort()) {
        entries.push([`${style}/${name}.svg`, `${head[style]}${icons[style][name]}</svg>`]);
      }
    }
    try {
      entries.push(["LICENSE", await (await fetch(`${ICON_ROOT}/tabler-LICENSE`)).text()]);
    } catch (err) {
      noteError("icon pack: licence", err);
    }
    return zipOf(entries);
  }

  function setupIconPack() {
    iconPackReady ??= (async () => {
      const pack = iconPackPath();
      const dir = PathUtils.parent(pack);
      if (!(await IOUtils.exists(pack))) {
        const bytes = await packFromBundle();
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
        // written aside first, so another window never reads half a zip
        const part = `${pack}.${Math.random().toString(36).slice(2)}.part`;
        await IOUtils.write(part, bytes);
        await IOUtils.move(part, pack);
      }
      pointAtIconPack(pack);
      // Older packs go (one still open can't be removed on Windows until
      // Zen restarts; it goes next time).
      for (const child of await IOUtils.getChildren(dir)) {
        if (child !== pack && /tabler-[^/\\]*\.zip(\.[a-z0-9]+\.part)?$/.test(child)) {
          IOUtils.remove(child).catch(() => {});
        }
      }
    })();
    iconPackReady.catch((err) => noteError("icon pack", err));
    return iconPackReady;
  }

  function tablerIcons() {
    if (iconIndex) {
      return iconIndex;
    }
    const holder = {};
    try {
      Services.scriptloader.loadSubScript(`${ICON_ROOT}/tabler-names.js`, holder);
    } catch (err) {
      noteError("icon picker: load names", err);
    }
    iconIndex = (holder.ZiaTablerIcons || []).map((row) => {
      const [name, styles, words] = row.split("|");
      return { name, outline: styles.includes("o"), filled: styles.includes("f"), words: words || "" };
    });
    return iconIndex;
  }

  function iconStyle() {
    try {
      return Services.prefs.getStringPref(ICON_STYLE_PREF, "outline") === "filled" ? "filled" : "outline";
    } catch (err) {
      return "outline";
    }
  }

  // Best matches first: the name itself, then words in the name, then tags.
  function searchIcons(icons, text) {
    const terms = text.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (!terms.length) {
      return icons;
    }
    const scored = [];
    for (const icon of icons) {
      const parts = icon.name.split("-");
      let score = 0;
      for (const term of terms) {
        if (parts.includes(term)) {
          score += 3;
        } else if (parts.some((part) => part.startsWith(term))) {
          score += 2;
        } else if (icon.name.includes(term) || icon.words.includes(term)) {
          score += 1;
        } else {
          score = 0;
          break;
        }
      }
      if (score) {
        if (icon.name === terms.join("-")) {
          score += 10;
        } else if (parts[0] === terms[0]) {
          score += 1;
        }
        scored.push({ icon, score });
      }
    }
    return scored.sort((a, b) => b.score - a.score || a.icon.name.length - b.icon.name.length).map((entry) => entry.icon);
  }


  function addIconPicker() {
    const picker = window.gZenEmojiPicker;
    const panel = document.getElementById("PanelUI-zen-emojis-picker");
    const pages = document.getElementById("PanelUI-zen-emojis-picker-pages");
    const tabs = document.getElementById("PanelUI-zen-emojis-buttons-wrapper");
    const search = document.getElementById("PanelUI-zen-emojis-picker-search");
    if (document.getElementById("zia-icons-tab")) {
      return true; // already hooked
    }
    if (!picker || !panel || !pages || !tabs) {
      return false;
    }

    const tab = document.createXULElement("toolbarbutton");
    tab.id = "zia-icons-tab";
    tab.setAttribute("label", "Zia");
    tabs.appendChild(tab);

    function nameZenTab() {
      const zenTab = document.getElementById("PanelUI-zen-emojis-picker-change-svg");
      if (zenTab && zenTab.getAttribute("label") !== "Zen") {
        zenTab.removeAttribute("data-l10n-id");
        zenTab.removeAttribute("data-l10n-args");
        zenTab.setAttribute("label", "Zen");
      }
    }

    const page = document.createXULElement("vbox");
    page.id = "zia-icons-page";
    const bar = document.createElementNS(XHTML_NS, "div");
    bar.id = "zia-icons-searchbar";
    const box = document.createElementNS(XHTML_NS, "input");
    box.id = "zia-icons-search";
    box.setAttribute("type", "text");
    box.setAttribute("placeholder", "Search icons");
    // Outline or solid, remembered
    const styles = document.createElementNS(XHTML_NS, "div");
    styles.id = "zia-icons-style";
    const styleButtons = {};
    for (const [value, label] of [["outline", "Outline"], ["filled", "Solid"]]) {
      const button = document.createElementNS(XHTML_NS, "button");
      button.className = "zia-icons-style-option";
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        try {
          Services.prefs.setStringPref(ICON_STYLE_PREF, value);
        } catch (err) {
          noteError("icon picker: save style", err);
        }
        showStyle();
        render();
      });
      styleButtons[value] = button;
      styles.appendChild(button);
    }
    bar.append(box, styles);
    const grid = document.createElementNS(XHTML_NS, "div");
    grid.id = "zia-icons-grid";
    const empty = document.createElementNS(XHTML_NS, "div");
    empty.id = "zia-icons-empty";
    empty.textContent = "No icons found";
    empty.hidden = true;
    page.append(bar, grid, empty);
    pages.appendChild(page);

    function showStyle() {
      const current = iconStyle();
      for (const [value, button] of Object.entries(styleButtons)) {
        button.toggleAttribute("selected", value === current);
      }
    }

    let showing = false;
    let picked = false;
    let resolvePick = null;
    let options = null;

    function choose(url) {
      picked = true;
      // as Zen does after its own picks: with an icon chosen, the "none"
      // (bin) button can take it off again
      panel.removeAttribute("hide-none-option");
      options?.onSelect?.(url);
      resolvePick?.(url);
      if (options?.closeOnSelect !== false) {
        panel.hidePopup();
      }
    }

    // Results are added a screenful at a time as the grid scrolls, so the
    // thousands of icons never load at once.
    const BATCH = 180;
    let results = [];
    let shown = 0;
    let lastQuery = null;
    const more = document.createElementNS(XHTML_NS, "div");
    more.id = "zia-icons-more";
    const moreWatcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          addMore();
        }
      },
      { root: grid, rootMargin: "200px" }
    );
    moreWatcher.observe(more);

    function addMore() {
      if (shown >= results.length) {
        return;
      }
      const style = iconStyle();
      const fragment = document.createDocumentFragment();
      for (const icon of results.slice(shown, shown + BATCH)) {
        const url = `${ICON_DIR}/${style}/${icon.name}.svg`;
        const item = document.createXULElement("toolbarbutton");
        item.className = "toolbarbutton-1 zen-emojis-picker-svg zia-icon-item";
        item.setAttribute("tooltiptext", icon.name.replace(/-/g, " "));
        item.style.listStyleImage = `url(${url})`;
        // Zen's picker takes every click on an icon with its class as one
        // of its own, and would pass on a broken address (it reads an
        // "icon" attribute these don't have) after Zia's
        item.addEventListener("command", (event) => {
          event.stopPropagation();
          choose(url);
        });
        fragment.appendChild(item);
      }
      shown = Math.min(results.length, shown + BATCH);
      grid.insertBefore(fragment, more);
    }

    function render() {
      const style = iconStyle();
      const query = `${style}:${(box.value || "").trim()}`;
      if (query === lastQuery) {
        return;
      }
      lastQuery = query;
      results = searchIcons(tablerIcons().filter((icon) => icon[style]), box.value || "");
      shown = 0;
      grid.replaceChildren(more);
      grid.scrollTop = 0;
      empty.hidden = results.length > 0;
      addMore();
    }

    function show() {
      showing = true;
      showStyle();
      render();
      box.focus({ preventScroll: true });
      page.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      for (const other of tabs.children) {
        other.classList.toggle("selected", other === tab);
      }
    }

    tab.addEventListener("command", show);

    panel.addEventListener("command", (event) => {
      if (event.target === tab) {
        return;
      }
      if (event.target.id?.startsWith("PanelUI-zen-emojis-picker-change")) {
        showing = false;
        tab.classList.remove("selected");
      }
    });

    function matchZenSearch() {
      const zenBox = document.getElementById("PanelUI-zen-emojis-picker-search");
      if (!zenBox) {
        return;
      }
      const from = getComputedStyle(zenBox);
      for (const prop of [
        "appearance", "padding", "border", "borderRadius", "backgroundColor",
        "backgroundImage", "color", "font", "fontSize", "fontFamily",
        "boxShadow", "outline", "minHeight", "height", "lineHeight",
      ]) {
        const value = from[prop];
        if (value && value !== "auto") {
          box.style[prop] = value;
        }
      }
      const rect = zenBox.getBoundingClientRect();
      if (rect.height > 0) {
        box.style.boxSizing = "border-box";
        box.style.height = `${rect.height}px`;
        box.style.minHeight = `${rect.height}px`;
      }
      const header = document.getElementById("PanelUI-zen-emojis-picker-header");
      if (header) {
        const row = getComputedStyle(header);
        for (const prop of ["padding", "gap", "alignItems"]) {
          if (row[prop]) {
            bar.style[prop] = row[prop];
          }
        }
      }
      const zenList = document.getElementById("PanelUI-zen-emojis-picker-svgs");
      if (zenList) {
        const list = getComputedStyle(zenList);
        for (const prop of ["padding", "gap", "gridTemplateColumns"]) {
          if (list[prop]) {
            grid.style[prop] = list[prop];
          }
        }
      }
    }

    box.addEventListener("input", render);

    search?.addEventListener("input", () => {
      if (showing) {
        box.value = search.value;
        render();
      }
    });

    panel.addEventListener("popupshowing", () => {
      nameZenTab();
      matchZenSearch();
    });

    panel.addEventListener("popupshown", () => {
      nameZenTab();
      matchZenSearch();
      showing = false;
      tab.classList.remove("selected");
      if (search && lastQuery !== null) {
        render();
      }
    });

    const openPicker = picker.open.bind(picker);
    picker.open = function (anchor, settings = {}) {
      const zenPick = openPicker(anchor, settings);
      if (!zenPick) {
        return zenPick;
      }
      options = settings;
      picked = false;
      const ziaPick = new Promise((resolve) => {
        resolvePick = resolve;
      });
      return Promise.race([
        zenPick.catch((err) => {
          if (picked) {
            return ziaPick;
          }
          throw err;
        }),
        ziaPick,
      ]);
    };
    return true;
  }

  // --- styles (Zia's chrome.css, icon picker part) ---------------------------
  const CSS = `
#PanelUI-zen-emojis-picker[only-svg-icons="true"] :is(#PanelUI-zen-emojis-picker-header, #PanelUI-zen-emojis-picker-search) {
  display: flex !important;
  visibility: visible !important;
}

/* With icons only, Zen makes its tab unclickable (it's the only page);
   beside Zia's tab it's the way back */
#PanelUI-zen-emojis-picker[only-svg-icons="true"] #PanelUI-zen-emojis-picker-change-svg {
  pointer-events: auto !important;
}

#zia-icons-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
}

#zia-icons-searchbar {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
}

/* (colours follow the panel's own light or dark, as Zen's do: white text
   showed on a light panel) */
#zia-icons-search {
  flex: 1;
  min-width: 0;
  padding: 4px;
  color: light-dark(rgb(28, 28, 32), rgb(255, 255, 255));

  &::placeholder {
    color: light-dark(rgba(0, 0, 0, 0.4), rgba(255, 255, 255, 0.4));
  }

  &:focus,
  &:focus-visible {
    outline: none;
  }
}

/* Outline or solid */
#zia-icons-style {
  display: flex;
  flex: none;
  padding: 2px;
  border-radius: 8px;
  background-color: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.07));
}

.zia-icons-style-option {
  appearance: none;
  margin: 0;
  padding: 3px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: light-dark(rgba(0, 0, 0, 0.55), rgba(255, 255, 255, 0.55));
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: default;

  &:hover {
    color: light-dark(rgba(0, 0, 0, 0.85), rgba(255, 255, 255, 0.85));
  }

  &[selected] {
    background-color: light-dark(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.14));
    color: light-dark(rgb(28, 28, 32), rgb(255, 255, 255));
    box-shadow: light-dark(0 0 0 0.5px rgba(0, 0, 0, 0.08), none);
  }
}

#zia-icons-empty {
  padding: 18px 10px;
  text-align: center;
  color: light-dark(rgba(0, 0, 0, 0.45), rgba(255, 255, 255, 0.45));
  font-size: 12px;
}

#zia-icons-more {
  grid-column: 1 / -1;
  height: 1px;
}

#zia-icons-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
  align-content: start;
  gap: 5px;
  padding: 0 10px 10px;
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.zia-icon-item {
  -moz-context-properties: fill, fill-opacity, stroke;
  fill: light-dark(rgba(0, 0, 0, 0.8), rgba(255, 255, 255, 0.85));
}
`;

  function injectStyles() {
    if (document.getElementById("bubble-tabler-css")) return;
    const style = document.createElementNS(XHTML_NS, "style");
    style.id = "bubble-tabler-css";
    style.textContent = CSS;
    root.appendChild(style);
  }

  // Zen may not have its picker panel in the page yet at startup, so keep
  // trying for a while, and again whenever a popup opens.
  function hookIconPicker() {
    const done = () => {
      try {
        if (addIconPicker()) {
          console.info("[bubble-clean] tabler icons: picker hooked");
          return true;
        }
      } catch (err) {
        console.error("[bubble-clean] tabler icons: picker failed:", err);
        return true; // a thrown error won't fix itself by retrying
      }
      return false;
    };
    if (done()) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (done() || ++tries >= 30) {
        clearInterval(timer);
        if (tries >= 30) {
          console.error(
            "[bubble-clean] tabler icons: Zen's icon picker was not found",
            { gZenEmojiPicker: !!window.gZenEmojiPicker, panel: !!document.getElementById("PanelUI-zen-emojis-picker") }
          );
        }
      }
    }, 1000);
    document.addEventListener("popupshowing", function onPopup() {
      if (done()) document.removeEventListener("popupshowing", onPopup, true);
    }, true);
  }

  function start() {
    console.info("[bubble-clean] tabler icons: starting");
    try {
      injectStyles();
      // Icons asked for before the pack was ready (the first start) are drawn again
      setupIconPack().then(
        () => {
          redrawPackIcons();
          window.SessionStore?.promiseAllWindowsRestored?.then(() => setTimeout(redrawPackIcons, 300), () => {});
        },
        () => {}
      );
      hookIconPicker();
    } catch (err) {
      console.error("[bubble-clean] tabler icons failed to start:", err);
    }
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
