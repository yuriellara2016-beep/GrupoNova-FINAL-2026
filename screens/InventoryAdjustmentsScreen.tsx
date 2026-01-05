import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Picker } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { THEME, SPACING } from '../lib/theme';
import { useAuthSafe } from '../lib/AuthContext';
import { useProductSearch } from '../hooks/useProductSearch';
import { getStores, getProductStockInStore, createInventoryEntry, initDb } from '../lib/db';
import { getClassifiedProducts } from '../lib/classifiedProducts';
import { Store } from '../types';
import ProductSearchDropdown, { ClassifiedProductSuggestion } from '../components/ProductSearchDropdown';

type AdjustmentItem = {
  id: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  reason: string;
  currentStock: number;
};

// Tipos de salida de inventario
type OutflowType = 'transfer' | 'shrinkage' | 'adjustment';

const OUTFLOW_TYPES = [
  { id: 'transfer', label: '🔄 Transferencia', description: 'Enviar a otra tienda', color: '#3B82F6' },
  { id: 'shrinkage', label: '⚠️ Merma', description: 'Deterioro, pérdida, daño', color: '#DC2626' },
  { id: 'adjustment', label: '🔧 Otros Ajustes', description: 'Otros ajustes de stock', color: '#F59E0B' },
];

const ADJUSTMENT_REASONS = [
  { label: 'Merma (deterioro)', value: 'shrinkage' },
  { label: 'Pérdida', value: 'loss' },
  { label: 'Daño', value: 'damage' },
  { label: 'Robo', value: 'theft' },
  { label: 'Expiración', value: 'expiration' },
  { label: 'Otro', value: 'other' },
];

