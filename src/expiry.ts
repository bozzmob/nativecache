import { MinHeap } from "./structures/min_heap";

export type ExpireCallback = (key: string, at: number) => void;

export class ExpiryScheduler {
  private heap = new MinHeap();
  private timer: NodeJS.Timeout | null = null;
  private nextAt: number | null = null;

  constructor(private onExpire: ExpireCallback) {}

  schedule(key: string, at: number): void {
    this.heap.push({ key, at });
    this.scheduleNext();
  }

  clear(): void {
    this.heap.clear();
    this.clearTimer();
  }

  stop(): void {
    this.clearTimer();
  }

  private scheduleNext(): void {
    const next = this.heap.peek();
    if (!next) return;
    if (this.nextAt !== null && this.nextAt <= next.at && this.timer) return;

    this.clearTimer();
    const delay = Math.max(0, next.at - Date.now());
    this.nextAt = next.at;
    this.timer = setTimeout(() => this.tick(), Math.min(delay, 0x7fffffff));
  }

  private tick(): void {
    this.clearTimer();
    const now = Date.now();
    let top = this.heap.peek();
    while (top && top.at <= now) {
      const item = this.heap.pop();
      if (item) this.onExpire(item.key, item.at);
      top = this.heap.peek();
    }
    this.scheduleNext();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextAt = null;
  }
}
