import React, { forwardRef } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { c, font, radius, shadow, t, web } from '../theme';

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent);
/** Modifier label: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl+';
export const SHIFT = isMac ? '⇧' : 'Shift+';
export const kbdLabel = (s: string) => (isMac ? s : s.replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌘/g, 'Ctrl+').replace(/⌫/g, 'Canc'));

/** Window coordinates of a mouse/press event (RN-web passes DOM events). */
export function eventPoint(e: any): { x: number; y: number } {
  const n = e?.nativeEvent ?? e;
  return { x: n?.clientX ?? n?.pageX ?? e?.clientX ?? 0, y: n?.clientY ?? n?.pageY ?? e?.clientY ?? 0 };
}

// ---------------------------------------------------------------------------
// Icon — Material Symbols Rounded, as in the Athly design system
// ---------------------------------------------------------------------------
export function Icon({
  name,
  size = 18,
  color = c.ink2,
  filled = false,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  filled?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      selectable={false}
      style={[
        web<TextStyle>({
          fontFamily: font.icon,
          fontSize: size,
          lineHeight: size,
          width: size,
          height: size,
          color,
          fontVariationSettings: `"FILL" ${filled ? 1 : 0}, "wght" 400, "GRAD" 0, "opsz" 24`,
          userSelect: 'none',
          overflow: 'hidden',
          flexShrink: 0,
        }),
        style,
      ]}
    >
      {name}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Hoverable pressable — RN-web reports `hovered` in the style callback
// ---------------------------------------------------------------------------
type HoverState = { hovered?: boolean; pressed: boolean; focused?: boolean };
export type HoverStyle = StyleProp<ViewStyle> | ((s: HoverState) => StyleProp<ViewStyle>);

export const Hover = forwardRef<View, Omit<PressableProps, 'style' | 'children'> & {
  style?: HoverStyle;
  children?: React.ReactNode | ((s: HoverState) => React.ReactNode);
  onContextMenu?: (e: any) => void;
  onDoubleClick?: (e: any) => void;
}>(function Hover({ style, children, onDoubleClick, ...rest }, ref) {
  const onPress = onDoubleClick
    ? (e: any) => ((e?.nativeEvent?.detail ?? 1) >= 2 ? onDoubleClick(e) : rest.onPress?.(e))
    : rest.onPress;
  return (
    <Pressable
      ref={ref}
      {...(rest as PressableProps)}
      onPress={onPress}
      style={(s) => [web({ cursor: rest.disabled ? 'default' : 'pointer', outlineStyle: 'none' }), typeof style === 'function' ? style(s as HoverState) : style]}
    >
      {children as any}
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Kbd
// ---------------------------------------------------------------------------
export function Kbd({ children, tone = 'default', style }: { children: string; tone?: 'default' | 'tint' | 'onPrimary'; style?: StyleProp<ViewStyle> }) {
  const bg = tone === 'tint' ? c.purple20 : tone === 'onPrimary' ? 'rgba(255,255,255,.18)' : c.fill08;
  const fg = tone === 'tint' ? c.purpleTint : tone === 'onPrimary' ? '#fff' : c.ink3;
  return (
    <View style={[{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, backgroundColor: bg }, style]}>
      <Text style={{ fontFamily: font.mono, fontWeight: '500', fontSize: 11, lineHeight: 11, color: fg }}>{kbdLabel(children)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
export type BtnVariant = 'primary' | 'tint' | 'ghost' | 'plain' | 'danger' | 'dangerText';

export function Btn({
  label,
  icon,
  iconRight,
  kbd,
  variant = 'ghost',
  onPress,
  disabled,
  height = 34,
  style,
  textColor,
}: {
  label?: string;
  icon?: string;
  iconRight?: string;
  kbd?: string;
  variant?: BtnVariant;
  onPress?: () => void;
  disabled?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
  textColor?: string;
}) {
  const v = {
    primary: { bg: c.purple, hover: c.purpleShade, fg: '#fff', kbd: 'onPrimary' as const },
    tint: { bg: c.purple16, hover: c.purple20, fg: c.purpleTint, kbd: 'tint' as const },
    ghost: { bg: c.fill07, hover: c.fill12, fg: c.ink, kbd: 'default' as const },
    plain: { bg: 'transparent', hover: c.fill06, fg: c.ink2, kbd: 'default' as const },
    danger: { bg: c.danger, hover: '#e2352b', fg: '#fff', kbd: 'onPrimary' as const },
    dangerText: { bg: 'transparent', hover: c.error13, fg: c.error, kbd: 'default' as const },
  }[variant];
  const fg = textColor ?? v.fg;
  return (
    <Hover
      onPress={onPress}
      disabled={disabled}
      style={({ hovered, pressed }) => [
        {
          height,
          paddingHorizontal: variant === 'dangerText' ? 10 : 14,
          borderRadius: radius.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          backgroundColor: hovered || pressed ? v.hover : v.bg,
          opacity: disabled ? 0.45 : 1,
        },
        variant === 'primary' && web({ boxShadow: shadow.primary }),
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={17} color={fg} /> : null}
      {label ? <Text style={t(600, 13, 1, { color: fg, whiteSpace: 'nowrap' } as TextStyle)}>{label}</Text> : null}
      {iconRight ? <Icon name={iconRight} size={17} color={fg} /> : null}
      {kbd ? <Kbd tone={v.kbd}>{kbd}</Kbd> : null}
    </Hover>
  );
}

export function IconBtn({
  icon,
  onPress,
  size = 34,
  iconSize = 19,
  color = c.ink2,
  active,
  title,
  disabled,
  style,
}: {
  icon: string;
  onPress?: () => void;
  size?: number | { w: number; h: number };
  iconSize?: number;
  color?: string;
  active?: boolean;
  title?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const w = typeof size === 'number' ? size : size.w;
  const h = typeof size === 'number' ? size : size.h;
  return (
    <Hover
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={title}
      {...({ title } as object)}
      style={({ hovered }) => [
        { width: w, height: h, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? c.purple16 : hovered ? c.fill07 : 'transparent', opacity: disabled ? 0.35 : 1 },
        style,
      ]}
    >
      <Icon name={icon} size={iconSize} color={active ? c.purpleTint : color} />
    </Hover>
  );
}

// ---------------------------------------------------------------------------
// Pill, Avatar, Progress, Toggle, Segmented, Hairline
// ---------------------------------------------------------------------------
export function Pill({ label, bg, fg, style, onPress }: { label: string; bg: string; fg: string; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const inner = <Text style={t(600, 11, 1.4, { color: fg, whiteSpace: 'nowrap' } as TextStyle)}>{label}</Text>;
  const base: ViewStyle = { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: bg, alignSelf: 'flex-start' };
  if (onPress)
    return (
      <Hover onPress={onPress} style={[base, style]}>
        {inner}
      </Hover>
    );
  return <View style={[base, style]}>{inner}</View>;
}

export function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Hover
      onPress={onPress}
      style={({ hovered }) => ({
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: active ? c.purple : hovered ? c.fill12 : c.fill07,
      })}
    >
      <Text style={t(600, 12, 1.4, { color: active ? '#fff' : c.ink2 })}>{label}</Text>
    </Hover>
  );
}

const AVATAR_COLORS: Record<string, string> = { CL: c.purple, CX: c.blue };
export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

export function Avatar({ name, initials, size = 22, color, ring }: { name?: string; initials?: string; size?: number; color?: string; ring?: string }) {
  const ini = initials ?? initialsOf(name ?? '?');
  const bg = color ?? AVATAR_COLORS[ini] ?? c.surface4;
  const fg = bg === c.surface4 ? c.ink2 : '#fff';
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
        ring ? web({ boxShadow: `0 0 0 2px ${ring}` }) : null,
      ]}
    >
      <Text style={t(700, Math.round(size * 0.37), 1, { color: fg })}>{ini}</Text>
    </View>
  );
}

export function Progress({ value, height = 4, style }: { value: number; height?: number; style?: StyleProp<ViewStyle> }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={[{ flex: 1, height, borderRadius: radius.pill, backgroundColor: c.fill12, overflow: 'hidden' }, style]}>
      <View style={[{ width: `${pct}%`, height: '100%' }, web({ backgroundImage: c.gradient, transition: 'width .25s' })]} />
    </View>
  );
}

export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Hover
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      style={[
        { width: 38, height: 22, borderRadius: radius.pill, padding: 2, flexDirection: 'row', justifyContent: value ? 'flex-end' : 'flex-start', backgroundColor: value ? c.purple : 'rgba(250,249,245,.16)' },
        web({ transition: 'background-color .2s' }),
      ]}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' }} />
    </Hover>
  );
}

export function Segmented<T extends string>({ options, value, onChange, width }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; width?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2, padding: 2, borderRadius: radius.md, backgroundColor: c.fill08, width }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Hover
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[{ flex: 1, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: on ? c.cell2 : 'transparent' }, on && web({ boxShadow: shadow.seg })]}
          >
            <Text style={t(500, 12.5, 1, { color: on ? c.ink : c.ink2 })}>{o.label}</Text>
          </Hover>
        );
      })}
    </View>
  );
}

