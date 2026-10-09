

const THROTTLE_MS = 50;
const SETTLE_MS = 80;

export class ZiaSplitChild extends JSWindowActorChild {
  #lastSent = 0;
  #trailingTimer = null;

  handleEvent(event) {
    switch (event.type) {
      case "scroll":
        this.#onScroll();
        break;
      case "DOMContentLoaded":
      case "pageshow":
        this.#onPageShown();
        break;
    }
  }

  #onScroll() {
    const now = Date.now();
    if (now - this.#lastSent >= THROTTLE_MS) {
      this.#sendScroll(now);
    }
    this.contentWindow?.clearTimeout(this.#trailingTimer);
    this.#trailingTimer = this.contentWindow?.setTimeout(() => this.#sendScroll(Date.now()), SETTLE_MS);
  }

  #sendScroll(now) {
    this.#lastSent = now;
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    try {
      this.sendAsyncMessage("ZiaSplit:Scrolled", { x: win.scrollX, y: win.scrollY });
    } catch (err) {
    }
  }

  #onPageShown() {
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    win.requestAnimationFrame(() =>
      win.requestAnimationFrame(() => {
        try {
          this.sendAsyncMessage("ZiaSplit:Painted", {});
        } catch (err) {
        }
      })
    );
  }

  didDestroy() {
    this.contentWindow?.clearTimeout(this.#trailingTimer);
  }
}
