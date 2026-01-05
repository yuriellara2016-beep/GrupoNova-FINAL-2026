import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, Alert, Modal, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { THEME, SPACING } from '../lib/theme';
import { upsertManyClassifiedProducts } from '../lib/classifiedProducts';
import DayStatusBanner from '../components/DayStatusBanner';
import { isoToDisplay } from '../lib/date';

export type ClassifiedProduct = {
  id: string;
  code: string;
  description: string;
  unit: string;
  createdAt: string;
  source?: string; // Para tracking de origen
};

export default function ProductClassifierScreen() {
  const [products, setProducts] = useState<ClassifiedProduct[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // Form fields
  const [formCode, setFormCode] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formUnit, setFormUnit] = useState('Uno');

  // CSV import
  const [importVisible, setImportVisible] = useState(false);
  const [csvText, setCsvText] = useState('');

  // Cargar productos y sincronizar automáticamente al montar
  useEffect(() => {
    const initializeProducts = async () => {
      setIsLoading(true);
      await loadAndSyncProducts();
      setIsLoading(false);
    };
    
    initializeProducts();
  }, []);

  // Función principal: Carga y sincroniza productos
  async function loadAndSyncProducts() {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage').then(m => m.default);
      
      // 1. Cargar productos existentes del clasificador
      const stored = await AsyncStorage.getItem('classified_products');
      const existingProducts = stored ? JSON.parse(stored) : [];
      
      // 2. Buscar productos en otras fuentes (solo si hay pocos productos)
      if (existingProducts.length < 10) { // Umbral bajo para sincronización automática
        console.log('🔍 Buscando productos en otras fuentes...');
        const newProducts = await findProductsInOtherSources(existingProducts);
        
        if (newProducts.length > 0) {
          // 3. Combinar productos
          const allProducts = [...newProducts, ...existingProducts];
          
          // 4. Eliminar duplicados por código
          const uniqueProducts = removeDuplicatesByCode(allProducts);
          
          // 5. Guardar
          await AsyncStorage.setItem('classified_products', JSON.stringify(uniqueProducts));
          
          // 6. Actualizar estado
          setProducts(uniqueProducts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
          setLastSync(new Date());
          
          // 7. Notificar al usuario (solo si se agregaron productos nuevos)
          const addedCount = newProducts.length - (allProducts.length - uniqueProducts.length);
          if (addedCount > 0) {
            setTimeout(() => {
              Alert.alert(
                '🔄 Sincronización Automática',
                `Se agregaron ${addedCount} productos desde otras fuentes`
              );
            }, 1000);
          }
          
          console.log(`✅ Sincronizado: ${addedCount} productos nuevos`);
          return;
        }
      }
      
      // Si ya hay suficientes productos o no se encontraron nuevos
      setProducts(existingProducts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setLastSync(new Date());
      
    } catch (err) {
      console.warn('Error loading/syncing products:', err);
      setProducts([]);
    }
  }

  // Función para buscar productos en todas las fuentes posibles
  async function findProductsInOtherSources(existingProducts: ClassifiedProduct[]) {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage').then(m => m.default);
      const allFoundProducts: ClassifiedProduct[] = [];
      
      // Obtener todas las claves de AsyncStorage
      const allKeys = await AsyncStorage.getAllKeys();
      console.log(`🔑 Total de claves en almacenamiento: ${allKeys.length}`);
      
      // Excluir claves del clasificador
      const excludeKeys = ['classified_products', 'classifier', 'classified'];
      const searchKeys = allKeys.filter(key => 
        !excludeKeys.some(exclude => key.toLowerCase().includes(exclude.toLowerCase()))
      );
      
      // Mapa de códigos existentes para evitar duplicados
      const existingCodes = new Set(existingProducts.map(p => p.code.toUpperCase()));
      
      // Buscar en cada clave
      for (const key of searchKeys) {
        try {
          const stored = await AsyncStorage.getItem(key);
          if (!stored) continue;
          
          const parsed = JSON.parse(stored);
          const extracted = extractProductsFromData(parsed, key);
          
          // Filtrar productos que no existen ya
          const newProducts = extracted.filter((p: ClassifiedProduct) => 
            !existingCodes.has(p.code.toUpperCase())
          );
          
          if (newProducts.length > 0) {
            console.log(`📦 Encontrados ${newProducts.length} productos en "${key}"`);
            allFoundProducts.push(...newProducts);
            
            // Actualizar códigos existentes
            newProducts.forEach(p => existingCodes.add(p.code.toUpperCase()));
          }
          
        } catch (e) {
          // Continuar con la siguiente clave
          console.warn(`Error procesando clave "${key}":`, e);
        }
      }
      
      return allFoundProducts;
      
    } catch (err) {
      console.error('Error searching products:', err);
      return [];
    }
  }

  // Función para extraer productos de diferentes formatos de datos
  function extractProductsFromData(data: any, sourceKey: string): ClassifiedProduct[] {
    const products: ClassifiedProduct[] = [];
    
    // Si es un array
    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        const product = extractProductFromItem(item, `${sourceKey}[${index}]`);
        if (product) products.push(product);
      });
    }
    // Si es un objeto, buscar arrays dentro
    else if (data && typeof data === 'object') {
      // Buscar arrays en propiedades del objeto
      Object.keys(data).forEach(key => {
        const value = data[key];
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            const product = extractProductFromItem(item, `${sourceKey}.${key}[${index}]`);
            if (product) products.push(product);
          });
        }
      });
    }
    
    return products;
  }

  // Función para extraer un producto de un objeto individual
  function extractProductFromItem(item: any, sourcePath: string): ClassifiedProduct | null {
    if (!item || typeof item !== 'object') return null;
    
    // Buscar código en diferentes nombres de campo
    const code = findProperty(item, [
      'code', 'codigo', 'productCode', 'codigo_producto', 
      'sku', 'id', 'productId', 'cod', 'referencia'
    ]);
    
    // Buscar descripción en diferentes nombres de campo
    const description = findProperty(item, [
      'description', 'descripcion', 'name', 'nombre', 
      'productName', 'nombre_producto', 'desc', 'productDescription'
    ]);
    
    if (!code || !description) return null;
    
    // Crear producto
    return {
      id: `auto_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      code: code.toString().toUpperCase().trim(),
      description: description.toString().trim(),
      unit: 'Uno',
      createdAt: new Date().toISOString(),
      source: sourcePath
    };
  }

  // Función auxiliar para buscar propiedades en un objeto
  function findProperty(obj: any, propNames: string[]): string | null {
    for (const prop of propNames) {
      if (obj[prop] !== undefined && obj[prop] !== null && obj[prop] !== '') {
        return obj[prop].toString();
      }
    }
    return null;
  }

  // Función para eliminar duplicados por código
  function removeDuplicatesByCode(products: ClassifiedProduct[]): ClassifiedProduct[] {
    const seen = new Set();
    return products.filter(product => {
      const key = product.code.toUpperCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  // Función para sincronizar manualmente (opcional para el usuario)
  async function manualSync() {
    setIsLoading(true);
    try {
      await loadAndSyncProducts();
      Alert.alert('✅ Sincronizado', 'Productos actualizados correctamente');
    } catch (error) {
      Alert.alert('Error', 'No se pudo sincronizar los productos');
    } finally {
      setIsLoading(false);
    }
  }

  async function saveProducts(newProducts: ClassifiedProduct[]) {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage').then(m => m.default);
      await AsyncStorage.setItem('classified_products', JSON.stringify(newProducts));
      setProducts(newProducts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (err) {
      Alert.alert('Error', 'No se pudo guardar el producto');
    }
  }

  function openForm(product?: ClassifiedProduct) {
    if (product) {
      setEditingId(product.id);
      setFormCode(product.code);
      setFormDescription(product.description);
      setFormUnit('Uno');
    } else {
      setEditingId(null);
      setFormCode('');
      setFormDescription('');
      setFormUnit('Uno');
    }
    setModalVisible(true);
  }

  function closeForm() {
    setModalVisible(false);
    setEditingId(null);
    setFormCode('');
    setFormDescription('');
    setFormUnit('Uno');
  }

  async function saveProduct() {
    if (!formCode.trim()) {
      Alert.alert('Error', 'El código del producto es requerido');
      return;
    }

    if (!formDescription.trim()) {
      Alert.alert('Error', 'La descripción del producto es requerida');
      return;
    }

    const duplicateExists = products.some(p => 
      p.code.toUpperCase() === formCode.toUpperCase() && p.id !== editingId
    );

    if (duplicateExists) {
      Alert.alert('Error', 'Ya existe un producto con este código');
      return;
    }

    let updatedProducts: ClassifiedProduct[];

    if (editingId) {
      updatedProducts = products.map(p =>
        p.id === editingId
          ? { ...p, code: formCode.trim().toUpperCase(), description: formDescription.trim(), unit: 'Uno' }
          : p
      );
    } else {
      const newProduct: ClassifiedProduct = {
        id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        code: formCode.trim().toUpperCase(),
        description: formDescription.trim(),
        unit: 'Uno',
        createdAt: new Date().toISOString(),
      };
      updatedProducts = [newProduct, ...products];
    }

    await saveProducts(updatedProducts);
    closeForm();

    Alert.alert(
      '✅ Éxito',
      editingId ? 'Producto actualizado correctamente' : 'Producto creado correctamente'
    );
  }

  async function deleteProduct(id: string) {
    const product = products.find(p => p.id === id);
    
    if (Platform.OS === 'web') {
      const updatedProducts = products.filter(p => p.id !== id);
      await saveProducts(updatedProducts);
      Alert.alert('✅ Eliminado', `Producto "${product?.description}" eliminado correctamente`);
      return;
    }

    Alert.alert(
      '⚠️ Confirmar Eliminación',
      `¿Desea eliminar el producto "${product?.description}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const updatedProducts = products.filter(p => p.id !== id);
            await saveProducts(updatedProducts);
            Alert.alert('✅ Eliminado', `Producto "${product?.description}" eliminado correctamente`);
          },
        },
      ]
    );
  }

  async function importFromCsv(csv: string) {
    try {
      const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        Alert.alert('Error', 'El contenido CSV está vacío');
        return;
      }
      const first = lines[0].toLowerCase();
      const hasHeader = first.includes('codigo') || first.includes('code');
      const data = hasHeader ? lines.slice(1) : lines;
      const items: Array<{ code: string; description: string; unit: string }> = [];
      const errors: string[] = [];
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const delimiter = row.includes(';') && !row.includes(',') ? ';' : ',';
        const parts = row.split(delimiter).map(p => p.trim());
        
        if (parts.length < 2) {
          errors.push(`Línea ${i + 1}: formato incorrecto, se esperan 2 columnas (código, descripción)`);
          continue;
        }
        
        const [code, description] = parts;
        if (!code || !description) {
          errors.push(`Línea ${i + 1}: campos vacíos`);
          continue;
        }
        
        items.push({ 
          code, 
          description, 
          unit: 'Uno'
        });
      }
      
      if (items.length === 0) {
        Alert.alert('Error', errors[0] || 'No hay filas válidas');
        return;
      }

      if (Platform.OS === 'web') {
        await upsertManyClassifiedProducts(items);
        setImportVisible(false);
        setCsvText('');
        await loadAndSyncProducts();
        Alert.alert('✅ Importación Exitosa', `Se importaron ${items.length} productos correctamente`);
        return;
      }

      Alert.alert(
        '📥 Confirmar Importación',
        `Se importarán ${items.length} productos. ${errors.length > 0 ? `\nErrores: ${errors.length}` : ''}`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Importar',
            onPress: async () => {
              await upsertManyClassifiedProducts(items);
              setImportVisible(false);
              setCsvText('');
              await loadAndSyncProducts();
              Alert.alert('✅ Importación Exitosa', `Se importaron ${items.length} productos correctamente`);
            },
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo importar CSV');
    }
  }

  async function pickCsvFile() {
    try {
      const { importCSVFile } = await import('../lib/file');
      const content = await importCSVFile();
      if (!content) return;
      setCsvText(content);
      setImportVisible(true);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo leer el archivo CSV');
    }
  }

  const filteredProducts = products.filter(p =>
    p.code.includes(searchQuery.toUpperCase()) ||
    p.description.toUpperCase().includes(searchQuery.toUpperCase())
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <DayStatusBanner />

      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>📦 Clasificador de Productos</Text>
          <TouchableOpacity 
            onPress={manualSync}
            style={styles.syncButton}
            disabled={isLoading}
          >
            <MaterialCommunityIcons 
              name={isLoading ? "refresh" : "sync"} 
              size={20} 
              color={isLoading ? THEME.colors.textSecondary : THEME.colors.primary} 
            />
          </TouchableOpacity>
        </View>
        <View style={styles.headerBottom}>
          <Text style={styles.subtitle}>
            {isLoading ? 'Cargando...' : `${products.length} productos`}
          </Text>
          {lastSync && (
            <Text style={styles.syncInfo}>
              Última sincronización: {lastSync.toLocaleTimeString()}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.searchContainer}>
        <MaterialCommunityIcons name="magnify" size={20} color={THEME.colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por código o descripción..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={THEME.colors.textSecondary}
        />
        {searchQuery !== '' && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialCommunityIcons name="close-circle" size={20} color={THEME.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: SPACING.small, marginHorizontal: SPACING.medium, marginBottom: SPACING.medium }}>
        <TouchableOpacity 
          style={[styles.addButton, { flex: 1 }]} 
          onPress={() => openForm()}
        >
          <MaterialCommunityIcons name="plus" size={20} color="#FFF" />
          <Text style={styles.addButtonText}>Nuevo Producto</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: '#0EA5E9', flex: 1 }]} 
          onPress={() => setImportVisible(true)}
        >
          <MaterialCommunityIcons name="file-import" size={20} color="#FFF" />
          <Text style={styles.addButtonText}>Importar CSV</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <MaterialCommunityIcons name="loading" size={48} color={THEME.colors.primary} />
          <Text style={styles.loadingText}>Buscando productos en el sistema...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="package-variant-closed" size={48} color={THEME.colors.textSecondary} />
              <Text style={styles.emptyText}>
                No hay productos clasificados
              </Text>
              <Text style={[styles.helperText, { textAlign: 'center', marginTop: SPACING.small }]}>
                El sistema buscará automáticamente productos en:
              </Text>
              <View style={styles.sourcesList}>
                <Text style={styles.sourceItem}>• Inventario / Stock</Text>
                <Text style={styles.sourceItem}>• Carga Inicial</Text>
                <Text style={styles.sourceItem}>• Transferencias</Text>
                <Text style={styles.sourceItem}>• Compras</Text>
              </View>
              <Text style={[styles.helperText, { textAlign: 'center', marginTop: SPACING.small }]}>
                O crea manualmente usando el botón "Nuevo Producto"
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.productCard}>
              <View style={styles.productInfo}>
                <View style={styles.codeContainer}>
                  <Text style={styles.code}>{item.code}</Text>
                  <View style={styles.unitBadge}>
                    <Text style={styles.unitBadgeText}>{item.unit}</Text>
                  </View>
                  {item.source && (
                    <View style={styles.sourceBadge}>
                      <MaterialCommunityIcons name="database" size={10} color="#666" />
                    </View>
                  )}
                </View>
                <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
                <View style={styles.productFooter}>
                  <Text style={styles.createdAt}>
                    {isoToDisplay(item.createdAt)}
                  </Text>
                  {item.source && (
                    <Text style={styles.sourceText} numberOfLines={1}>
                      {item.source.split('.')[0]}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => openForm(item)}
                >
                  <MaterialCommunityIcons name="pencil" size={18} color="#2563EB" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => deleteProduct(item.id)}
                >
                  <MaterialCommunityIcons name="trash-can" size={18} color="#DC2626" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Modales (mantener igual) */}
      {/* Form Modal */}
      <Modal visible={modalVisible} animationType="slide" onRequestClose={closeForm}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeForm} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color={THEME.colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingId ? '✏️ Editar Producto' : '➕ Nuevo Producto'}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.formContent}>
            <View style={styles.formSection}>
              <Text style={styles.formLabel}>Código del Producto *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Ej: PROD001"
                value={formCode}
                onChangeText={setFormCode}
                autoCapitalize="characters"
                editable={!editingId}
                placeholderTextColor={THEME.colors.textSecondary}
              />
              {editingId && (
                <Text style={styles.helperText}>El código no se puede cambiar después de crear el producto</Text>
              )}
            </View>

            <View style={styles.formSection}>
              <Text style={styles.formLabel}>Descripción del Producto *</Text>
              <TextInput
                style={[styles.formInput, styles.descriptionInput]}
                placeholder="Ej: Bebida gaseosa 2L"
                value={formDescription}
                onChangeText={setFormDescription}
                multiline
                numberOfLines={3}
                placeholderTextColor={THEME.colors.textSecondary}
              />
            </View>

            <View style={styles.formSection}>
              <Text style={styles.formLabel}>Unidad de Medida</Text>
              <View style={styles.unitDisplay}>
                <Text style={styles.unitDisplayText}>Uno</Text>
                <MaterialCommunityIcons name="lock" size={16} color={THEME.colors.textSecondary} />
              </View>
              <Text style={styles.helperText}>La unidad de medida siempre será "Uno"</Text>
            </View>

            <View style={styles.infoBox}>
              <MaterialCommunityIcons name="information-outline" size={18} color="#0EA5E9" />
              <Text style={styles.infoText}>
                Los productos clasificados se podrán usar en los tipos de entrada (compras, transferencias, ajustes)
              </Text>
            </View>
          </View>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelButton} onPress={closeForm}>
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={saveProduct}>
              <Text style={styles.saveButtonText}>
                {editingId ? 'Actualizar' : 'Crear'} Producto
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* CSV Import Modal (mantener igual) */}
      <Modal visible={importVisible} animationType="slide" onRequestClose={() => setImportVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setImportVisible(false)} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={24} color={THEME.colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>📥 Importar Clasificador (CSV)</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView style={{ flex: 1, paddingHorizontal: SPACING.medium, paddingVertical: SPACING.large }}>
            <Text style={styles.formLabel}>Pega el CSV con columnas: código, descripción</Text>
            <Text style={styles.helperText}>Ejemplo: COCA001,Bebida Gaseosa 2L</Text>
            
            <TouchableOpacity
              onPress={pickCsvFile}
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.small,
                backgroundColor: THEME.colors.surfaceVariant,
                borderWidth: 1,
                borderColor: THEME.colors.outline,
                paddingHorizontal: SPACING.small,
                paddingVertical: SPACING.small,
                borderRadius: THEME.radii.md,
                marginBottom: SPACING.small,
                marginTop: SPACING.small,
              }}
            >
              <MaterialCommunityIcons name="file-upload" size={18} color={THEME.colors.primary} />
              <Text style={{ color: THEME.colors.primary, fontWeight: '700' }}>Seleccionar archivo CSV</Text>
            </TouchableOpacity>
            
            <TextInput
              style={[styles.formInput, { minHeight: 140, textAlignVertical: 'top' }]}
              placeholder={"COCA001,Bebida Gaseosa 2L\nAGUA001,Agua Mineral 500ml\nPAN001,Pan Blanco"}
              value={csvText}
              onChangeText={setCsvText}
              multiline
              autoCapitalize="characters"
            />
            
            <View style={styles.infoBox}>
              <MaterialCommunityIcons name="information-outline" size={18} color="#0EA5E9" />
              <Text style={styles.infoText}>
                Los códigos duplicados se actualizan, los nuevos se crean. 
                La unidad de medida se establecerá automáticamente como "Uno".
                Esta importación no modifica el inventario.
              </Text>
            </View>
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setImportVisible(false)}>
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={() => importFromCsv(csvText)} disabled={!csvText.trim()}>
              <Text style={styles.saveButtonText}>Importar</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  header: {
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.medium,
    backgroundColor: THEME.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.outline,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.tiny,
  },
  headerBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: THEME.colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
  },
  syncButton: {
    padding: SPACING.small,
  },
  syncInfo: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    fontStyle: 'italic',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface,
    marginHorizontal: SPACING.medium,
    marginVertical: SPACING.small,
    paddingHorizontal: SPACING.small,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.small,
    fontSize: 14,
    color: THEME.colors.text,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.small,
    paddingVertical: SPACING.medium,
    backgroundColor: THEME.colors.primary,
    borderRadius: THEME.radii.md,
  },
  addButtonText: {
    color: THEME.colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xlarge,
  },
  loadingText: {
    marginTop: SPACING.medium,
    fontSize: 15,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: SPACING.medium,
    paddingBottom: SPACING.large,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xlarge,
    paddingHorizontal: SPACING.large,
  },
  emptyText: {
    marginTop: SPACING.medium,
    fontSize: 15,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  sourcesList: {
    marginTop: SPACING.small,
    alignItems: 'flex-start',
    width: '100%',
  },
  sourceItem: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginVertical: SPACING.tiny,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    padding: SPACING.medium,
    marginBottom: SPACING.small,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  productInfo: {
    flex: 1,
  },
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.small,
    marginBottom: SPACING.tiny,
  },
  code: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.primary,
    backgroundColor: THEME.colors.surfaceVariant,
    paddingHorizontal: SPACING.small,
    paddingVertical: 2,
    borderRadius: THEME.radii.sm,
  },
  unitBadge: {
    paddingHorizontal: SPACING.small,
    paddingVertical: 2,
    backgroundColor: '#E0F2FE',
    borderRadius: THEME.radii.sm,
  },
  unitBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0369A1',
  },
  sourceBadge: {
    padding: 2,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
  productFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  createdAt: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
  },
  sourceText: {
    fontSize: 10,
    color: '#666',
    fontStyle: 'italic',
    maxWidth: 100,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.small,
    marginLeft: SPACING.small,
  },
  editButton: {
    padding: SPACING.small,
    backgroundColor: '#EFF6FF',
    borderRadius: THEME.radii.sm,
  },
  deleteButton: {
    padding: SPACING.small,
    backgroundColor: '#FEE2E2',
    borderRadius: THEME.radii.sm,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  modalHeader: {
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
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  formContent: {
    flex: 1,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.large,
  },
  formSection: {
    marginBottom: SPACING.large,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: SPACING.small,
  },
  formInput: {
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    borderRadius: THEME.radii.md,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.small,
    fontSize: 14,
    color: THEME.colors.text,
    backgroundColor: THEME.colors.surface,
  },
  descriptionInput: {
    textAlignVertical: 'top',
    minHeight: 80,
  },
  helperText: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginTop: SPACING.tiny,
    fontStyle: 'italic',
  },
  unitDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    borderRadius: THEME.radii.md,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.small,
    backgroundColor: THEME.colors.surfaceVariant,
  },
  unitDisplayText: {
    fontSize: 14,
    color: THEME.colors.text,
    fontWeight: '500',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.small,
    padding: SPACING.medium,
    backgroundColor: '#E0F2FE',
    borderRadius: THEME.radii.md,
    marginVertical: SPACING.large,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#0369A1',
    lineHeight: 18,
  },
  modalFooter: {
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
    fontSize: 15,
  },
  saveButton: {
    flex: 1,
    paddingVertical: SPACING.medium,
    backgroundColor: THEME.colors.primary,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  saveButtonText: {
    fontWeight: '700',
    color: THEME.colors.onPrimary,
    fontSize: 15,
  },
});