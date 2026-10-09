

export class ZiaSplitParent extends JSWindowActorParent {
  receiveMessage(message) {
    const browser = this.browsingContext?.top?.embedderElement;
    const win = browser?.ownerGlobal;
    if (message.name === "ZiaSplit:Scrolled") {
      win?.ziaSplitOnPageScroll?.(browser, message.data);
    } else if (message.name === "ZiaSplit:Painted") {
      win?.ziaSplitOnPagePainted?.(browser);
    }
  }
}
