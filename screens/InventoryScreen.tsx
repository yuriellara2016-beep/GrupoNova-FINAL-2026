import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Platform, View, Text, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createProduct, initDb, getProducts, getInventoryEntries, getProductStockInStore, getStores } from '../lib/db';
import { useStore } from '../lib/useStore';
import { useAuth } from '../hooks/useAuth';
import { useAuthSafe } from '../lib/AuthContext';
import { THEME } from '../lib/theme';
import { saveInventory, getTodayKey, InventoryItemDiff } from '../lib/storage';

declare const Blob: any;
declare const URL: any;

function buildCsvTemplate(): string {
  const headers = ['name', 'sku', 'costPrice', 'sellPrice', 'quantity', 'chargeExtra10Percent'];
  const rows = [
    ['Coca Cola 600ml', 'COCA600', '10.00', '15.00', '100', 'true'],
    ['Sabritas Original', 'SAB001', '8.50', '12.00', '50', 'false'],
    ['Galletas Emperador', 'GAL001', '15.00', '20.00', '30', 'true'],
  ];
  const csv = [headers.join(','), ...rows.map(r => r.map(v => (/,|\n|\"/.test(v) ? `"${v.replace(/\"/g, '""')}"` : v)).join(','))].join('\n');
  return csv;
}

async function downloadCsvFile(filename: string, content: string) {
  try {
    if (Platform.OS === 'web') {
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const { exportCSVFile } = await import('../lib/file');
    await exportCSVFile(filename, content);
    Alert.alert('Listo', 'Archivo guardado. Si es la primera vez, elige la carpeta Descargas/Download.');
  } catch (e: any) {
    Alert.alert('Error', e?.message || 'No se pudo generar el archivo');
  }
}

function parseCsv(content: string) {
  // Simple CSV parser for comma-separated values without complex quoting across lines
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => line.split(',').map(c => c.trim()));
  return { headers, rows };
}

function validateAndMapProducts(headers: string[], rows: string[][]) {
  const required = ['name', 'sku', 'costPrice', 'sellPrice', 'quantity', 'chargeExtra10Percent'];
  const missing = required.filter(h => !headers.includes(h));
  if (missing.length) {
    throw new Error(`Faltan columnas requeridas: ${missing.join(', ')}`);
  }
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const products = [] as any[];
  const errors = [] as string[];
  rows.forEach((cols, r) => {
    const rowNum = r + 2; // considering header is line 1
    const name = cols[idx['name']]?.trim();
    const sku = cols[idx['sku']]?.trim();
    const costPrice = parseFloat(cols[idx['costPrice']] || '0');
    const sellPrice = parseFloat(cols[idx['sellPrice']] || '0');
    const quantity = parseInt(cols[idx['quantity']] || '0', 10);
    const chargeExtraRaw = (cols[idx['chargeExtra10Percent']] || '').toLowerCase();
    const chargeExtra10Percent = chargeExtraRaw === 'true' || chargeExtraRaw === '1' || chargeExtraRaw === 'yes';

    const rowErrors = [] as string[];
    if (!name) rowErrors.push('name vacío');
    if (Number.isNaN(costPrice) || costPrice < 0) rowErrors.push('costPrice inválido');
    if (Number.isNaN(sellPrice) || sellPrice < 0) rowErrors.push('sellPrice inválido');
    if (!Number.isInteger(quantity) || quantity < 0) rowErrors.push('quantity inválido');

    if (rowErrors.length) {
      errors.push(`Línea ${rowNum}: ${rowErrors.join(', ')}`);
    } else {
      products.push({ name, sku: sku || null, costPrice, sellPrice, quantity, chargeExtra10Percent });
    }
  });
  return { products, errors };
}

export default function InventoryScreen({ navigation, route, fromCierre: fromCierreOverride, onContinueArqueo }: any) {
  const { user } = useAuth();
  const { currentStore } = useStore();
  const isSeller = user?.role === 'seller';
  
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [csvText, setCsvText] = useState('');
  const webFileInputRef = useRef<HTMLInputElement | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [stockSuggestionsModalVisible, setStockSuggestionsModalVisible] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [inventoryEntries, setInventoryEntries] = useState<any[]>([]);
  const [summary, setSummary] = useState({ totalCost: 0, totalSale: 0, profit: 0 });
  const [productsWithStock, setProductsWithStock] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string | null>(null);

  // Check if coming from cierre del día
  const fromCierre = (route?.params?.fromCierre === true) || !!fromCierreOverride;
  
  // Physical inventory mode (cierre del día)
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, string>>({});

  const isAdmin = user?.role === 'admin';
  // Only restrict sellers if not in cierre mode
  const isSellerRestricted = isSeller && !fromCierre;
  const storeId = isAdmin ? (selectedStoreFilter || null) : currentStore?.id;

  useEffect(() => {
    (async () => {
      if (isSellerRestricted) return; // Skip loading for sellers when not in cierre
      try { 
        await initDb(); 
        const storesData = await getStores();
        setStores(storesData);
      } catch (e) { 
        console.warn('DB init failed:', (e as any)?.message || e); 
      }
      loadData();
    })();
  }, [selectedStoreFilter, currentStore, isSellerRestricted]);

  const loadData = async () => {
    if (isSellerRestricted) return;
    try {
      const prods = await getProducts();
      
      // Get stock per store or all stores
      const productsWithStockData: any[] = [];
      
      if (isAdmin && !selectedStoreFilter) {
        // Admin viewing all stores: show each product with stock from all stores
        for (const product of prods) {
          let totalStock = 0;
          const storeStocks: any[] = [];
          
          for (const store of stores) {
            const stock = await getProductStockInStore(product.id, store.id);
            storeStocks.push({ storeId: store.id, storeName: store.name, quantity: stock });
            totalStock += stock;
          }
          
          productsWithStockData.push({
            ...product,
            totalStock,
            storeStocks,
          });
        }
      } else if (storeId) {
        // Specific store selected (admin filter or vendor's store)
        for (const product of prods) {
          const stock = await getProductStockInStore(product.id, storeId);
          productsWithStockData.push({
            ...product,
            totalStock: stock,
            storeStocks: [{ storeId, storeName: stores.find(s => s.id === storeId)?.name || 'Tienda', quantity: stock }],
          });
        }
      }
      
      setProductsWithStock(productsWithStockData);
      setProducts(prods);
      
      const entries = await getInventoryEntries({ storeId });
      setInventoryEntries(entries);
      
      // Calculate summary based on store stock
      let totalCost = 0;
      let totalSale = 0;
      for (const item of productsWithStockData) {
        totalCost += (item.totalStock || 0) * (item.costPrice || 0);
        totalSale += (item.totalStock || 0) * (item.sellPrice || 0);
      }
      setSummary({ totalCost, totalSale, profit: totalSale - totalCost });
    } catch (e) {
      console.warn('Error loading inventory data:', e);
    }
  };

  // Handle cierre del día flow - save inventory and go to arqueo
  const handleSaveInventoryAndContinue = async () => {
    // Build inventory diff items
    const items: InventoryItemDiff[] = [];
    for (const product of productsWithStock) {
      const counted = Number(physicalCounts[product.id] || '0');
      const expected = product.totalStock || 0;
      const difference = counted - expected;
      
      items.push({
        id: product.id,
        name: product.name,
        expected,
        counted,
        difference,
      });
    }
    
    try {
      const today = getTodayKey();
      await saveInventory({ date: today, items });
      
      Alert.alert(
        'Inventario Guardado',
        `Se guardó el inventario físico con ${items.length} productos.\n\nAhora procede al arqueo de caja.`,
        [
          {
            text: 'Continuar al Arqueo',
            onPress: () => {
              // Navigate to Cash screen with arqueo and cierre flags
              if (typeof onContinueArqueo === 'function') {
                onContinueArqueo();
              } else if (navigation?.navigate) {
                navigation.navigate('Caja', { openArqueo: true, fromCierreFlow: true });
              }
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'No se pudo guardar el inventario físico');
      console.error(error);
    }
  };

  // Stock suggestions for admin (products that need restocking)
  const stockSuggestions = useMemo(() => {
    if (!isAdmin) return [];
    
    const suggestions: any[] = [];
    
    for (const product of productsWithStock) {
      const minStock = product.minStock || 10; // Default minimum stock
      
      if (isAdmin && !selectedStoreFilter) {
        // Check each store individually for low stock
        for (const storeStock of product.storeStocks || []) {
          if (storeStock.quantity < minStock) {
            const suggested = Math.max(minStock * 2, 20); // Suggest 2x min or 20 units
            const needed = suggested - storeStock.quantity;
            
            suggestions.push({
              productId: product.id,
              productName: product.name,
              sku: product.sku || product.id.substring(0, 6),
              storeId: storeStock.storeId,
              storeName: storeStock.storeName,
              currentStock: storeStock.quantity,
              minStock,
              suggestedStock: suggested,
              neededUnits: needed,
              costPerUnit: product.costPrice || 0,
              totalCost: needed * (product.costPrice || 0),
            });
          }
        }
      } else if (storeId) {
        // Single store view
        const currentStock = product.totalStock || 0;
        if (currentStock < minStock) {
          const suggested = Math.max(minStock * 2, 20);
          const needed = suggested - currentStock;
          
          suggestions.push({
            productId: product.id,
            productName: product.name,
            sku: product.sku || product.id.substring(0, 6),
            storeId,
            storeName: stores.find(s => s.id === storeId)?.name || 'Tienda',
            currentStock,
            minStock,
            suggestedStock: suggested,
            neededUnits: needed,
            costPerUnit: product.costPrice || 0,
            totalCost: needed * (product.costPrice || 0),
          });
        }
      }
    }
    
    return suggestions;
  }, [productsWithStock, isAdmin, selectedStoreFilter, storeId, stores]);

  const templateCsv = useMemo(() => buildCsvTemplate(), []);

  const onDownloadTemplate = () => {
    downloadCsvFile('plantilla_productos.csv', templateCsv);
  };

  const onOpenImport = () => {
    if (Platform.OS === 'web') {
      webFileInputRef.current?.click();
    } else {
      setImportModalVisible(true);
    }
  };

  const handleWebFileChange = async (e: any) => {
    try {
      const file = e?.target?.files?.[0];
      if (!file) return;
      const text = await file.text();
      importFromCsv(text);
      e.target.value = '';
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo leer el archivo');
    }
  };

  const importFromCsv = async (content: string) => {
    try {
      const { headers, rows } = parseCsv(content);
      const { products, errors } = validateAndMapProducts(headers, rows);
      if (products.length === 0) {
        Alert.alert('Error', 'No se encontraron productos válidos en el archivo CSV');
        return;
      }
      const headErrors = errors.slice(0, 5);
      const more = errors.length > headErrors.length ? `\n... y ${errors.length - headErrors.length} errores más.` : '';
      const message = errors.length
        ? `Se importarán ${products.length} productos.\n\nErrores:\n- ${headErrors.join('\n- ')}${more}\n\n¿Continuar?`
        : `Se importarán ${products.length} productos. ¿Continuar?`;
      Alert.alert(
        '📥 Confirmar Importación',
        message,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Importar',
            onPress: async () => {
              await initDb();
              for (const p of products) {
                await createProduct(p);
              }
              Alert.alert('✅ Importación Exitosa', `Se importaron ${products.length} productos correctamente`);
              setImportModalVisible(false);
              setCsvText('');
              loadData(); // Refresh data after import
            },
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Archivo CSV inválido');
    }
  };

  const openReportModal = () => {
    setReportModalVisible(true);
  };

  // Calculate detailed report data
  const detailedReport = useMemo(() => {
    const report: any[] = [];
    
    for (const product of products) {
      // Calculate entries (purchases, transfers in, adjustments) and exits (sales, transfers out)
      const productEntries = inventoryEntries.filter(e => e.productId === product.id);
      
      let totalEntries = 0;
      let totalExits = 0;
      
      for (const entry of productEntries) {
        const qty = entry.quantity || 0;
        if (entry.type === 'purchase' || entry.type === 'transfer_in' || entry.type === 'adjustment') {
          totalEntries += qty;
        } else if (entry.type === 'sale' || entry.type === 'transfer_out') {
          totalExits += qty;
        }
      }
      
      const currentStock = product.quantity || 0;
      const initialBalance = currentStock - totalEntries + totalExits;
      const finalBalance = currentStock;
      
      const costValue = finalBalance * (product.costPrice || 0);
      const saleValue = finalBalance * (product.sellPrice || 0);
      
      report.push({
        sku: product.sku || product.id.substring(0, 6),
        name: product.name,
        unit: 'Uno', // Default unit
        initialBalance,
        entries: totalEntries,
        exits: totalExits,
        finalBalance,
        costValue,
        saleValue,
      });
    }
    
    return report;
  }, [products, inventoryEntries]);

  // New: aggregated movement reports per product for purchases, transfers received, and adjustments
  const movementReports = useMemo(() => {
    const map: Record<string, any> = {};
    for (const p of products) {
      map[p.id] = {
        productId: p.id,
        name: p.name,
        sku: p.sku || p.id.substring(0,6),
        sellPrice: p.sellPrice || 0,
        purchasesQty: 0,
        purchasesCost: 0,
        purchasesSaleValue: 0,
        transfersInQty: 0,
        transfersInCost: 0,
        transfersInSaleValue: 0,
        adjustmentsQty: 0,
        adjustmentsCost: 0,
        adjustmentsSaleValue: 0,
      };
    }
    for (const e of inventoryEntries) {
      const rec = map[e.productId];
      if (!rec) continue;
      const qty = Math.abs(Number(e.quantity || 0));
      const unitCost = Number(e.unitCost || 0);
      const salePrice = rec.sellPrice;
      if (e.type === 'purchase') {
        rec.purchasesQty += qty;
        rec.purchasesCost += unitCost * qty;
        rec.purchasesSaleValue += salePrice * qty;
      } else if (e.type === 'transfer_in') {
        rec.transfersInQty += qty;
        rec.transfersInCost += unitCost * qty;
        rec.transfersInSaleValue += salePrice * qty;
      } else if (e.type === 'adjustment') {
        rec.adjustmentsQty += qty;
        rec.adjustmentsCost += unitCost * qty;
        rec.adjustmentsSaleValue += salePrice * qty;
      }
    }
    return Object.values(map).filter(r => (r.purchasesQty + r.transfersInQty + r.adjustmentsQty) > 0);
  }, [products, inventoryEntries]);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {fromCierre ? 'Inventario Físico - Cierre del Día' : 'Inventario'}
          </Text>
        </View>

        {isSellerRestricted ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#6B7280', fontSize: 16, textAlign: 'center', padding: 16 }}>
              Acceso restringido. Esta sección (Inventario) está disponible solo para administradores.
            </Text>
          </View>
        ) : (
          <>
            {/* Store Filter for Admins */}
            {isAdmin && (
              <View style={styles.storeFilterContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storeFilterScroll}>
                  <TouchableOpacity
                    style={[styles.storeFilterTab, selectedStoreFilter === null && styles.storeFilterTabActive]}
                    onPress={() => { setSelectedStoreFilter(null); }}
                  >
                    <Text style={[styles.storeFilterText, selectedStoreFilter === null && styles.storeFilterTextActive]}>
                      Todas las Tiendas
                    </Text>
                  </TouchableOpacity>
                  {stores.map(store => (
                    <TouchableOpacity
                      key={store.id}
                      style={[styles.storeFilterTab, selectedStoreFilter === store.id && styles.storeFilterTabActive]}
                      onPress={() => { setSelectedStoreFilter(store.id); }}
                    >
                      <Text style={[styles.storeFilterText, selectedStoreFilter === store.id && styles.storeFilterTextActive]}>
                        {store.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <ScrollView contentContainerStyle={styles.content}> 
              {/* Inventory Summary */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>
                  📊 Resumen de Inventario
                  {isAdmin && selectedStoreFilter ? ` - ${stores.find(s => s.id === selectedStoreFilter)?.name || ''}` : ''}
                  {isAdmin && !selectedStoreFilter ? ' (Consolidado)' : ''}
                </Text>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Total al Costo</Text>
                    <Text style={styles.summaryValueCost}>${summary.totalCost.toFixed(2)}</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Total a la Venta</Text>
                    <Text style={styles.summaryValueSale}>${summary.totalSale.toFixed(2)}</Text>
                  </View>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Utilidad a Generar</Text>
                  <Text style={[styles.summaryValueProfit, summary.profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
                    ${summary.profit.toFixed(2)} ({summary.totalCost > 0 ? ((summary.profit / summary.totalCost) * 100).toFixed(1) : '0.0'}%)
                  </Text>
                </View>
              </View>

              {/* Stock Suggestions Button (Admin only) */}
              {isAdmin && stockSuggestions.length > 0 && (
                <TouchableOpacity style={[styles.reportBtn, { backgroundColor: '#F44336' }]} onPress={() => setStockSuggestionsModalVisible(true)}>
                  <Text style={styles.reportBtnText}>
                    ⚠️ Sugerencias de Abastecimiento ({stockSuggestions.length})
                  </Text>
                </TouchableOpacity>
              )}

              {/* If from cierre, show save button */}
              {fromCierre && (
                <TouchableOpacity 
                  style={[styles.reportBtn, { backgroundColor: '#4CAF50' }]} 
                  onPress={handleSaveInventoryAndContinue}
                >
                  <Text style={styles.reportBtnText}>
                    ✅ Guardar Inventario y Continuar al Arqueo
                  </Text>
                </TouchableOpacity>
              )}

              {/* Products with Stock Table */}
              <View style={styles.productsTableContainer}>
                <Text style={styles.sectionTitle}>
                  {fromCierre ? 'Ingresa el Conteo Físico' : 'Productos en Inventario'}
                </Text>
                
                {productsWithStock.length === 0 ? (
                  <Text style={styles.emptyText}>No hay productos en inventario</Text>
                ) : (
                  <View>
                    {/* Table Header */}
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Producto</Text>
                      <Text style={[styles.tableHeaderCell, { flex: 1 }]}>SKU</Text>
                      {fromCierre ? (
                        <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Conteo Físico</Text>
                      ) : (
                        <>
                          {isAdmin && !selectedStoreFilter ? (
                            <>
                              <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Total</Text>
                              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Por Tienda</Text>
                            </>
                          ) : (
                            <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Stock</Text>
                          )}
                          <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Precio</Text>
                        </>
                      )}
                    </View>

                    {/* Table Rows */}
                    {productsWithStock.map((product, idx) => (
                      <View key={product.id} style={[styles.tableRow, idx % 2 === 0 ? styles.tableRowEven : styles.tableRowOdd]}>
                        <Text style={[styles.tableCell, { flex: 2, fontWeight: '600' }]}>{product.name}</Text>
                        <Text style={[styles.tableCell, { flex: 1, fontSize: 11 }]}>
                          {product.sku || product.id.substring(0, 6)}
                        </Text>
                        
                        {fromCierre ? (
                          <TextInput
                            style={[styles.physicalCountInput, { flex: 1.5 }]}
                            value={physicalCounts[product.id] || ''}
                            onChangeText={(val) => setPhysicalCounts({ ...physicalCounts, [product.id]: val })}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor="#9CA3AF"
                          />
                        ) : (
                          <>
                            {isAdmin && !selectedStoreFilter ? (
                              <>
                                <Text style={[styles.tableCell, { flex: 1, fontWeight: '700', color: product.totalStock < (product.minStock || 10) ? '#F44336' : '#4CAF50' }]}>
                                  {product.totalStock}
                                </Text>
                                <View style={[styles.tableCell, { flex: 2 }]}>
                                  {product.storeStocks.map((ss: any) => (
                                    <Text key={ss.storeId} style={{ fontSize: 10, color: '#666' }}>
                                      {ss.storeName}: {ss.quantity}
                                    </Text>
                                  ))}
                                </View>
                              </>
                            ) : (
                              <Text style={[styles.tableCell, { flex: 1, fontWeight: '700', color: product.totalStock < (product.minStock || 10) ? '#F44336' : '#4CAF50' }]}>
                                {product.totalStock}
                              </Text>
                            )}
                            
                            <Text style={[styles.tableCell, { flex: 1 }]}>${product.sellPrice?.toFixed(2) || '0.00'}</Text>
                          </>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Detailed Report Button */}
              <TouchableOpacity style={styles.reportBtn} onPress={openReportModal}>
                <Text style={styles.reportBtnText}>📊 Reporte Detallado de Inventario</Text>
              </TouchableOpacity>
            </ScrollView>

            {Platform.OS === 'web' && (
              // @ts-ignore
              <input
                type="file"
                accept=".csv,text/csv"
                ref={webFileInputRef}
                style={{ display: 'none' }}
                onChange={handleWebFileChange}
              />
            )}

            {/* Stock Suggestions Modal (Admin Only) */}
            <Modal visible={stockSuggestionsModalVisible} animationType="slide" onRequestClose={() => setStockSuggestionsModalVisible(false)}>
              <SafeAreaView style={styles.reportModalContainer}>
                <View style={styles.reportHeader}>
                  <Text style={styles.reportModalTitle}>⚠️ Sugerencias de Abastecimiento</Text>
                  <TouchableOpacity onPress={() => setStockSuggestionsModalVisible(false)}>
                    <Text style={styles.closeBtn}>✕</Text>
                  </TouchableOpacity>
                </View>
                
                <ScrollView style={styles.reportScroll}>
                  <View style={styles.suggestionsSummary}>
                    <Text style={styles.suggestionsSummaryText}>
                      Total de productos con bajo stock: {stockSuggestions.length}
                    </Text>
                    <Text style={styles.suggestionsSummaryText}>
                      Inversión sugerida: ${stockSuggestions.reduce((sum, s) => sum + s.totalCost, 0).toFixed(2)}
                    </Text>
                  </View>

                  {/* Suggestions Table */}
                  <View style={styles.reportTableHeader}>
                    <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 2 }]}>Producto</Text>
                    <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.5 }]}>Tienda</Text>
                    <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Stock Actual</Text>
                    <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Sugerido</Text>
                    <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Comprar</Text>
                    <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>Costo Total</Text>
                  </View>
                  
                  {stockSuggestions.map((suggestion, idx) => (
                    <View key={`${suggestion.productId}-${suggestion.storeId}-${idx}`} style={[styles.reportTableRow, idx % 2 === 0 ? styles.reportTableRowEven : styles.reportTableRowOdd]}>
                      <Text style={[styles.reportTableCell, { flex: 2 }]}>{suggestion.productName}</Text>
                      <Text style={[styles.reportTableCell, { flex: 1.5 }]}>{suggestion.storeName}</Text>
                      <Text style={[styles.reportTableCell, { flex: 1, color: '#F44336', fontWeight: '700' }]}>
                        {suggestion.currentStock}
                      </Text>
                      <Text style={[styles.reportTableCell, { flex: 1, color: '#4CAF50' }]}>
                        {suggestion.suggestedStock}
                      </Text>
                      <Text style={[styles.reportTableCell, { flex: 1, fontWeight: '700' }]}>
                        {suggestion.neededUnits}
                      </Text>
                      <Text style={[styles.reportTableCell, { flex: 1.2 }]}>
                        ${suggestion.totalCost.toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </SafeAreaView>
            </Modal>

            <Modal visible={importModalVisible} animationType="slide" onRequestClose={() => setImportModalVisible(false)}>
              <SafeAreaView style={styles.modalContainer}>
                <Text style={styles.modalTitle}>Pegar CSV</Text>
                <Text style={styles.modalBody}>Pega el contenido de tu archivo CSV y presiona Importar.</Text>
                <TextInput
                  style={styles.textArea}
                  value={csvText}
                  onChangeText={setCsvText}
                  placeholder="name,sku,costPrice,sellPrice,quantity,chargeExtra10Percent\nCoca Cola 600ml,COCA600,10.00,15.00,100,true"
                  multiline
                  textAlignVertical="top"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setImportModalVisible(false)}>
                    <Text style={styles.modalBtnText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.modalPrimary]}
                    onPress={() => importFromCsv(csvText)}
                    disabled={!csvText.trim()}
                  >
                    <Text style={styles.modalBtnText}>Importar</Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>
            </Modal>

            {/* Detailed Report Modal */}
            <Modal visible={reportModalVisible} animationType="slide" onRequestClose={() => setReportModalVisible(false)}>
              <SafeAreaView style={styles.reportModalContainer}>
                <View style={styles.reportHeader}>
                  <Text style={styles.reportModalTitle}>📊 Reporte Detallado de Inventario</Text>
                  <TouchableOpacity onPress={() => setReportModalVisible(false)}>
                    <Text style={styles.closeBtn}>✕</Text>
                  </TouchableOpacity>
                </View>
                
                <ScrollView style={styles.reportScroll}>
                  {detailedReport.length === 0 ? (
                    <Text style={styles.emptyText}>No hay productos en inventario</Text>
                  ) : (
                    <View>
                      {/* Header Row */}
                      <View style={styles.reportTableHeader}>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>SKU</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 2 }]}>Producto</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Unidad</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Saldo Inicial</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Entradas</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Salidas</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Saldo Final</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>Importe Costo</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>Importe Venta</Text>
                      </View>
                      
                      {/* Data Rows */}
                      {detailedReport.map((item, idx) => (
                        <View key={idx} style={[styles.reportTableRow, idx % 2 === 0 ? styles.reportTableRowEven : styles.reportTableRowOdd]}>
                          <Text style={[styles.reportTableCell, { flex: 1 }]}>{item.sku}</Text>
                          <Text style={[styles.reportTableCell, { flex: 2 }]}>{item.name}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1 }]}>{item.unit}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1 }]}>{item.initialBalance.toFixed(0)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1, color: '#4CAF50' }]}>{item.entries.toFixed(0)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1, color: '#F44336' }]}>{item.exits.toFixed(0)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1, fontWeight: '700' }]}>{item.finalBalance.toFixed(0)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1.2 }]}>${item.costValue.toFixed(2)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1.2 }]}>${item.saleValue.toFixed(2)}</Text>
                        </View>
                      ))}

                      {/* New Sections: Purchases, Transfers Received, Adjustments (cost and sale) */}
                      <Text style={[styles.reportModalTitle, { marginTop: 16 }]}>🛒 Compras por Producto</Text>
                      <View style={styles.reportTableHeader}>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 2 }]}>Producto</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Cant</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>Al Costo</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>A la Venta</Text>
                      </View>
                      {movementReports.filter(r => r.purchasesQty > 0).map((r, idx) => (
                        <View key={`p-${idx}`} style={[styles.reportTableRow, idx % 2 === 0 ? styles.reportTableRowEven : styles.reportTableRowOdd]}>
                          <Text style={[styles.reportTableCell, { flex: 2 }]}>{r.name}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1, color: '#4CAF50' }]}>{r.purchasesQty.toFixed(0)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1.2 }]}>${r.purchasesCost.toFixed(2)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1.2 }]}>${r.purchasesSaleValue.toFixed(2)}</Text>
                        </View>
                      ))}

                      <Text style={[styles.reportModalTitle, { marginTop: 16 }]}>📦 Transferencias Recibidas</Text>
                      <View style={styles.reportTableHeader}>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 2 }]}>Producto</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Cant</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>Al Costo</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>A la Venta</Text>
                      </View>
                      {movementReports.filter(r => r.transfersInQty > 0).map((r, idx) => (
                        <View key={`t-${idx}`} style={[styles.reportTableRow, idx % 2 === 0 ? styles.reportTableRowEven : styles.reportTableRowOdd]}>
                          <Text style={[styles.reportTableCell, { flex: 2 }]}>{r.name}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1, color: '#4CAF50' }]}>{r.transfersInQty.toFixed(0)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1.2 }]}>${r.transfersInCost.toFixed(2)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1.2 }]}>${r.transfersInSaleValue.toFixed(2)}</Text>
                        </View>
                      ))}

                      <Text style={[styles.reportModalTitle, { marginTop: 16 }]}>⚙️ Ajustes</Text>
                      <View style={styles.reportTableHeader}>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 2 }]}>Producto</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1 }]}>Cant</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>Al Costo</Text>
                        <Text style={[styles.reportTableCell, styles.reportTableHeaderText, { flex: 1.2 }]}>A la Venta</Text>
                      </View>
                      {movementReports.filter(r => r.adjustmentsQty > 0).map((r, idx) => (
                        <View key={`a-${idx}`} style={[styles.reportTableRow, idx % 2 === 0 ? styles.reportTableRowEven : styles.reportTableRowOdd]}>
                          <Text style={[styles.reportTableCell, { flex: 2 }]}>{r.name}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1, color: '#4CAF50' }]}>{r.adjustmentsQty.toFixed(0)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1.2 }]}>${r.adjustmentsCost.toFixed(2)}</Text>
                          <Text style={[styles.reportTableCell, { flex: 1.2 }]}>${r.adjustmentsSaleValue.toFixed(2)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </ScrollView>
              </SafeAreaView>
            </Modal>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  blue: { backgroundColor: '#2196F3' },
  purple: { backgroundColor: '#7C4DFF' },
  headerBtnText: { color: '#fff', fontWeight: '700' },

  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: '#333',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  summaryValueCost: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2196F3',
  },
  summaryValueSale: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FF9800',
  },
  summaryValueProfit: {
    fontSize: 24,
    fontWeight: '700',
  },
  profitPositive: {
    color: '#4CAF50',
  },
  profitNegative: {
    color: '#F44336',
  },
  reportBtn: {
    backgroundColor: '#FF9800',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  reportBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  storeFilterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
  },
  storeFilterScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  storeFilterTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  storeFilterTabActive: {
    backgroundColor: '#6200ee',
  },
  storeFilterText: {
    color: '#333',
    fontWeight: '700',
  },
  storeFilterTextActive: {
    color: '#fff',
  },

  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    gap: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalBody: { fontSize: 14, color: '#555' },
  textArea: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    backgroundColor: '#fafafa',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancel: { backgroundColor: '#eee' },
  modalPrimary: { backgroundColor: '#6200ee' },
  modalBtnText: { color: '#000' },
  reportModalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  reportModalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeBtn: {
    fontSize: 24,
    color: '#666',
    paddingHorizontal: 8,
  },
  reportScroll: {
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 40,
    fontSize: 16,
  },
  reportTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#6200ee',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  reportTableHeaderText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  reportTableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  reportTableRowEven: {
    backgroundColor: '#fafafa',
  },
  reportTableRowOdd: {
    backgroundColor: '#fff',
  },
  reportTableCell: {
    fontSize: 12,
    color: '#333',
    paddingHorizontal: 4,
  },
  productsTableContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    ...THEME.shadows.medium,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: THEME.colors.text,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: THEME.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  tableHeaderCell: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    alignItems: 'center',
  },
  tableRowEven: {
    backgroundColor: '#fafafa',
  },
  tableRowOdd: {
    backgroundColor: '#fff',
  },
  tableCell: {
    fontSize: 12,
    color: '#333',
    paddingHorizontal: 4,
  },
  physicalCountInput: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 4,
    textAlign: 'center',
  },
  suggestionsSummary: {
    backgroundColor: '#FFF3E0',
    padding: 16,
    marginBottom: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  suggestionsSummaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E65100',
    marginBottom: 4,
  },
});