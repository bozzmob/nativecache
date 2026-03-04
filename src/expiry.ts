import { MinHeap } from "./structures/min_heap";

export type ExpireCallback = (key: string, at: number) => void;

export class ExpiryScheduler {
  private heap = new MinHeap();
  private scheduledAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private nextAt: number | null = null;

  constructor(private onExpire: ExpireCallback) {}

  schedule(key: string, at: number): void {
    this.scheduledAt.set(key, at);
    this.heap.push({ key, at });
    this.scheduleNext();
  }

  cancel(key: string): void {
    if (!this.scheduledAt.has(key)) return;
    this.scheduledAt.delete(key);
    this.scheduleNext();
  }

  clear(): void {
    this.heap.clear();
    this.scheduledAt.clear();
    this.clearTimer();
  }

  stop(): void {
    this.clearTimer();
  }

  private scheduleNext(): void {
    const next = this.nextLiveItem();
    if (!next) {
      this.clearTimer();
      return;
    }
    if (this.nextAt !== null && this.nextAt <= next.at && this.timer) return;

    this.clearTimer();
    const delay = Math.max(0, next.at - Date.now());
    this.nextAt = next.at;
    this.timer = setTimeout(() => this.tick(), Math.min(delay, 0x7fffffff));
  }

  private tick(): void {
    this.clearTimer();
    const now = Date.now();
    let top = this.nextLiveItem();
    while (top && top.at <= now) {
      const item = this.heap.pop();
      if (!item) break;
      if (this.scheduledAt.get(item.key) === item.at) {
        this.scheduledAt.delete(item.key);
        this.onExpire(item.key, item.at);
      }
      top = this.nextLiveItem();
    }
    this.scheduleNext();
  }

  private nextLiveItem(): { key: string; at: number } | undefined {
    let top = this.heap.peek();
    while (top) {
      if (this.scheduledAt.get(top.key) === top.at) return top;
      this.heap.pop();
      top = this.heap.peek();
    }
    return undefined;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextAt = null;
  }
}
