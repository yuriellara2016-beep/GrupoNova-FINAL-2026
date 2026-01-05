import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { initDb, createInventoryEntry, getProductStockInStore } from '../lib/db';
import { Product } from '../types';
import { THEME, SPACING } from '../lib/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface Store {
  id: string;
  name: string;
}

interface StockReassignmentModuleProps {
  visible: boolean;
  product: Product | null;
  stores: Store[];
  onClose: () => void;
  onReassignmentComplete: () => void;
}

export default function StockReassignmentModule({
  visible,
  product,
  stores,
  onClose,
  onReassignmentComplete,
}: StockReassignmentModuleProps) {
  const [reassignFromStore, setReassignFromStore] = useState<string | null>(null);
  const [reassignToStore, setReassignToStore] = useState<string | null>(null);
  const [reassignQuantity, setReassignQuantity] = useState('');
  const [storeStockMap, setStoreStockMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  // Load stock info when modal becomes visible and product changes
  useEffect(() => {
    if (visible && product) {
      loadStockInfo();
    }
  }, [visible, product, stores]);

  async function loadStockInfo() {
    try {
      setLoading(true);
      await initDb();
      
      const stockMap: Record<string, number> = {};
      for (const store of stores) {
        const qty = await getProductStockInStore(product!.id, store.id);
        stockMap[store.id] = qty;
      }
      
      setStoreStockMap(stockMap);

      // Auto-select origin store (first with stock > 0)
      const origin = stores.find(s => (stockMap[s.id] || 0) > 0)?.id || null;
      const destination = stores.find(s => s.id !== origin)?.id || null;
      
      setReassignFromStore(origin);
      setReassignToStore(destination);
      setReassignQuantity('');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo cargar el stock');
    } finally {
      setLoading(false);
    }
  }

  async function confirmReassignment() {
    try {
      // Validations
      if (!product || !reassignFromStore || !reassignToStore) {
        Alert.alert('Error', 'Seleccione producto, tienda de origen y tienda de destino');
        return;
      }

      if (reassignFromStore === reassignToStore) {
        Alert.alert('Error', 'La tienda de origen y destino deben ser diferentes');
        return;
      }

      const qty = parseFloat(reassignQuantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        Alert.alert('Error', 'Ingrese una cantidad válida (> 0)');
        return;
      }

      // Check available stock in origin
      const available = storeStockMap[reassignFromStore] || 0;
      if (available < qty) {
        Alert.alert(
          'Stock insuficiente',
          `Origen tiene ${available} unidades, no puede transferir ${qty}`
        );
        return;
      }

      setLoading(true);
      await initDb();

      // Create transfer_out from origin
      await createInventoryEntry({
        type: 'transfer_out',
        productId: product.id,
        quantity: qty,
        unitCost: product.costPrice || 0,
        paymentMethod: null,
        note: `Reasignación manual de ${product.name}`,
        storeId: reassignFromStore,
      });

      // Create transfer_in to destination
      await createInventoryEntry({
        type: 'transfer_in',
        productId: product.id,
        quantity: qty,
        unitCost: product.costPrice || 0,
        paymentMethod: null,
        note: `Reasignación recibida de ${product.name}`,
        storeId: reassignToStore,
        targetStoreId: reassignToStore,
      });

      const fromStoreName = stores.find(s => s.id === reassignFromStore)?.name || 'Tienda';
      const toStoreName = stores.find(s => s.id === reassignToStore)?.name || 'Tienda';

      Alert.alert(
        '✅ Transferencia realizada',
        `${qty} unidades de "${product.name}"\ntrasladadas de ${fromStoreName} a ${toStoreName}`
      );

      // Reset form
      setReassignFromStore(null);
      setReassignToStore(null);
      setReassignQuantity('');
      setStoreStockMap({});

      // Notify parent to refresh
      onReassignmentComplete();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo completar la reasignación');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <MaterialCommunityIcons name="close" size={24} color={THEME.colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>🔄 Reasignar Stock</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {product && (
            <View style={styles.productSection}>
              <Text style={styles.sectionLabel}>Producto</Text>
              <View style={styles.productCard}>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productSku}>SKU: {product.sku || 'N/A'}</Text>
                  <Text style={styles.productPrice}>
                    Precio Costo: ${product.costPrice?.toFixed(2) || '0.00'}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Stock per Store */}
          {stores.length > 0 && (
            <View style={styles.stockInfoSection}>
              <Text style={styles.sectionLabel}>Stock Actual por Tienda</Text>
              {stores.map(store => (
                <View key={store.id} style={styles.stockInfoRow}>
                  <Text style={styles.storeName}>{store.name}</Text>
                  <Text style={[
                    styles.stockValue,
                    (storeStockMap[store.id] || 0) > 0 ? styles.stockPositive : styles.stockZero
                  ]}>
                    {storeStockMap[store.id] || 0} unidades
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Origin Store Selection */}
          <View style={styles.selectionSection}>
            <Text style={styles.sectionLabel}>📤 De: Tienda de Origen</Text>
            <View style={styles.storeButtonsContainer}>
              {stores.map(store => (
                <TouchableOpacity
                  key={store.id}
                  style={[
                    styles.storeButton,
                    reassignFromStore === store.id && styles.storeButtonActive
                  ]}
                  onPress={() => setReassignFromStore(store.id)}
                >
                  <Text style={[
                    styles.storeButtonText,
                    reassignFromStore === store.id && styles.storeButtonTextActive
                  ]}>
                    {store.name}
                  </Text>
                  {reassignFromStore === store.id && (
                    <MaterialCommunityIcons name="check" size={16} color={THEME.colors.onPrimary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
            {reassignFromStore && (
              <Text style={styles.stockInfo}>
                Stock disponible: {storeStockMap[reassignFromStore] || 0} unidades
              </Text>
            )}
          </View>

          {/* Destination Store Selection */}
          <View style={styles.selectionSection}>
            <Text style={styles.sectionLabel}>📥 A: Tienda de Destino</Text>
            <View style={styles.storeButtonsContainer}>
              {stores.map(store => (
                <TouchableOpacity
                  key={store.id}
                  style={[
                    styles.storeButton,
                    reassignToStore === store.id && styles.storeButtonActive,
                    reassignFromStore === store.id && styles.storeButtonDisabled
                  ]}
                  onPress={() => reassignFromStore !== store.id && setReassignToStore(store.id)}
                  disabled={reassignFromStore === store.id}
                >
                  <Text style={[
                    styles.storeButtonText,
                    reassignToStore === store.id && styles.storeButtonTextActive
                  ]}>
                    {store.name}
                  </Text>
                  {reassignToStore === store.id && (
                    <MaterialCommunityIcons name="check" size={16} color={THEME.colors.onPrimary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Quantity Input */}
          <View style={styles.quantitySection}>
            <Text style={styles.sectionLabel}>Cantidad a Transferir</Text>
            <TextInput
              style={styles.quantityInput}
              placeholder="Ingrese cantidad"
              value={reassignQuantity}
              onChangeText={setReassignQuantity}
              keyboardType="numeric"
              editable={!loading}
              placeholderTextColor={THEME.colors.textSecondary}
            />
            {reassignQuantity && reassignFromStore && (
              <View style={styles.previewBox}>
                <Text style={styles.previewText}>
                  🔍 Previsualizando transferencia de {reassignQuantity} unidades
                </Text>
                {reassignFromStore && (
                  <>
                    <Text style={styles.previewDetail}>
                      • Desde: {stores.find(s => s.id === reassignFromStore)?.name}
                    </Text>
                    <Text style={styles.previewDetail}>
                      Stock actual: {storeStockMap[reassignFromStore] || 0}
                    </Text>
                    <Text style={styles.previewDetail}>
                      Stock después: {(storeStockMap[reassignFromStore] || 0) - parseInt(reassignQuantity)}
                    </Text>
                  </>
                )}
              </View>
            )}
          </View>

          {/* Info Box */}
          <View style={styles.infoBox}>
            <MaterialCommunityIcons name="information-outline" size={16} color="#0EA5E9" />
            <Text style={styles.infoText}>
              Esta operación creará un movimiento de transferencia que quedará registrado en el historial
            </Text>
          </View>
        </ScrollView>

        {/* Footer Buttons */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={styles.cancelButtonText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.confirmButton,
              (!reassignFromStore || !reassignToStore || !reassignQuantity || loading) && styles.confirmButtonDisabled
            ]}
            onPress={confirmReassignment}
            disabled={!reassignFromStore || !reassignToStore || !reassignQuantity || loading}
          >
            <Text style={styles.confirmButtonText}>
              {loading ? 'Procesando...' : '🔄 Confirmar Transferencia'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.medium,
    backgroundColor: THEME.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.outline,
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.medium,
  },
  productSection: {
    marginBottom: SPACING.large,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: SPACING.small,
  },
  productCard: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    padding: SPACING.medium,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  productInfo: {
    gap: SPACING.tiny,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  productSku: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  productPrice: {
    fontSize: 12,
    color: THEME.colors.primary,
    fontWeight: '600',
  },
  stockInfoSection: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    padding: SPACING.medium,
    marginBottom: SPACING.large,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  stockInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.small,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.outlineVariant,
  },
  storeName: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  stockValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  stockPositive: {
    color: '#10B981',
  },
  stockZero: {
    color: THEME.colors.textSecondary,
  },
  selectionSection: {
    marginBottom: SPACING.large,
  },
  storeButtonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  storeButton: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.tiny,
    paddingVertical: SPACING.medium,
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  storeButtonActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  storeButtonDisabled: {
    opacity: 0.4,
  },
  storeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  storeButtonTextActive: {
    color: THEME.colors.onPrimary,
  },
  stockInfo: {
    marginTop: SPACING.small,
    fontSize: 12,
    color: THEME.colors.textSecondary,
    fontStyle: 'italic',
  },
  quantitySection: {
    marginBottom: SPACING.large,
  },
  quantityInput: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.small,
    fontSize: 15,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  previewBox: {
    marginTop: SPACING.small,
    backgroundColor: '#FEF3C7',
    borderRadius: THEME.radii.md,
    padding: SPACING.small,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  previewText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
    marginBottom: SPACING.tiny,
  },
  previewDetail: {
    fontSize: 12,
    color: '#92400E',
    marginVertical: 2,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.small,
    padding: SPACING.medium,
    backgroundColor: '#E0F2FE',
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.large,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#0369A1',
    lineHeight: 16,
  },
  footer: {
    flexDirection: 'row',
    gap: SPACING.small,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.medium,
    backgroundColor: THEME.colors.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.outline,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: SPACING.medium,
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontWeight: '700',
    color: THEME.colors.text,
    fontSize: 14,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: SPACING.medium,
    backgroundColor: THEME.colors.primary,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontWeight: '700',
    color: THEME.colors.onPrimary,
    fontSize: 14,
  },
});