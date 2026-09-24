// checklist.md model. The file stays the source of truth: every edit is a
// minimal line-level rewrite so agents' formatting (tabs vs spaces, ==marks==,
// notes between items) survives untouched.

export interface ChecklistItem {
  line: number; // 0-based line index in the file
  depth: number; // 0 = top level
  checked: boolean;
  text: string;
  section: number;
  /** Line index of the last descendant (== line when it has no children). */
  endLine: number;
  childCount: number;
}

export interface ChecklistNote {
  line: number;
  text: string;
  section: number;
}

export interface ChecklistSection {
  title: string | null;
  level: number;
  line: number; // heading line, -1 for the implicit first section
  items: ChecklistItem[];
  notes: ChecklistNote[];
  done: number;
  total: number;
}

export interface Checklist {
  sections: ChecklistSection[];
  done: number;
  total: number;
  indentUnit: string;
}

const ITEM_RE = /^([ \t]*)[-*+] \[( |x|X)\] ?(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

function splitLines(src: string): string[] {
  return src.split('\n');
}

function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === '\t' ? 4 : 1;
  return w;
}

function detectIndentUnit(lines: string[]): string {
  for (const l of lines) {
    const m = ITEM_RE.exec(l.replace(/\r$/, ''));
    if (m && m[1].length > 0) {
      if (m[1].startsWith('\t')) return '\t';
      return m[1].length >= 4 ? '    ' : '  ';
    }
  }
  return '\t';
}

export function parseChecklist(src: string): Checklist {
  const lines = splitLines(src);
  const sections: ChecklistSection[] = [];
  let current: ChecklistSection = { title: null, level: 0, line: -1, items: [], notes: [], done: 0, total: 0 };
  sections.push(current);

  // Stack of indentation widths → depth, so mixed tabs/2/4 spaces all work.
  let stack: number[] = [];
  const all: ChecklistItem[] = [];

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const h = HEADING_RE.exec(line);
    if (h) {
      current = { title: h[2], level: h[1].length, line: i, items: [], notes: [], done: 0, total: 0 };
      sections.push(current);
      stack = [];
      return;
    }
    const m = ITEM_RE.exec(line);
    if (m) {
      const w = indentWidth(m[1]);
      while (stack.length && stack[stack.length - 1] > w) stack.pop();
      if (!stack.length || stack[stack.length - 1] < w) stack.push(w);
      const depth = stack.length - 1;
      const item: ChecklistItem = {
        line: i,
        depth,
        checked: m[2] !== ' ',
        text: m[3],
        section: sections.length - 1,
        endLine: i,
        childCount: 0,
      };
      current.items.push(item);
      all.push(item);
      current.total++;
      if (item.checked) current.done++;
      return;
    }
    if (line.trim()) {
      current.notes.push({ line: i, text: line.trim(), section: sections.length - 1 });
    }
  });

  // Descendant ranges.
  for (const sec of sections) {
    const items = sec.items;
    for (let a = 0; a < items.length; a++) {
      let b = a + 1;
      while (b < items.length && items[b].depth > items[a].depth) b++;
      items[a].childCount = b - a - 1;
      items[a].endLine = items[b - 1].line;
    }
  }

  const visible = sections.filter((s) => s.title !== null || s.items.length || s.notes.length);
  return {
    sections: visible,
    done: all.filter((x) => x.checked).length,
    total: all.length,
    indentUnit: detectIndentUnit(lines),
  };
}

export function toggleItem(src: string, line: number): string {
  const lines = splitLines(src);
  const l = lines[line];
  if (l == null) return src;
  const m = /^([ \t]*[-*+] \[)( |x|X)(\].*)$/s.exec(l);
  if (!m) return src;
  lines[line] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3];
  return lines.join('\n');
}

export function setItemText(src: string, line: number, text: string): string {
  const lines = splitLines(src);
  const l = lines[line];
  if (l == null) return src;
  const cr = l.endsWith('\r') ? '\r' : '';
  const m = /^([ \t]*[-*+] \[[ xX]\] ?)/.exec(l);
  if (!m) return src;
  lines[line] = m[1] + text + cr;
  return lines.join('\n');
}

/** Remove an item together with all of its sub-items. */
export function deleteItem(src: string, item: Pick<ChecklistItem, 'line' | 'endLine'>): string {
  const lines = splitLines(src);
  lines.splice(item.line, item.endLine - item.line + 1);
  return lines.join('\n');
}

/**
 * Insert a new unchecked item. With `parent`, it becomes that item's last
 * child; otherwise it is appended at the end of the section.
 */
export function addItem(
  src: string,
  list: Checklist,
  sectionIndex: number,
  text: string,
  parent?: ChecklistItem,
): string {
  const lines = splitLines(src);
  const crlf = lines.some((l) => l.endsWith('\r')) ? '\r' : '';
  const sec = list.sections[sectionIndex];
  let at: number;
  let indent = '';
  if (parent) {
    at = parent.endLine + 1;
    const parentWs = /^([ \t]*)/.exec(lines[parent.line])![1];
    indent = parentWs + list.indentUnit;
  } else if (sec && sec.items.length) {
    at = sec.items[sec.items.length - 1].line + 1;
    const top = sec.items.find((i) => i.depth === 0) ?? sec.items[0];
    indent = /^([ \t]*)/.exec(lines[top.line])![1];
  } else if (sec && sec.line >= 0) {
    at = sec.line + 1;
  } else {
    at = lines.length;
    while (at > 0 && lines[at - 1].trim() === '') at--;
  }
  lines.splice(at, 0, `${indent}- [ ] ${text}${crlf}`);
  return lines.join('\n');
}

/** Append a new `## title` section at the end of the file. */
export function addSection(src: string, title: string): string {
  const trimmed = src.replace(/\s+$/, '');
  const crlf = src.includes('\r\n') ? '\r\n' : '\n';
  return `${trimmed}${trimmed ? crlf + crlf : ''}## ${title}${crlf}`;
}
