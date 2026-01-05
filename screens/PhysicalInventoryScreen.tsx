import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getProducts, getProductStockInStore, setProductStockInStore, initDb } from '../lib/db';
import { useStore } from '../lib/useStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveInventory as saveInventorySnapshot, getTodayKey } from '../lib/storage';

type ProductInventory = {
  id: string;
  name: string;
  sku: string | null;
  systemStock: number;
  physicalStock: string;
  difference: number;
};

export default function PhysicalInventoryScreen({ navigation }: any) {
  const { currentStore } = useStore();
  const [products, setProducts] = useState<ProductInventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      await initDb();
      const allProducts = await getProducts();
      const storeId = currentStore?.id || 'store_default';
      
      const inventoryProducts: ProductInventory[] = await Promise.all(
        allProducts.map(async (product) => {
          const systemStock = await getProductStockInStore(product.id, storeId);
          return {
            id: product.id,
            name: product.name,
            sku: product.sku,
            systemStock: systemStock,
            physicalStock: '',
            difference: 0,
          };
        })
      );
      
      setProducts(inventoryProducts);
      setLoading(false);
    } catch (error) {
      console.error('Error loading products:', error);
      setLoading(false);
      Alert.alert('Error', 'No se pudieron cargar los productos');
    }
  }, [currentStore?.id]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const updatePhysicalStock = (productId: string, value: string) => {
    setProducts(prev => prev.map(p => {
      if (p.id === productId) {
        const physical = value === '' ? 0 : parseInt(value, 10) || 0;
        return {
          ...p,
          physicalStock: value,
          difference: physical - p.systemStock,
        };
      }
      return p;
    }));
  };

  const handleSaveInventory = async () => {
    try {
      // Verificar que todos los productos tengan cantidad física ingresada
      const incomplete = products.filter(p => p.physicalStock === '');
      if (incomplete.length > 0) {
        Alert.alert(
          'Inventario Incompleto',
          `Hay ${incomplete.length} producto(s) sin contar. ¿Deseas continuar de todos modos?`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Continuar',
              onPress: () => saveInventory(),
            },
          ]
        );
        return;
      }
      
      await saveInventory();
    } catch (error) {
      console.error('Error saving inventory:', error);
      Alert.alert('Error', 'No se pudo guardar el inventario');
    }
  };

  const saveInventory = async () => {
    setSaving(true);
    
    try {
      const storeId = currentStore?.id || 'store_default';
      const differences: any[] = [];
      const itemsForSnapshot: { id: string; name: string; expected: number; counted: number; difference: number }[] = [];
      
      // Calcular diferencias SIN ajustar stock en DB - solo para registro de cierre
      for (const product of products) {
        if (product.physicalStock !== '') {
          const physical = parseInt(product.physicalStock, 10) || 0;
          const diff = physical - product.systemStock;
          
          // Solo registrar si hay diferencia
          if (diff !== 0) {
            differences.push({
              productName: product.name,
              sku: product.sku || product.id.substring(0, 6),
              systemStock: product.systemStock,
              physicalStock: physical,
              difference: diff,
            });
          }
          // Build snapshot item para historial sin ajustar
          itemsForSnapshot.push({ id: product.id, name: product.name, expected: product.systemStock, counted: physical, difference: diff });
        }
      }
      
      // Guardar snapshot de inventario físico con diferencias en storage (para respaldo - SIN AJUSTAR STOCK)
      try {
        const today = getTodayKey();
        await saveInventorySnapshot({ date: today, items: itemsForSnapshot });
      } catch (_){}
      
      // Guardar historial local también (legacy)
      const inventoryRecord = {
        date: new Date().toISOString(),
        storeId,
        differences,
        totalDifferences: differences.length,
      };
      const history = await AsyncStorage.getItem('inventory_history');
      const historyArray = history ? JSON.parse(history) : [];
      historyArray.unshift(inventoryRecord);
      await AsyncStorage.setItem('inventory_history', JSON.stringify(historyArray.slice(0, 10)));
      
      setSaving(false);
      
      // Mostrar resumen de diferencias
      if (differences.length > 0) {
        const summary = differences.slice(0, 5).map(d => 
          `${d.productName}: ${d.difference > 0 ? '+' : ''}${d.difference}`
        ).join('\n');
        
        Alert.alert(
          'Inventario Guardado',
          `Se registraron ${differences.length} diferencia(s) (SIN AJUSTES):\n\n${summary}${differences.length > 5 ? '\n...' : ''}\n\nAhora procede al arqueo de caja.`,
          [
            {
              text: 'Continuar al Arqueo',
              onPress: () => {
                navigation.navigate('Caja', { openArqueo: true, fromCierreFlow: true });
              },
            },
          ]
        );
      } else {
        Alert.alert(
          'Inventario Guardado',
          'No se encontraron diferencias. Ahora procede al arqueo de caja.',
          [
            {
              text: 'Continuar al Arqueo',
              onPress: () => {
                navigation.navigate('Caja', { openArqueo: true, fromCierreFlow: true });
              },
            },
          ]
        );
      }
    } catch (error) {
      setSaving(false);
      console.error('Error in saveInventory:', error);
      Alert.alert('Error', 'No se pudo guardar el inventario');
    }
  };

  const totalDifferences = products.filter(p => p.difference !== 0).length;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0A84FF" />
        <Text style={styles.loadingText}>Cargando inventario...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Inventario Físico</Text>
            <Text style={styles.subtitle}>Cierre del Día</Text>
          </View>
          {totalDifferences > 0 && (
            <View style={styles.differenceBadge}>
              <MaterialCommunityIcons name="alert" size={16} color="#FFF" />
              <Text style={styles.differenceBadgeText}>{totalDifferences}</Text>
            </View>
          )}
        </View>

        <View style={styles.instructionsCard}>
          <MaterialCommunityIcons name="information" size={20} color="#0A84FF" />
          <Text style={styles.instructionsText}>
            Cuenta el inventario físico de cada producto. El sistema mostrará las diferencias automáticamente.
          </Text>
        </View>

        <ScrollView style={styles.content}>
          {products.map((product, index) => (
            <View key={product.id} style={styles.productCard}>
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productSku}>SKU: {product.sku || product.id.substring(0, 6)}</Text>
                {/* Ocultar cantidades de stock del sistema en modo físico para no sesgar el conteo */}
                {/* <View style={styles.stockRow}>
                  <Text style={styles.stockLabel}>Stock Sistema:</Text>
                  <Text style={styles.stockValue}>{product.systemStock}</Text>
                </View> */}
              </View>
              
              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>Stock Físico:</Text>
                <TextInput
                  style={styles.stockInput}
                  value={product.physicalStock}
                  onChangeText={(text) => updatePhysicalStock(product.id, text)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              {product.physicalStock !== '' && product.difference !== 0 && (
                <View style={[
                  styles.differenceBox,
                  { backgroundColor: product.difference > 0 ? '#ECFDF5' : '#FEF2F2' }
                ]}>
                  <MaterialCommunityIcons 
                    name={product.difference > 0 ? 'arrow-up' : 'arrow-down'} 
                    size={16} 
                    color={product.difference > 0 ? '#10B981' : '#EF4444'} 
                  />
                  <Text style={[
                    styles.differenceText,
                    { color: product.difference > 0 ? '#10B981' : '#EF4444' }
                  ]}>
                    {product.difference > 0 ? '+' : ''}{product.difference} unidades
                  </Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity 
            style={styles.saveButton}
            onPress={handleSaveInventory}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="check-circle" size={20} color="#FFF" />
                <Text style={styles.saveButtonText}>Guardar y Continuar al Arqueo</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F5F5F5' 
  },
  safeArea: { 
    flex: 1 
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
  },
  header: { 
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20, 
    paddingTop: 16, 
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: { 
    fontSize: 24, 
    fontWeight: '800', 
    color: '#1A1A1A' 
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  differenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  differenceBadgeText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  instructionsCard: {
    flexDirection: 'row',
    backgroundColor: '#EFF6FF',
    margin: 16,
    padding: 12,
    borderRadius: 12,
    gap: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#0A84FF',
  },
  instructionsText: {
    flex: 1,
    fontSize: 14,
    color: '#1E40AF',
    lineHeight: 20,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  productCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  productInfo: {
    marginBottom: 12,
  },
  productName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  productSku: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stockLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  stockValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0A84FF',
  },
  inputSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  stockInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    fontWeight: '600',
    width: 100,
    textAlign: 'center',
  },
  differenceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    gap: 6,
  },
  differenceText: {
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFF',
  },
  saveButton: {
    backgroundColor: '#0A84FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});