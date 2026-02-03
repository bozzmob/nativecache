export interface HeapItem {
  at: number;
  key: string;
}

export class MinHeap {
  private items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): HeapItem | undefined {
    return this.items.length > 0 ? this.items[0]! : undefined;
  }

  push(item: HeapItem): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapItem | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  clear(): void {
    this.items = [];
  }

  private bubbleUp(index: number): void {
    const items = this.items;
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentItem = items[parent]!;
      const current = items[i]!;
      if (parentItem.at <= current.at) break;
      items[parent] = current;
      items[i] = parentItem;
      i = parent;
    }
  }

  private bubbleDown(index: number): void {
    const items = this.items;
    let i = index;
    const length = items.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;

      if (left < length) {
        const leftItem = items[left]!;
        const smallestItem = items[smallest]!;
        if (leftItem.at < smallestItem.at) {
          smallest = left;
        }
      }

      if (right < length) {
        const rightItem = items[right]!;
        const smallestItem = items[smallest]!;
        if (rightItem.at < smallestItem.at) {
          smallest = right;
        }
      }

      if (smallest === i) break;
      const current = items[i]!;
      items[i] = items[smallest]!;
      items[smallest] = current;
      i = smallest;
    }
  }
}
