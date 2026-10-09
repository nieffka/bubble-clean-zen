// bubble-clean loader
// Each feature lives in scripts/<name>.js and is loaded only when its pref is on.
// Restart to apply.
(() => {
	const BASE = "chrome://sine/content/bubble-clean-zen/scripts/";
	const SCRIPTS = [{
			pref: "bubble.trim-url-bar.enabled",
			file: "trim-url-bar.js"
		},
		{
			pref: "zia.split-tabs.enabled",
			file: "zia-split-tabs.js"
		},
		{
			pref: "zia.media-player.enabled",
			file: "zia-media-player.js"
		},
	];

	const defaults = Services.prefs.getDefaultBranch("");
	for (const {
			pref
		}
		of SCRIPTS) defaults.setBoolPref(pref, true);

	for (const {
			pref,
			file
		}
		of SCRIPTS) {
		if (!Services.prefs.getBoolPref(pref, true)) continue;
		try {
			Services.scriptloader.loadSubScript(BASE + file, window);
		} catch (err) {
			console.error(`[bubble-clean] Couldn't load ${file}:`, err);
		}
	}
})();

// Extracted from Zia by z1n-k; MIT licensed.
// Zia findbar
function shortenFindCount(findbar) {
	const label = findbar?.querySelector?.(".found-matches");
	if (!label || label.__ziaCount) {
		return;
	}
	label.__ziaCount = true;
	const update = () => {
		const numbers = (label.getAttribute("value") || label.textContent || "").match(/\d[\d,.]*/g);
		label.setAttribute("zia-count", numbers?.length >= 2 ? `${numbers[0]}/${numbers[1]}` : numbers?.[0] || "");
	};
	new MutationObserver(update).observe(label, {
		attributes: true,
		attributeFilter: ["value"],
		childList: true,
		characterData: true,
		subtree: true
	});
	update();
}

// Find opens empty, as in Dia, rather than with the last search in it.
// (Text selected on the page still fills it in: Firefox does that just
// after this.)
function clearFindBarOnOpen(event) {
	const findbar = event.target;
	if (findbar?.localName !== "findbar") {
		return;
	}
	// (not findbar.clear(): that collapses the page's selection too, which
	// Firefox is about to read)
	try {
		const field = findbar._findField;
		if (field?.value) {
			field.value = "";
			field.editor?.clearUndoRedo();
			findbar._updateStatusUI?.();
			findbar._enableFindButtons?.(false);
		}
	} catch (err) {
		noteError("find bar: clearFindBarOnOpen", err);
	}
}

// On macOS Firefox fills a find bar that opens with nothing selected from
// the system's shared find clipboard, the last search made anywhere: so it
// reopened with that search in it. Opened with nothing selected, it starts
// empty; text selected on the page still fills it in.
function skipClipboardPrefill(findbar) {
	if (!findbar || findbar.__ziaNoClipboardPrefill || typeof findbar.onCurrentSelection !== "function") {
		return;
	}
	findbar.__ziaNoClipboardPrefill = true;
	const original = findbar.onCurrentSelection;
	findbar.onCurrentSelection = function(selectionString, isInitialSelection) {
		if (!isInitialSelection || selectionString) {
			return original.call(this, selectionString, isInitialSelection);
		}
		// Firefox's own steps for an empty opening, minus the clipboard
		try {
			if (!this._startFindDeferred) {
				return undefined;
			}
			this._findField.value = "";
			this._enableFindButtons(false);
			this._findField.select();
			this._findField.focus();
			this._startFindDeferred.resolve();
			this._startFindDeferred = null;
			return undefined;
		} catch (err) {
			noteError("find bar: skipClipboardPrefill", err);
			return original.call(this, selectionString, isInitialSelection);
		}
	};
}

function dressFindBar(findbar) {
	shortenFindCount(findbar);
	skipClipboardPrefill(findbar);
}

function watchFindBars() {
	window.addEventListener("findbaropen", clearFindBarOnOpen, true);
	gBrowser.tabContainer.addEventListener("TabFindInitialized", (event) => {
		dressFindBar(gBrowser.getCachedFindBar?.(event.target));
	});
	for (const tab of gBrowser.tabs) {
		if (gBrowser.isFindBarInitialized?.(tab)) {
			dressFindBar(gBrowser.getCachedFindBar(tab));
		}
	}
}

watchFindBars();

// Extracted from Zia by z1n-k; MIT licensed.
// Zia PiP
(() => {
	const PIP_PLAYER_URL = "chrome://global/content/pictureinpicture/player.xhtml";
	const PIP_SCRIPT_URL = "chrome://sine/content/bubble-clean-zen/scripts/zia-pip.js";

	function decoratePipWindow(win) {
		try {
			if (win.__ziaPipLoaded || win.location?.href !== PIP_PLAYER_URL) {
				return;
			}
			Services.scriptloader.loadSubScript(PIP_SCRIPT_URL, win);
		} catch (err) {
			console.error("[pip-tuck] Couldn't set up picture-in-picture:", err);
		}
	}

	const observer = (subject, topic) => {
		if (topic !== "domwindowopened") {
			return;
		}
		subject.addEventListener("load", () => setTimeout(() => decoratePipWindow(subject), 0), {
			once: true
		});
	};
	Services.ww.registerNotification(observer);
	window.addEventListener("unload", () => Services.ww.unregisterNotification(observer));
	for (const win of Services.wm.getEnumerator("Toolkit:PictureInPicture")) {
		decoratePipWindow(win);
	}

	// Defaults (the feature reads these prefs)
	const defaults = Services.prefs.getDefaultBranch("");
	defaults.setBoolPref("zia.pip.dia-style", true);
	defaults.setBoolPref("zia.pip.tuck", true);
	defaults.setStringPref("zia.pip.tuck-spot", "nearest"); // nearest | left | right | bottom | bottom-left | bottom-right
	Services.prefs.setBoolPref("media.videocontrols.picture-in-picture.improved-video-controls.enabled", true);
})();