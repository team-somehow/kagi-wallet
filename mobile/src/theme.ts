// Kagi design tokens, light. Cool aluminium ground (the sticks' own material, not cream), ink
// for everything that is fine, deep amber for anything that needs a human, red for revoke.
// Deep blue marks infrared and the wrist. No green: quiet is the absence of colour.
export const colors = {
  ground: '#E9EDF1',
  panel: '#F8FAFC',
  raised: '#DDE3EA',
  line: '#CBD2DA',
  text: '#111820',
  muted: '#5C6674',
  faint: '#8A939F',
  amber: '#B35F17',
  amberInk: '#F3E4D5',
  blue: '#1C6296',
  blueInk: '#DCE9F4',
  red: '#C4302A',
  redInk: '#F6DEDA',
  /** Text on a filled button or chip (ink, amber or red fills). */
  onFill: '#FFFFFF',
} as const;

// The Kagi Wallet stick, from the app icon (assets/logo.png). Used wherever a stick is drawn.
export const BRAND = {
  case: '#0061DA',
  depth: '#01347D',
  lcd: '#071525',
  kanji: '#ACDFFC',
  wallet: '#0175FA',
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
