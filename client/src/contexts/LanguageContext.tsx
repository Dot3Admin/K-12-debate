import { createContext, useContext, useEffect, ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

export type Language = 'ko' | 'en' | 'jp';

interface LanguageContextType {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: Record<string, any>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

interface LanguageProviderProps {
  children: ReactNode;
}

export const LanguageProvider = ({ children }: LanguageProviderProps) => {
  const { i18n: i18nInstance } = useTranslation();
  const [language, setLanguageState] = useState<Language>(() => {
    const savedLang = localStorage.getItem('i18nextLng');
    if (savedLang && ['ko', 'en', 'jp'].includes(savedLang)) {
      return savedLang as Language;
    }
    return (i18nInstance.language || 'en') as Language;
  });

  const setLanguage = (newLanguage: Language) => {
    i18nInstance.changeLanguage(newLanguage);
    setLanguageState(newLanguage);
  };

  const t = (key: string, params?: Record<string, any>): string => {
    if (key.includes(':')) {
      const [namespace, ...restParts] = key.split(':');
      const actualKey = restParts.join(':');
      return i18nInstance.t(actualKey, { ...params, ns: namespace });
    }
    
    const parts = key.split('.');
    if (parts.length < 2) {
      return i18nInstance.t(key, { ...params, ns: 'common' });
    }
    
    const namespace = parts[0];
    const actualKey = parts.slice(1).join('.');
    
    return i18nInstance.t(actualKey, { ...params, ns: namespace });
  };

  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      document.documentElement.lang = lng;
      setLanguageState(lng as Language);
    };

    i18nInstance.on('languageChanged', handleLanguageChange);
    
    const currentLang = i18nInstance.language;
    if (currentLang && currentLang !== language) {
      setLanguageState(currentLang as Language);
    }

    return () => {
      i18nInstance.off('languageChanged', handleLanguageChange);
    };
  }, [i18nInstance, language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};
