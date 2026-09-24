import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { c, font, radius, shadow, t, web } from '../theme';
import { useApp, type MenuItem } from '../state/app';
import { Btn, Hover, Icon, kbdLabel } from './primitives';

/** Listen to keydown while mounted. Handlers run in reverse mount order so
 *  the top-most overlay gets Escape first. */
const keyStack: ((e: KeyboardEvent) => boolean | void)[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      for (let i = keyStack.length - 1; i >= 0; i--) {
        if (keyStack[i](e) === true) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    },
    true,
  );
}
export function useOverlayKeys(handler: (e: KeyboardEvent) => boolean | void, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const fn = (e: KeyboardEvent) => ref.current(e);
    keyStack.push(fn);
    return () => {
      const i = keyStack.indexOf(fn);
      if (i >= 0) keyStack.splice(i, 1);
    };
  }, [active]);
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
export function Scrim({ children, onDismiss, align = 'center', style }: { children: React.ReactNode; onDismiss?: () => void; align?: 'center' | 'top'; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.45)', alignItems: 'center', justifyContent: align === 'center' ? 'center' : 'flex-start', paddingTop: align === 'top' ? 90 : 0, zIndex: 50 },
        web({ backdropFilter: 'blur(4px)', animation: 'lore-fade .12s ease-out' }),
        style,
      ]}
    >
      <Pressable style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, web({ cursor: 'default' })]} onPress={onDismiss} />
      {children}
    </View>
  );
}

export function DialogFrame({
  width,
  children,
  onDismiss,
  onSubmit,
  align,
  style,
}: {
  width: number;
  children: React.ReactNode;
  onDismiss: () => void;
  onSubmit?: () => void;
  align?: 'center' | 'top';
  style?: StyleProp<ViewStyle>;
}) {
  useOverlayKeys((e) => {
    if (e.key === 'Escape') return onDismiss(), true;
    if (e.key === 'Enter' && !e.shiftKey && onSubmit && !(e.target instanceof HTMLTextAreaElement)) return onSubmit(), true;
  });
  const { width: ww } = useWindowDimensions();
  return (
    <Scrim onDismiss={onDismiss} align={align}>
      <View
        style={[
          { width: Math.min(width, ww - 48), backgroundColor: c.dialog, borderWidth: 1, borderColor: 'rgba(250,249,245,.12)', borderRadius: radius.xl },
          web({ boxShadow: shadow.pop, animation: 'lore-pop .14s ease-out' }),
          style,
        ]}
      >
        {children}
      </View>
    </Scrim>
  );
}

export function DialogTitle({ children, onClose }: { children: string; onClose?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 20, paddingHorizontal: 24, paddingBottom: 4 }}>
      <Text style={[t(600, 18, 1.3, { letterSpacing: -0.36 }), { flex: 1 }]}>{children}</Text>
      {onClose ? (
        <Hover onPress={onClose} style={({ hovered }) => ({ borderRadius: 6, padding: 2, backgroundColor: hovered ? c.fill07 : 'transparent' })}>
          <Icon name="close" size={19} color={c.ink3} />
        </Hover>
      ) : null}
    </View>
  );
}

