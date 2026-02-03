export class Deque<T> {
  private buffer: Array<T | undefined>;
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(initialCapacity = 16) {
    const capacity = Math.max(4, initialCapacity);
    this.buffer = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  pushFront(value: T): void {
    this.ensureCapacity();
    this.head = (this.head - 1 + this.buffer.length) % this.buffer.length;
    this.buffer[this.head] = value;
    this.count += 1;
  }

  pushBack(value: T): void {
    this.ensureCapacity();
    this.buffer[this.tail] = value;
    this.tail = (this.tail + 1) % this.buffer.length;
    this.count += 1;
  }

  popFront(): T | undefined {
    if (this.count === 0) return undefined;
    const value = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.buffer.length;
    this.count -= 1;
    return value;
  }

  popBack(): T | undefined {
    if (this.count === 0) return undefined;
    this.tail = (this.tail - 1 + this.buffer.length) % this.buffer.length;
    const value = this.buffer[this.tail];
    this.buffer[this.tail] = undefined;
    this.count -= 1;
    return value;
  }

  get(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined;
    const actual = (this.head + index) % this.buffer.length;
    return this.buffer[actual];
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const value = this.get(i);
      if (value !== undefined) result.push(value);
    }
    return result;
  }

  clear(): void {
    this.buffer = new Array<T | undefined>(this.buffer.length);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  private ensureCapacity(): void {
    if (this.count < this.buffer.length) return;
    const next = new Array<T | undefined>(this.buffer.length * 2);
    for (let i = 0; i < this.count; i += 1) {
      next[i] = this.get(i);
    }
    this.buffer = next;
    this.head = 0;
    this.tail = this.count;
  }
}
