// Natsumi PDF viewer: loads content/pdfjs-viewer.css (Natsumi Browser's
// pdfjs.css by Green, @greeeen-dev, MIT) into Firefox's PDF viewer.
// The viewer is a page of its own, not part of Zen's window, so the sheet is
// added to the page from here.

// Same session-changing query as this module, so an update is never shown
// with last session's styles.
const SHEET_URL =
  "chrome://sine/content/bubble-clean-zen/content/pdfjs-viewer.css" + new URL(import.meta.url).search;

export function styleNatsumiPdf(win) {
  const doc = win.document;
  if (doc.documentElement.classList.contains("natsumiPdf")) {
    return;
  }
  try {
    win.windowUtils.loadSheetUsingURIString(SHEET_URL, win.windowUtils.USER_SHEET);
    doc.documentElement.classList.add("natsumiPdf");
  } catch (err) {
    console.error("[natsumi-pdf] stylesheet", err);
  }
}
