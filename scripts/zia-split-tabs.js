// Extracted from Zia by z1n-k; MIT licensed.
// Zia split tabs
(() => {
  if (window.__zia_split_tabsLoaded) return;
  window.__zia_split_tabsLoaded = true;
  const root = document.documentElement;

  const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";
  const HTML = "http://www.w3.org/1999/xhtml";
  const MAGNET_SHARE = 0.32;
  const MAGNET_PULL_X = 0.55;
  const MAGNET_PULL_Y = 0.35;

  const ZONE_EDGE = 44;
  const ZONE_ACTIVE_W = 350;
  const ZONE_ACTIVE_H = 580;
  const ZONE_PAGE_W = 272;
  const ZONE_PAGE_H = 452;

  const splitDrop = {
    overlay: null,
    zones: {},
    tab: null,
    target: null,
    lastSelect: null,
    dragStartedAt: 0,
    side: null,
    bounds: null,
    renderedSide: null,
    frame: null,
    pointer: null,
  };

  function draggedTabOf(event) {
    const dt = event.dataTransfer;
    if (!dt || !dt.types.includes(TAB_DROP_TYPE)) {
      return null;
    }
    try {
      return dt.mozGetDataAt(TAB_DROP_TYPE, 0) || null;
    } catch (err) {
      return null;
    }
  }

  const PRESS_SELECT_MS = 1500;

  function splitTargetFor(tab) {
    const last = splitDrop.lastSelect;
    const selectedByThisDrag =
      last &&
      last.tab === tab &&
      gBrowser.selectedTab === tab &&
      splitDrop.dragStartedAt - last.time < PRESS_SELECT_MS &&
      splitDrop.dragStartedAt >= last.time;
    const previous = last?.previous;
    if (selectedByThisDrag && previous && !previous.closing && previous.isConnected && !previous.hidden) {
      return previous;
    }
    return gBrowser.selectedTab;
  }

  function canSplitWith(tab, current = gBrowser.selectedTab) {
    const splitter = window.gZenViewSplitter;
    if (!splitter || !tab || !current || tab.closing || tab.hasAttribute("zen-empty-tab")) {
      return false;
    }
    if (tab.hasAttribute("zen-live-folder-item-id")) {
      return false;
    }

    if (tab === current && current.splitView) {
      return false;
    }

    if (tab !== current && tab.splitView && current.splitView && tab.group && tab.group === current.group) {
      return false;
    }
    const group = splitter._data?.find?.((g) => g.tabs.includes(current));
    return !(group && group.tabs.length >= (splitter.MAX_TABS || 4));
  }

  function makeZone(side) {
    const zone = document.createElementNS(HTML, "div");
    zone.className = "zia-split-zone";
    zone.setAttribute("side", side);
    const inner = document.createElementNS(HTML, "div");
    inner.className = "zia-split-zone-inner";
    const icon = document.createElementNS(HTML, "div");
    icon.className = "zia-split-zone-icon";
    const label = document.createElementNS(HTML, "div");
    label.className = "zia-split-zone-label";
    label.textContent = side === "left" ? "Add left split" : "Add right split";
    inner.append(icon, label);
    zone.appendChild(inner);
    return zone;
  }

  function ensureSplitOverlay() {
    if (splitDrop.overlay) {
      return splitDrop.overlay;
    }
    const overlay = document.createElementNS(HTML, "div");
    overlay.id = "zia-split-drop";
    splitDrop.zones.left = makeZone("left");
    splitDrop.zones.right = makeZone("right");
    overlay.append(splitDrop.zones.left, splitDrop.zones.right);

    overlay.addEventListener("dragover", onSplitDragOver);
    overlay.addEventListener("drop", onSplitDrop);
    overlay.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget) {
        hideSplitDrop();
      }
    });
    document.documentElement.appendChild(overlay);
    splitDrop.overlay = overlay;
    return overlay;
  }

  function showSplitDrop(tab, event) {
    const overlay = ensureSplitOverlay();
    const box = gBrowser.tabbox.getBoundingClientRect();
    splitDrop.bounds = box;
    overlay.style.setProperty("--zia-drop-left", `${box.left}px`);
    overlay.style.setProperty("--zia-drop-top", `${box.top}px`);
    overlay.style.setProperty("--zia-drop-width", `${box.width}px`);
    overlay.style.setProperty("--zia-drop-height", `${box.height}px`);
    splitDrop.tab = tab;
    splitDrop.side = null;

    const target = splitDrop.target;
    let switched = false;
    const showTarget = () => {
      if (switched) {
        return;
      }
      switched = true;
      if (target && splitDrop.tab === tab && overlay.hasAttribute("open") && gBrowser.selectedTab !== target) {
        gBrowser.selectedTab = target;
      }
    };
    // Keep Zen's native drag image; no screenshot needs to finish first.
    setTimeout(showTarget, 0);
    overlay.setAttribute("open", "true");

    requestAnimationFrame(() => {
      if (overlay.hasAttribute("open")) {
        overlay.setAttribute("shown", "true");
      }
    });

  }

  function hideSplitDrop(event) {
    if (splitDrop.frame !== null) {
      cancelAnimationFrame(splitDrop.frame);
      splitDrop.frame = null;
    }
    splitDrop.pointer = null;
    restoreNativeTabPreview();
    const overlay = splitDrop.overlay;
    if (!overlay?.hasAttribute("open")) {
      return;
    }
    overlay.removeAttribute("shown");
    overlay.removeAttribute("open");
    setDropSide(null);
    splitDrop.side = null;
    splitDrop.tab = null;
    splitDrop.target = null;
    splitDrop.bounds = null;
  }

  function setDropSide(side, cursorX = 0, cursorY = 0) {
    const overlay = splitDrop.overlay;
    if (!overlay) {
      return;
    }
    const changed = side !== splitDrop.renderedSide;
    splitDrop.renderedSide = side;
    if (changed) overlay.toggleAttribute("has-side", !!side);
    for (const [name, zone] of Object.entries(splitDrop.zones)) {
      const active = name === side;
      if (changed) zone.toggleAttribute("active", active);
      if (!active) {
        if (changed) setZoneOffset(zone, "0px", "0px");
        continue;
      }

      // The overlay has the tabbox's bounds. Reusing them avoids a synchronous
      // layout read after toggling the active zone on every dragover.
      const box = splitDrop.bounds;
      const w = Math.min(ZONE_ACTIVE_W, box.width * 0.45);
      const h = Math.min(ZONE_ACTIVE_H, box.height * 0.86);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      let tx;
      if (name === "left") {
        const baseCentre = box.left + ZONE_EDGE + w / 2;
        tx = clamp((cursorX - baseCentre) * MAGNET_PULL_X, 8 - (box.left + ZONE_EDGE), box.width / 2 - ZONE_EDGE - w);
      } else {
        const baseCentre = box.right - ZONE_EDGE - w / 2;
        tx = clamp((cursorX - baseCentre) * MAGNET_PULL_X, -(box.width / 2 - ZONE_EDGE - w), window.innerWidth - 8 - (box.right - ZONE_EDGE));
      }
      const room = Math.max(0, box.height / 2 - h / 2 - 8);
      const ty = clamp((cursorY - (box.top + box.height / 2)) * MAGNET_PULL_Y, -room, room);
      setZoneOffset(zone, `${tx.toFixed(1)}px`, `${ty.toFixed(1)}px`);
    }
  }

  function setZoneOffset(zone, x, y) {
    // Reading inline style does not flush layout. Avoid identical mutations,
    // including movements clamped against the same edge.
    if (zone.style.getPropertyValue("--zia-zone-tx") !== x) {
      zone.style.setProperty("--zia-zone-tx", x);
    }
    if (zone.style.getPropertyValue("--zia-zone-ty") !== y) {
      zone.style.setProperty("--zia-zone-ty", y);
    }
  }

  function sideAt(event) {
    const box = splitDrop.bounds || gBrowser.tabbox.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
      return null;
    }
    const x = event.clientX - box.left;
    if (x < box.width * MAGNET_SHARE) {
      return "left";
    }
    if (x > box.width * (1 - MAGNET_SHARE)) {
      return "right";
    }
    return null;
  }

  function followDrag(event, overPage) {
    if (overPage) showNativeSplitPreview(event);
    else restoreNativeTabPreview();
    const side = overPage ? sideAt(event) : null;
    if (side !== splitDrop.side && side) {
      Services.zen?.playHapticFeedback?.();
    }
    splitDrop.side = side;
    splitDrop.pointer = { x: event.clientX, y: event.clientY };
    if (splitDrop.frame === null) {
      splitDrop.frame = requestAnimationFrame(() => {
        splitDrop.frame = null;
        const point = splitDrop.pointer;
        if (point && splitDrop.overlay?.hasAttribute("open")) {
          setDropSide(splitDrop.side, point.x, point.y);
        }
      });
    }
  }

  function onSplitDragOver(event) {
    if (!splitDrop.tab) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
  }

  function onSplitDrop(event) {
    const tab = splitDrop.tab;
    const target = splitDrop.target;
    // A drop can arrive before the queued paint or at a newer position.
    const side = isOverPage(event) ? sideAt(event) : null;
    event.preventDefault();
    event.stopPropagation();
    hideSplitDrop(event);
    if (!tab || !side) {
      return;
    }

    setTimeout(() => {
      try {
        splitTabToSide(tab, side, target);
      } catch (err) {
        console.error("[Zia] Split on drop failed:", err);
      }
    }, 0);
  }

  function splitTabToSide(tab, side, onTab = gBrowser.selectedTab) {
    const splitter = window.gZenViewSplitter;
    const glance = window.gZenGlanceManager;
    const base = onTab && !onTab.closing ? onTab : gBrowser.selectedTab;
    let target = glance?.getTabOrGlanceParent?.(base) ?? base;
    let dragged = glance?.getTabOrGlanceParent?.(tab) ?? tab;

    if (dragged === target) {
      const url = "about:newtab";
      const newTab = gBrowser.addTrustedTab(url, { inBackground: true });
      const left = side === "left";
      splitter.splitTabs(left ? [target, newTab] : [newTab, target], "vsep", left ? 1 : 0);
      gBrowser.selectedTab = newTab;
      return;
    }

    const pair = [dragged, target];
    const anyEssential = pair.some((t) => t.hasAttribute("zen-essential"));
    const somePinned = pair.some((t) => t.pinned) && !pair.every((t) => t.pinned);
    if (anyEssential || somePinned) {
      [dragged, target] = pair.map((t) => (t.pinned ? gBrowser.duplicateTab(t, true) : t));
    }

    const left = side === "left";
    splitter.splitTabs(left ? [dragged, target] : [target, dragged], "vsep", left ? 0 : 1);
    gBrowser.selectedTab = dragged;
  }

  function watchSplitDrop() {
    if (!window.gZenViewSplitter || !gBrowser.tabbox) {
      return;
    }
    window.addEventListener(
      "dragover",
      (event) => {
        const open = splitDrop.overlay?.hasAttribute("open");
        const overPage = isOverPage(event);
        if (open) {
          if (overPage) {
            gBrowser.tabContainer.tabDragAndDrop?.clearSpaceSwitchTimer?.();
          }
          followDrag(event, overPage);
          return;
        }
        if (!overPage) {
          return;
        }
        const tab = draggedTabOf(event);
        const target = tab && splitTargetFor(tab);
        if (tab && canSplitWith(tab, target)) {
          splitDrop.target = target;
          gBrowser.tabContainer.tabDragAndDrop?.clearSpaceSwitchTimer?.();
          showSplitDrop(tab, event);
          followDrag(event, overPage);
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
    window.addEventListener("dragend", hideSplitDrop, true);

    gBrowser.tabContainer.addEventListener("TabSelect", (event) => {
      splitDrop.lastSelect = { tab: event.target, previous: event.detail?.previousTab || null, time: Date.now() };
    });
    window.addEventListener("dragstart", () => (splitDrop.dragStartedAt = Date.now()), true);
    window.addEventListener(
      "drop",
      (event) => {
        if (!event.target?.closest?.("#zia-split-drop")) {
          hideSplitDrop(event);
        }
      },
      true
    );
  }

  function isOverPage(event) {
    const box = splitDrop.bounds || gBrowser.tabbox.getBoundingClientRect();
    const inPage =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    return inPage && !isOverCollapsedSidebar(event);
  }

  function isOverCollapsedSidebar(event) {
    if (root.getAttribute("zen-compact-mode") !== "true") {
      return false;
    }
    const toolbox = document.getElementById("navigator-toolbox");
    if (!toolbox) {
      return false;
    }
    const box = toolbox.getBoundingClientRect();

    if (box.right <= 0) {
      return false;
    }
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  }


  // Zen's rectangle is created by its private split handler, not by the
  // normal sidebar drag. Reuse its XUL structure and built-in styling only.
  function showNativeSplitPreview(event) {
    if (splitDrop.nativePreview || !splitDrop.tab ||
        typeof event.dataTransfer?.updateDragImage !== "function") return;
    if (document.getElementById("zen-split-view-drag-image")) return;
    const preview = document.createXULElement("vbox");
    preview.id = "zen-split-view-drag-image";
    const icon = document.createXULElement("image");
    icon.setAttribute("src", splitDrop.tab.getAttribute("image") || "chrome://global/skin/icons/defaultFavicon.svg");
    const label = document.createXULElement("label");
    label.textContent = splitDrop.tab.label;
    preview.append(icon, label);
    document.documentElement.appendChild(preview);
    splitDrop.nativePreview = preview;
    splitDrop.nativeTransfer = event.dataTransfer;
    const dt = event.dataTransfer;
    // Allow native sidebar drag-style refreshes to finish first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (splitDrop.nativePreview !== preview || !splitDrop.tab) return;
      const original = gBrowser.tabContainer.tabDragAndDrop?.originalDragImageArgs;
      try {
        dt.updateDragImage(preview, original?.[1] ?? 16, original?.[2] ?? 16);
        gBrowser.tabContainer.tabDragAndDrop?.clearDragOverVisuals?.();
      } catch (error) {
        // The drag can end while the update is queued.
        restoreNativeTabPreview();
      }
    }));
  }

  function restoreNativeTabPreview() {
    const preview = splitDrop.nativePreview;
    if (!preview) return;
    const dt = splitDrop.nativeTransfer;
    splitDrop.nativePreview = null;
    splitDrop.nativeTransfer = null;
    try {
      const original = gBrowser.tabContainer.tabDragAndDrop?.originalDragImageArgs;
      if (original?.length) dt?.updateDragImage(...original);
    } catch {}
    preview.remove();
  }

  function start() {
    Services.prefs.getDefaultBranch("").setBoolPref("zen.splitView.enable-tab-drop", false);
    watchSplitDrop();
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
