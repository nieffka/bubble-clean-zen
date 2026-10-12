// Natsumi PDF viewer. The stylesheet (content/pdfjs-viewer.css) is Natsumi
// Browser's pdfjs.css by Green (@greeeen-dev), MIT licensed:
//   https://github.com/greeeen-dev/natsumi-browser
// This actor is adapted from Zia's ZiaPdfChild.sys.mjs (MIT, z1n-k): it spots
// Firefox's PDF viewer and gives it that stylesheet (NatsumiPdf.sys.mjs).
// Registered by bubble-clean.uc.js with a query string that changes every
// session, so Firefox never runs a cached older copy.

export class NatsumiPdfChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type !== "DOMContentLoaded") {
      return;
    }
    const doc = this.document;
    const win = this.contentWindow;
    if (!doc || !win) {
      return;
    }
    // Firefox's own viewer: its page runs from resource://pdf.js, which a
    // website's copy of PDF.js can't.
    let isViewer = false;
    try {
      isViewer =
        !!doc.getElementById("outerContainer") &&
        !!doc.getElementById("toolbarViewer") &&
        ((doc.nodePrincipal?.spec || "").startsWith("resource://pdf.js") ||
          !!doc.querySelector('script[src^="resource://pdf.js/"]'));
    } catch (err) {
      isViewer = false;
    }
    if (!isViewer) {
      return;
    }
    try {
      if (!Services.prefs.getBoolPref("natsumi.pdf-style.enabled", true)) {
        return;
      }
    } catch (err) {
      // no pref yet: on by default
    }
    try {
      const url = "chrome://sine/content/bubble-clean-zen/actors/NatsumiPdf.sys.mjs" + new URL(import.meta.url).search;
      ChromeUtils.importESModule(url).styleNatsumiPdf(win);
    } catch (err) {
      console.error("[natsumi-pdf]", err);
    }
  }
}
