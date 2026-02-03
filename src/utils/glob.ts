const REGEX_SPECIAL = /[\\^$.*+?()[\]{}|]/g;

function escapeRegex(value: string): string {
  return value.replace(REGEX_SPECIAL, "\\$&");
}

export function globToRegExp(pattern: string): RegExp {
  let regex = "^";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern.charAt(i);

    if (char === "\\") {
      const next = pattern.charAt(i + 1);
      if (next) {
        regex += escapeRegex(next);
        i += 2;
        continue;
      }
    }

    if (char === "*") {
      regex += ".*";
      i += 1;
      continue;
    }

    if (char === "?") {
      regex += ".";
      i += 1;
      continue;
    }

    if (char === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        regex += "\\[";
        i += 1;
        continue;
      }
      const raw = pattern.slice(i + 1, end);
      const negated = raw.startsWith("!") || raw.startsWith("^");
      const content = negated ? raw.slice(1) : raw;
      const safe = escapeRegex(content).replace(/\\-/g, "-");
      regex += negated ? `[^${safe}]` : `[${safe}]`;
      i = end + 1;
      continue;
    }

    regex += escapeRegex(char);
    i += 1;
  }

  regex += "$";
  return new RegExp(regex);
}

export function matchGlob(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}
