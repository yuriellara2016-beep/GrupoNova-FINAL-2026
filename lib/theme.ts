export const theme = {
  colors: {
    primary: '#0A84FF',
    onPrimary: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceVariant: '#F3F4F6',
    outline: '#E5E7EB',
    text: '#111827',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    muted: '#6B7280',
    background: '#F9FAFB',
    tertiary: '#10B981', // accent/confirm actions
    success: '#10B981', // success/positive actions
    error: '#DC2626',
  },
  spacing: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 32,
    // aliases used by some screens
    tiny: 6,
    small: 12,
    medium: 16,
    large: 24,
  },
  radii: {
    sm: 8,
    md: 12,
    lg: 16,
  },
  // border radius aliases for components that expect `borderRadius`
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
  },
  // simple cross-platform shadows
  shadows: {
    small: {
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    medium: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
  },
};

// Named exports used by various screens/components
export const THEME = {
  colors: theme.colors,
  radii: theme.radii,
  // expose both single shadow and full shadows map for compatibility
  shadow: theme.shadows.medium,
  shadows: theme.shadows,
};

// Common aliases used across different parts of the app.
// These are intentionally redundant to keep older screens working.
export const SPACING = {
  xs: theme.spacing.xs,
  sm: theme.spacing.sm,
  md: theme.spacing.md,
  lg: theme.spacing.lg,
  xl: theme.spacing.xl,
  tiny: theme.spacing.tiny,
  small: theme.spacing.small,
  medium: theme.spacing.medium,
  large: theme.spacing.large,
};

// Some screens/components expect these named exports.
// They are simple aliases to the canonical theme object.
export const COLORS = {
  ...theme.colors,
  // extra aliases frequently used in screens
  border: theme.colors.outline,
  warning: '#F59E0B',
};

export const colors = COLORS;
export const spacing = {
  ...theme.spacing,
  ...SPACING,
};
export const radii = theme.radii;

// Style-object typography used like: `...TYPOGRAPHY.h1`
export const TYPOGRAPHY = {
  h1: { fontSize: 28, fontWeight: '800' as const },
  h2: { fontSize: 22, fontWeight: '800' as const },
  h3: { fontSize: 18, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  button: { fontSize: 16, fontWeight: '700' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
};

// Numeric typography used like: `fontSize: typography.subtitle`
export const typography = {
  h1: 28,
  h2: 22,
  h3: 18,
  body: 16,
  subtitle: 14,
  caption: 12,
  button: 16,
};