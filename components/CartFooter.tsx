import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { THEME, SPACING } from '../lib/theme';

type Props = {
  subtotal: number;
  commission?: number;
  total: number;
  onPayCash: () => void;
  onPayTransfer: () => void;
};

export default function CartFooter({ subtotal, commission = 0, total, onPayCash, onPayTransfer }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.totals}>
        <Text style={styles.label}>Subtotal</Text>
        <Text style={styles.value}>${subtotal.toFixed(2)}</Text>
        <Text style={styles.label}>Commission</Text>
        <Text style={styles.value}>${commission.toFixed(2)}</Text>
        <Text style={styles.label}>Total</Text>
        <Text style={styles.total}>${total.toFixed(2)}</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, styles.cash]} onPress={onPayCash}>
          <Text style={styles.btnText}>Pagar en efectivo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.transfer]} onPress={onPayTransfer}>
          <Text style={[styles.btnText, { color: THEME.colors.primary }]}>Pagar por transferencia</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: SPACING.medium,
    backgroundColor: THEME.colors.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.outline,
  },
  totals: {
    marginBottom: SPACING.small,
  },
  label: {
    color: THEME.colors.muted,
  },
  value: {
    fontWeight: '600',
    marginBottom: 6,
  },
  total: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME.colors.text,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  btn: {
    flex: 1,
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  cash: {
    backgroundColor: THEME.colors.primary,
  },
  transfer: {
    backgroundColor: THEME.colors.surface,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  btnText: {
    color: THEME.colors.onPrimary,
    fontWeight: '700',
  },
});