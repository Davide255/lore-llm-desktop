import React, { memo, useMemo } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import { Lexer, type Token, type Tokens } from 'marked';
import { c, font, radius, t, web } from '../theme';
import { Icon } from './primitives';

export interface Heading {
  depth: number;
  text: string;
  line: number;
}

export interface Block {
  token: Token;
  line: number; // 0-based start line
  endLine: number;
}

const countNl = (s: string) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};

/** Top-level blocks annotated with their source line range. */
export function lexBlocks(src: string): Block[] {
  const tokens = Lexer.lex(src, { gfm: true });
  const out: Block[] = [];
  let line = 0;
  for (const tok of tokens) {
    const n = countNl(tok.raw);
    out.push({ token: tok, line, endLine: line + Math.max(0, n - (tok.raw.endsWith('\n') ? 1 : 0)) });
    line += n;
  }
  return out;
}

export function extractHeadings(src: string): Heading[] {
  return lexBlocks(src)
    .filter((b) => b.token.type === 'heading')
    .map((b) => ({ depth: (b.token as Tokens.Heading).depth, text: plain((b.token as Tokens.Heading).tokens), line: b.line }));
}

function plain(tokens?: Token[]): string {
  if (!tokens) return '';
  return tokens.map((x) => ('tokens' in x && x.tokens ? plain(x.tokens) : 'text' in x ? String(x.text) : '')).join('');
}

// ---------------------------------------------------------------------------

export interface MarkdownProps {
  source: string;
  /** Highlight the block/list item containing this 0-based line. */
  activeLine?: number;
  /** Compact sizing for the editor preview pane. */
  compact?: boolean;
  onLink?: (href: string) => void;
  /** Turns plain `name.md` mentions into links when they resolve. */
  resolveMention?: (name: string) => string | null;
  onToggleTask?: (line: number) => void;
  onHeadingLayout?: (line: number, y: number) => void;
  onBlockLayout?: (line: number, y: number) => void;
}

const S = {
  h1: t(700, 30, 1.2, { letterSpacing: -0.96, marginBottom: 14 }),
  h2: t(600, 19, 1.3, { letterSpacing: -0.38, marginTop: 28, marginBottom: 10 }),
  h3: t(600, 16, 1.35, { letterSpacing: -0.2, marginTop: 22, marginBottom: 8 }),
  h4: t(600, 14.5, 1.35, { marginTop: 18, marginBottom: 6, color: c.ink78 }),
  p: t(400, 15.5, 1.65, { color: c.ink78, letterSpacing: -0.155, marginBottom: 14 }),
  li: t(400, 15.5, 1.6, { color: c.ink78, letterSpacing: -0.155 }),
};

export const Markdown = memo(function Markdown(props: MarkdownProps) {
  const blocks = useMemo(() => lexBlocks(props.source), [props.source]);
  return (
    <View>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} first={i === 0 || (i === 1 && blocks[0].token.type === 'space')} {...props} />
      ))}
    </View>
  );
});

function BlockView({ block, first, ...p }: { block: Block; first: boolean } & MarkdownProps) {
  const tok = block.token;
  const active = p.activeLine != null && p.activeLine >= block.line && p.activeLine <= block.endLine;
  const hl = active && tok.type !== 'list' ? { backgroundColor: c.purple12, borderRadius: radius.sm, marginHorizontal: -8, paddingHorizontal: 8 } : null;
  const onLayout = p.onBlockLayout ? (e: any) => p.onBlockLayout!(block.line, e.nativeEvent.layout.y) : undefined;

  switch (tok.type) {
    case 'space':
      return null;
    case 'heading': {
      const h = tok as Tokens.Heading;
      const style = h.depth === 1 ? S.h1 : h.depth === 2 ? S.h2 : h.depth === 3 ? S.h3 : S.h4;
      const size = p.compact && h.depth === 1 ? { fontSize: 26, lineHeight: 31 } : null;
      return (
        <View
          onLayout={(e) => {
            p.onHeadingLayout?.(block.line, e.nativeEvent.layout.y);
            onLayout?.(e);
          }}
          style={hl}
        >
          <Text style={[style, size, first && { marginTop: 0 }]}>
            <Inline tokens={h.tokens} {...p} />
          </Text>
        </View>
      );
    }
    case 'paragraph': {
      const para = tok as Tokens.Paragraph;
      return (
        <View onLayout={onLayout} style={hl}>
          <Text style={S.p}>
            <Inline tokens={para.tokens} {...p} />
          </Text>
        </View>
      );
    }
    case 'list':
      return (
        <View onLayout={onLayout} style={{ marginBottom: 14 }}>
          <ListView list={tok as Tokens.List} startLine={block.line} depth={0} {...p} />
        </View>
      );
    case 'blockquote': {
      const q = tok as Tokens.Blockquote;
      return (
        <View onLayout={onLayout} style={[{ paddingVertical: 14, paddingHorizontal: 18, backgroundColor: c.cell, borderRadius: radius.lg, marginBottom: 14 }, active && { backgroundColor: c.purple12 }]}>
          {q.tokens.map((inner, i) =>
            inner.type === 'paragraph' ? (
              <Text key={i} style={t(400, 15, 1.6, { color: c.ink2, marginBottom: i < q.tokens.length - 1 ? 8 : 0 })}>
                <Inline tokens={(inner as Tokens.Paragraph).tokens} {...p} />
              </Text>
            ) : (
              <BlockView key={i} block={{ token: inner, line: block.line, endLine: block.endLine }} first={false} {...p} activeLine={undefined} />
            ),
          )}
        </View>
      );
    }
    case 'code': {
      const code = tok as Tokens.Code;
      return (
        <View onLayout={onLayout} style={[{ paddingVertical: 14, paddingHorizontal: 18, borderRadius: radius.lg, backgroundColor: c.cell, marginBottom: 14 }, active && { backgroundColor: c.purple12 }]}>
          <Text style={web<TextStyle>({ fontFamily: font.mono, fontSize: 13, lineHeight: 22.75, color: c.ink2, whiteSpace: 'pre-wrap' })}>{code.text}</Text>
        </View>
      );
    }
    case 'table':
      return (
        <View onLayout={onLayout}>
          <TableView table={tok as Tokens.Table} {...p} />
        </View>
      );
    case 'hr':
      return <View style={{ height: 1, backgroundColor: c.hair, marginVertical: 22 }} />;
    case 'html':
      return (
        <View onLayout={onLayout}>
          <Text style={[S.p, { fontFamily: font.mono, fontSize: 13, color: c.ink3 }]}>{(tok as Tokens.HTML).text}</Text>
        </View>
      );
    default:
      return 'text' in tok ? (
        <View onLayout={onLayout} style={hl}>
          <Text style={S.p}>{String((tok as Tokens.Text).text)}</Text>
        </View>
      ) : null;
  }
}

