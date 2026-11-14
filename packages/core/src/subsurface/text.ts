/**
 * Line and string syntax of the Subsurface git storage.
 *
 * A file is a list of lines. A line may contain quoted strings, and a string may span several
 * lines: Subsurface writes a newline inside a string as "\n\t" (core/save-git.cpp, quote()), and
 * the reader joins a line break followed by a tab back into a newline (core/load-git.cpp,
 * parse_one_string()). Like Subsurface, the reader replaces each string in the line text by a
 * single '"' and hands the decoded strings over separately.
 */

/** quote() in core/save-git.cpp */
export function quote(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const code = c.charCodeAt(0);
    if ((code > 0 && code < 9) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      out += '?';
    } else if (c === '\\') {
      out += '\\\\';
    } else if (c === '"') {
      out += '\\"';
    } else if (c === '\n') {
      out += text[i + 1] === '\n' ? '\n' : '\n\t';
    } else {
      out += c;
    }
  }
  return out;
}

/** show_utf8(): prefix + quoted string + postfix. Subsurface writes empty strings too. */
export function quoted(prefix: string, value: string, postfix: string): string {
  return `${prefix}"${quote(value)}"${postfix}`;
}

export interface Line {
  /** The line with every string reduced to its opening '"'. */
  text: string;
  /** Decoded strings in order of appearance. */
  strings: string[];
}

/** parse_one_string(): returns the decoded string and the index after the closing quote. */
function parseString(content: string, start: number): [string, number] {
  const end = content.length;
  let s = '';
  let buf = start;
  let p = start;
  while (p < end) {
    const c = content[p++];
    let replace: string | null;
    if (c === '\n') {
      if (p < end && content[p] === '\t') replace = '\n';
      else continue;
    } else if (c === '\\') {
      if (p < end) replace = content[p]!;
      else continue;
    } else if (c === '"') {
      replace = null;
    } else {
      continue;
    }
    s += content.slice(buf, p - 1);
    if (replace === null) break;
    s += replace;
    buf = ++p;
  }
  return [s, p];
}

/**
 * for_each_line() / parse_one_line(): split a file into lines. Lines that start with a newline
 * or a tab are invalid (left over from a broken string) and skipped, as Subsurface does.
 */
export function splitLines(content: string): { lines: Line[]; skipped: string[] } {
  const lines: Line[] = [];
  const skipped: string[] = [];
  const end = content.length;
  let p = 0;
  while (p < end) {
    const start = p;
    if (content[p] === '\n' || content[p] === '\t') {
      while (p < end && content[p++] !== '\n');
      skipped.push(content.slice(start, p));
      continue;
    }
    let text = '';
    const strings: string[] = [];
    while (p < end) {
      const c = content[p++]!;
      if (c === '\n') break;
      text += c;
      if (c === '"') {
        const [s, next] = parseString(content, p);
        strings.push(s);
        p = next;
      }
    }
    lines.push({ text, strings });
  }
  return { lines, skipped };
}

/**
 * match_action(): the keyword is the leading run of lowercase letters and must be followed by
 * a space or the end of the line. Returns null for anything else (for example sample lines).
 */
export function splitKeyword(text: string): { keyword: string; rest: string } | null {
  let i = 0;
  while (i < text.length && text[i]! >= 'a' && text[i]! <= 'z') i++;
  if (i === 0) return null;
  if (i === text.length) return { keyword: text, rest: '' };
  if (text[i] !== ' ') return null;
  return { keyword: text.slice(0, i), rest: text.slice(i + 1) };
}

/** Hands out the strings of a line in order (pop_cstring() in core/load-git.cpp). */
export class StringQueue {
  private next = 0;
  private readonly strings: readonly string[];
  constructor(strings: readonly string[]) {
    this.strings = strings;
  }
  pop(): string {
    return this.strings[this.next++] ?? '';
  }
  get all(): readonly string[] {
    return this.strings;
  }
}

export interface KeyValue {
  key: string;
  value: string;
}

/** parse_keyvalue_entry() applied to the rest of a line: `key=value key="string" flag`. */
export function parseKeyValues(rest: string, strings: StringQueue): KeyValue[] {
  const out: KeyValue[] = [];
  let i = 0;
  const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  for (;;) {
    while (isSpace(rest[i])) i++;
    if (i >= rest.length) break;
    const keyStart = i;
    while (i < rest.length && !isSpace(rest[i]) && rest[i] !== '=') i++;
    const key = rest.slice(keyStart, i);
    let value = '';
    if (rest[i] === '=') {
      i++;
      const valueStart = i;
      while (i < rest.length && !isSpace(rest[i])) i++;
      const raw = rest.slice(valueStart, i);
      value = raw.startsWith('"') ? strings.pop() : raw;
    }
    out.push({ key, value });
  }
  return out;
}
