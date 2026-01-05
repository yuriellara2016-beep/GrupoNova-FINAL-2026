import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radii, typography } from '../lib/theme';

type Props = {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  label?: string;
};

export default function QuantityInput({ value, min = 0, max, onChange, label }: Props) {
  const clamp = (n: number) => {
    if (typeof max === 'number') return Math.max(min, Math.min(max, n));
    return Math.max(min, n);
  };

  const handleText = (t: string) => {
    const normalized = t.replace(/[\u2212\u2012\u2013\u2014]/g, '-');
    const parsed = parseInt(normalized, 10);
    if (Number.isNaN(parsed)) {
      onChange(min);
    } else {
      onChange(clamp(parsed));
    }
  };

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => onChange(clamp(value - 1))}>
          <Text style={styles.btnText}>-</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(value)}
          onChangeText={handleText}
        />
        <TouchableOpacity style={styles.btn} onPress={() => onChange(clamp(value + 1))}>
          <Text style={styles.btnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: spacing.sm },
  label: { fontSize: typography.subtitle, color: colors.textPrimary, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  btn: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  btnText: { fontSize: typography.subtitle, color: colors.textPrimary },
  input: {
    flex: 1,
    backgroundColor: 'white',
    borderColor: colors.outline,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});