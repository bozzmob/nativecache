import { normalizeRange } from "../utils/range";

export interface ZSetEntry {
  value: string;
  score: number;
}

export class SortedSet {
  private entries: ZSetEntry[] = [];
  private scores = new Map<string, number>();

  get size(): number {
    return this.scores.size;
  }

  add(items: ZSetEntry[]): number {
    let added = 0;
    for (const item of items) {
      if (!this.scores.has(item.value)) {
        added += 1;
        this.insert(item);
      } else {
        const previous = this.scores.get(item.value);
        if (previous !== item.score) {
          this.remove(item.value);
          this.insert(item);
        }
      }
    }
    return added;
  }

  remove(value: string): boolean {
    const score = this.scores.get(value);
    if (score === undefined) return false;
    const index = this.findIndex(value, score);
    if (index === -1) return false;
    this.entries.splice(index, 1);
    this.scores.delete(value);
    return true;
  }

  score(value: string): number | null {
    const score = this.scores.get(value);
    return score === undefined ? null : score;
  }

  incrBy(value: string, increment: number): number {
    const current = this.score(value) ?? 0;
    const next = current + increment;
    this.add([{ value, score: next }]);
    return next;
  }

  range(start: number, stop: number, rev: boolean): ZSetEntry[] {
    const length = this.entries.length;
    const range = normalizeRange(start, stop, length);
    if (!range) return [];
    const [startIndex, stopIndex] = range;

    if (!rev) {
      return this.entries.slice(startIndex, stopIndex + 1);
    }

    const revStart = length - 1 - startIndex;
    const revStop = length - 1 - stopIndex;
    const result: ZSetEntry[] = [];
    for (let i = revStart; i >= revStop; i -= 1) {
      const entry = this.entries[i];
      if (entry) result.push(entry);
    }
    return result;
  }

  rank(value: string, rev: boolean): number | null {
    const score = this.scores.get(value);
    if (score === undefined) return null;
    const index = this.findIndex(value, score);
    if (index === -1) return null;
    if (!rev) return index;
    return this.entries.length - 1 - index;
  }

  clear(): void {
    this.entries = [];
    this.scores.clear();
  }

  private insert(item: ZSetEntry): void {
    const index = this.findInsertIndex(item);
    this.entries.splice(index, 0, item);
    this.scores.set(item.value, item.score);
  }

  private findInsertIndex(item: ZSetEntry): number {
    let low = 0;
    let high = this.entries.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const midEntry = this.entries[mid]!;
      const compare = this.compare(item, midEntry);
      if (compare > 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private findIndex(value: string, score: number): number {
    let low = 0;
    let high = this.entries.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const entry = this.entries[mid]!;
      if (entry.score < score) {
        low = mid + 1;
      } else if (entry.score > score) {
        high = mid - 1;
      } else {
        let left = mid;
        while (left >= 0) {
          const leftEntry = this.entries[left];
          if (!leftEntry || leftEntry.score !== score) break;
          if (leftEntry.value === value) return left;
          left -= 1;
        }
        let right = mid + 1;
        while (right < this.entries.length) {
          const rightEntry = this.entries[right];
          if (!rightEntry || rightEntry.score !== score) break;
          if (rightEntry.value === value) return right;
          right += 1;
        }
        return -1;
      }
    }
    return -1;
  }

  private compare(a: ZSetEntry, b: ZSetEntry): number {
    if (a.score !== b.score) return a.score - b.score;
    if (a.value < b.value) return -1;
    if (a.value > b.value) return 1;
    return 0;
  }
}
