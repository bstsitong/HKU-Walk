import { ComponentProps, ReactNode, useContext } from 'react';
import { Alert as NativeAlert, Image as NativeImage, ImageProps, Pressable as NativePressable, PressableProps,
  Text as NativeText, TextInput as NativeTextInput, TextProps, type AccessibilityProps } from 'react-native';
import { useLanguage } from './LanguageProvider';
import { translate, t } from './localization';
import { colors } from './theme';
import { FormInputFocus } from './KeyboardLayout';

function accessibilityInLanguage(props: AccessibilityProps, language: ReturnType<typeof useLanguage>['language']) {
  return {
    accessibilityLabel: props.accessibilityLabel ? translate(props.accessibilityLabel, language) : undefined,
    accessibilityHint: props.accessibilityHint ? translate(props.accessibilityHint, language) : undefined,
    accessibilityValue: props.accessibilityValue ? { ...props.accessibilityValue,
      text: props.accessibilityValue.text ? translate(props.accessibilityValue.text, language) : undefined } : undefined,
  };
}

function childrenInLanguage(children: ReactNode, language: ReturnType<typeof useLanguage>['language']): ReactNode {
  if (typeof children === 'string') return translate(children, language);
  if (Array.isArray(children)) return children.map(child => childrenInLanguage(child, language));
  return children;
}
export function Text({ raw = false, children, ...props }: TextProps & { raw?: boolean }) {
  const { language } = useLanguage();
  return <NativeText {...props} {...accessibilityInLanguage(props, language)}>{raw ? children : childrenInLanguage(children, language)}</NativeText>;
}
export function TextInput({ onFocus, ...props }: ComponentProps<typeof NativeTextInput>) {
  const { language } = useLanguage();
  const revealInput = useContext(FormInputFocus);
  return <NativeTextInput placeholderTextColor={colors.muted} selectionColor={colors.green} {...props} {...accessibilityInLanguage(props, language)}
    onFocus={event => { onFocus?.(event); revealInput?.(); }}
    placeholder={props.placeholder ? translate(props.placeholder, language) : undefined} />;
}
export function Pressable(props: PressableProps) {
  const { language } = useLanguage();
  return <NativePressable {...props} {...accessibilityInLanguage(props, language)} />;
}
export function Image(props: ImageProps) {
  const { language } = useLanguage();
  return <NativeImage {...props} {...accessibilityInLanguage(props, language)} />;
}
export const Alert = {
  alert(...[title, message, buttons, options]: Parameters<typeof NativeAlert.alert>) {
    NativeAlert.alert(t(title ?? ''), message ? t(message) : message, buttons?.map(button => ({ ...button, text: button.text ? t(button.text) : button.text })), options);
  },
};
