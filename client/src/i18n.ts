import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import koCommon from '../../locales/ko/common.json';
import koAuth from '../../locales/ko/auth.json';
import koChat from '../../locales/ko/chat.json';
import koAgent from '../../locales/ko/agent.json';
import koAdmin from '../../locales/ko/admin.json';
import koError from '../../locales/ko/error.json';
import koHome from '../../locales/ko/home.json';

import enCommon from '../../locales/en/common.json';
import enAuth from '../../locales/en/auth.json';
import enChat from '../../locales/en/chat.json';
import enAgent from '../../locales/en/agent.json';
import enAdmin from '../../locales/en/admin.json';
import enError from '../../locales/en/error.json';
import enHome from '../../locales/en/home.json';

import jpCommon from '../../locales/jp/common.json';
import jpAuth from '../../locales/jp/auth.json';
import jpChat from '../../locales/jp/chat.json';
import jpAgent from '../../locales/jp/agent.json';
import jpAdmin from '../../locales/jp/admin.json';
import jpError from '../../locales/jp/error.json';
import jpHome from '../../locales/jp/home.json';

const resources = {
  ko: {
    common: koCommon,
    auth: koAuth,
    chat: koChat,
    agent: koAgent,
    admin: koAdmin,
    error: koError,
    home: koHome,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    chat: enChat,
    agent: enAgent,
    admin: enAdmin,
    error: enError,
    home: enHome,
  },
  jp: {
    common: jpCommon,
    auth: jpAuth,
    chat: jpChat,
    agent: jpAgent,
    admin: jpAdmin,
    error: jpError,
    home: jpHome,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS: 'common',
    ns: ['common', 'auth', 'chat', 'agent', 'admin', 'error', 'home'],
    fallbackLng: 'en',
    supportedLngs: ['ko', 'en', 'jp'],
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
