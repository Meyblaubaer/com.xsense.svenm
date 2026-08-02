'use strict';

class LatestValueQueue {
  constructor(handler, delayMs = 50) {
    this.handler = handler;
    this.delayMs = delayMs;
    this.timer = null;
    this.pendingValue = undefined;
  }

  push(value) {
    this.pendingValue = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const pendingValue = this.pendingValue;
      this.pendingValue = undefined;
      this.timer = null;
      this.handler(pendingValue);
    }, this.delayMs);
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingValue = undefined;
  }
}

module.exports = LatestValueQueue;
