import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { THEME, SPACING } from '../lib/theme';
import { useAuthSafe } from '../lib/AuthContext';
import { useProductSearch } from '../hooks/useProductSearch';
import { getStores, getProductStockInStore, createInventoryEntry, initDb } from '../lib/db';
import { findProductByCode, getClassifiedProducts } from '../lib/classifiedProducts';
import { Store } from '../types';
import ProductSearchDropdown, { ClassifiedProductSuggestion } from '../components/ProductSearchDropdown';

type TransferItem = {
  id: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  fromStoreId: string;
  toStoreId: string;
  fromStockAvailable: number;
};

export default function ManualTransfersScreen() {
  const { user } = useAuthSafe();
  const [stores, setStores] = useState<Store[]>([]);
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state for new transfer
  const productSearch = useProductSearch({ debounceMs: 300 });
  const [selectedProduct, setSelectedProduct] = useState<ClassifiedProductSuggestion | null>(null);
  const [quantity, setQuantity] = useState('');
  const [fromStore, setFromStore] = useState<string | null>(null);
  const [toStore, setToStore] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      await initDb();
      const storesData = await getStores();
      const activeStores = storesData.filter(s => s.active);
      setStores(activeStores);
      
      if (activeStores.length > 0) {
        setFromStore(activeStores[0].id);
        if (activeStores.length > 1) {
          setToStore(activeStores[1].id);
        }
      }
    } catch (error) {
      console.warn('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectProduct(product: ClassifiedProductSuggestion) {
    setSelectedProduct(product);
    productSearch.setQuery(product.code);
    productSearch.setSuggestions([]);

    // Get available stock in the selected from-store
    if (fromStore) {
      try {
        // Find the real product ID from the classified product
        const classifiedProducts = await getClassifiedProducts();
        const classifiedProd = classifiedProducts.find(p => p.code === product.code);
        
        if (classifiedProd) {
          const availableStock = await getProductStockInStore(classifiedProd.id, fromStore);
          setSelectedProduct(prev => prev ? { ...prev, _id: classifiedProd.id } : product);
        }
      } catch (error) {
        console.warn('Error fetching stock:', error);
      }
    }
  }

  async function handleAddTransfer() {
    if (!selectedProduct) {
      Alert.alert('Error', 'Selecciona un producto del clasificador');
      return;
    }

    if (!quantity.trim() || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      Alert.alert('Error', 'Ingresa una cantidad válida mayor a 0');
      return;
    }

    if (!fromStore) {
      Alert.alert('Error', 'Selecciona tienda origen');
      return;
    }

    if (!toStore) {
      Alert.alert('Error', 'Selecciona tienda destino');
      return;
    }

    if (fromStore === toStore) {
      Alert.alert('Error', 'Las tiendas origen y destino deben ser diferentes');
      return;
    }

    try {
      // Get available stock
      const classifiedProducts = await getClassifiedProducts();
      const classifiedProd = classifiedProducts.find(p => p.code === selectedProduct.code);
      
      if (!classifiedProd) {
        Alert.alert('Error', 'Producto no encontrado en el clasificador');
        return;
      }

      const availableStock = await getProductStockInStore(classifiedProd.id, fromStore);
      const qty = Number(quantity);

      if (qty > availableStock) {
        Alert.alert('Error', `Stock insuficiente. Disponible: ${availableStock}`);
        return;
      }

      // Add to transfer items
      const newItem: TransferItem = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        productCode: selectedProduct.code,
        productName: selectedProduct.description,
        unit: selectedProduct.unit,
        quantity: qty,
        fromStoreId: fromStore,
        toStoreId: toStore,
        fromStockAvailable: availableStock,
      };

      setTransferItems([...transferItems, newItem]);

      // Reset form
      productSearch.setQuery('');
      setSelectedProduct(null);
      setQuantity('');
      setNote('');

      Alert.alert('✓ Producto agregado', `${selectedProduct.description} agregado a la transferencia`);
    } catch (error) {
      Alert.alert('Error', 'No se pudo agregar el producto');
      console.error(error);
    }
  }

  async function handleConfirmTransfer() {
    if (transferItems.length === 0) {
      Alert.alert('Error', 'Agrega al menos un producto a la transferencia');
      return;
    }

    Alert.alert(
      'Confirmar Transferencia',
      `¿Confirmar transferencia de ${transferItems.length} producto(s)?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            try {
              setLoading(true);

              const classifiedProducts = await getClassifiedProducts();
              const fromStoreObj = stores.find(s => s.id === transferItems[0].fromStoreId);
              const toStoreObj = stores.find(s => s.id === transferItems[0].toStoreId);

              for (const item of transferItems) {
                const classifiedProd = classifiedProducts.find(p => p.code === item.productCode);
                
                if (!classifiedProd) continue;

                // Create outbound entry (from store)
                await createInventoryEntry({
                  type: 'transfer_out',
                  productId: classifiedProd.id,
                  quantity: item.quantity,
                  unitCost: 0,
                  paymentMethod: null,
                  note: `Transferencia manual a ${toStoreObj?.name || 'destino'}${note ? ': ' + note : ''}`,
                  storeId: item.fromStoreId,
                });

                // Create inbound entry (to store)
                await createInventoryEntry({
                  type: 'transfer_in',
                  productId: classifiedProd.id,
                  quantity: item.quantity,
                  unitCost: 0,
                  paymentMethod: null,
                  note: `Transferencia manual desde ${fromStoreObj?.name || 'origen'}${note ? ': ' + note : ''}`,
                  storeId: item.toStoreId,
                  targetStoreId: item.toStoreId,
                });
              }

              Alert.alert('✓ Éxito', 'Transferencia registrada correctamente');
              setTransferItems([]);
              productSearch.setQuery('');
              setNote('');
            } catch (error) {
              Alert.alert('Error', 'No se pudo registrar la transferencia');
              console.error(error);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  function handleRemoveItem(itemId: string) {
    setTransferItems(transferItems.filter(item => item.id !== itemId));
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerContent}>
          <Text>Cargando...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const fromStoreObj = stores.find(s => s.id === fromStore);
  const toStoreObj = stores.find(s => s.id === toStore);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>📦 Transferencias Manuales</Text>
          <Text style={styles.subtitle}>Transfiere productos entre tiendas</Text>
        </View>

        {/* Stores Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tiendas</Text>
          
          <View style={styles.storesGrid}>
            <View style={styles.storeCard}>
              <Text style={styles.storeLabel}>Desde:</Text>
              <View style={styles.storePicker}>
                {stores.map(store => (
                  <TouchableOpacity
                    key={store.id}
                    style={[
                      styles.storeOption,
                      fromStore === store.id && styles.storeOptionActive
                    ]}
                    onPress={() => setFromStore(store.id)}
                  >
                    <Text style={[
                      styles.storeOptionText,
                      fromStore === store.id && styles.storeOptionTextActive
                    ]}>
                      {store.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.storeCard}>
              <Text style={styles.storeLabel}>Hacia:</Text>
              <View style={styles.storePicker}>
                {stores.map(store => (
                  <TouchableOpacity
                    key={store.id}
                    style={[
                      styles.storeOption,
                      toStore === store.id && styles.storeOptionActive
                    ]}
                    onPress={() => setToStore(store.id)}
                  >
                    <Text style={[
                      styles.storeOptionText,
                      toStore === store.id && styles.storeOptionTextActive
                    ]}>
                      {store.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Product Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Agregar Productos</Text>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Producto (código o descripción)</Text>
            <ProductSearchDropdown
              value={productSearch.query}
              onChangeText={productSearch.setQuery}
              onSelectProduct={handleSelectProduct}
              suggestions={productSearch.suggestions}
              loading={productSearch.loading}
              placeholder="Busca por código o descripción"
            />
          </View>

          {selectedProduct && (
            <View style={styles.selectedProductCard}>
              <View style={styles.selectedProductHeader}>
                <View>
                  <Text style={styles.selectedProductCode}>{selectedProduct.code}</Text>
                  <Text style={styles.selectedProductDesc}>{selectedProduct.description}</Text>
                  <Text style={styles.selectedProductUnit}>{selectedProduct.unit}</Text>
                </View>
              </View>
            </View>
          )}

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Cantidad</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="numeric"
              editable={!!selectedProduct}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Nota (opcional)</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Motivo de la transferencia"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={2}
            />
          </View>

          <TouchableOpacity
            style={[styles.addBtn, !selectedProduct || !quantity && styles.addBtnDisabled]}
            onPress={handleAddTransfer}
            disabled={!selectedProduct || !quantity}
          >
            <MaterialCommunityIcons name="plus" size={20} color="#fff" />
            <Text style={styles.addBtnText}>Agregar Producto</Text>
          </TouchableOpacity>
        </View>

        {/* Transfer Items Summary */}
        {transferItems.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Productos a Transferir ({transferItems.length})</Text>

            {transferItems.map((item, idx) => (
              <View key={item.id} style={styles.itemCard}>
                <View style={styles.itemContent}>
                  <View>
                    <Text style={styles.itemCode}>{item.productCode}</Text>
                    <Text style={styles.itemName}>{item.productName}</Text>
                    <Text style={styles.itemDetails}>
                      {item.quantity} {item.unit} • Stock disponible: {item.fromStockAvailable}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => handleRemoveItem(item.id)}
                >
                  <MaterialCommunityIcons name="delete" size={20} color="#F44336" />
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleConfirmTransfer}
            >
              <MaterialCommunityIcons name="check" size={20} color="#fff" />
              <Text style={styles.confirmBtnText}>Confirmar Transferencia</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.medium,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    marginBottom: SPACING.large,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: THEME.colors.text,
    marginBottom: SPACING.small,
  },
  subtitle: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
  },
  section: {
    marginBottom: SPACING.large,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: SPACING.medium,
  },
  storesGrid: {
    gap: SPACING.medium,
  },
  storeCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  storeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.small,
  },
  storePicker: {
    gap: SPACING.small,
  },
  storeOption: {
    padding: SPACING.small,
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.sm,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    alignItems: 'center',
  },
  storeOptionActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  storeOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  storeOptionTextActive: {
    color: THEME.colors.onPrimary,
  },
  formGroup: {
    marginBottom: SPACING.medium,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.colors.text,
    marginBottom: SPACING.small,
  },
  input: {
    backgroundColor: THEME.colors.surfaceVariant,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    borderRadius: THEME.radii.md,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.small,
    fontSize: 14,
    color: THEME.colors.text,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  selectedProductCard: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#0EA5E9',
    borderRadius: THEME.radii.md,
    padding: SPACING.medium,
    marginBottom: SPACING.medium,
  },
  selectedProductHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  selectedProductCode: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.primary,
    marginBottom: 4,
  },
  selectedProductDesc: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.text,
    marginBottom: 4,
  },
  selectedProductUnit: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    fontStyle: 'italic',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.small,
    backgroundColor: THEME.colors.primary,
    paddingVertical: SPACING.medium,
    borderRadius: THEME.radii.md,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: THEME.colors.onPrimary,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    marginBottom: SPACING.small,
  },
  itemContent: {
    flex: 1,
  },
  itemCode: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary,
    marginBottom: 4,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.text,
    marginBottom: 4,
  },
  itemDetails: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  removeBtn: {
    padding: SPACING.small,
    marginLeft: SPACING.small,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.small,
    backgroundColor: '#10B981',
    paddingVertical: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginTop: SPACING.medium,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});