export function DialogFooter({ children, border = true }: { children: React.ReactNode; border?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: border ? 1 : 0, borderColor: c.hair }}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Popup menu (context menus, dropdowns)
// ---------------------------------------------------------------------------
export function PopupMenuLayer() {
  const app = useApp();
  const m = app.menu;
  const { width: ww, height: wh } = useWindowDimensions();
  const [hover, setHover] = useState(-1);
  const items = m?.items ?? [];
  const actionable = items.map((it, i) => (it !== 'sep' && !it.disabled ? i : -1)).filter((i) => i >= 0);

  useEffect(() => setHover(-1), [m]);

  const close = () => app.setMenu(null);
  const run = (it: MenuItem) => {
    if (it === 'sep' || it.disabled) return;
    close();
    it.onPress();
  };

  useOverlayKeys(
    (e) => {
      if (e.key === 'Escape') return close(), true;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const pos = actionable.indexOf(hover);
        const next = e.key === 'ArrowDown' ? actionable[(pos + 1) % actionable.length] : actionable[(pos - 1 + actionable.length) % actionable.length];
        setHover(next ?? -1);
        return true;
      }
      if (e.key === 'Enter' && hover >= 0) return run(items[hover]), true;
    },
    !!m,
  );

  if (!m) return null;
  const width = m.width ?? 250;
  const estH = items.reduce((h, it) => h + (it === 'sep' ? 11 : 32), 10);
  const left = Math.max(8, Math.min(m.x, ww - width - 8));
  const top = m.y + estH > wh - 8 ? Math.max(8, m.y - estH) : m.y;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 }}>
      <Pressable
        style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, web({ cursor: 'default' })]}
        onPress={close}
        {...({ onContextMenu: (e: any) => (e.preventDefault(), close()) } as object)}
      />
      <View
        style={[
          { position: 'absolute', left, top, width, backgroundColor: c.menu, borderWidth: 1, borderColor: 'rgba(250,249,245,.12)', borderRadius: radius.lg, padding: 5 },
          web({ boxShadow: shadow.menu, animation: 'lore-pop .1s ease-out' }),
        ]}
      >
        {items.map((it, i) =>
          it === 'sep' ? (
            <View key={i} style={{ height: 1, backgroundColor: c.hair, marginVertical: 5, marginHorizontal: 4 }} />
          ) : (
            <Hover
              key={i}
              disabled={it.disabled}
              onPress={() => run(it)}
              onHoverIn={() => setHover(i)}
              onHoverOut={() => setHover((h) => (h === i ? -1 : h))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 32, paddingHorizontal: 10, borderRadius: 7, backgroundColor: hover === i ? (it.danger ? c.danger : c.purple) : 'transparent', opacity: it.disabled ? 0.4 : 1 }}
            >
              {it.icon ? <Icon name={it.icon} size={17} color={hover === i ? '#fff' : it.danger ? c.error : c.ink2} /> : it.checked != null ? <Icon name={it.checked ? 'check' : 'blank'} size={17} color={hover === i ? '#fff' : c.purpleTint} /> : null}
              <Text numberOfLines={1} style={[t(400, 13.5, 1, { color: hover === i ? '#fff' : it.danger ? c.error : c.ink }), { flex: 1 }]}>
                {it.label}
              </Text>
              {it.checked && it.icon ? <Icon name="check" size={16} color={hover === i ? '#fff' : c.purpleTint} /> : null}
              {it.kbd ? <Text style={{ fontFamily: font.mono, fontSize: 11.5, color: hover === i ? 'rgba(255,255,255,.75)' : c.ink3 }}>{kbdLabel(it.kbd)}</Text> : null}
            </Hover>
          ),
        )}
      </View>
    </View>
  );
}

/** Open a dropdown menu anchored below an element (RN-web refs are DOM nodes). */
export function anchorBelow(el: unknown, gap = 6): { x: number; y: number; width: number } {
  const r = (el as HTMLElement | null)?.getBoundingClientRect?.();
  if (!r) return { x: 100, y: 100, width: 250 };
  return { x: r.left, y: r.bottom + gap, width: r.width };
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function ToastLayer() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center', gap: 10, zIndex: 70 }}>
      {toasts.map((tt) => (
        <View
          key={tt.id}
          style={[
            { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: tt.action ? 12 : 13, paddingLeft: 18, paddingRight: tt.action ? 14 : 18, borderRadius: radius.card, backgroundColor: c.toast, borderWidth: 1, borderColor: c.hair },
            web({ boxShadow: shadow.toast, animation: 'lore-rise .18s ease-out' }),
          ]}
        >
          <Icon name={tt.icon} size={19} color={c.ink2} />
          <Text style={t(400, 13.5, 1.2)}>
            {tt.mono ? <Text style={{ fontFamily: font.mono }}>{tt.mono}</Text> : null}
            {tt.mono ? ' ' : ''}
            {tt.text}
          </Text>
          {tt.action ? (
            <Btn
              variant="tint"
              height={30}
              label={tt.action.label}
              kbd={tt.action.kbd}
              onPress={() => {
                dismissToast(tt.id);
                tt.action!.run();
              }}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}
