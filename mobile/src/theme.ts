// Kagi design tokens. True black ground (OLED, hardware), warm phosphor white
// for everything that is fine, amber for anything that needs a human, red for
// revoke. No green: quiet is the absence of colour.
export const colors = {
  ground: '#0B0D11',
  panel: '#15181E',
  raised: '#24282F',
  line: '#292D34',
  text: '#F0EEE7',
  muted: '#A0A6B0',
  faint: '#585D65',
  amber: '#FFAC70',
  amberInk: '#36271F',
  blue: '#83D6EB',
  blueInk: '#152C36',
  red: '#FF5A4E',
  redInk: '#2C120F',
  onLight: '#000000',
} as const;

export const fonts = {
  sans: 'SchibstedGrotesk_400Regular',
  sansMedium: 'SchibstedGrotesk_500Medium',
  sansBold: 'SchibstedGrotesk_700Bold',
  mono: 'MartianMono_400Regular',
  monoBold: 'MartianMono_600SemiBold',
} as const;

export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 32, xxl: 48 } as const;
export const radius = { s: 10, m: 18 } as const;
