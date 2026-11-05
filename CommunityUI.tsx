import { ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Pressable, Text, TextInput } from './ui';

export function Button({ label, onPress, busy = false, secondary = false, disabled = false }: {
  label: string; onPress: () => void; busy?: boolean; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled, busy }} disabled={busy || disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, (pressed || busy || disabled) && s.dim]}>
    {busy ? <ActivityIndicator color={secondary ? '#184d3e' : '#fff'} /> : null}
    <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
  </Pressable>;
}
export function Field({ label, hint, style, ...props }: ComponentProps<typeof TextInput> & { label: string; hint?: string }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text>
    {hint ? <Text style={s.hint}>{hint}</Text> : null}
    <TextInput accessibilityLabel={label} placeholderTextColor="#657468" selectionColor="#184d3e"
      style={[s.input, props.multiline && s.multiline, style]} {...props} />
  </View>;
}
const s = StyleSheet.create({
  field: { marginTop: 18 }, label: { color: '#203a31', fontSize: 14, fontWeight: '700', lineHeight: 23 },
  hint: { color: '#637169', fontSize: 12, lineHeight: 20 },
  input: { color: '#203a31', backgroundColor: '#fff', borderWidth: 1, borderColor: '#bccbbd', borderRadius: 10, minHeight: 50, padding: 12, fontSize: 15, marginTop: 7 },
  multiline: { minHeight: 145, lineHeight: 24 },
  button: { minHeight: 50, borderRadius: 11, backgroundColor: '#184d3e', paddingHorizontal: 15, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 16 },
  secondary: { backgroundColor: '#eaf1e8' }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' }, secondaryText: { color: '#184d3e' }, dim: { opacity: 0.55 },
});
