import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Product } from '../types';
import { THEME, SPACING } from '../lib/theme';

type Props = {
  visible: boolean;
  product: Product | null;
  onClose: () => void;
  onSave: (id: string, fields: Partial<Product>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
};

export default function ProductEditModal({ visible, product, onClose, onSave, onDelete }: Props) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState<string | null>(null);
  const [costPrice, setCostPrice] = useState('0');
  const [sellPrice, setSellPrice] = useState('0');
  const [quantity, setQuantity] = useState('0');
  const [chargeExtra, setChargeExtra] = useState(false);
  const [minStock, setMinStock] = useState('5');

  useEffect(() => {
    if (product) {
      setName(product.name ?? '');
      setSku(product.sku ?? null);
      setCostPrice(String(product.costPrice ?? 0));
      setSellPrice(String(product.sellPrice ?? 0));
      setQuantity(String(product.quantity ?? 0));
      setChargeExtra(!!product.chargeExtra10Percent);
      setMinStock(String(product.minStock ?? 5));
    }
  }, [product]);

  function handleSave() {
    if (!product) return;
    if (!name.trim()) return Alert.alert('Nombre requerido');
    const fields: Partial<Product> = {
      name: name.trim(),
      sku: sku ?? null,
      costPrice: parseFloat(costPrice) || 0,
      sellPrice: parseFloat(sellPrice) || 0,
      quantity: parseFloat(quantity) || 0,
      chargeExtra10Percent: !!chargeExtra,
      minStock: parseFloat(minStock) || 5,
    };
    Promise.resolve(onSave(product.id, fields)).catch(e => Alert.alert('Error', String(e)));
  }

  function handleDelete() {
    if (!product) return;
    Alert.alert('Eliminar producto', '¿Estás seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => Promise.resolve(onDelete(product.id)).catch(e => Alert.alert('Error', String(e))) }
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Editar producto</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Nombre" style={styles.input} />
          <TextInput value={sku ?? ''} onChangeText={t => setSku(t || null)} placeholder="SKU (opcional)" style={styles.input} />
          <View style={styles.row}>
            <TextInput value={costPrice} onChangeText={setCostPrice} placeholder="Costo" keyboardType="numeric" style={[styles.input, { flex: 1 }]} />
            <TextInput value={sellPrice} onChangeText={setSellPrice} placeholder="Venta" keyboardType="numeric" style={[styles.input, { flex: 1, marginLeft: SPACING.small }]} />
          </View>
          <View style={styles.row}>
            <TextInput value={quantity} onChangeText={setQuantity} placeholder="Cantidad" keyboardType="numeric" style={[styles.input, { flex: 1 }]} />
            <TextInput value={minStock} onChangeText={setMinStock} placeholder="Stock Mín" keyboardType="numeric" style={[styles.input, { flex: 1, marginLeft: SPACING.small }]} />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: SPACING.small }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: THEME.colors.tertiary }]} onPress={onClose}>
              <Text>Cerrar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: THEME.colors.error }]} onPress={handleDelete}>
              <Text style={{ color: '#fff' }}>Eliminar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: THEME.colors.primary }]} onPress={handleSave}>
              <Text style={{ color: THEME.colors.onPrimary }}>Guardar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: THEME.colors.surface, padding: SPACING.medium, borderTopLeftRadius: THEME.radii.md, borderTopRightRadius: THEME.radii.md },
  title: { fontSize: 18, fontWeight: '700', marginBottom: SPACING.small },
  input: { backgroundColor: THEME.colors.surfaceVariant, padding: SPACING.small, borderRadius: THEME.radii.sm, marginBottom: SPACING.small },
  row: { flexDirection: 'row' },
  btn: { padding: SPACING.small, borderRadius: THEME.radii.sm, alignItems: 'center', minWidth: 84 },
});