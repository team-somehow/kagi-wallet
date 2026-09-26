// Kagi design tokens. True black ground (OLED, hardware), warm phosphor white
// for everything that is fine, amber for anything that needs a human, red for
// revoke. No green: quiet is the absence of colour.
export const colors = {
  ground: '#000000',
  panel: '#111316',
  raised: '#1B1E23',
  line: '#26292F',
  text: '#ECE9E1',
  muted: '#8E939B',
  faint: '#585D65',
  amber: '#FFB13B',
  amberInk: '#2A1D08',
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
export const radius = { s: 4, m: 8 } as const;
