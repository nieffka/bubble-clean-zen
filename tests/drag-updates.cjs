const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Exercise the actual drag functions with a controllable animation clock.
const source = fs.readFileSync(path.join(__dirname, "../zia-split-tabs.uc.js"), "utf8");
const frames = new Map();
const timers = [];
const elements = new Map();
let nextFrame = 0, writes = 0, toggles = 0, reads = 0;
const images = [], splits = [];
function element() {
  const attrs = new Map(), styles = new Map();
  return {
    style: {
      setProperty(k, v) { writes++; styles.set(k, v); },
      getPropertyValue: k => styles.get(k) || "",
    },
    setAttribute(k, v) { attrs.set(k, v); },
    getAttribute: k => attrs.get(k),
    hasAttribute: k => attrs.has(k),
    removeAttribute(k) { attrs.delete(k); },
    toggleAttribute(k, on) { toggles++; on ? attrs.set(k, "") : attrs.delete(k); },
    append(...children) { children.forEach(c => this.appendChild(c)); },
    appendChild(child) { if (child.id) elements.set(child.id, child); },
    addEventListener() {},
    remove() { elements.delete(this.id); },
  };
}
const root = element();
const box = { left: 200, top: 50, right: 1200, bottom: 850, width: 1000, height: 800 };
const tab = { ...element(), label: "Dragged tab", isConnected: true };
const target = { ...element(), isConnected: true };
const original = [element(), 20, 20];
const dataTransfer = { updateDragImage: (...args) => images.push(args) };
const event = (x, y = 350) => ({
  clientX: x, clientY: y, dataTransfer, preventDefault() {}, stopPropagation() {},
});
const context = vm.createContext({
  document: {
    documentElement: root,
    createElementNS: element,
    createXULElement: element,
    getElementById: id => elements.get(id),
  },
  window: { innerWidth: 1300, gZenViewSplitter: { splitTabs: (...args) => splits.push(args) } },
  gBrowser: {
    selectedTab: target,
    tabbox: { getBoundingClientRect() { reads++; return box; } },
    tabContainer: { tabDragAndDrop: { originalDragImageArgs: original, clearDragOverVisuals() {} } },
  },
  Services: { zen: { playHapticFeedback() {} } },
  requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
  cancelAnimationFrame: id => frames.delete(id),
  setTimeout: fn => timers.push(fn),
  console,
});
vm.runInContext(source.slice(0, source.indexOf("  function start() {")) +
  "\n globalThis.api = { splitDrop, showSplitDrop, followDrag, hideSplitDrop, onSplitDrop };\n})();", context);
const api = context.api;
function paint() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(fn => fn());
}
function open() {
  api.splitDrop.target = target;
  api.showSplitDrop(tab, event(300));
  api.followDrag(event(300), true);
  paint(); paint();
}
open();
assert.equal(images.length, 1, "Native preview is installed once");
const readBaseline = reads, writeBaseline = writes, toggleBaseline = toggles;
for (let i = 0; i < 100; i++) api.followDrag(event(310 + i, 400), true);
assert.equal(frames.size, 1, "Rapid input queues only one visual frame");
assert.equal(writes, writeBaseline, "Drag events perform no zone style writes");
paint();
assert.equal(reads, readBaseline, "Moving within the page does not measure layout");
assert.equal(toggles, toggleBaseline, "Staying on one side does not retoggle state");
assert.ok(writes - writeBaseline <= 2, "Only the active offsets change");
const left = api.splitDrop.zones.left;
assert.equal(left.style.getPropertyValue("--zia-zone-tx"), "-5.5px", "Latest x wins");
assert.equal(left.style.getPropertyValue("--zia-zone-ty"), "-17.5px", "Latest y wins");
const stationaryWrites = writes;
api.followDrag(event(409, 400), true); paint();
assert.equal(writes, stationaryWrites, "Identical positions do not mutate styles");
assert.equal(images.length, 1, "Movement does not rebuild the native drag image");

// Drop at the opposite edge before its visual frame runs.
api.followDrag(event(1100), true);
api.onSplitDrop(event(1100));
assert.equal(frames.size, 0, "Dropping cancels pending movement");
assert.equal(api.splitDrop.bounds, null);
assert.equal(api.splitDrop.side, null);
timers.splice(0).forEach(fn => fn());
assert.equal(splits.length, 1);
assert.equal(splits[0][0][0], target);
assert.equal(splits[0][0][1], tab, "Release coordinates select the right split");
assert.equal(images.at(-1)[0], original[0], "Original preview is restored");

context.gBrowser.selectedTab = target;
open();
api.followDrag(event(1100), true);
api.onSplitDrop(event(700));
timers.splice(0).forEach(fn => fn());
assert.equal(splits.length, 1, "Dropping in the center cancels a stale edge target");

open();
api.followDrag(event(1100), true);
api.hideSplitDrop();
const afterCancel = writes;
paint();
assert.equal(writes, afterCancel, "Canceled frames cannot move a hidden panel");
assert.equal(api.splitDrop.frame, null);
console.log("Passed: burst coalescing, unchanged positions, native preview lifecycle, release targeting, center cancellation and cleanup.");