export const Hairline = ({ vertical, style }: { vertical?: boolean; style?: StyleProp<ViewStyle> }) => (
  <View style={[vertical ? { width: 1, alignSelf: 'stretch', backgroundColor: c.hair } : { height: 1, backgroundColor: c.hair }, style]} />
);

export const VSep = () => <View style={{ width: 1, height: 18, backgroundColor: c.hair, marginHorizontal: 6 }} />;

export const Spacer = ({ w, h }: { w?: number; h?: number }) => <View style={{ width: w, height: h, flex: w == null && h == null ? 1 : undefined }} />;

export function SectionLabel({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3, marginBottom: 12 }), style]}>{children}</Text>;
}

export const Card = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ backgroundColor: c.cell, borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, padding: 18 }, style]}>{children}</View>
);

export function IconWell({ icon, tint = 'purple', size = 34 }: { icon: string; tint?: 'purple' | 'blue' | 'info' | 'neutral' | 'danger'; size?: number }) {
  const map = {
    purple: [c.purple18, c.purpleTint],
    blue: [c.blue18, c.blueTint],
    info: [c.info16, c.info],
    neutral: [c.surface4, c.purpleTint],
    danger: [c.danger14, c.error],
  }[tint];
  return (
    <View style={{ width: size, height: size, borderRadius: size > 36 ? 12 : radius.md, backgroundColor: map[0], alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name={icon} size={size > 36 ? 22 : 19} color={map[1]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Text field
// ---------------------------------------------------------------------------
export const Field = forwardRef<TextInput, TextInputProps & { icon?: string; iconColor?: string; suffix?: string; monoText?: boolean; invalid?: boolean }>(
  function Field({ icon, iconColor, suffix, monoText, invalid, style, onFocus, onBlur, ...rest }, ref) {
    const [focused, setFocused] = React.useState(false);
    return (
      <View
        style={[
          { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: c.fill05, borderWidth: 1, borderColor: invalid ? c.error : focused ? c.purple : c.hair },
          focused && web({ boxShadow: shadow.focus }),
        ]}
      >
        {icon ? <Icon name={icon} size={17} filled color={iconColor ?? c.blueTint} /> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={c.ink3}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            web<TextStyle>({ flex: 1, outlineStyle: 'none', color: c.ink, fontFamily: monoText ? font.mono : font.sf, fontSize: 14, caretColor: c.purpleTint, minWidth: 0 }),
            style as TextStyle,
          ]}
          {...rest}
        />
        {suffix ? <Text style={{ fontFamily: font.mono, fontSize: 14, color: c.ink3 }}>{suffix}</Text> : null}
      </View>
    );
  },
);

export function FieldLabel({ children }: { children: string }) {
  return <Text style={t(500, 12.5, 1, { color: c.ink2, marginBottom: 8 })}>{children}</Text>;
}

export function Hint({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'error' }) {
  return <Text style={t(400, 11.5, 1.3, { color: tone === 'error' ? c.error : c.ink3, marginTop: 7 })}>{children}</Text>;
}

/** Blue info strip used for index.md notices. */
export function InfoStrip({ icon = 'auto_awesome', children, style }: { icon?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, borderRadius: radius.lg, backgroundColor: c.info10 }, style]}>
      <Icon name={icon} size={17} color={c.info} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
