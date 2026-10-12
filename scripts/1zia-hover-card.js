// Adapted from Zia by z1n-k; MIT licensed (src/js/27-hover-cards.js, src/css/07-hover-cards.css).
// Tab hover card: title, domain and a row of action buttons.
// Left out on purpose: folder card, page thumbnail, split-view handling.
// Buttons are defined in ACTIONS below: add, remove or reorder them there.
(() => {
  if (window.__bubbleHoverCardLoaded) return;
  window.__bubbleHoverCardLoaded = true;

  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const root = document.documentElement;

  // Constants Zia defines elsewhere (values are my guesses: tweak to taste)
  const TAB_CARD_GAP = 8; // space between card and sidebar / window edge
  const TAB_CARD_DELAY = 400; // ms hovering before the first card shows
  const TAB_CARD_GRACE = 150; // ms before the card hides after leaving
  const ESSENTIAL_CARD_OVERLAP_X = 14;
  const ESSENTIAL_CARD_OVERLAP_Y = 18;
  const CARD_OUT_MS = 120;

  // --- icons (inline SVG, so no icon files are needed) ----------------------
  const ICONS = {
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 5.5V4.5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1"/>',
    check: '<path d="M3.5 8.5l3 3 6-7"/>',
    volume: '<path d="M3 6.5h2L8 4v8L5 9.5H3z"/><path d="M10.5 6a3 3 0 0 1 0 4"/>',
    "volume-off": '<path d="M3 6.5h2L8 4v8L5 9.5H3z"/><path d="M10.5 6.5l3 3M13.5 6.5l-3 3"/>',
    unload: '<circle cx="8" cy="8" r="5.5"/><path d="M5.5 8h5"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  };

  function makeIcon(name) {
    const text =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || "") +
      "</svg>";
    const svg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    return document.importNode(svg, true);
  }

  // --- the buttons -----------------------------------------------------------
  // icon(tab): icon name; hidden(tab): true to leave the button out;
  // keepsCard: leave the card open after the click; run(tab): what it does
  const ACTIONS = [
    {
      name: "copy",
      label: "Copy link",
      icon: () => "copy",
      hidden: (tab) => !/^https?:/.test(tab.linkedBrowser?.currentURI?.spec || ""),
      keepsCard: true,
      run: (tab) => {
        const helper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
        helper.copyString(tab.linkedBrowser.currentURI.spec);
      },
    },
    {
      name: "mute",
      label: "Mute / unmute tab",
      icon: (tab) => (tab.hasAttribute("muted") ? "volume-off" : "volume"),
      hidden: (tab) => !tab.hasAttribute("soundplaying") && !tab.hasAttribute("muted"),
      keepsCard: true,
      run: (tab) => tab.toggleMuteAudio(),
    },
    {
      name: "unload",
      label: "Unload tab",
      icon: () => "unload",
      hidden: (tab) => tab.selected || tab.hasAttribute("pending") || !tab.linkedPanel,
      run: (tab) => gBrowser.discardBrowser(tab, true),
    },
    {
      name: "close",
      label: "Close tab",
      icon: () => "close",
      hidden: (tab) => tab.hasAttribute("zen-essential"),
      run: (tab) => gBrowser.removeTab(tab, { animate: true }),
    },
  ];

  // --- styles (from Zia's 07-hover-cards.css, tab card only) ----------------
  const CSS = `
#zia-tab-card {
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
  width: var(--zia-tab-card-width, 260px);
  padding: 12px 14px 10px;
  overflow: clip;
  pointer-events: auto;
  background-color: color-mix(
      in srgb,
      rgba(0, 0, 0, 0.5) 50%,
      var(--zen-primary-color) 54%
    ) !important;
  border-radius: var(--border-radius-medium);
  corner-shape: var(--zia-squircle, round) !important;
  box-shadow: var(--zia-glass-edge-lit, inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 8px 28px rgba(0, 0, 0, 0.35));
  color: rgb(255, 255, 255);
  -moz-window-dragging: no-drag;

  &[zia-open] {
    animation: zia-tab-card-in 0.26s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }

  &[zia-snap] {
    animation: none;
  }

  &[zia-closing] {
    animation: zia-tab-card-out 0.12s ease-in forwards;
    pointer-events: none;
  }
}

:is(#zia-tab-card, .zia-tab-card-sub, #zia-tab-card-actions, .zia-tab-card-action)[hidden] {
  display: none !important;
}

@keyframes zia-tab-card-in {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes zia-tab-card-out {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.85);
  }
}

.zia-tab-card-title {
  font-weight: 600;
  font-size: 13px;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.zia-tab-card-sub {
  color: var(--zia-tab-card-sub, rgba(255, 255, 255, 0.55));
  font-size: 13px;
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#zia-tab-card-actions {
  display: flex;
  gap: 2px;
  margin: 8px -6px -4px;
}

.zia-tab-card-action {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  width: 30px;
  height: 30px;
  border-radius: calc(8px * var(--zia-squircle-grow, 1));
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(255, 255, 255);
}

:root .zia-tab-card-action {
  corner-shape: var(--zia-squircle, round) !important;
}

/* faded as a whole: faded per shape, overlapping strokes showed brighter */
.zia-tab-card-action svg {
  width: 17px;
  height: 17px;
  opacity: 0.55;
  pointer-events: none;
}

.zia-tab-card-action:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.zia-tab-card-action:hover svg {
  opacity: 1;
}
`;

  function injectStyles() {
    if (document.getElementById("bubble-hover-card-css")) return;
    const style = document.createElementNS(XHTML_NS, "style");
    style.id = "bubble-hover-card-css";
    style.textContent = CSS;
    document.documentElement.appendChild(style);
  }

  // --- what the card shows ---------------------------------------------------
  const NEW_TAB_PAGES = new Set(["about:newtab", "about:home", "about:blank", "about:privatebrowsing"]);

  function tabCardKind(tab) {
    const spec = tab.linkedBrowser?.currentURI?.spec || "";
    if (/^https?:/.test(spec)) return "web";
    if (!spec || NEW_TAB_PAGES.has(spec) || tab.hasAttribute("zen-empty-tab")) return "new";
    return "internal";
  }

  const INTERNAL_PAGE_NAMES = { preferences: "settings", addons: "extensions" };

  function tabCardDomain(tab) {
    try {
      const uri = tab.linkedBrowser?.currentURI;
      if (!uri) return "";
      if (/^https?$/.test(uri.scheme)) return uri.host.replace(/^www\./, "");
      if (uri.scheme === "about") {
        const name = uri.filePath.split(/[?#]/)[0].toLowerCase();
        return INTERNAL_PAGE_NAMES[name] || name;
      }
      return "";
    } catch (err) {
      return "";
    }
  }

  function buildTabCard(onAction) {
    const card = document.createElementNS(XHTML_NS, "div");
    card.id = "zia-tab-card";
    card.hidden = true;

    const title = document.createElementNS(XHTML_NS, "div");
    title.className = "zia-tab-card-title";
    const sub = document.createElementNS(XHTML_NS, "div");
    sub.className = "zia-tab-card-sub";

    const row = document.createElementNS(XHTML_NS, "div");
    row.id = "zia-tab-card-actions";
    for (const action of ACTIONS) {
      const button = document.createElementNS(XHTML_NS, "button");
      button.className = "zia-tab-card-action";
      button.setAttribute("zia-action", action.name);
      button.title = action.label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onAction(action);
      });
      row.appendChild(button);
    }

    card.append(title, sub, row);
    root.appendChild(card);
    return card;
  }

  function fillTabCard(card, tab) {
    const isNew = tabCardKind(tab) === "new";
    card.querySelector(".zia-tab-card-title").textContent = tab.label || "New Tab";
    const sub = card.querySelector(".zia-tab-card-sub");
    sub.textContent = isNew ? "" : tabCardDomain(tab);
    sub.hidden = !sub.textContent;

    const row = card.querySelector("#zia-tab-card-actions");
    row.hidden = isNew;
    for (const button of row.children) {
      const action = ACTIONS.find((a) => a.name === button.getAttribute("zia-action"));
      button.hidden = !action || !!action.hidden?.(tab);
      if (!button.hidden) {
        button.replaceChildren(makeIcon(action.icon(tab)));
      }
    }
  }

  // keeps the card in the window; returns the top it got
  function moveCard(card, x, y) {
    x = Math.max(TAB_CARD_GAP, Math.min(x, window.innerWidth - card.offsetWidth - TAB_CARD_GAP));
    y = Math.max(TAB_CARD_GAP, Math.min(y, window.innerHeight - card.offsetHeight - TAB_CARD_GAP));
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
    return y;
  }

  function placeTabCard(card, tab) {
    const tile = tab.querySelector(":scope > .tab-stack > .tab-background");
    const tileBox = tile?.getBoundingClientRect();
    const tabBox = tileBox && tileBox.width > 0 && tileBox.height > 0 ? tileBox : tab.getBoundingClientRect();
    const sidebar = document.getElementById("navigator-toolbox")?.getBoundingClientRect() || tabBox;
    const onRight = root.getAttribute("zen-right-side") === "true";
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    let x;
    let y;
    let origin;

    if (tab.hasAttribute("zen-essential")) {
      y = tabBox.bottom - ESSENTIAL_CARD_OVERLAP_Y;
      if (onRight) {
        x = tabBox.left - width + ESSENTIAL_CARD_OVERLAP_X;
        origin = "top right";
      } else {
        x = tabBox.right - ESSENTIAL_CARD_OVERLAP_X;
        origin = "top left";
      }
    } else {
      x = onRight ? sidebar.left - width - TAB_CARD_GAP : sidebar.right + TAB_CARD_GAP;
      y = tabBox.top + tabBox.height / 2 - height / 2;
      origin = onRight ? "right center" : "left center";
    }

    moveCard(card, x, y);
    card.style.transformOrigin = origin;
  }

  // --- showing and hiding ----------------------------------------------------
  function addTabHoverCards() {
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbox) return;

    let card = null;
    let current = null;
    let showTimer = 0;
    let hideTimer = 0;
    let closeTimer = 0;
    let keepCardUntil = 0;

    const cardUp = () => !!card && !card.hidden && !card.hasAttribute("zia-closing");
    const cardHovered = () => !!card && !card.hidden && card.matches(":hover");

    // Compact mode hides the sidebar once the pointer leaves it, and the card
    // sits outside it: hold it open while on the card.
    let holding = false;
    const holdSidebar = (on) => {
      if (on === holding) return;
      if (on) {
        holding = !toolbox.hasAttribute("has-popup-menu");
        if (holding) toolbox.setAttribute("has-popup-menu", "true");
        return;
      }
      holding = false;
      toolbox.removeAttribute("has-popup-menu");
      try {
        const manager = window.gZenCompactModeManager;
        if (manager?.preference && !toolbox.matches(":hover")) {
          const keep = Services.prefs.getIntPref("zen.view.compact.sidebar-keep-hover.duration", 0);
          if (keep > 0) {
            manager.flashElement(toolbox, keep, `has-hover${toolbox.id}`, "zen-has-hover");
          }
        }
      } catch (err) {
        console.error("[bubble-clean] hover card: release sidebar", err);
      }
    };

    const hide = (force = false) => {
      if (force !== true && cardHovered()) return;
      holdSidebar(false);
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      current = null;
      if (card && !card.hidden && !card.hasAttribute("zia-closing")) {
        card.removeAttribute("zia-snap");
        card.setAttribute("zia-closing", "true");
      }
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (card?.hasAttribute("zia-closing")) {
          card.hidden = true;
          card.removeAttribute("zia-closing");
          card.removeAttribute("zia-open");
        }
      }, CARD_OUT_MS);
    };

    const openCard = (wasUp) => {
      clearTimeout(closeTimer);
      card.removeAttribute("zia-closing");
      if (wasUp) {
        card.setAttribute("zia-snap", "true");
        card.setAttribute("zia-open", "true");
        return;
      }
      card.removeAttribute("zia-snap");
      card.removeAttribute("zia-open");
      void card.offsetWidth;
      card.setAttribute("zia-open", "true");
    };

    const hideSoon = () => {
      clearTimeout(hideTimer);
      const attempt = () => {
        const wait = keepCardUntil - Date.now();
        if (wait > 0) {
          hideTimer = setTimeout(attempt, wait);
          return;
        }
        hide();
      };
      hideTimer = setTimeout(attempt, TAB_CARD_GRACE);
    };

    const onCard = (node) => !!node && !!card?.contains(node);

    const show = (tab) => {
      const wasUp = cardUp();
      if (!card) {
        card = buildTabCard((action) => {
          const target = current;
          if (!action.keepsCard) {
            hide(true);
          } else {
            keepCardUntil = Date.now() + 1200;
          }
          if (!target?.isConnected) return;
          Promise.try(() => action.run(target))
            .then(() => {
              if (action.keepsCard && card && !card.hidden && current === target) {
                if (action.name === "copy") {
                  const button = card.querySelector('[zia-action="copy"]');
                  button?.replaceChildren(makeIcon("check"));
                  setTimeout(() => {
                    if (current === target) fillTabCard(card, target);
                  }, 900);
                } else {
                  setTimeout(() => {
                    if (current === target) fillTabCard(card, target);
                  }, 80);
                }
              }
            })
            .catch((err) => console.error(`[bubble-clean] ${action.label} failed:`, err));
        });
        card.addEventListener("mouseenter", () => {
          clearTimeout(hideTimer);
          holdSidebar(true);
        });
        card.addEventListener("mouseleave", () => {
          holdSidebar(false);
          hideSoon();
        });
      }
      current = tab;
      fillTabCard(card, tab);
      card.hidden = false;
      placeTabCard(card, tab);
      openCard(wasUp);
    };

    toolbox.addEventListener("mouseover", (event) => {
      const tab = event.target?.closest?.(".tabbrowser-tab");
      if (!tab || tab.hasAttribute("pending-drag") || tab.hasAttribute("zen-empty-tab") || gBrowser.tabContainer.hasAttribute("movingtab")) {
        return;
      }
      clearTimeout(hideTimer);
      if (tab === current) return;
      clearTimeout(showTimer);
      if (current) {
        show(tab);
        return;
      }
      showTimer = setTimeout(() => {
        if (tab.isConnected && tab.matches(":hover")) show(tab);
      }, TAB_CARD_DELAY);
    });

    toolbox.addEventListener("mouseout", (event) => {
      const tab = event.target?.closest?.(".tabbrowser-tab");
      if (!tab) return;
      const to = event.relatedTarget;
      if (to && (tab.contains(to) || onCard(to))) return;
      clearTimeout(showTimer);
      hideSoon();
    });

    toolbox.addEventListener("mousedown", () => hide(), true);
    toolbox.addEventListener("dragstart", () => hide(true), true);
    toolbox.addEventListener("wheel", () => hide(), { passive: true, capture: true });

    for (const type of ["TabSelect", "TabClose"]) {
      gBrowser.tabContainer.addEventListener(type, () => {
        if (Date.now() < keepCardUntil || cardHovered()) return;
        hide();
      });
    }

    window.addEventListener("blur", () => {
      if (Date.now() >= keepCardUntil) hide();
    });

    // The card replaces the browser's own tab tooltip, so it isn't shown twice
    document.addEventListener(
      "popupshowing",
      (event) => {
        const trigger = event.target?.triggerNode;
        if (event.target?.localName === "tooltip" && trigger?.closest?.(".tabbrowser-tab")) {
          event.preventDefault();
        }
      },
      true
    );
  }

  function start() {
    try {
      injectStyles();
      addTabHoverCards();
    } catch (err) {
      console.error("[bubble-clean] hover card failed to start:", err);
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
