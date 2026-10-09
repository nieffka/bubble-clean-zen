// Trim URL bar
(() => {
  "use strict";

  if (window.__bubbleTrimURLLoaded) {
    return;
  }

  window.__bubbleTrimURLLoaded = true;

  function trimURL() {
    const original = gURLBar?._zenTrimURL;

    if (typeof original !== "function" || original.__trimURL) {
      return;
    }

    const wrapped = function (url) {
      // Let Zen/Sine do its normal URL trimming first
      const trimmed = original.call(this, url);

      if (
        typeof trimmed !== "string" ||
        gURLBar.hasAttribute("breakout-extend")
      ) {
        return trimmed;
      }


      return trimmed
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "");
    };

    wrapped.__trimURL = true;

    gURLBar._zenTrimURL = wrapped;

    try {
      gURLBar.setURI();
    } catch (err) {}
  }

  function start() {
    trimURL();
  }

  if (window.gBrowserInit?.delayedStartupFinished) {
    start();
  } else {
    const observer = (subject) => {
      if (subject === window) {
        Services.obs.removeObserver(
          observer,
          "browser-delayed-startup-finished"
        );

        start();
      }
    };

    Services.obs.addObserver(
      observer,
      "browser-delayed-startup-finished"
    );
  }
})();
