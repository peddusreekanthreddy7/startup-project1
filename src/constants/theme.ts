import { Platform } from 'react-native';

export const Colors = {
  dark: {
    text: '#FFFCF2',
    textSecondary: '#CCC5B9',
    background: '#0A0A0A',
    surface: '#252422',
    surfaceLight: '#2E2C2A',
    primary: '#EB5E28',
    primaryHover: '#D4521F',
    border: '#3A3836',
    borderLight: '#4A4745',
    error: '#EF4444',
    success: '#10B981',
    warning: '#F59E0B',
  },
  light: {
    text: '#FFFCF2',
    textSecondary: '#CCC5B9',
    background: '#0A0A0A',
    surface: '#252422',
    surfaceLight: '#2E2C2A',
    primary: '#EB5E28',
    primaryHover: '#D4521F',
    border: '#3A3836',
    borderLight: '#4A4745',
    error: '#EF4444',
    success: '#10B981',
    warning: '#F59E0B',
  }
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

export type ThemeColor = keyof typeof Colors.dark;

