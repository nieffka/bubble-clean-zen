// Extracted from Zia by z1n-k; MIT licensed.
(() => {
  if (window.__bubbleTabNumbersLoaded) return;
  window.__bubbleTabNumbersLoaded = true;

  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const root = document.documentElement;
  const TAB_NUMBERS_ALWAYS_PREF = "zia.tab-numbers.always";
  const TAB_NUMBERS_LEAVE_MS = 110;

  // --- small helpers Zia provides elsewhere -------------------------------
  const setFlag = (name, on) => root.toggleAttribute(name, !!on);

  const watchPrefs = (pref, callback) => {
    const observer = { observe: () => callback() };
    Services.prefs.addObserver(pref, observer);
    window.addEventListener("unload", () => Services.prefs.removeObserver(pref, observer), { once: true });
  };

  // --- styles (from Zia's 04-tabs-sound-bars-and-essentials.css) -----------
  const CSS = `
.tabbrowser-tab > .tab-stack > .tab-content > .zia-tab-number {
  display: none;
  flex: none;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  margin: 0 0 0 6px;
  padding: 0;
  border-radius: calc(5.5px * var(--zia-squircle-grow, 1));
  corner-shape: var(--zia-squircle, round) !important;
  background-color: transparent;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.5);
  font: 500 10px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  place-items: center;
  pointer-events: none;

  & > span {
    display: block;
    text-box: trim-both cap alphabetic;
  }
}

.tabbrowser-tab > .tab-stack > .tab-content > .zia-tab-number[zia-wide] {
  width: auto;
  min-width: 18px;
  padding: 0 4px;

  & > span {
    letter-spacing: -0.05em;
    margin-inline-end: 0.05em;
  }
}

.tabbrowser-tab[visuallyselected] > .tab-stack > .tab-content > .zia-tab-number {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.68);
}

/* Essentials, and every tab when the sidebar is collapsed: a smaller key in the corner */
.tabbrowser-tab[zen-essential] > .tab-stack,
:root:not([zen-sidebar-expanded="true"]) .tabbrowser-tab > .tab-stack {
  position: relative;
}

:is(.tabbrowser-tab[zen-essential], :root:not([zen-sidebar-expanded="true"]) .tabbrowser-tab) > .tab-stack > .tab-content > .zia-tab-number {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 15px;
  height: 15px;
  margin: 0;
  border-radius: calc(4.25px * var(--zia-squircle-grow, 1));
  background-color: rgba(28, 28, 30, 0.45);
  font-size: 8.75px;
}

:is(.tabbrowser-tab[zen-essential], :root:not([zen-sidebar-expanded="true"]) .tabbrowser-tab) > .tab-stack > .tab-content > .zia-tab-number[zia-wide] {
  width: auto;
  min-width: 15px;
  padding: 0 2.5px;
}

:root[zia-tab-numbers] .tabbrowser-tab > .tab-stack > .tab-content > .zia-tab-number {
  display: grid;
  animation: zia-tab-number-in 0.16s cubic-bezier(0.2, 0.9, 0.3, 1);
}

@media -moz-pref("zia.tab-numbers.always") {
  .tabbrowser-tab > .tab-stack > .tab-content > .zia-tab-number {
    display: grid;
  }
}

/* The number being typed lights up */
.tabbrowser-tab > .tab-stack > .tab-content > .zia-tab-number[zia-target] {
  background-color: #5ab9f5 !important;
  box-shadow: none;
  color: rgb(8, 24, 38);
}

@keyframes zia-tab-number-in {
  from {
    opacity: 0;
    translate: 4px 0;
  }
}

/* Let go: they slide back off to the right */
:root[zia-tab-numbers-leaving]:not([zia-tab-numbers]) .tabbrowser-tab > .tab-stack > .tab-content > .zia-tab-number {
  display: grid;
  animation: zia-tab-number-out 0.1s cubic-bezier(0.4, 0, 0.8, 0.4) forwards;
}

@keyframes zia-tab-number-out {
  to {
    opacity: 0;
    translate: 4px 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  :root[zia-tab-numbers] .tabbrowser-tab > .tab-stack > .tab-content > .zia-tab-number {
    animation: none;
  }

  :root[zia-tab-numbers-leaving]:not([zia-tab-numbers]) .tabbrowser-tab > .tab-stack > .tab-content > .zia-tab-number {
    display: none;
  }
}
`;

  function injectStyles() {
    if (document.getElementById("bubble-tab-numbers-css")) return;
    const style = document.createElementNS(XHTML_NS, "style");
    style.id = "bubble-tab-numbers-css";
    style.textContent = CSS;
    document.documentElement.appendChild(style);
  }

  // --- Zia's tab-numbers logic ---------------------------------------------

  // The tabs the keys go to, in order: what's on screen, in the tab strip's
  // order (a tab inside a closed folder is skipped)
  function numberableTabs() {
    return (gBrowser.visibleTabs || []).filter((tab) => {
      try {
        return tab.checkVisibility ? tab.checkVisibility() : tab.getBoundingClientRect().height > 0;
      } catch (err) {
        return true;
      }
    });
  }

  function keyOf(tab) {
    return tab.querySelector(":scope > .tab-stack > .tab-content > .zia-tab-number");
  }

  function numberTabs() {
    const tabs = numberableTabs();
    const numbers = new Map(tabs.map((tab, i) => [tab, i + 1]));
    for (const tab of gBrowser.tabs) {
      const number = numbers.get(tab);
      let key = keyOf(tab);
      if (!number) {
        key?.remove();
        continue;
      }
      if (!key) {
        key = document.createElementNS(XHTML_NS, "span");
        key.className = "zia-tab-number";
        key.setAttribute("aria-hidden", "true");
        tab.querySelector(":scope > .tab-stack > .tab-content")?.append(key);
      }
      // the digits in a box of their own, trimmed to their height, so the
      // key can centre them exactly
      if (key.textContent !== String(number)) {
        const digits = document.createElementNS(XHTML_NS, "span");
        digits.textContent = String(number);
        key.replaceChildren(digits);
      }
      // one digit keeps its key square; two widen it
      key.toggleAttribute("zia-wide", number > 9);
    }
    return tabs;
  }

  function watchTabNumbers() {
    const mac = AppConstants.platform === "macosx";
    const isModKey = (event) => event.key === (mac ? "Meta" : "Control");
    const modHeld = (event) =>
      (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey && !event.shiftKey;

    let tabs = [];
    let typed = "";
    let lastDigit = null;

    // The key of the tab typed so far lights up
    const markTarget = () => {
      tabs.forEach((tab, i) => keyOf(tab)?.toggleAttribute("zia-target", !!typed && Number(typed) === i + 1));
    };

    // Letting go, the keys slide back off to the right the way they came
    let leaving = null;

    const show = () => {
      clearTimeout(leaving);
      setFlag("zia-tab-numbers-leaving", false);
      tabs = numberTabs();
      setFlag("zia-tab-numbers", true);
    };

    const hide = () => {
      typed = "";
      markTarget();
      if (root.hasAttribute("zia-tab-numbers") && !Services.prefs.getBoolPref(TAB_NUMBERS_ALWAYS_PREF, false)) {
        setFlag("zia-tab-numbers-leaving", true);
        clearTimeout(leaving);
        leaving = setTimeout(() => setFlag("zia-tab-numbers-leaving", false), TAB_NUMBERS_LEAVE_MS);
      }
      setFlag("zia-tab-numbers", false);
    };

    // Letting go: the tab typed, if any
    const commit = () => {
      const tab = typed ? tabs[Number(typed) - 1] : null;
      hide();
      if (tab?.isConnected) {
        gBrowser.selectedTab = tab;
      }
    };

    const startsANumber = (prefix) => tabs.some((_, i) => String(i + 1).startsWith(prefix));

    const onDigit = (digit) => {
      if (!root.hasAttribute("zia-tab-numbers")) {
        show();
      }
      // Carries on from the digits before if together they still name a
      // tab; otherwise starts again from this one
      const next = typed + digit;
      typed = startsANumber(next) ? next : startsANumber(digit) ? digit : "";
      markTarget();
    };

    // Seen both ways: keys pressed in a page reach the window only
    // afterwards, in the system group. A digit is handled once, but held
    // back from Firefox's own shortcut both times.
    for (const options of [{ capture: true }, { capture: true, mozSystemGroup: true }]) {
      window.addEventListener(
        "keydown",
        (event) => {
          if (isModKey(event)) {
            if (!event.repeat && !root.hasAttribute("zia-tab-numbers")) {
              show();
            }
            return;
          }
          const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1];
          if (digit !== undefined && modHeld(event)) {
            event.preventDefault();
            event.stopPropagation();
            const stamp = `${event.timeStamp}:${event.code}`;
            if (stamp !== lastDigit && !event.repeat) {
              lastDigit = stamp;
              onDigit(digit);
            }
          } else if (root.hasAttribute("zia-tab-numbers")) {
            // Any other shortcut (Cmd+W, Cmd+T...) or key: the keys go, and
            // nothing is chosen.
            hide();
          }
        },
        options
      );
      window.addEventListener(
        "keyup",
        (event) => {
          if (isModKey(event)) {
            commit();
          }
        },
        options
      );
    }

    // Should the letting go of Cmd still be missed, the next key or move
    // of the mouse without it held puts the keys away
    const heldStill = (event) => (mac ? event.metaKey : event.ctrlKey);
    for (const type of ["mousemove", "mousedown", "wheel", "keyup"]) {
      window.addEventListener(
        type,
        (event) => {
          if (root.hasAttribute("zia-tab-numbers") && !heldStill(event) && !isModKey(event)) {
            hide();
          }
        },
        { capture: true, passive: true }
      );
    }

    // Only when the window itself is left: focus moving into the page just
    // chosen reads as a blur too, with the key still held
    window.addEventListener("blur", (event) => {
      if (event.target !== window) {
        return;
      }
      setTimeout(() => {
        if (Services.focus.activeWindow !== window) {
          hide();
        }
      }, 0);
    });
    document.addEventListener("visibilitychange", () => document.hidden && hide());

    // Kept up to date as tabs come and go, for when they show all the time
    let queued = false;
    const renumber = () => {
      if (queued || !(root.hasAttribute("zia-tab-numbers") || Services.prefs.getBoolPref(TAB_NUMBERS_ALWAYS_PREF, false))) {
        return;
      }
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        tabs = numberTabs();
      });
    };
    for (const type of ["TabSelect", "TabOpen", "TabClose", "TabMove", "TabShow", "TabHide", "TabPinned", "TabUnpinned", "TabGrouped", "TabUngrouped", "TabGroupExpand", "TabGroupCollapse"]) {
      gBrowser.tabContainer.addEventListener(type, renumber);
    }
    window.addEventListener("ZenWorkspacesUIUpdate", renumber);
    window.addEventListener("ZenWorkspaceChanged", renumber);
    watchPrefs(TAB_NUMBERS_ALWAYS_PREF, renumber);
    renumber();
  }

  function start() {
    try {
      injectStyles();
      watchTabNumbers();
    } catch (err) {
      console.error("[bubble-clean] tab numbers failed to start:", err);
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
