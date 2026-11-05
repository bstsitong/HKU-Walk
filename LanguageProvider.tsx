import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLanguage, isLanguage, Language, setCurrentLanguage, translate } from './localization';

const Context = createContext({ language: getLanguage(), chooseLanguage: (_: Language) => {} });
const storageKey = 'hku-walk.language.v1';
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getLanguage());
  const changes = useRef(0);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey).then(value => {
      if (active && changes.current === 0 && isLanguage(value)) { setCurrentLanguage(value); setLanguage(value); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const chooseLanguage = (next: Language) => {
    changes.current++;
    setCurrentLanguage(next); setLanguage(next);
    writes.current = writes.current.then(() => AsyncStorage.setItem(storageKey, next)).catch(() => {
      Alert.alert(translate('语言暂时无法保存'), translate('本次切换仍然有效，重新打开后请检查语言设置。'));
    });
  };
  return <Context.Provider value={{ language, chooseLanguage }}>{children}</Context.Provider>;
}
export const useLanguage = () => useContext(Context);
