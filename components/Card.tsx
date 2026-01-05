import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TouchableOpacity, StyleProp } from 'react-native';
import { THEME, SPACING } from '../lib/theme';

export type CardVariant = 'raised' | 'surface' | 'outlined';

interface CardProps {
  children?: React.ReactNode;
  title?: string;
  subtitle?: string;
  variant?: CardVariant;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export default function Card({
  children,
  title,
  subtitle,
  variant = 'raised',
  onPress,
  style,
}: CardProps) {
  const Container = onPress ? TouchableOpacity : View;

  return (
    <Container
      activeOpacity={onPress ? 0.8 : 1}
      onPress={onPress}
      style={[styles.base, getVariantStyle(variant), style]}
    >
      {title ? <Text style={[styles.title, variant === 'raised' ? styles.titleRaised : undefined]}>{title}</Text> : null}
      {subtitle ? <Text style={[styles.subtitle, variant === 'raised' ? styles.subtitleRaised : undefined]}>{subtitle}</Text> : null}
      {children}
    </Container>
  );
}

function getVariantStyle(variant: CardVariant): ViewStyle {
  switch (variant) {
    case 'outlined':
      return {
        backgroundColor: THEME.colors.surface,
        borderColor: THEME.colors.outline,
        borderWidth: 1,
      };
    case 'surface':
      return {
        backgroundColor: THEME.colors.surface,
      };
    case 'raised':
    default:
      return {
        backgroundColor: THEME.colors.surface,
        ...THEME.shadow,
      } as ViewStyle;
  }
}

const styles = StyleSheet.create({
  base: {
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: THEME.colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.small,
  },
  titleRaised: {
    color: THEME.colors.text,
  },
  subtitleRaised: {
    color: THEME.colors.textSecondary,
  },
});