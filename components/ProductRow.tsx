import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Product } from '../types';
import { THEME, SPACING } from '../lib/theme';

type Props = {
  product: Product;
  onPress?: () => void;
  onToggleExtra?: (enabled: boolean) => void;
};

export default function ProductRow({ product, onPress, onToggleExtra }: Props) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.left}>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.sku}>{product.sku ?? ''}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.qty}>Qty: {product.quantity}</Text>
        <Text style={styles.price}>V: ${product.sellPrice.toFixed(2)}</Text>
        <View style={styles.extraRow}>
          <Text style={styles.extraLabel}>+10%</Text>
          <Switch value={!!product.chargeExtra10Percent} onValueChange={onToggleExtra} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    marginVertical: SPACING.small,
    borderRadius: THEME.radii.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...THEME.shadow,
  },
  left: {},
  right: {
    alignItems: 'flex-end',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  sku: {
    fontSize: 12,
    color: THEME.colors.muted,
  },
  qty: {
    fontSize: 13,
    color: THEME.colors.muted,
  },
  price: {
    fontWeight: '700',
    color: THEME.colors.primary,
  },
  extraRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  extraLabel: {
    marginRight: 8,
    color: THEME.colors.muted,
  },
});