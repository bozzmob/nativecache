export function normalizeIndex(index: number, length: number): number {
  if (index < 0) return length + index;
  return index;
}

export function normalizeRange(
  start: number,
  stop: number,
  length: number
): [number, number] | null {
  if (length === 0) return null;
  let startIndex = normalizeIndex(start, length);
  let stopIndex = normalizeIndex(stop, length);

  if (startIndex < 0) startIndex = 0;
  if (stopIndex < 0) stopIndex = 0;
  if (startIndex >= length) return null;
  if (stopIndex >= length) stopIndex = length - 1;
  if (startIndex > stopIndex) return null;

  return [startIndex, stopIndex];
}
