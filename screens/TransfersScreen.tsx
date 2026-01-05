import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Platform, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthSafe } from '../hooks/useAuth';
import {
  getProducts,
  getStores,
  getProductStockInStore,
  generateTransferSuggestions,
  getTransferRequests,
  approveTransferRequest,
  rejectTransferRequest,
  initDb,
  createTransferRequest,
} from '../lib/db';
import { TransferRequest, Product, Store, User } from '../types';
import { THEME, SPACING } from '../lib/theme';
import { dateToDisplay } from '../lib/date';

type StockSummary = {
  productId: string;
  productName: string;
  stores: Array<{ storeId: string; storeName: string; quantity: number }>;
  totalStock: number;
};

// Type for editable transfers with quantity modification
type EditableTransfer = TransferRequest & {
  editableQuantity: number;
};

export default function TransfersScreen() {
  const { user } = useAuthSafe();
  const [products, setProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<EditableTransfer[]>([]);
  const [sentTransfers, setSentTransfers] = useState<TransferRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [productStockMap, setProductStockMap] = useState<StockSummary[]>([]);
  
  // Estados para exportar/importar transferencias
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  
  // New: Manual transfer modal
  const [manualTransferModalVisible, setManualTransferModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [fromStoreId, setFromStoreId] = useState<string>('');
  const [toStoreId, setToStoreId] = useState<string>('');
  const [transferQuantity, setTransferQuantity] = useState<string>('');
  const [costPrice, setCostPrice] = useState<string>('');
  const [salePrice, setSalePrice] = useState<string>('');
  
  // New: Transfer summary modal for viewing by store
  const [summaryModalVisible, setSummaryModalVisible] = useState(false);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [transferSummary, setTransferSummary] = useState<Array<{
    transfer: EditableTransfer;
    product: Product | null;
    fromStore: Store | null;
    toStore: Store | null;
  }>>([]);
  
  // Active tab: 'pending' or 'sent'
  const [activeTab, setActiveTab] = useState<'pending' | 'sent'>('pending');
  
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    loadData();
  }, []);
  
  async function loadData() {
    try {
      await initDb();
      const [productsData, storesData, allTransfers] = await Promise.all([
        getProducts(),
        getStores(),
        getTransferRequests(), // Get all transfers
      ]);
      const activeStores = storesData.filter(s => s.active);
      setProducts(productsData);
      setStores(activeStores);
      
      // Split transfers into pending and sent (approved/rejected)
      const pending = allTransfers.filter(t => t.status === 'pending').map(t => ({
        ...t,
        editableQuantity: t.quantity, // Initialize editable quantity
      }));
      const sent = allTransfers.filter(t => t.status !== 'pending').slice(0, 20);
      
      setPendingTransfers(pending);
      setSentTransfers(sent);

      // Build real stock summary per product and per store
      const stockSummaries: StockSummary[] = [];
      for (const product of productsData) {
        let totalStock = 0;
        const perStore: Array<{ storeId: string; storeName: string; quantity: number }> = [];
        for (const store of activeStores) {
          const qty = await getProductStockInStore(product.id, store.id);
          perStore.push({ storeId: store.id, storeName: store.name, quantity: qty });
          totalStock += qty;
        }
        stockSummaries.push({ productId: product.id, productName: product.name, stores: perStore, totalStock });
      }
      setProductStockMap(stockSummaries);
    } catch (err) {
      console.error('Load transfer data error:', err);
    } finally {
      setLoading(false);
    }
  }
  
  const handleGenerateSuggestions = async () => {
    try {
      setGeneratingSuggestions(true);
      const count = await generateTransferSuggestions();
      if (count > 0) {
        Alert.alert('✅ Sugerencias generadas', `Se crearon ${count} sugerencia(s) de transferencia`);
        await loadData();
      } else {
        Alert.alert('ℹ️ Sin sugerencias', 'No se encontraron necesidades de transferencia');
      }
    } catch (error) {
      Alert.alert('Error', 'No se pudieron generar sugerencias');
      console.error(error);
    } finally {
      setGeneratingSuggestions(false);
    }
  };
  
  // Update transfer quantity in the summary
  const updateTransferQuantity = (transferId: string, newQuantity: number) => {
    setPendingTransfers(prev => 
      prev.map(t => t.id === transferId ? { ...t, editableQuantity: newQuantity } : t)
    );
  };
  
  // Remove transfer from pending list
  const removeTransfer = (transferId: string) => {
    Alert.alert(
      '¿Eliminar transferencia?',
      'Esta transferencia se eliminará de la lista de pendientes',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            setPendingTransfers(prev => prev.filter(t => t.id !== transferId));
            // Also remove from summary if modal is open
            setTransferSummary(prev => prev.filter(t => t.transfer.id !== transferId));
          },
        },
      ]
    );
  };
  
  const handleApprove = async (transferId: string) => {
    if (!user?.id) return;
    
    // Find the transfer and use its editable quantity
    const transfer = pendingTransfers.find(t => t.id === transferId);
    if (!transfer) return;
    
    // If quantity was modified, we need to update the transfer request first
    // For now, we'll just approve with the current quantity in DB
    // TODO: If you want to use editableQuantity, you'd need an update function in db.ts
    
    try {
      await approveTransferRequest(transferId, user.id);
      Alert.alert('✅ Transferencia autorizada', 'El inventario se actualizó correctamente');
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo aprobar la transferencia');
    }
  };
  
  const handleReject = async (transferId: string) => {
    if (!user?.id) return;
    
    Alert.alert(
      '¿Rechazar transferencia?',
      `Se descartará la solicitud sin mover inventario.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Rechazar',
          style: 'destructive',
          onPress: async () => {
            try {
              await rejectTransferRequest(transferId, user.id);
              Alert.alert('❌ Transferencia rechazada', 'La solicitud fue descartada');
              await loadData();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'No se pudo rechazar la transferencia');
            }
          },
        },
      ]
    );
  };

  // Helper: get stock for a specific store using computed map
  const getStockForStore = (productId: string, storeId: string): number => {
    const rec = productStockMap.find(p => p.productId === productId);
    if (!rec) return 0;
    const s = rec.stores.find(st => st.storeId === storeId);
    return s?.quantity ?? 0;
  };

  // Create manual transfer
  const handleCreateManualTransfer = async () => {
    if (!selectedProduct || !fromStoreId || !toStoreId || !transferQuantity || !user?.id) {
      Alert.alert('Error', 'Complete todos los campos requeridos');
      return;
    }

    const qty = parseInt(transferQuantity);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Error', 'La cantidad debe ser mayor a 0');
      return;
    }

    const availableStock = getStockForStore(selectedProduct.id, fromStoreId);
    if (qty > availableStock) {
      Alert.alert('Error', `Stock insuficiente. Disponible: ${availableStock} unidades`);
      return;
    }

    const cost = parseFloat(costPrice) || 0;
    const sale = parseFloat(salePrice) || 0;
    const costTotal = cost * qty;
    const saleTotal = sale * qty;

    try {
      await createTransferRequest({
        productId: selectedProduct.id,
        fromStoreId,
        toStoreId,
        quantity: qty,
        note: `Transferencia manual - Costo: $${cost.toFixed(2)}/u, Venta: $${sale.toFixed(2)}/u | Total Costo: $${costTotal.toFixed(2)}, Total Venta: $${saleTotal.toFixed(2)}`,
        suggestedBy: user.id,
      });

      Alert.alert('✅ Transferencia creada', 'La transferencia manual fue creada exitosamente');
      setManualTransferModalVisible(false);
      resetManualTransferForm();
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'No se pudo crear la transferencia');
    }
  };

  const resetManualTransferForm = () => {
    setSelectedProduct(null);
    setFromStoreId('');
    setToStoreId('');
    setTransferQuantity('');
    setCostPrice('');
    setSalePrice('');
  };

  // Calculate totals for manual transfer
  const qty = parseInt(transferQuantity) || 0;
  const cost = parseFloat(costPrice) || 0;
  const sale = parseFloat(salePrice) || 0;
  const costTotal = cost * qty;
  const saleTotal = sale * qty;
  const availableStock = selectedProduct && fromStoreId 
    ? getStockForStore(selectedProduct.id, fromStoreId) 
    : 0;

  // Open summary modal for a specific store
  const openStoreSummary = (store: Store) => {
    const storeTransfers = pendingTransfers
      .filter(t => t.toStoreId === store.id)
      .map(t => ({
        transfer: t,
        product: products.find(p => p.id === t.productId) || null,
        fromStore: stores.find(s => s.id === t.fromStoreId) || null,
        toStore: stores.find(s => s.id === t.toStoreId) || null,
      }));
    
    setSelectedStore(store);
    setTransferSummary(storeTransfers);
    setSummaryModalVisible(true);
  };
  
  // Approve all transfers in summary
  const handleApproveSummary = async () => {
    if (!user?.id || transferSummary.length === 0) return;
    
    Alert.alert(
      'Confirmar todas las transferencias',
      `¿Autorizar ${transferSummary.length} transferencia(s) hacia ${selectedStore?.name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Autorizar Todas',
          onPress: async () => {
            try {
              for (const { transfer } of transferSummary) {
                await approveTransferRequest(transfer.id, user.id);
              }
              Alert.alert('✅ Transferencias autorizadas', `${transferSummary.length} transferencias procesadas`);
              setSummaryModalVisible(false);
              await loadData();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'No se pudieron aprobar todas las transferencias');
            }
          },
        },
      ]
    );
  };

  // Función para exportar transferencias pendientes como JSON
  async function exportPendingTransfers() {
    try {
      if (pendingTransfers.length === 0) {
        Alert.alert('Sin transferencias', 'No hay transferencias pendientes para exportar');
        return;
      }

      // Enriquecer transferencias con datos de productos para facilitar importación
      const enrichedTransfers = pendingTransfers.map(transfer => {
        const product = products.find(p => p.id === transfer.productId);
        const fromStore = stores.find(s => s.id === transfer.fromStoreId);
        const toStore = stores.find(s => s.id === transfer.toStoreId);

        return {
          ...transfer,
          productName: product?.name || 'Desconocido',
          fromStoreName: fromStore?.name || 'Desconocido',
          toStoreName: toStore?.name || 'Desconocido',
        };
      });

      const payload = {
        transfers: enrichedTransfers,
        exportedAt: new Date().toISOString(),
        exportedBy: user?.email || 'Admin',
      };

      const jsonData = JSON.stringify(payload, null, 2);
      const filename = `transferencias_${new Date().toISOString().slice(0, 10)}.json`;

      if (Platform.OS === 'web') {
        // Web: descargar como archivo
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert('✅ Exportado', `${pendingTransfers.length} transferencias exportadas`);
        return;
      }

      // Android/iOS: guardar en carpeta elegida (Descargas recomendado)
      const { exportJSONFile } = await import('../lib/file');
      await exportJSONFile(filename, payload);
      Alert.alert('✅ Exportado', `Archivo guardado: ${filename}\nSi es la primera vez, elige Descargas/Download.`);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'No se pudo exportar');
    }
  }

  // Permitir seleccionar archivo JSON y precargarlo para importar
  async function pickJsonFile() {
    try {
      if (Platform.OS === 'web') {
        const DocumentPicker = await import('expo-document-picker');
        const result = await (DocumentPicker as any).getDocumentAsync({
          type: ['application/json', 'text/plain'],
          copyToCacheDirectory: true,
          multiple: false,
        } as any);

        const asset = (result as any)?.assets?.[0];
        const uri = asset?.uri || (result as any)?.uri;
        const canceled = (result as any)?.canceled === true || (result as any)?.type === 'cancel';
        if (canceled || !uri) return;

        const { File } = await import('expo-file-system');
        const file = new File(uri);
        const content = await file.text();
        try {
          const parsed = JSON.parse(content);
          setImportJsonText(JSON.stringify(parsed, null, 2));
        } catch {
          setImportJsonText(content);
        }
        setImportModalVisible(true);
        return;
      }

      // Android/iOS
      const { importJSONFile } = await import('../lib/file');
      const data = await importJSONFile<any>();
      if (!data) return;
      setImportJsonText(JSON.stringify(data, null, 2));
      setImportModalVisible(true);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo leer el archivo JSON');
    }
  }

  // Función para importar transferencias desde JSON (vendedor recibe y confirma en su tienda)
  async function importTransfers() {
    try {
      if (!importJsonText.trim()) {
        Alert.alert('Error', 'Pegue el contenido JSON de las transferencias');
        return;
      }

      const data = JSON.parse(importJsonText);
      if (!data.transfers || !Array.isArray(data.transfers)) {
        Alert.alert('Error', 'Formato JSON inválido');
        return;
      }

      // Filtrar solo transferencias dirigidas a la tienda del vendedor (si no es admin)
      let transfersToImport = data.transfers;
      if (!isAdmin && user?.storeId) {
        transfersToImport = data.transfers.filter((t: any) => t.toStoreId === user.storeId);
        if (transfersToImport.length === 0) {
          Alert.alert('Sin transferencias', 'No hay transferencias dirigidas a tu tienda en este archivo');
          return;
        }
      }

      Alert.alert(
        'Confirmar Importación',
        `¿Desea importar ${transfersToImport.length} transferencia(s) y marcarlas como aprobadas?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Importar y Aprobar',
            onPress: async () => {
              try {
                let successCount = 0;
                for (const transfer of transfersToImport) {
                  // Verificar que el producto existe
                  const product = products.find(p => p.id === transfer.productId);
                  if (!product) continue;

                  // Auto-aprobar la transferencia: ejecutar transfer_out y transfer_in
                  await approveTransferRequest(transfer.id, user?.id || 'imported');
                  successCount++;
                }

                Alert.alert('✅ Importación exitosa', `${successCount} transferencia(s) importadas y aplicadas`);
                setImportModalVisible(false);
                setImportJsonText('');
                await loadData();
              } catch (error: any) {
                Alert.alert('Error al importar', error?.message || 'No se pudieron importar todas las transferencias');
              }
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Error', 'JSON inválido: ' + (error?.message || error));
    }
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed" size={48} color={THEME.colors.error} />
          <Text style={styles.errorText}>Solo administradores pueden gestionar transferencias</Text>
        </View>
      </SafeAreaView>
    );
  }
  
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={THEME.colors.primary} />
          <Text style={styles.loadingText}>Cargando inventario...</Text>
        </View>
      </SafeAreaView>
    );
  }
  
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.content}>
        <Text style={styles.heading}>Transferencias entre Áreas</Text>

        {/* Botones Exportar / Importar / Manual */}
        <View style={styles.exportImportSection}>
          <TouchableOpacity style={styles.exportBtn} onPress={exportPendingTransfers}>
            <Text style={styles.exportBtnText}>📤 Exportar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.importBtn}
            onPress={() => {
              // En web, abrir selector de archivo directamente; en móvil, abrir modal con opción de pegar/seleccionar
              if (Platform.OS === 'web') {
                pickJsonFile();
              } else {
                setImportModalVisible(true);
              }
            }}
          >
            <Text style={styles.importBtnText}>📥 Importar</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.manualBtn} 
            onPress={() => setManualTransferModalVisible(true)}
          >
            <Text style={styles.manualBtnText}>✏️ Manual</Text>
          </TouchableOpacity>
        </View>

        {/* Generate Suggestions Button */}
        <TouchableOpacity 
          style={styles.generateBtn} 
          onPress={handleGenerateSuggestions}
          disabled={!isAdmin || generatingSuggestions}
        >
          <Text style={styles.generateBtnText}>
            {generatingSuggestions ? '⏳ Generando...' : '🤖 Generar Sugerencias Automáticas'}
          </Text>
        </TouchableOpacity>

        {/* Tabs for Pending vs Sent */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'pending' && styles.tabActive]}
            onPress={() => setActiveTab('pending')}
          >
            <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>
              ⏳ Pendientes ({pendingTransfers.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'sent' && styles.tabActive]}
            onPress={() => setActiveTab('sent')}
          >
            <Text style={[styles.tabText, activeTab === 'sent' && styles.tabTextActive]}>
              📤 Enviadas ({sentTransfers.length})
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'pending' ? (
          <>
            {/* Summary by Store Buttons */}
            {pendingTransfers.length > 0 && (
              <View style={styles.summarySection}>
                <Text style={styles.sectionTitle}>📊 Ver Resumen por Tienda</Text>
                <View style={styles.storeButtons}>
                  {stores.map(store => {
                    const storeTransferCount = pendingTransfers.filter(t => t.toStoreId === store.id).length;
                    if (storeTransferCount === 0) return null;
                    
                    return (
                      <TouchableOpacity
                        key={store.id}
                        style={styles.storeSummaryBtn}
                        onPress={() => openStoreSummary(store)}
                      >
                        <Text style={styles.storeSummaryBtnText}>
                          {store.name} ({storeTransferCount})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Pending Transfers */}
            <View style={styles.pendingSection}>
              <Text style={styles.sectionTitle}>
                ⏳ Todas las Transferencias Pendientes ({pendingTransfers.length})
              </Text>
              {pendingTransfers.map(transfer => {
                const product = products.find(p => p.id === transfer.productId);
                const fromStore = stores.find(s => s.id === transfer.fromStoreId);
                const toStore = stores.find(s => s.id === transfer.toStoreId);
                
                if (!product || !fromStore || !toStore) return null;

                const fromStock = getStockForStore(transfer.productId, transfer.fromStoreId);
                const toStock = getStockForStore(transfer.productId, transfer.toStoreId);

                return (
                  <View key={transfer.id} style={styles.transferCard}>
                    <View style={styles.transferHeader}>
                      <Text style={styles.transferProduct}>{product.name}</Text>
                      {transfer.suggestedBy === 'system' && (
                        <View style={styles.autoTag}>
                          <Text style={styles.autoTagText}>Auto</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        style={styles.deleteTransferBtn}
                        onPress={() => removeTransfer(transfer.id)}
                      >
                        <Text style={styles.deleteTransferBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.transferRoute}>
                      <View style={styles.storeBox}>
                        <Text style={styles.storeLabel}>Desde</Text>
                        <Text style={styles.storeName}>{fromStore.name}</Text>
                        <Text style={styles.currentStock}>Stock: {fromStock}</Text>
                      </View>
                      <Text style={styles.arrow}>→</Text>
                      <View style={styles.quantityBox}>
                        <TextInput
                          style={styles.quantityInput}
                          value={String(transfer.editableQuantity)}
                          onChangeText={(val) => {
                            const num = parseInt(val) || 0;
                            updateTransferQuantity(transfer.id, num);
                          }}
                          keyboardType="numeric"
                        />
                        <Text style={styles.quantityLabel}>unidades</Text>
                      </View>
                      <Text style={styles.arrow}>→</Text>
                      <View style={styles.storeBox}>
                        <Text style={styles.storeLabel}>Hacia</Text>
                        <Text style={styles.storeName}>{toStore.name}</Text>
                        <Text style={styles.currentStock}>Stock: {toStock}</Text>
                      </View>
                    </View>
                    {transfer.note && (
                      <Text style={styles.transferNote}>{transfer.note}</Text>
                    )}
                    <View style={styles.transferActions}>
                      <TouchableOpacity
                        style={styles.rejectBtn}
                        onPress={() => handleReject(transfer.id)}
                      >
                        <Text style={styles.rejectBtnText}>✕ Rechazar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.approveBtn}
                        onPress={() => handleApprove(transfer.id)}
                      >
                        <Text style={styles.approveBtnText}>✓ Autorizar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              {pendingTransfers.length === 0 && (
                <Text style={styles.emptyText}>No hay transferencias pendientes</Text>
              )}
            </View>
          </>
        ) : (
          <>
            {/* Sent Transfers (Approved/Rejected) */}
            <View style={styles.historySection}>
              <Text style={styles.sectionTitle}>📤 Transferencias Enviadas</Text>
              {sentTransfers.map(transfer => {
                const product = products.find(p => p.id === transfer.productId);
                const fromStore = stores.find(s => s.id === transfer.fromStoreId);
                const toStore = stores.find(s => s.id === transfer.toStoreId);
                
                if (!product || !fromStore || !toStore) return null;

                return (
                  <View key={transfer.id} style={[
                    styles.historyCard,
                    transfer.status === 'approved' ? styles.historyApproved : styles.historyRejected
                  ]}>
                    <View style={styles.historyHeader}>
                      <Text style={styles.historyProduct}>{product.name}</Text>
                      <View style={[
                        styles.statusBadge,
                        transfer.status === 'approved' ? styles.statusApproved : styles.statusRejected
                      ]}>
                        <Text style={styles.statusText}>
                          {transfer.status === 'approved' ? '✓ Aprobada' : '✕ Rechazada'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.historyRoute}>
                      {fromStore.name} → {toStore.name} ({transfer.quantity} unidades)
                    </Text>
                    <Text style={styles.historyDate}>
                      {dateToDisplay(new Date(transfer.approvedAt || transfer.createdAt))} 
                      {transfer.approvedAt && ` • ${new Date(transfer.approvedAt).toLocaleTimeString()}`}
                    </Text>
                    {transfer.note && (
                      <Text style={styles.historyNote}>{transfer.note}</Text>
                    )}
                  </View>
                );
              })}
              {sentTransfers.length === 0 && (
                <Text style={styles.emptyText}>No hay transferencias enviadas</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Manual Transfer Modal */}
      <Modal
        visible={manualTransferModalVisible}
        animationType="slide"
        onRequestClose={() => {
          setManualTransferModalVisible(false);
          resetManualTransferForm();
        }}
      >
        <SafeAreaView style={styles.manualModalContainer}>
          <View style={styles.manualModalHeader}>
            <Text style={styles.manualModalTitle}>✏️ Transferencia Manual</Text>
            <TouchableOpacity
              onPress={() => {
                setManualTransferModalVisible(false);
                resetManualTransferForm();
              }}
            >
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.manualModalContent}>
            {/* Select Product */}
            <Text style={styles.manualInputLabel}>Producto *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.productScrollView}>
              {products.map(product => (
                <TouchableOpacity
                  key={product.id}
                  style={[
                    styles.productChip,
                    selectedProduct?.id === product.id && styles.productChipSelected
                  ]}
                  onPress={() => setSelectedProduct(product)}
                >
                  <Text style={[
                    styles.productChipText,
                    selectedProduct?.id === product.id && styles.productChipTextSelected
                  ]}>
                    {product.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* From Store */}
            <Text style={styles.manualInputLabel}>Tienda que Emite *</Text>
            <View style={styles.storeChipsContainer}>
              {stores.map(store => (
                <TouchableOpacity
                  key={store.id}
                  style={[
                    styles.storeChip,
                    fromStoreId === store.id && styles.storeChipSelected
                  ]}
                  onPress={() => setFromStoreId(store.id)}
                >
                  <Text style={[
                    styles.storeChipText,
                    fromStoreId === store.id && styles.storeChipTextSelected
                  ]}>
                    {store.name}
                  </Text>
                  {selectedProduct && (
                    <Text style={[
                      styles.storeChipStock,
                      fromStoreId === store.id && styles.storeChipStockSelected
                    ]}>
                      Stock: {getStockForStore(selectedProduct.id, store.id)}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* To Store */}
            <Text style={styles.manualInputLabel}>Tienda que Recibe *</Text>
            <View style={styles.storeChipsContainer}>
              {stores.map(store => (
                <TouchableOpacity
                  key={store.id}
                  style={[
                    styles.storeChip,
                    toStoreId === store.id && styles.storeChipSelected
                  ]}
                  onPress={() => setToStoreId(store.id)}
                >
                  <Text style={[
                    styles.storeChipText,
                    toStoreId === store.id && styles.storeChipTextSelected
                  ]}>
                    {store.name}
                  </Text>
                  {selectedProduct && (
                    <Text style={[
                      styles.storeChipStock,
                      toStoreId === store.id && styles.storeChipStockSelected
                    ]}>
                      Stock: {getStockForStore(selectedProduct.id, store.id)}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Stock Available */}
            {selectedProduct && fromStoreId && (
              <View style={styles.stockInfoBox}>
                <Ionicons name="information-circle" size={20} color={THEME.colors.primary} />
                <Text style={styles.stockInfoText}>
                  Stock disponible en origen: <Text style={styles.stockInfoValue}>{availableStock}</Text> unidades
                </Text>
              </View>
            )}

            {/* Quantity */}
            <Text style={styles.manualInputLabel}>Cantidad a Transferir *</Text>
            <TextInput
              style={styles.manualTextInput}
              value={transferQuantity}
              onChangeText={setTransferQuantity}
              keyboardType="numeric"
              placeholder="0"
            />

            {/* Cost Price */}
            <Text style={styles.manualInputLabel}>Precio de Costo (por unidad)</Text>
            <TextInput
              style={styles.manualTextInput}
              value={costPrice}
              onChangeText={setCostPrice}
              keyboardType="numeric"
              placeholder="0.00"
            />

            {/* Sale Price */}
            <Text style={styles.manualInputLabel}>Precio de Venta (por unidad)</Text>
            <TextInput
              style={styles.manualTextInput}
              value={salePrice}
              onChangeText={setSalePrice}
              keyboardType="numeric"
              placeholder="0.00"
            />

            {/* Summary Box */}
            {qty > 0 && (cost > 0 || sale > 0) && (
              <View style={styles.summaryBox}>
                <Text style={styles.summaryBoxTitle}>📊 Resumen de la Transferencia</Text>
                
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Cantidad:</Text>
                  <Text style={styles.summaryValue}>{qty} unidades</Text>
                </View>

                {cost > 0 && (
                  <>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Precio de Costo/u:</Text>
                      <Text style={styles.summaryValue}>${cost.toFixed(2)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Importe al Costo:</Text>
                      <Text style={[styles.summaryValue, styles.summaryTotal]}>${costTotal.toFixed(2)}</Text>
                    </View>
                  </>
                )}

                {sale > 0 && (
                  <>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Precio de Venta/u:</Text>
                      <Text style={styles.summaryValue}>${sale.toFixed(2)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Importe a la Venta:</Text>
                      <Text style={[styles.summaryValue, styles.summaryTotal]}>${saleTotal.toFixed(2)}</Text>
                    </View>
                  </>
                )}

                <View style={styles.summaryDivider} />
                
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabelBold}>Total de la Transferencia:</Text>
                  <Text style={styles.summaryValueBold}>
                    {cost > 0 && sale > 0 
                      ? `$${costTotal.toFixed(2)} - $${saleTotal.toFixed(2)}`
                      : cost > 0 
                      ? `$${costTotal.toFixed(2)}`
                      : `$${saleTotal.toFixed(2)}`
                    }
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          <View style={styles.manualModalFooter}>
            <TouchableOpacity
              style={styles.cancelManualBtn}
              onPress={() => {
                setManualTransferModalVisible(false);
                resetManualTransferForm();
              }}
            >
              <Text style={styles.cancelManualBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.createManualBtn,
                (!selectedProduct || !fromStoreId || !toStoreId || !transferQuantity) && styles.createManualBtnDisabled
              ]}
              onPress={handleCreateManualTransfer}
              disabled={!selectedProduct || !fromStoreId || !toStoreId || !transferQuantity}
            >
              <Text style={styles.createManualBtnText}>✓ Crear Transferencia</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Store Summary Modal */}
      <Modal visible={summaryModalVisible} animationType="slide" onRequestClose={() => setSummaryModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              📦 Resumen para {selectedStore?.name}
            </Text>
            <TouchableOpacity onPress={() => setSummaryModalVisible(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalContent}>
            {transferSummary.map(({ transfer, product, fromStore }) => (
              <View key={transfer.id} style={styles.summaryItem}>
                <View style={styles.summaryItemHeader}>
                  <Text style={styles.summaryProductName}>
                    {product?.name || 'Producto desconocido'}
                  </Text>
                  <TouchableOpacity
                    style={styles.removeItemBtn}
                    onPress={() => {
                      removeTransfer(transfer.id);
                      setTransferSummary(prev => prev.filter(t => t.transfer.id !== transfer.id));
                    }}
                  >
                    <Text style={styles.removeItemBtnText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.summaryFromStore}>
                  De: {fromStore?.name || 'Desconocido'}
                </Text>
                <View style={styles.summaryQuantityRow}>
                  <Text style={styles.summaryQuantityLabel}>Cantidad:</Text>
                  <TextInput
                    style={styles.summaryQuantityInput}
                    value={String(transfer.editableQuantity)}
                    onChangeText={(val) => {
                      const num = parseInt(val) || 0;
                      updateTransferQuantity(transfer.id, num);
                      // Update in summary too
                      setTransferSummary(prev => 
                        prev.map(t => 
                          t.transfer.id === transfer.id 
                            ? { ...t, transfer: { ...t.transfer, editableQuantity: num } }
                            : t
                        )
                      );
                    }}
                    keyboardType="numeric"
                  />
                  <Text style={styles.summaryQuantityUnit}>unidades</Text>
                </View>
              </View>
            ))}
            
            {transferSummary.length === 0 && (
              <Text style={styles.emptyText}>No hay productos en este resumen</Text>
            )}
          </ScrollView>
          
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.cancelModalBtn}
              onPress={() => setSummaryModalVisible(false)}
            >
              <Text style={styles.cancelModalBtnText}>Cerrar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.approveAllBtn, transferSummary.length === 0 && { opacity: 0.5 }]}
              onPress={handleApproveSummary}
              disabled={transferSummary.length === 0}
            >
              <Text style={styles.approveAllBtnText}>
                ✓ Autorizar Todas ({transferSummary.length})
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Modal para mostrar JSON exportado (fallback móvil) */}
      <Modal visible={exportModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📤 Transferencias Exportadas</Text>
            <Text style={styles.modalSubtitle}>Copie este JSON y compártalo:</Text>
            <ScrollView style={styles.jsonScrollView}>
              <Text style={styles.jsonText}>{importJsonText}</Text>
            </ScrollView>
            <TouchableOpacity style={styles.closeModalBtn} onPress={() => { setExportModalVisible(false); setImportJsonText(''); }}>
              <Text style={styles.closeModalBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal para importar JSON */}
      <Modal visible={importModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📥 Importar Transferencias</Text>
            <Text style={styles.modalSubtitle}>Pegue el JSON de transferencias exportadas:</Text>
            {/* Botón para elegir archivo JSON */}
            <TouchableOpacity
              onPress={pickJsonFile}
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
              }}
            >
              <MaterialCommunityIcons name="file-upload" size={18} color={THEME.colors.primary} />
              <Text style={{ color: THEME.colors.primary, fontWeight: '700' }}>Seleccionar archivo JSON</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.jsonInput}
              value={importJsonText}
              onChangeText={setImportJsonText}
              placeholder='{"transfers": [...]}'
              multiline
              textAlignVertical="top"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalActionBtn, styles.cancelModalBtn]} onPress={() => { setImportModalVisible(false); setImportJsonText(''); }}>
                <Text style={styles.cancelModalBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalActionBtn, styles.importModalBtn]} onPress={importTransfers}>
                <Text style={styles.importModalBtnText}>Importar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.large,
    paddingTop: SPACING.large,
    paddingBottom: SPACING.medium,
    gap: SPACING.small,
    backgroundColor: THEME.colors.surface,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: SPACING.large,
    paddingVertical: SPACING.medium,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.small,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.medium,
  },
  suggestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    borderRadius: THEME.radii.md,
    gap: SPACING.xs,
  },
  suggestionBtnDisabled: {
    opacity: 0.6,
  },
  suggestionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  productCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  productName: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: SPACING.xs,
  },
  totalStock: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.small,
  },
  storesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  storeChip: {
    backgroundColor: THEME.colors.surfaceVariant,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.xs,
    borderRadius: THEME.radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  storeChipName: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  storeChipQty: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary,
  },
  requestCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.lg,
    marginBottom: SPACING.medium,
    borderWidth: 2,
    borderColor: THEME.colors.primary,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.medium,
  },
  requestProductName: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
    flex: 1,
  },
  autoTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary,
    paddingHorizontal: SPACING.small,
    paddingVertical: 4,
    borderRadius: THEME.radii.sm,
    gap: 4,
  },
  autoTagText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  transferFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.medium,
  },
  transferBox: {
    flex: 1,
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  transferLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
    marginBottom: 4,
  },
  transferStore: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: 2,
  },
  transferQty: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  transferArrow: {
    alignItems: 'center',
    paddingHorizontal: SPACING.small,
  },
  transferQtyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.primary,
    marginTop: 4,
  },
  requestNote: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.small,
    fontStyle: 'italic',
  },
  requestActions: {
    flexDirection: 'row',
    gap: SPACING.small,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.medium,
    borderRadius: THEME.radii.md,
    gap: SPACING.xs,
  },
  approveBtn: {
    backgroundColor: '#10B981',
  },
  rejectBtn: {
    backgroundColor: THEME.colors.error,
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  badge: {
    backgroundColor: THEME.colors.primary,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    padding: SPACING.xlarge,
  },
  emptyText: {
    marginTop: SPACING.medium,
    fontSize: 14,
    color: THEME.colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xlarge,
  },
  errorText: {
    marginTop: SPACING.medium,
    fontSize: 16,
    color: THEME.colors.error,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: SPACING.medium,
    fontSize: 14,
    color: THEME.colors.textSecondary,
  },
  generateBtn: {
    backgroundColor: THEME.colors.primary,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    marginBottom: SPACING.large,
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  summarySection: {
    marginBottom: SPACING.large,
  },
  summaryCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  stockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  stockItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.small,
  },
  storeName: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  stockValue: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.textSecondary,
  },
  stockLow: {
    color: THEME.colors.error,
  },
  stockTotal: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  pendingSection: {
    marginBottom: SPACING.large,
  },
  transferCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  transferHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.medium,
  },
  transferProduct: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
    flex: 1,
  },
  transferRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.medium,
  },
  storeBox: {
    flex: 1,
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  storeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
    marginBottom: 4,
  },
  currentStock: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  quantityBox: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  quantity: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  quantityLabel: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  arrow: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.primary,
  },
  transferNote: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.small,
    fontStyle: 'italic',
  },
  transferActions: {
    flexDirection: 'row',
    gap: SPACING.small,
  },
  rejectBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  approveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  historySection: {
    marginTop: SPACING.large,
    paddingBottom: SPACING.xlarge,
  },
  historyCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
    borderLeftWidth: 4,
  },
  historyApproved: {
    borderLeftColor: '#10B981',
    backgroundColor: '#F0FDF4',
  },
  historyRejected: {
    borderLeftColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.tiny,
  },
  historyProduct: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: SPACING.small,
    paddingVertical: 4,
    borderRadius: THEME.radii.sm,
  },
  statusApproved: {
    backgroundColor: '#10B981',
  },
  statusRejected: {
    backgroundColor: '#EF4444',
  },
  statusText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  historyRoute: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginBottom: 4,
  },
  historyDate: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    fontStyle: 'italic',
  },
  historyNote: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginTop: SPACING.tiny,
    fontStyle: 'italic',
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: THEME.colors.text,
    textAlign: 'center',
    padding: SPACING.large,
  },

  // Estilos para exportar/importar
  exportImportSection: {
    flexDirection: 'row',
    gap: SPACING.small,
    marginBottom: SPACING.medium,
  },
  exportBtn: {
    flex: 1,
    backgroundColor: '#3B82F6',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  exportBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  importBtn: {
    flex: 1,
    backgroundColor: '#10B981',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  importBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  manualBtn: {
    flex: 1,
    backgroundColor: '#F59E0B',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  manualBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

  // Tabs
  tabsContainer: {
    flexDirection: 'row',
    gap: SPACING.small,
    marginBottom: SPACING.large,
  },
  tab: {
    flex: 1,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceVariant,
  },
  tabActive: {
    backgroundColor: THEME.colors.primary,
  },
  tabText: {
    color: THEME.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#fff',
  },

  // Summary by store
  summarySection: {
    marginBottom: SPACING.large,
  },
  storeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  storeSummaryBtn: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  storeSummaryBtnText: {
    color: THEME.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },

  // Transfer card with editable quantity
  transferCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  deleteTransferBtn: {
    backgroundColor: THEME.colors.error,
    paddingHorizontal: SPACING.small,
    paddingVertical: 4,
    borderRadius: THEME.radii.sm,
  },
  deleteTransferBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  quantityInput: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    padding: 0,
    margin: 0,
  },

  // Manual transfer modal
  manualModalContainer: {
    flex: 1,
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.lg,
    padding: SPACING.large,
    maxHeight: '80%',
  },
  manualModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.large,
  },
  manualModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  manualModalContent: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    padding: SPACING.large,
    marginBottom: SPACING.large,
  },
  manualInputLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: SPACING.small,
  },
  productScrollView: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  productChip: {
    backgroundColor: THEME.colors.surfaceVariant,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.xs,
    borderRadius: THEME.radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  productChipSelected: {
    backgroundColor: THEME.colors.primary,
  },
  productChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  productChipTextSelected: {
    color: '#fff',
  },
  storeChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  storeChip: {
    backgroundColor: THEME.colors.surfaceVariant,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.xs,
    borderRadius: THEME.radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  storeChipSelected: {
    backgroundColor: THEME.colors.primary,
  },
  storeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  storeChipTextSelected: {
    color: '#fff',
  },
  storeChipStock: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
    marginTop: 2,
  },
  storeChipStockSelected: {
    color: '#fff',
  },
  stockInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.small,
    marginBottom: SPACING.small,
  },
  stockInfoText: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  stockInfoValue: {
    color: THEME.colors.primary,
    fontWeight: '700',
  },
  manualTextInput: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: SPACING.small,
  },
  summaryBox: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  summaryBoxTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: SPACING.small,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.small,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  summaryTotal: {
    color: THEME.colors.primary,
  },
  summaryLabelBold: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  summaryValueBold: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: THEME.colors.outline,
    marginBottom: SPACING.small,
  },
  manualModalFooter: {
    flexDirection: 'row',
    gap: SPACING.small,
  },
  cancelManualBtn: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  cancelManualBtnText: {
    color: THEME.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  createManualBtn: {
    backgroundColor: THEME.colors.primary,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  createManualBtnDisabled: {
    backgroundColor: THEME.colors.surfaceVariant,
    opacity: 0.5,
  },
  createManualBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.lg,
    padding: SPACING.large,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.large,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  closeBtn: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  modalContent: {
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.md,
    padding: SPACING.large,
    marginBottom: SPACING.large,
  },
  modalSubtitle: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.medium,
  },
  summaryItem: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  summaryItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.small,
  },
  summaryProductName: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  removeItemBtn: {
    backgroundColor: THEME.colors.error,
    paddingHorizontal: SPACING.small,
    paddingVertical: 4,
    borderRadius: THEME.radii.sm,
  },
  removeItemBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  summaryFromStore: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.small,
  },
  summaryQuantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.small,
  },
  summaryQuantityLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  summaryQuantityInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    padding: 0,
    margin: 0,
  },
  summaryQuantityUnit: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: SPACING.small,
  },
  approveAllBtn: {
    backgroundColor: '#10B981',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  approveAllBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelModalBtn: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  cancelModalBtnText: {
    color: THEME.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  importModalBtn: {
    backgroundColor: THEME.colors.primary,
  },
  importModalBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: SPACING.large,
  },
  jsonScrollView: {
    flex: 1,
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.md,
    padding: SPACING.small,
    marginBottom: SPACING.medium,
  },
  jsonText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    color: THEME.colors.text,
  },
  jsonInput: {
    flex: 1,
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.md,
    padding: SPACING.medium,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    marginBottom: SPACING.medium,
    minHeight: 200,
  },
  closeModalBtn: {
    backgroundColor: THEME.colors.primary,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  closeModalBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.small,
  },
  modalActionBtn: {
    flex: 1,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  cancelModalBtn: {
    backgroundColor: THEME.colors.surfaceVariant,
  },
  cancelModalBtnText: {
    color: THEME.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  importModalBtn: {
    backgroundColor: THEME.colors.primary,
  },
  importModalBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});