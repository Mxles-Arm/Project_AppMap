import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations, type Language } from './translations';

const KEY = 'loomap_language';

export function useLanguage() {
  const [language, setLanguageState] = useState<Language>('th');

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(saved => {
      if (saved === 'th' || saved === 'en') setLanguageState(saved);
    });
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    AsyncStorage.setItem(KEY, lang).catch(() => {});
  }, []);

  return { language, setLanguage, t: translations[language] };
}
