import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, font, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { openItemMenu } from '../state/actions';
import { lore } from '../kb/bridge';
import { basename, fileKind, formatSize, longDate, relTime, wordCount } from '../kb/paths';
import { Avatar, Btn, Hover, Icon, IconBtn, InfoStrip, Kbd } from '../ui/primitives';
import { Markdown, extractHeadings } from '../ui/Markdown';
import { anchorBelow } from '../ui/overlays';
import { EmptyState, FileBar, Rail, RailHeading, useFile, useLinkHandler, useWidth } from './common';

export function DocumentScreen({ path }: { path: string }) {
  const app = useApp();
  const { file, error } = useFile(path);
  const { onLink, resolveMention } = useLinkHandler(path);
  const readOnly = fileKind(path) === 'index';
  const { width, onLayout } = useWidth();
  const showRail = width > 980;
  const scrollRef = useRef<ScrollView>(null);
  const headingY = useRef(new Map<number, number>());
  const [activeHeading, setActiveHeading] = useState(0);
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const moreRef = useRef<View>(null);

  const headings = useMemo(() => (file ? extractHeadings(file.content).filter((h) => h.depth <= 3) : []), [file]);
  const events = app.activity.filter((a) => a.path === path);

  // "Citato da": files that link to or mention this one.
  useEffect(() => {
    let live = true;
    const name = basename(path);
    lore.search(name).then((rs) => {
      if (live) setBacklinks(rs.filter((r) => r.path !== path && r.hits.length).map((r) => r.path).slice(0, 8));
    });
    return () => {
      live = false;
    };
  }, [path, app.revision]);

  useEffect(() => {
    headingY.current.clear();
    setActiveHeading(0);
  }, [path]);

  if (error) return <EmptyState icon="error" title="Impossibile aprire il file" body={error} />;
  if (!file) return <View style={{ flex: 1 }} />;

  const author = file.author === 'you' ? 'da te' : 'da un agente';
  const subtitle = readOnly ? 'Generato · sola lettura' : `${formatSize(file.size)} · modificato ${relTime(file.mtime)} ${author}`;

  // Heading offsets are relative to the markdown root; add its own offset + padding.
  const padTop = readOnly ? 28 : 40;
  const yOf = (line: number) => {
    const y = headingY.current.get(line);
    return y == null ? null : y + (headingY.current.get(-1) ?? 0) + padTop;
  };

  const onScroll = (e: any) => {
    const y = e.nativeEvent.contentOffset.y + 80;
    let idx = 0;
    headings.forEach((h, i) => {
      const hy = yOf(h.line);
      if (hy != null && hy <= y) idx = i;
    });
    setActiveHeading(idx);
  };

  const scrollTo = (line: number) => {
    const y = yOf(line);
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  };

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <FileBar title={basename(path)} subtitle={subtitle}>
        <IconBtn icon="ios_share" title="Copia link" onPress={() => app.ops.copyLink(path)} />
        {readOnly ? (
          <Btn icon="lock" label="Sola lettura" textColor={c.ink3} disabled style={{ opacity: 1 }} />
        ) : (
          <>
            <View ref={moreRef}>
              <IconBtn
                icon="more_horiz"
                onPress={() => {
                  const a = anchorBelow(moreRef.current);
                  openItemMenu(app, path, a.x + a.width - 250, a.y);
                }}
              />
            </View>
            <Btn variant="tint" icon="edit" label="Modifica" kbd="E" onPress={() => app.navigate({ name: 'file', path, edit: true })} />
          </>
        )}
      </FileBar>

      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingHorizontal: 48 }}>
          <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', paddingTop: readOnly ? 28 : 40, paddingBottom: 60 }}>
            {readOnly ? (
              <InfoStrip icon="lock" style={{ marginBottom: 28, paddingVertical: 12, paddingHorizontal: 16 }}>
                <Text style={t(400, 13, 1.45, { color: c.ink2 })}>Indice compilato dagli agenti. Non modificabile — cambia i file sorgente e verrà rigenerato.</Text>
              </InfoStrip>
            ) : null}
            {file.content.trim() ? (
              <View onLayout={(e) => headingY.current.set(-1, e.nativeEvent.layout.y)}>
                <Markdown
                  source={file.content}
                  onLink={onLink}
                  resolveMention={resolveMention}
                  onHeadingLayout={(line, y) => headingY.current.set(line, y)}
                />
              </View>
            ) : (
              <Hover onPress={() => !readOnly && app.navigate({ name: 'file', path, edit: true })} style={{ paddingVertical: 40, alignItems: 'center', gap: 8 }}>
                <Icon name="draft" size={28} color={c.ink3} />
                <Text style={t(400, 14, 1.4, { color: c.ink3 })}>File vuoto{readOnly ? '' : ' — premi E per scrivere'}</Text>
              </Hover>
            )}
          </View>
        </ScrollView>

        {showRail ? (
          <Rail>
            {readOnly ? (
              <>
                <RailHeading>Generazione</RailHeading>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  {file.author === 'you' ? <Avatar initials="TU" size={28} /> : <Avatar initials="AG" size={28} color={c.purple} />}
                  <View>
                    <Text style={t(500, 13, 1.3)}>{file.author === 'you' ? 'Tu' : 'Agente'}</Text>
                    <Text style={t(400, 11.5, 1.3, { color: c.ink3 })}>{relTime(file.mtime)}</Text>
                  </View>
                </View>
                <Text style={t(400, 12.5, 1.8, { color: c.ink2, marginBottom: 16 })}>
                  {wordCount(file.content)} parole{'\n'}
                  {formatSize(file.size)}
                </Text>
                <Btn
                  icon="difference"
                  label="Vedi modifica"
                  disabled={!events.length}
                  onPress={() => app.navigate({ name: 'activity', id: events[0]?.id })}
                  style={{ width: '100%' }}
                />
              </>
            ) : (
              <>
                {headings.length ? (
                  <>
                    <RailHeading>In questa pagina</RailHeading>
                    <View style={{ marginBottom: 26 }}>
                      {headings.map((h, i) => {
                        const on = i === activeHeading;
                        return (
                          <Hover key={h.line} onPress={() => scrollTo(h.line)}>
                            {({ hovered }) => (
                              <Text
                                numberOfLines={2}
                                style={[
                                  t(on ? 500 : 400, 12.5, 1.3, { color: on ? c.purpleTint : hovered ? c.ink : c.ink2 }),
                                  { paddingVertical: 6, marginLeft: -12, paddingLeft: 10 + (h.depth > 1 ? 12 : 0) + (h.depth > 2 ? 10 : 0), borderLeftWidth: 2, borderColor: on ? c.purple : 'transparent' },
                                ]}
                              >
                                {h.text}
                              </Text>
                            )}
                          </Hover>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                {backlinks.length ? (
                  <>
                    <RailHeading>Citato da</RailHeading>
                    <View style={{ gap: 8, marginBottom: 26 }}>
                      {backlinks.map((b) => (
                        <Hover key={b} onPress={() => app.navigate({ name: 'file', path: b })} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Icon name={fileKind(b) === 'index' ? 'auto_awesome' : fileKind(b) === 'checklist' ? 'checklist' : 'description'} size={15} color={fileKind(b) === 'index' ? c.info : c.ink3} />
                          <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12, color: c.purpleTint, flex: 1 }}>
                            {basename(b)}
                          </Text>
                        </Hover>
                      ))}
                    </View>
                  </>
                ) : null}
                <RailHeading>Dettagli</RailHeading>
                <Text style={t(400, 12.5, 1.8, { color: c.ink2 })}>
                  Creato {longDate(file.birthtime || file.mtime)}
                  {'\n'}
                  {events.length} {events.length === 1 ? 'revisione' : 'revisioni'} registrate
                  {'\n'}
                  {wordCount(file.content)} parole
                </Text>
                <View style={{ flex: 1 }} />
                <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 24, padding: 10, borderRadius: radius.md, backgroundColor: c.fill04 }, web({ userSelect: 'none' })]}>
                  <Kbd>E</Kbd>
                  <Text style={t(400, 11.5, 1.3, { color: c.ink3 })}>modifica · doppio clic nell’albero</Text>
                </View>
              </>
            )}
          </Rail>
        ) : null}
      </View>
    </View>
  );
}