function ListView({ list, startLine, depth, ...p }: { list: Tokens.List; startLine: number; depth: number } & MarkdownProps) {
  let line = startLine;
  const start = typeof list.start === 'number' ? list.start : 1;
  return (
    <View style={{ gap: 0 }}>
      {list.items.map((item, i) => {
        const itemLine = line;
        const n = countNl(item.raw);
        line += n;
        const end = itemLine + Math.max(0, n - (item.raw.endsWith('\n') ? 1 : 0));
        // Children lists sit inside item.tokens; locate the first nested list.
        const nestedIdx = item.tokens.findIndex((x) => x.type === 'list');
        const own = nestedIdx === -1 ? item.tokens : item.tokens.slice(0, nestedIdx);
        const rest = nestedIdx === -1 ? [] : item.tokens.slice(nestedIdx);
        const ownEnd = nestedIdx === -1 ? end : itemLine + countNl(own.map((x) => x.raw).join('')) - 1;
        const active = p.activeLine != null && p.activeLine >= itemLine && p.activeLine <= Math.max(itemLine, ownEnd);
        let childLine = itemLine + countNl(own.map((x) => x.raw).join(''));
        return (
          <View key={i}>
            <View
              style={[
                { flexDirection: 'row', gap: 10, marginBottom: 8 },
                active && { backgroundColor: c.purple12, borderRadius: radius.sm, marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 3, marginTop: -3, marginBottom: 5 },
              ]}
            >
              {item.task ? (
                <Text
                  onPress={p.onToggleTask ? () => p.onToggleTask!(itemLine) : undefined}
                  style={web({ cursor: p.onToggleTask ? 'pointer' : 'default', paddingTop: 3 })}
                >
                  <Icon name={item.checked ? 'check_circle' : 'radio_button_unchecked'} filled={item.checked} size={19} color={item.checked ? c.purpleTint : c.ink3} />
                </Text>
              ) : list.ordered ? (
                <Text style={[S.li, { color: c.purpleTint, minWidth: 18, fontVariant: ['tabular-nums'] }]}>{start + i}.</Text>
              ) : (
                <Text style={[S.li, { color: c.purpleTint }]}>•</Text>
              )}
              <Text style={[S.li, { flex: 1 }, item.task && item.checked ? { color: c.ink3, textDecorationLine: 'line-through' } : null]}>
                {own.map((x, j) => (
                  <React.Fragment key={j}>
                    {j > 0 ? '\n' : null}
                    <Inline tokens={'tokens' in x && x.tokens ? x.tokens : [x]} {...p} />
                  </React.Fragment>
                ))}
              </Text>
            </View>
            {rest.map((x, j) => {
              const l = childLine;
              childLine += countNl(x.raw);
              return x.type === 'list' ? (
                <View key={j} style={{ paddingLeft: 24 }}>
                  <ListView list={x as Tokens.List} startLine={l} depth={depth + 1} {...p} />
                </View>
              ) : (
                <BlockView key={j} block={{ token: x, line: l, endLine: l + countNl(x.raw) }} first={false} {...p} />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function TableView({ table, ...p }: { table: Tokens.Table } & MarkdownProps) {
  const cell = (tokens: Token[], head: boolean, key: number) => (
    <View key={key} style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 12, borderLeftWidth: key ? 1 : 0, borderColor: c.hair }}>
      <Text style={head ? t(600, 11, 1.3, { letterSpacing: 0.88, textTransform: 'uppercase', color: c.ink3 }) : t(400, 13.5, 1.5, { color: c.ink78 })}>
        <Inline tokens={tokens} {...p} />
      </Text>
    </View>
  );
  return (
    <View style={{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden', marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(250,249,245,.02)' }}>{table.header.map((h, i) => cell(h.tokens, true, i))}</View>
      {table.rows.map((r, ri) => (
        <View key={ri} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: c.hair }}>
          {r.map((x, i) => cell(x.tokens, false, i))}
        </View>
      ))}
    </View>
  );
}

/** A single line of inline markdown (checklist items, snippets). */
export function InlineMarkdown({ text, ...p }: { text: string } & Partial<MarkdownProps>) {
  const tokens = useMemo(() => Lexer.lexInline(text, { gfm: true }), [text]);
  return <Inline tokens={tokens} source={text} {...p} />;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------
const MARK_RE = /==([^=\n]+)==/g;
const MENTION_RE = /([\w\-./]*[\w-]\.md)\b/g;

function Inline({ tokens, ...p }: { tokens?: Token[] } & MarkdownProps): React.ReactElement | null {
  if (!tokens) return null;
  return (
    <>
      {tokens.map((tok, i) => (
        <InlineToken key={i} tok={tok} {...p} />
      ))}
    </>
  );
}

function InlineToken({ tok, ...p }: { tok: Token } & MarkdownProps): React.ReactElement | null {
  switch (tok.type) {
    case 'strong':
      return (
        <Text style={{ fontWeight: '700', color: c.ink }}>
          <Inline tokens={(tok as Tokens.Strong).tokens} {...p} />
        </Text>
      );
    case 'em':
      return (
        <Text style={{ fontStyle: 'italic' }}>
          <Inline tokens={(tok as Tokens.Em).tokens} {...p} />
        </Text>
      );
    case 'del':
      return (
        <Text style={{ textDecorationLine: 'line-through', color: c.ink3 }}>
          <Inline tokens={(tok as Tokens.Del).tokens} {...p} />
        </Text>
      );
    case 'codespan':
      return (
        <Text style={{ fontFamily: font.mono, fontSize: '0.86em' as unknown as number, color: c.ink, backgroundColor: c.fill07, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
          {decode((tok as Tokens.Codespan).text)}
        </Text>
      );
    case 'link': {
      const l = tok as Tokens.Link;
      return (
        <Text onPress={() => p.onLink?.(l.href)} style={web({ color: c.purpleTint, cursor: 'pointer' })}>
          <Inline tokens={l.tokens} {...p} />
        </Text>
      );
    }
    case 'image': {
      const im = tok as Tokens.Image;
      return (
        <Text onPress={() => p.onLink?.(im.href)} style={web({ color: c.purpleTint, cursor: 'pointer' })}>
          🖼 {im.text || im.href}
        </Text>
      );
    }
    case 'br':
      return <Text>{'\n'}</Text>;
    case 'text':
    case 'escape': {
      const x = tok as Tokens.Text;
      if ('tokens' in x && x.tokens && x.tokens.length) return <Inline tokens={x.tokens} {...p} />;
      return <RichText text={decode(x.text)} {...p} />;
    }
    case 'html':
      return <Text style={{ color: c.ink3 }}>{(tok as Tokens.HTML).text}</Text>;
    default:
      return 'text' in tok ? <Text>{decode(String((tok as Tokens.Text).text))}</Text> : null;
  }
}

/** Plain text with ==highlight== marks and `file.md` mentions. */
function RichText({ text, ...p }: { text: string } & MarkdownProps) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  const pushMentions = (s: string) => {
    if (!p.resolveMention) {
      parts.push(s);
      return;
    }
    let l = 0;
    for (const m of s.matchAll(MENTION_RE)) {
      const target = p.resolveMention(m[1]);
      if (!target) continue;
      if (m.index! > l) parts.push(s.slice(l, m.index));
      parts.push(
        <Text key={`m${k++}`} onPress={() => p.onLink?.(target)} style={web({ color: c.purpleTint, cursor: 'pointer' })}>
          {m[1]}
        </Text>,
      );
      l = m.index! + m[0].length;
    }
    if (l < s.length) parts.push(s.slice(l));
  };
  for (const m of text.matchAll(MARK_RE)) {
    if (m.index! > last) pushMentions(text.slice(last, m.index));
    parts.push(
      <Text key={`h${k++}`} style={{ backgroundColor: c.purple28, color: c.ink, borderRadius: 4, paddingHorizontal: 3 }}>
        {m[1]}
      </Text>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) pushMentions(text.slice(last));
  return <>{parts}</>;
}

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT[m] ?? m);