export default function InventoryAdjustmentsScreen() {
  const { user } = useAuthSafe();
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [adjustmentItems, setAdjustmentItems] = useState<AdjustmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [outflowType, setOutflowType] = useState<OutflowType>('shrinkage');

  // Form state for new adjustment
  const productSearch = useProductSearch({ debounceMs: 300 });
  const [selectedProduct, setSelectedProduct] = useState<ClassifiedProductSuggestion | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('shrinkage');
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
        setSelectedStore(activeStores[0].id);
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

    // Get current stock in the selected store
    if (selectedStore) {
      try {
        const classifiedProducts = await getClassifiedProducts();
        const classifiedProd = classifiedProducts.find(p => p.code === product.code);
        
        if (classifiedProd) {
          const currentStock = await getProductStockInStore(classifiedProd.id, selectedStore);
          setSelectedProduct(prev => prev ? { ...prev, _id: classifiedProd.id } : product);
        }
      } catch (error) {
        console.warn('Error fetching stock:', error);
      }
    }
  }

  async function handleAddAdjustment() {
    if (!selectedProduct) {
      Alert.alert('Error', 'Selecciona un producto del clasificador');
      return;
    }

    if (!quantity.trim() || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      Alert.alert('Error', 'Ingresa una cantidad válida mayor a 0');
      return;
    }

    if (!selectedStore) {
      Alert.alert('Error', 'Selecciona una tienda');
      return;
    }

    try {
      // Get current stock
      const classifiedProducts = await getClassifiedProducts();
      const classifiedProd = classifiedProducts.find(p => p.code === selectedProduct.code);
      
      if (!classifiedProd) {
        Alert.alert('Error', 'Producto no encontrado en el clasificador');
        return;
      }

      const currentStock = await getProductStockInStore(classifiedProd.id, selectedStore);
      const qty = Number(quantity);

      if (qty > currentStock) {
        Alert.alert('Error', `Cantidad inválida. Stock disponible: ${currentStock}`);
        return;
      }

      // Get reason label
      const reasonLabel = ADJUSTMENT_REASONS.find(r => r.value === reason)?.label || reason;

      // Add to adjustment items
      const newItem: AdjustmentItem = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        productCode: selectedProduct.code,
        productName: selectedProduct.description,
        unit: selectedProduct.unit,
        quantity: qty,
        reason: reasonLabel,
        currentStock,
      };

      setAdjustmentItems([...adjustmentItems, newItem]);

      // Reset form
      productSearch.setQuery('');
      setSelectedProduct(null);
      setQuantity('');
      setReason('shrinkage');
      setNote('');

      Alert.alert('✓ Producto agregado', `${selectedProduct.description} agregado al ajuste`);
    } catch (error) {
      Alert.alert('Error', 'No se pudo agregar el producto');
      console.error(error);
    }
  }

  async function handleConfirmAdjustment() {
    if (adjustmentItems.length === 0) {
      Alert.alert('Error', 'Agrega al menos un producto al ajuste');
      return;
    }

    Alert.alert(
      'Confirmar Ajuste de Salida',
      `¿Confirmar ajuste de ${adjustmentItems.length} producto(s)?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            try {
              setLoading(true);

              const classifiedProducts = await getClassifiedProducts();
              const storeObj = stores.find(s => s.id === selectedStore);

              for (const item of adjustmentItems) {
                const classifiedProd = classifiedProducts.find(p => p.code === item.productCode);
                
                if (!classifiedProd) continue;

                // Create adjustment entry (outbound, negative quantity)
                await createInventoryEntry({
                  type: 'adjustment',
                  productId: classifiedProd.id,
                  quantity: -item.quantity,
                  unitCost: 0,
                  paymentMethod: null,
                  note: `Ajuste por ${item.reason.toLowerCase()}${note ? ': ' + note : ''} en ${storeObj?.name || 'tienda'}`,
                  storeId: selectedStore || 'store_default',
                });
              }

              Alert.alert('✓ Éxito', 'Ajuste de salida registrado correctamente');
              setAdjustmentItems([]);
              productSearch.setQuery('');
              setNote('');
            } catch (error) {
              Alert.alert('Error', 'No se pudo registrar el ajuste');
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
    setAdjustmentItems(adjustmentItems.filter(item => item.id !== itemId));
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

  const storeObj = stores.find(s => s.id === selectedStore);
  const currentOutflowConfig = OUTFLOW_TYPES.find(t => t.id === outflowType);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>📊 Salida de Inventarios</Text>
          <Text style={styles.subtitle}>Registra movimientos de salida de stock</Text>
        </View>

        {/* Outflow Type Selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tipo de Salida</Text>
          <View style={styles.outflowTypeContainer}>
            {OUTFLOW_TYPES.map(type => (
              <TouchableOpacity
                key={type.id}
                style={[
                  styles.outflowTypeCard,
                  outflowType === type.id && styles.outflowTypeCardActive
                ]}
                onPress={() => {
                  setOutflowType(type.id as OutflowType);
                  setReason(type.id === 'transfer' ? 'transfer' : 'shrinkage');
                  setAdjustmentItems([]);
                  setNote('');
                }}
              >
                <Text style={styles.outflowTypeLabel}>{type.label}</Text>
                <Text style={[
                  styles.outflowTypeDesc,
                  outflowType === type.id && styles.outflowTypeDescActive
                ]}>
                  {type.description}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Store Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tienda Origen</Text>
          <View style={styles.storePickerContainer}>
            {stores.map(store => (
              <TouchableOpacity
                key={store.id}
                style={[
                  styles.storeOption,
                  selectedStore === store.id && styles.storeOptionActive
                ]}
                onPress={() => setSelectedStore(store.id)}
              >
                <Text style={[
                  styles.storeOptionText,
                  selectedStore === store.id && styles.storeOptionTextActive
                ]}>
                  {store.name}
                </Text>
              </TouchableOpacity>
            ))}
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
              <View>
                <Text style={styles.selectedProductCode}>{selectedProduct.code}</Text>
                <Text style={styles.selectedProductDesc}>{selectedProduct.description}</Text>
                <Text style={styles.selectedProductUnit}>{selectedProduct.unit}</Text>
              </View>
            </View>
          )}

          {outflowType === 'shrinkage' && (
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Motivo del Ajuste</Text>
              <View style={styles.reasonPicker}>
                {ADJUSTMENT_REASONS.map(r => (
                  <TouchableOpacity
                    key={r.value}
                    style={[
                      styles.reasonOption,
                      reason === r.value && styles.reasonOptionActive
                    ]}
                    onPress={() => setReason(r.value)}
                  >
                    <Text style={[
                      styles.reasonOptionText,
                      reason === r.value && styles.reasonOptionTextActive
                    ]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Cantidad a Descontar</Text>
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
              placeholder="Detalles adicionales"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={2}
            />
          </View>

          <TouchableOpacity
            style={[styles.addBtn, !selectedProduct || !quantity && styles.addBtnDisabled]}
            onPress={handleAddAdjustment}
            disabled={!selectedProduct || !quantity}
          >
            <MaterialCommunityIcons name="plus" size={20} color="#fff" />
            <Text style={styles.addBtnText}>Agregar Producto</Text>
          </TouchableOpacity>
        </View>

        {/* Adjustment Items Summary */}
        {adjustmentItems.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Productos a Descontar ({adjustmentItems.length})</Text>

            {adjustmentItems.map((item, idx) => (
              <View key={item.id} style={styles.itemCard}>
                <View style={styles.itemContent}>
                  <View>
                    <Text style={styles.itemCode}>{item.productCode}</Text>
                    <Text style={styles.itemName}>{item.productName}</Text>
                    <Text style={styles.itemReason}>{item.reason}</Text>
                    <Text style={styles.itemDetails}>
                      -{item.quantity} {item.unit} (de {item.currentStock} disponibles)
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

            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total de descuentos:</Text>
              <Text style={styles.totalItems}>{adjustmentItems.length} producto(s)</Text>
            </View>

            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleConfirmAdjustment}
            >
              <MaterialCommunityIcons name="check" size={20} color="#fff" />
              <Text style={styles.confirmBtnText}>Confirmar Ajuste</Text>
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
  outflowTypeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  outflowTypeCard: {
    flex: 1,
    minWidth: 130,
    padding: SPACING.small,
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.sm,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    alignItems: 'center',
  },
  outflowTypeCardActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  outflowTypeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.colors.text,
    marginBottom: 4,
  },
  outflowTypeDesc: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
  },
  outflowTypeDescActive: {
    color: THEME.colors.onPrimary,
  },
  storePickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  storeOption: {
    flex: 1,
    minWidth: 130,
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
    fontSize: 13,
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
  reasonPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  reasonOption: {
    flex: 1,
    minWidth: 130,
    padding: SPACING.small,
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.sm,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    alignItems: 'center',
  },
  reasonOptionActive: {
    backgroundColor: '#FEE2E2',
    borderColor: '#F44336',
  },
  reasonOptionText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.text,
    textAlign: 'center',
  },
  reasonOptionTextActive: {
    color: '#D32F2F',
    fontWeight: '700',
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
    backgroundColor: '#FEF2F2',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: '#FBCFE8',
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
    marginBottom: 2,
  },
  itemReason: {
    fontSize: 11,
    color: '#D32F2F',
    fontWeight: '600',
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
  totalCard: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.medium,
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.tiny,
  },
  totalItems: {
    fontSize: 18,
    fontWeight: '700',
    color: '#D32F2F',
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.small,
    backgroundColor: '#D32F2F',
    paddingVertical: SPACING.medium,
    borderRadius: THEME.radii.md,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});