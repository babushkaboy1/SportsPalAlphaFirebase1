import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme as NavDarkTheme, DefaultTheme as NavLightTheme, Theme as NavTheme } from '@react-navigation/native';

export type ThemeMode = 'light' | 'dark' | 'system';

export type AppPalette = {
  isDark: boolean;
  background: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  primary: string; // accent for buttons/links/icons
  primaryStrong: string; // stronger shade for emphasis/pressed
  danger: string;
  tabBarBg: string;
  tabIconActive: string;
  tabIconInactive: string;
};

const DARK: AppPalette = {
  isDark: true,
  background: '#121212',
  card: '#1e1e1e',
  text: '#ffffff',
  muted: '#bdbdbd',
  border: '#2a2a2a',
  primary: '#1ae9ef',
  primaryStrong: '#13c6cc',
  danger: '#ff5a5f',
  tabBarBg: '#121212',
  tabIconActive: '#1ae9ef',
  tabIconInactive: '#cccccc',
};

// For light, keep a darker turquoise for contrast as requested
const LIGHT: AppPalette = {
  isDark: false,
  background: '#ffffff',
  card: '#f7f8fa',
  text: '#111111',
  muted: '#6b7280', // gray-500
  border: '#e5e7eb', // gray-200
  primary: '#007E84', // dark turquoise
  primaryStrong: '#00959c',
  danger: '#e11d48',
  tabBarBg: '#ffffff',
  tabIconActive: '#007E84',
  tabIconInactive: '#6b7280',
};

type ThemeContextValue = {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  theme: AppPalette;
  navTheme: NavTheme;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'themeMode';

function resolveMode(mode: ThemeMode, system: ColorSchemeName): 'light' | 'dark' {
  if (mode === 'system') return system === 'dark' ? 'dark' : 'light';
  return mode;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(Appearance.getColorScheme());

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setThemeModeState(saved);
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // React to system theme changes when in 'system' mode
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  // Persist on change
  const setThemeMode = (m: ThemeMode) => {
    setThemeModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  };

  const effective = resolveMode(themeMode, systemScheme);
  const theme = effective === 'dark' ? DARK : LIGHT;

  const navTheme: NavTheme = useMemo(() => {
    if (theme.isDark) {
      return {
        ...NavDarkTheme,
        colors: {
          ...NavDarkTheme.colors,
          background: theme.background,
          card: theme.card,
          primary: theme.primary,
          text: theme.text,
          border: theme.border,
        },
      };
    }
    return {
      ...NavLightTheme,
      colors: {
        ...NavLightTheme.colors,
        background: theme.background,
        card: theme.card,
        primary: theme.primary,
        text: theme.text,
        border: theme.border,
      },
    };
  }, [theme.isDark, theme.background, theme.card, theme.primary, theme.text, theme.border]);

  // Wait for initial load to avoid flicker
  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, theme, navTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
