import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, Modal, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProducts, initDb, createProduct, updateProductFlag, updateProductFull, deleteProduct, createInventoryEntry, updateProductQuantity, getInventoryEntries, getSales, getProductStockInStore, getStores, adjustProductStockInStore, hasUserCompletedInitialLoad, recordUserInitialLoad } from '../lib/db';
import { saveInventory } from '../lib/storage';
import ProductRow from '../components/ProductRow';
import ProductEditModal from '../components/ProductEditModal';
import StockReassignmentModule from '../components/StockReassignmentModule';
import ProductHistoryModal from '../components/ProductHistoryModal';
import { findProductByCode, searchProducts, getClassifiedProducts } from '../lib/classifiedProducts';
import type { ClassifiedProduct } from '../lib/classifiedProducts';
import { incrementUsageCount } from '../lib/classifiedProducts';
import { Product } from '../types';
import { THEME, SPACING } from '../lib/theme';
import { useStore } from '../lib/useStore';
import { useAuth } from '../hooks/useAuth';
import { useAuthSafe } from '../lib/AuthContext';
import DayStatusBanner from '../components/DayStatusBanner';
import { findProductBySku } from '../lib/db';
import Ionicons from '@expo/vector-icons/Ionicons';
import { dateToDisplay, isoToDisplay } from '../lib/date';
import { DeviceEventEmitter } from 'react-native';
import * as localDb from '../lib/localDb';

export default function ProductsScreen({ navigation, route }: any) {
  const { currentStoreId, currentStore } = useStore();
  const { user, businessDate } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isSeller = user?.role === 'seller';
  const { businessDate: libBusinessDate } = useAuthSafe();

  // Estado del día cerrado (bloqueo de Productos)
  const [isDayClosed, setIsDayClosed] = useState(false);

  const refreshDayClosedStatus = React.useCallback(async () => {
    try {
      const dateKey = (businessDate || libBusinessDate || '').slice(0, 10) || null;
      const closed = await localDb.isDayClosed({ storeId: currentStoreId, businessDate: dateKey });
      setIsDayClosed(closed);
    } catch {
      // ignore
    }
  }, [businessDate, libBusinessDate, currentStoreId]);

  const [products, setProducts] = useState<Product[]>([]);
  const [displayedProducts, setDisplayedProducts] = useState<Product[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  
  // NEW: Product History Modal state
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [physicalCountVisible, setPhysicalCountVisible] = useState(false);
  const [physicalCounts, setPhysicalCounts] = useState<{ [productId: string]: string }>({});
  const [fromCierreFlowLocal, setFromCierreFlowLocal] = useState(false);
  // NEW: Map to store the actual stock per product in the selected store for the physical count modal
  const [physicalCountStockMap, setPhysicalCountStockMap] = useState<{ [productId: string]: number }>({});
  // CSV import UI state
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [csvText, setCsvText] = useState('');
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  // Initial Product Load Modal state
  const [showInitialLoadModal, setShowInitialLoadModal] = useState(false);
  const [initialLoadClassified, setInitialLoadClassified] = useState<ClassifiedProduct[]>([]);
  const [initialLoadCart, setInitialLoadCart] = useState<Array<{ code: string; description: string; quantity: number; costPrice: number; sellPrice: number }>>([]);
  const [initialLoadSelectedCode, setInitialLoadSelectedCode] = useState('');
  const [initialLoadSelectedQty, setInitialLoadSelectedQty] = useState('');
  const [initialLoadSelectedCost, setInitialLoadSelectedCost] = useState('');
  const [initialLoadSelectedSell, setInitialLoadSelectedSell] = useState('');
  const [initialLoadLoading, setInitialLoadLoading] = useState(false);
  const [initialLoadCompleted, setInitialLoadCompleted] = useState(false);
  // Nuevo: mapa de existencia actual por código clasificador
  const [existingStockByCode, setExistingStockByCode] = useState<Record<string, number>>({});
  // Nuevo: filtro de búsqueda en modal de Carga Inicial
  const [initialLoadSearchQuery, setInitialLoadSearchQuery] = useState('');
  // Nuevo: modal y estado para importar CSV en Carga Inicial
  const [initialLoadCSVModalVisible, setInitialLoadCSVModalVisible] = useState(false);
  const [initialLoadCSVText, setInitialLoadCSVText] = useState('');

  // Inventory Entry state - now supports multiple products (cart-style)
  const [entryModalVisible, setEntryModalVisible] = useState(false);
  const [entryType, setEntryType] = useState<'purchase' | 'transfer_in' | 'adjustment'>('purchase');
  const [entryStoreId, setEntryStoreId] = useState<string | null>(null); // Tienda de destino
  const [cartItems, setCartItems] = useState<Array<{
    sku: string;
    name: string;
    quantity: number;
    costPrice: number;
    sellPrice: number;
  }>>([]);
  
  // Form fields for adding to cart
  const [entrySku, setEntrySku] = useState('');
  const [entryName, setEntryName] = useState('');
  const [entryQuantity, setEntryQuantity] = useState('');
  const [entryCost, setEntryCost] = useState('');
  const [entrySellPrice, setEntrySellPrice] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  // Autocomplete suggestions for SKU/code
  const [skuSuggestions, setSkuSuggestions] = useState<ClassifiedProduct[]>([]);
  const [showSkuSuggestions, setShowSkuSuggestions] = useState(false);

  // Operations Report state (replaces old reassignment modal)
  const [reportVisible, setReportVisible] = useState(false);

  // Stock Reassignment Module state (replaces old reassignment modal)
  const [reassignmentModuleVisible, setReassignmentModuleVisible] = useState(false);
  const [reassignProduct, setReassignProduct] = useState<Product | null>(null);

  // Nuevo: Mapa de stock por producto y tienda para mostrar en la UI
  const [productStoreStock, setProductStoreStock] = useState<Record<string, Array<{ storeId: string; storeName: string; quantity: number }>>>({});

  // Otras salidas (daño, pérdida, etc.)
  const [otherExitsModalVisible, setOtherExitsModalVisible] = useState(false);
  const [otherExitReason, setOtherExitReason] = useState<'damaged' | 'lost' | 'other'>('damaged');
  const [otherExitProduct, setOtherExitProduct] = useState<Product | null>(null);
  const [otherExitQuantity, setOtherExitQuantity] = useState('');
  const [otherExitNote, setOtherExitNote] = useState('');

  // Quick search for sales
  const [searchQuery, setSearchQuery] = useState('');
  const [quickSearchProducts, setQuickSearchProducts] = useState<Product[]>([]);
  const [quickCartItems, setQuickCartItems] = useState<Map<string, { product: Product; quantity: number }>>(new Map());
  const [showQuickSearch, setShowQuickSearch] = useState(true);

  // NEW: Function to open product history
  function openProductHistory(product: Product) {
    setHistoryProduct(product);
    setHistoryModalVisible(true);
  }

  useEffect(() => {
    (async () => {
      // Ensure storesList is defined in the outer scope of the try/catch so we can pass it to load()
      let storesList: any[] = [];
      try {
        await initDb();
        storesList = await getStores();
        setStores(storesList);
      } catch (e) {
        console.warn('DB init failed:', e?.message ?? e);
        return;
      }

      // Verificar si el día está cerrado para esta tienda/fecha
      await refreshDayClosedStatus();

      await load(storesList);
      
      // Check if user should see initial load modal (only once per user per businessDate)
      if (user?._id) {
        const hasCompleted = await hasUserCompletedInitialLoad(user._id, businessDate);
        if (!hasCompleted) {
          // Load classified products para el modal de carga inicial y calcular existencias actuales
          const classified = await getClassifiedProducts();
          setInitialLoadClassified(classified);
          // Calcular existencias visibles por código
          const stockMap: Record<string, number> = {};
          for (const cp of classified) {
            try {
              const prod = await findProductBySku(cp.code);
              if (prod) {
                if (isSeller && currentStoreId) {
                  stockMap[cp.code] = await getProductStockInStore(prod.id, currentStoreId);
                } else {
                  // Admin: sumar existencias de todas las tiendas configuradas
                  let sum = 0;
                  for (const st of storesList) {
                    sum += await getProductStockInStore(prod.id, st.id);
                  }
                  stockMap[cp.code] = sum;
                }
              }
            } catch {}
          }
          setExistingStockByCode(stockMap);
          setShowInitialLoadModal(true);
        }
      }

      // Si venimos del flujo de cierre, abrir Inventario Físico inmediatamente
      if (route?.params?.forcePhysicalCount) {
        setFromCierreFlowLocal(route?.params?.fromCierreFlow === true);
        startPhysicalCount();
      }
    })();

    // Listener para flujo de cierre desde caja en navegadores simples
    const sub = DeviceEventEmitter.addListener('startPhysicalInventoryCierreFlow', (data?: any) => {
      setFromCierreFlowLocal(data?.fromCierreFlow === true);
      startPhysicalCount();
    });

    // Refrescar estado de día cerrado cuando se cierre/abra o cambie el estado
    const dayStatusChanged = DeviceEventEmitter.addListener('dayStatusChanged', refreshDayClosedStatus);
    const dayClosed = DeviceEventEmitter.addListener('dayClosed', refreshDayClosedStatus);
    const dayOpened = DeviceEventEmitter.addListener('dayOpened', refreshDayClosedStatus);

    return () => {
      try { sub.remove(); } catch {}
      try { dayStatusChanged.remove(); } catch {}
      try { dayClosed.remove(); } catch {}
      try { dayOpened.remove(); } catch {}
    };
  }, []);

  // Cuando cambia la fecha de trabajo o la tienda, recalcular el cierre
  useEffect(() => {
    refreshDayClosedStatus();
  }, [refreshDayClosedStatus]);

  // NEW: también reaccionar si la pantalla ya estaba montada y solo cambian los params
  useEffect(() => {
    if (!route?.params?.forcePhysicalCount) return;

    setFromCierreFlowLocal(route?.params?.fromCierreFlow === true);
    startPhysicalCount();

    // Limpiar params para evitar re-disparos
    try {
      navigation?.setParams?.({ forcePhysicalCount: false, fromCierreFlow: false });
    } catch {}
  }, [route?.params?.forcePhysicalCount, route?.params?.fromCierreFlow]);

  // Filter products based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setQuickSearchProducts(displayedProducts);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = displayedProducts.filter(p => 
        p.name.toLowerCase().includes(query) || 
        (p.sku && p.sku.toLowerCase().includes(query))
      );
      setQuickSearchProducts(filtered);
    }
  }, [searchQuery, displayedProducts]);

  async function load(passedStores?: any[]) {
    const storesToUse = passedStores ?? stores;
    const prods = await getProducts();
    setProducts(prods);

    // Cargar stock por tienda para cada producto
    const stockMap: Record<string, Array<{ storeId: string; storeName: string; quantity: number }>> = {};
    for (const product of prods) {
      const storeStockList: Array<{ storeId: string; storeName: string; quantity: number }> = [];
      for (const store of storesToUse) {
        const qty = await getProductStockInStore(product.id, store.id);
        if (qty > 0) {
          storeStockList.push({ storeId: store.id, storeName: store.name, quantity: qty });
        }
      }
      stockMap[product.id] = storeStockList;
    }
    setProductStoreStock(stockMap);

    // Filtrar productos por tienda para vendedores
    if (isSeller && currentStoreId) {
      const productsWithStock: Product[] = [];
      for (const product of prods) {
        const stock = await getProductStockInStore(product.id, currentStoreId);
        if (stock > 0) {
          productsWithStock.push(product);
        }
      }
      setDisplayedProducts(productsWithStock);
    } else {
      // Admin ve todos
      setDisplayedProducts(prods);
    }
  }

  // New: Add item to initial load cart (acepta código explícito)
  function addToInitialLoadCart(codeOverride?: string) {
    const selectedCode = (codeOverride ?? initialLoadSelectedCode).trim();
    if (!selectedCode) {
      Alert.alert('Error', 'Por favor selecciona un código');
      return;
    }

    const qty = parseFloat(initialLoadSelectedQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      Alert.alert('Error', 'La cantidad debe ser mayor a cero');
      return;
    }

    const cost = parseFloat(initialLoadSelectedCost);
    const sell = parseFloat(initialLoadSelectedSell);
    
    if (!Number.isFinite(cost) || cost <= 0) {
      Alert.alert('Error', 'Precio de costo requerido');
      return;
    }

    if (!Number.isFinite(sell) || sell <= 0) {
      Alert.alert('Error', 'Precio de venta requerido');
      return;
    }

    const classified = initialLoadClassified.find(c => c.code === selectedCode);
    if (!classified) {
      Alert.alert('Error', 'Código no encontrado');
      return;
    }

    // Add to cart
    const newItem = {
      code: classified.code,
      description: classified.description,
      quantity: qty,
      costPrice: cost,
      sellPrice: sell,
    };

    setInitialLoadCart(prev => [...prev, newItem]);
    
    // Clear form
    setInitialLoadSelectedCode('');
    setInitialLoadSelectedQty('');
    setInitialLoadSelectedCost('');
    setInitialLoadSelectedSell('');
  }

  function removeFromInitialLoadCart(index: number) {
    setInitialLoadCart(prev => prev.filter((_, i) => i !== index));
  }

  // Confirm and execute initial load
  async function confirmInitialLoad() {
    if (initialLoadCart.length === 0) {
      Alert.alert('Error', 'Agrega al menos un producto');
      return;
    }

    setInitialLoadLoading(true);
    try {
      const defaultStoreId = currentStoreId || currentStore?.id || 'store_default';
      let totalImporte = 0;
      const codesUsed: string[] = [];

      for (const item of initialLoadCart) {
        // Buscar producto existente en BD por SKU/código clasificador
        const existingProductDb = await findProductBySku(item.code);
        let productId: string;

        if (existingProductDb) {
          // Producto existe, actualizar precios por ID correcto
          await updateProductFull(existingProductDb.id, {
            costPrice: item.costPrice,
            sellPrice: item.sellPrice,
          });
          productId = existingProductDb.id;
        } else {
          // Crear producto nuevo con SKU = código del clasificador
          const newProd: Omit<Product, 'id'> = {
            name: item.description,
            sku: item.code || null,
            costPrice: item.costPrice,
            sellPrice: item.sellPrice,
            quantity: 0,
            chargeExtra10Percent: false,
          };
          productId = await createProduct(newProd);
        }

        // Registrar entrada de inventario
        await createInventoryEntry({
          productId,
          type: 'purchase',
          quantity: item.quantity,
          unitCost: item.costPrice,
          paymentMethod: 'cash',
          note: `Carga inicial - ${item.description}`,
          targetStoreId: defaultStoreId,
        });

        totalImporte += item.quantity * item.costPrice;
        codesUsed.push(item.code);
        
        // Increment usage
        try { await incrementUsageCount(item.code); } catch {}
      }

      // Record this initial load in database
      if (user?._id) {
        const businessDate = libBusinessDate || new Date().toISOString().split('T')[0];
        await recordUserInitialLoad(user._id, businessDate, initialLoadCart.length, totalImporte, codesUsed);
        setInitialLoadCompleted(true);
      }

      Alert.alert('✅ Éxito', `Carga inicial completada: ${initialLoadCart.length} productos por $${totalImporte.toFixed(2)}`);
      setShowInitialLoadModal(false);
      setInitialLoadCart([]);
      await load();
    } catch (err: any) {
      Alert.alert('Error', `No se pudo completar la carga inicial: ${err?.message || 'Error desconocido'}`);
    } finally {
      setInitialLoadLoading(false);
    }
  }

  // New: Open inventory entry modal
  function openInventoryEntry() {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden realizar operaciones en Productos porque el día está cerrado. Contacta al administrador.');
      return;
    }
    setEntryType('purchase');
    setCartItems([]);
    setEntrySku('');
    setEntryName('');
    setEntryQuantity('');
    setEntryCost('');
    setEntrySellPrice('');
    setSuccessMessage('');
    // Predeterminar tienda: vendedor usa su tienda, admin puede elegir (default primera tienda)
    if (isSeller && currentStoreId) {
      setEntryStoreId(currentStoreId);
    } else if (isAdmin && stores.length > 0) {
      setEntryStoreId(stores[0].id);
    } else if (isSeller && currentStore?.id) {
      // Fallback to currentStore.id if currentStoreId is not set
      setEntryStoreId(currentStore.id);
    } else {
      setEntryStoreId(null);
    }
    setEntryModalVisible(true);
  }

  // Add item to cart instead of registering immediately
  function addToCart() {
    if (!entryName.trim()) {
      setSuccessMessage('❌ El nombre del producto es requerido');
      setTimeout(() => setSuccessMessage(''), 3000);
      return;
    }

    const qty = parseFloat(entryQuantity);
    const costInput = entryCost.trim();
    const sellInput = entrySellPrice.trim();

    // Validaciones según el tipo de entrada
    if (entryType === 'purchase' || entryType === 'transfer_in') {
      if (!Number.isFinite(qty) || qty <= 0) {
        setSuccessMessage('❌ La cantidad debe ser mayor a cero');
        setTimeout(() => setSuccessMessage(''), 3000);
        return;
      }
    } else if (entryType === 'adjustment') {
      if (!Number.isFinite(qty) || qty === 0) {
        setSuccessMessage('❌ La cantidad de ajuste debe ser distinta de cero');
        setTimeout(() => setSuccessMessage(''), 3000);
        return;
      }
    }

    const parsedCost = parseFloat(costInput);
    const parsedSell = parseFloat(sellInput);
    
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setSuccessMessage('❌ Precio de costo requerido');
      setTimeout(() => setSuccessMessage(''), 3000);
      return;
    }

    if (!Number.isFinite(parsedSell) || parsedSell < 0) {
      setSuccessMessage('❌ Precio de venta requerido');
      setTimeout(() => setSuccessMessage(''), 3000);
      return;
    }

    // Add to cart
    const newItem = {
      sku: entrySku.trim(),
      name: entryName.trim(),
      quantity: qty,
      costPrice: parsedCost,
      sellPrice: parsedSell,
    };

    setCartItems(prev => [...prev, newItem]);
    
    // Clear form
    setEntrySku('');
    setEntryName('');
    setEntryQuantity('');
    setEntryCost('');
    setEntrySellPrice('');
    
    setSuccessMessage(`✅ ${newItem.name} agregado al carrito (${newItem.quantity} unidades)`);
    setTimeout(() => setSuccessMessage(''), 3000);
  }

  function removeFromCart(index: number) {
    setCartItems(prev => prev.filter((_, i) => i !== index));
    setSuccessMessage('✅ Producto removido del carrito');
    setTimeout(() => setSuccessMessage(''), 2000);
  }

  async function confirmAllCartItems() {
    if (isDayClosed && !isAdmin) {
      setSuccessMessage('❌ Día cerrado: no se pueden registrar entradas de inventario');
      setTimeout(() => setSuccessMessage(''), 3000);
      return;
    }

    if (cartItems.length === 0) {
      setSuccessMessage('❌ El carrito está vacío');
      setTimeout(() => setSuccessMessage(''), 3000);
      return;
    }

    // For sellers, use their assigned store; for admins, require selection
    const sellerStoreId = isSeller ? (currentStoreId || currentStore?.id || null) : null;
    const targetStoreId = isSeller ? sellerStoreId : entryStoreId;

    if (!targetStoreId) {
      setSuccessMessage('❌ Debe seleccionar una tienda de destino');
      setTimeout(() => setSuccessMessage(''), 3000);
      return;
    }

    const typeLabel = entryType === 'purchase' ? 'Compra' : entryType === 'transfer_in' ? 'Transferencia Recibida' : 'Ajuste';

    try {
      const allProducts = await getProducts();
      let registeredCount = 0;
      let totalImporte = 0;

      for (const item of cartItems) {
        const skuTrim = item.sku.toLowerCase();
        const existingProduct = skuTrim ? allProducts.find(p => (p.sku || '').toLowerCase() === skuTrim) : null;

        let productId: string;

        if (existingProduct) {
          // Update prices
          const fields: Partial<Product> = {
            costPrice: item.costPrice,
            sellPrice: item.sellPrice,
          };
          await updateProductFull(existingProduct.id, fields);
          productId = existingProduct.id;
        } else {
          // Create new product
          const newProd: Omit<Product, 'id'> = {
            name: item.name,
            sku: item.sku || null,
            costPrice: item.costPrice,
            sellPrice: item.sellPrice,
            quantity: 0,
            chargeExtra10Percent: false,
          };
          productId = await createProduct(newProd);
        }

        // Register inventory entry with proper storeId assignment based on entry type
        await createInventoryEntry({
          productId,
          type: entryType,
          quantity: item.quantity,
          unitCost: item.costPrice,
          paymentMethod: entryType === 'purchase' ? 'cash' : null,
          note: `${typeLabel} - ${item.name}`,
          // For transfer_in, use storeId (source) optional and targetStoreId for destination
          storeId: entryType === 'transfer_in' ? targetStoreId : null,
          // For purchase/adjustment, increase stock at targetStoreId (seller's store or selected)
          targetStoreId: entryType === 'purchase' || entryType === 'adjustment' ? targetStoreId : (entryType === 'transfer_in' ? targetStoreId : null),
        });

        // Increment usage count for classified product code if present
        if (item.sku) {
          try { await incrementUsageCount(item.sku); } catch {}
        }

        registeredCount++;
        totalImporte += Math.abs(item.quantity) * item.costPrice;
      }

      const storeName = stores.find(s => s.id === targetStoreId)?.name || 'Tienda';
      setSuccessMessage(`✅ ${typeLabel} registrada en ${storeName}: ${registeredCount} productos por $${totalImporte.toFixed(2)}`);
      setTimeout(() => {
        setSuccessMessage('');
        setEntryModalVisible(false);
        setCartItems([]);
      }, 2500);
      
      await load();
    } catch (err: any) {
      setSuccessMessage(`❌ Error: ${err?.message || 'No se pudo registrar'}`);
      setTimeout(() => setSuccessMessage(''), 4000);
    }
  }

  async function confirmInventoryEntry() {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden registrar entradas de inventario porque el día está cerrado. Contacta al administrador.');
      return;
    }

    // Legacy single-item flow (keep for backward compatibility)
    if (!entryName.trim()) {
      Alert.alert('Error', 'El nombre del producto es requerido');
      return;
    }

    const qty = parseFloat(entryQuantity);
    const costInput = entryCost.trim();
    const sellInput = entrySellPrice.trim();

    // Validaciones según el tipo de entrada
    if (entryType === 'purchase' || entryType === 'transfer_in') {
      if (!Number.isFinite(qty) || qty <= 0) {
        Alert.alert('Error', 'La cantidad debe ser mayor a cero');
        return;
      }
    } else if (entryType === 'adjustment') {
      if (!Number.isFinite(qty) || qty === 0) {
        Alert.alert('Error', 'La cantidad de ajuste debe ser distinta de cero (puede ser negativa para disminuir stock)');
        return;
      }
    }

    const typeLabel = entryType === 'purchase' ? 'Compra' : entryType === 'transfer_in' ? 'Transferencia Recibida' : 'Ajuste';

    // Lógica central que registra la entrada
    const performRegistration = async () => {
      try {
        const allProducts = await getProducts();
        const skuTrim = entrySku.trim().toLowerCase();
        const existingProduct = skuTrim ? allProducts.find(p => (p.sku || '').toLowerCase() === skuTrim) : null;

        let productId: string;
        // Si no ingresan costo/venta y el producto existe, usamos los valores actuales
        const parsedCost = parseFloat(costInput);
        const parsedSell = parseFloat(sellInput);
        const finalCost = Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : (existingProduct?.costPrice ?? 0);
        const finalSell = Number.isFinite(parsedSell) && parsedSell >= 0 ? parsedSell : (existingProduct?.sellPrice ?? 0);

        if (existingProduct) {
          // Actualizar precios solo si fueron provistos; la cantidad la ajusta createInventoryEntry
          const fields: Partial<Product> = {};
          if (costInput) fields.costPrice = finalCost;
          if (sellInput) fields.sellPrice = finalSell;
          if (Object.keys(fields).length > 0) {
            await updateProductFull(existingProduct.id, fields);
          }
          productId = existingProduct.id;
        } else {
          // Crear producto nuevo con cantidad 0; la entrada ajustará el stock
          if (!Number.isFinite(finalSell) || finalSell <= 0) {
            throw new Error('Precio de venta requerido para crear producto nuevo');
          }
          const newProd: Omit<Product, 'id'> = {
            name: entryName.trim(),
            sku: entrySku.trim() || null,
            costPrice: finalCost,
            sellPrice: finalSell,
            quantity: 0,
            chargeExtra10Percent: false,
          };
          productId = await createProduct(newProd);
        }

        // Registrar movimiento de inventario
        await createInventoryEntry({
          productId,
          type: entryType,
          quantity: qty,
          unitCost: finalCost,
          paymentMethod: entryType === 'purchase' ? 'cash' : null,
          note: `${typeLabel} - ${entryName}`,
          storeId: entryType === 'transfer_in' ? entryStoreId : null,
          targetStoreId: entryType === 'purchase' || entryType === 'adjustment' ? entryStoreId : null,
        });

        // Increment usage count for classified product code if present
        if (entrySku) {
          try { await incrementUsageCount(entrySku); } catch {}
        }

        const importe = Math.abs(qty) * finalCost;
        Alert.alert('✅ Entrada Registrada', `Se registró ${typeLabel.toLowerCase()} para ${entryName} (${qty} unidades)\nTotal al costo: $${importe.toFixed(2)}`);
        setEntryModalVisible(false);
        await load();
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'No se pudo registrar la entrada');
      }
    };

    // En web, los botones de Alert no son interactivos, ejecutar directamente
    if (Platform.OS === 'web') {
      await performRegistration();
      return;
    }

    const importePreview = Math.abs(qty) * (Number.isFinite(parseFloat(costInput)) && parseFloat(costInput) >= 0 ? parseFloat(costInput) : 0);
    Alert.alert(
      `Confirmar ${typeLabel}`,
      `Producto: ${entryName}\nCódigo: ${entrySku || 'N/A'}\nCantidad: ${qty}\nCosto Unitario: ${costInput ? `$${parseFloat(costInput).toFixed(2)}` : '(sin cambio)'}\nVenta Unitario: ${sellInput ? `$${parseFloat(sellInput).toFixed(2)}` : '(sin cambio)'}\nImporte al Costo: $${importePreview.toFixed(2)}\n\n¿Desea registrar esta entrada?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: performRegistration }
      ]
    );
  }

  function openEdit(p: Product) {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden editar productos porque el día está cerrado. Contacta al administrador.');
      return;
    }
    setEditingProduct(p);
    setModalVisible(true);
  }

  // Updated: Use new reassignment module instead of old reassignment modal
  async function openReassignModal(p: Product) {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden realizar cambios de stock porque el día está cerrado. Contacta al administrador.');
      return;
    }
    setReassignProduct(p);
    setReassignmentModuleVisible(true);
  }

  async function handleSaveEdit(id: string, fields: Partial<Product>) {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden guardar cambios porque el día está cerrado. Contacta al administrador.');
      return;
    }
    await updateProductFull(id, fields);
    setModalVisible(false);
    setEditingProduct(null);
    await load();
  }

  async function handleDelete(id: string) {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden eliminar productos porque el día está cerrado. Contacta al administrador.');
      return;
    }
    await deleteProduct(id);
    setModalVisible(false);
    setEditingProduct(null);
    await load();
  }

  async function startPhysicalCount() {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se puede realizar inventario físico porque el día está cerrado. Contacta al administrador.');
      return;
    }
    const prods = await getProducts();
    setProducts(prods);
    
    // Precalcular stock por tienda para cada producto
    const inventoryStoreId = currentStoreId || currentStore?.id || 'store_default';
    const stockMap: { [productId: string]: number } = {};
    for (const product of prods) {
      stockMap[product.id] = await getProductStockInStore(product.id, inventoryStoreId);
    }
    setPhysicalCountStockMap(stockMap);
    
    // Initialize physical counts with empty strings
    const counts: { [key: string]: string } = {};
    prods.forEach(p => counts[p.id] = '');
    setPhysicalCounts(counts);
    setPhysicalCountVisible(true);
  }

  async function confirmPhysicalCount() {
    // IMPORTANT: Inventario físico NO debe cambiar stock. Solo registra diferencias en Auditoría.
    // Además, evitamos interpretar campos vacíos como 0 (eso crearía diferencias falsas).
    
    const inventoryDate = (businessDate || libBusinessDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const inventoryStoreId = currentStoreId || currentStore?.id || 'store_default';
    
    const differences: { product: Product; systemQty: number; physicalQty: number; diff: number }[] = [];
    let countedProducts = 0;
    
    await initDb();
    
    for (const product of products) {
      const rawCount = (physicalCounts[product.id] ?? '').trim();
      if (!rawCount) {
        continue;
      }
      
      countedProducts++;
      
      const physicalQty = parseFloat(rawCount);
      if (!Number.isFinite(physicalQty)) {
        continue;
      }
      
      // Usar stock por tienda (no el global product.quantity)
      const systemQty = await getProductStockInStore(product.id, inventoryStoreId);
      const diff = physicalQty - systemQty;
      
      differences.push({ product, systemQty, physicalQty, diff });
    }
    
    if (countedProducts === 0) {
      Alert.alert('Error', 'Ingresa al menos un conteo físico antes de confirmar.');
      return;
    }
    
    const itemsWithDiff = differences.filter((d) => d.diff !== 0);
    
    if (itemsWithDiff.length === 0) {
      // Guardar auditoría igualmente (como "cuadra"), para que quede registro del inventario físico.
      try {
        await saveInventory({
          date: inventoryDate,
          items: differences.map((d) => ({
            id: d.product.id,
            name: d.product.name,
            expected: d.systemQty,
            counted: d.physicalQty,
            difference: d.diff,
          })),
        });
      } catch {}
      
      Alert.alert('✅ Inventario Correcto', 'No hay diferencias. Se registró el inventario físico en Auditoría.');
      setPhysicalCountVisible(false);
      
      // Mark physical inventory done for today
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage').then((m) => m.default);
        const key = `inventory_physical_done_${inventoryDate}`;
        await AsyncStorage.setItem(key, '1');
      } catch {}
      
      // Si venimos del flujo de cierre, continuar al arqueo
      if (route?.params?.fromCierreFlow || fromCierreFlowLocal) {
        if (navigation?.navigate) {
          navigation?.navigate?.('Caja', { openArqueo: true, fromCierreFlow: true });
        } else {
          try {
            DeviceEventEmitter.emit('goToCashFromCierre');
          } catch {}
        }
      }
      return;
    }
    
    const summary = itemsWithDiff
      .map((d) => `${d.product.name}: Sistema ${d.systemQty} → Físico ${d.physicalQty} (${d.diff > 0 ? '+' : ''}${d.diff})`)
      .join('\n');
    
    Alert.alert(
      'Diferencias encontradas',
      `Se encontraron ${itemsWithDiff.length} productos con diferencias:\n\n${summary}\n\n¿Desea guardar estas diferencias en Auditoría?\n(El stock NO se modificará)`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Guardar en Auditoría',
          onPress: async () => {
            try {
              await saveInventory({
                date: inventoryDate,
                items: differences.map((d) => ({
                  id: d.product.id,
                  name: d.product.name,
                  expected: d.systemQty,
                  counted: d.physicalQty,
                  difference: d.diff,
                })),
              });
            } catch (err) {
              Alert.alert('Error', 'No se pudo guardar el inventario en Auditoría.');
              return;
            }
            
            Alert.alert(
              '✅ Inventario Registrado',
              `Se guardaron las diferencias en Auditoría.\n\nNota: El stock de la tienda NO fue modificado.`
            );
            
            setPhysicalCountVisible(false);
            
            // Mark physical inventory done for today
            try {
              const AsyncStorage = await import('@react-native-async-storage/async-storage').then((m) => m.default);
              const key = `inventory_physical_done_${inventoryDate}`;
              await AsyncStorage.setItem(key, '1');
            } catch {}
            
            await load();
            
            // Si venimos del flujo de cierre, continuar al arqueo
            if (route?.params?.fromCierreFlow || fromCierreFlowLocal) {
              if (navigation?.navigate) {
                navigation?.navigate?.('Caja', { openArqueo: true, fromCierreFlow: true });
              } else {
                try {
                  DeviceEventEmitter.emit('goToCashFromCierre');
                } catch {}
              }
            }
          },
        },
      ]
    );
  }

  function cancelPhysicalCount() {
    // Determine if any physical count has been entered
    const hasInput = Object.values(physicalCounts).some(v => (v ?? '').trim().length > 0);

    // On web, Alert buttons are not supported; close immediately to avoid getting stuck
    if (Platform.OS === 'web') {
      setPhysicalCounts({});
      setPhysicalCountVisible(false);
      return;
    }

    if (!hasInput) {
      // No data entered: close immediately and reset state
      setPhysicalCounts({});
      setPhysicalCountVisible(false);
      return;
    }

    // Data exists (native): ask for confirmation before discarding
    Alert.alert(
      '¿Cancelar Conteo?',
      'Se perderán los datos ingresados',
      [
        { text: 'Continuar Contando', style: 'cancel' },
        { text: 'Cancelar Conteo', style: 'destructive', onPress: () => { setPhysicalCounts({}); setPhysicalCountVisible(false); } }
      ]
    );
  }

  // CSV import handlers
  function openImport() {
    if (Platform.OS === 'web') {
      webFileInputRef.current?.click();
    } else {
      setImportModalVisible(true);
    }
  }

  const handleWebFileChange = async (e: any) => {
    try {
      const file = e?.target?.files?.[0];
      if (!file) return;
      const text = await file.text();
      await importFromCsv(text);
      e.target.value = '';
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo leer el archivo');
    }
  };

  async function importFromCsv(csvContent: string) {
    try {
      const lines = csvContent.split('\n').filter(line => line.trim());
      if (lines.length === 0) {
        Alert.alert('Error', 'El archivo CSV está vacío');
        return;
      }

      // Check if first line is header (contains "nombre" or "name")
      const firstLine = lines[0].toLowerCase();
      const hasHeader = firstLine.includes('nombre') || firstLine.includes('name');
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const newProducts: Omit<Product, 'id'>[] = [];
      const errors: string[] = [];

      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i].trim();
        if (!line) continue;

        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 4) {
          errors.push(`Línea ${i + 1}: formato incorrecto (se esperan al menos 4 columnas)`);
          continue;
        }

        const [nombre, sku, costo, venta, cantidad = '0', plusTen = 'false'] = parts;
        
        if (!nombre) {
          errors.push(`Línea ${i + 1}: nombre vacío`);
          continue;
        }

        const costPrice = parseFloat(costo);
        const sellPrice = parseFloat(venta);
        const qty = parseFloat(cantidad);

        if (isNaN(costPrice) || costPrice < 0) {
          errors.push(`Línea ${i + 1}: costo inválido`);
          continue;
        }

        if (isNaN(sellPrice) || sellPrice < 0) {
          errors.push(`Línea ${i + 1}: precio de venta inválido`);
          continue;
        }

        newProducts.push({
          name: nombre,
          sku: sku || null,
          costPrice,
          sellPrice,
          quantity: isNaN(qty) ? 0 : qty,
          chargeExtra10Percent: plusTen.toLowerCase() === 'true' || plusTen === '1',
        });
      }

      if (newProducts.length === 0) {
        Alert.alert('Error', 'No se encontraron productos válidos en el archivo CSV');
        return;
      }

      const message = errors.length > 0 
        ? `Se importarán ${newProducts.length} productos.\n\nErrores encontrados: ${errors.length}\n\n¿Continuar?`
        : `Se importarán ${newProducts.length} productos. ¿Continuar?`;

      Alert.alert(
        '📥 Confirmar Importación',
        message,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Importar',
            onPress: async () => {
              for (const prod of newProducts) {
                await createProduct(prod);
              }
              Alert.alert('✅ Importación Exitosa', `Se importaron ${newProducts.length} productos correctamente`);
              setImportModalVisible(false);
              setCsvText('');
              await load();
            }
          }
        ]
      );

    } catch (err: any) {
      console.error('Import products error:', err);
      Alert.alert('Error', 'No se pudo importar el archivo CSV: ' + (err?.message || err));
    }
  }

  // Nueva función: Registrar otras salidas (daño, pérdida)
  async function handleOtherExit() {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden registrar salidas porque el día está cerrado. Contacta al administrador.');
      return;
    }

    if (!otherExitProduct) {
      Alert.alert('Error', 'Selecciona un producto');
      return;
    }

    const qty = parseFloat(otherExitQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      Alert.alert('Error', 'La cantidad debe ser mayor a cero');
      return;
    }

    try {
      const reasonLabel = otherExitReason === 'damaged' ? 'Daño' : otherExitReason === 'lost' ? 'Pérdida' : 'Otra Salida';
      
      // Crear entrada de inventario con cantidad negativa
      await createInventoryEntry({
        productId: otherExitProduct.id,
        type: 'adjustment',
        quantity: -qty, // Negativo para rebajar stock
        unitCost: otherExitProduct.costPrice,
        paymentMethod: null,
        note: `${reasonLabel} - ${otherExitNote || 'Sin nota'}`,
        storeId: null,
        targetStoreId: currentStoreId || currentStore?.id || null,
      });

      Alert.alert('✅ Éxito', `${reasonLabel} de ${otherExitProduct.name} registrada: -${qty} unidades`);
      setOtherExitsModalVisible(false);
      setOtherExitProduct(null);
      setOtherExitQuantity('');
      setOtherExitNote('');
      setOtherExitReason('damaged');
      await load();
    } catch (err: any) {
      Alert.alert('Error', `No se pudo registrar: ${err?.message || 'Error desconocido'}`);
    }
  }

  function openOtherExitModal(product: Product) {
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden registrar salidas porque el día está cerrado. Contacta al administrador.');
      return;
    }
    setOtherExitProduct(product);
    setOtherExitQuantity('');
    setOtherExitNote('');
    setOtherExitReason('damaged');
    setOtherExitsModalVisible(true);
  }

  // Agregar helper para abrir y refrescar el modal de Carga Inicial con existencias actuales
  async function openInitialLoadModal() {
    try {
      const classified = await getClassifiedProducts();
      setInitialLoadClassified(classified);
      const stockMap: Record<string, number> = {};
      for (const cp of classified) {
        try {
          const prod = await findProductBySku(cp.code);
          if (prod) {
            if (isSeller && currentStoreId) {
              stockMap[cp.code] = await getProductStockInStore(prod.id, currentStoreId);
            } else {
              let sum = 0;
              for (const st of stores) {
                sum += await getProductStockInStore(prod.id, st.id);
              }
              stockMap[cp.code] = sum;
            }
          }
        } catch {}
      }
      setExistingStockByCode(stockMap);
      setShowInitialLoadModal(true);
    } catch (e) {
      Alert.alert('Error', 'No se pudo cargar el clasificador');
    }
  }

  // Quick cart functions
  const addToQuickCart = (product: Product) => {
    const newCart = new Map(quickCartItems);
    const existing = newCart.get(product.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      newCart.set(product.id, { product, quantity: 1 });
    }
    setQuickCartItems(newCart);
  };

  const removeFromQuickCart = (productId: string) => {
    const newCart = new Map(quickCartItems);
    newCart.delete(productId);
    setQuickCartItems(newCart);
  };

  const updateQuickCartQuantity = (productId: string, quantity: number) => {
    const newCart = new Map(quickCartItems);
    if (quantity <= 0) {
      newCart.delete(productId);
    } else {
      const item = newCart.get(productId);
      if (item) {
        item.quantity = quantity;
      }
    }
    setQuickCartItems(newCart);
  };

  const getTotalQuickCartItems = () => {
    let total = 0;
    quickCartItems.forEach(item => {
      total += item.quantity;
    });
    return total;
  };

  const getTotalQuickCartPrice = () => {
    let total = 0;
    quickCartItems.forEach(item => {
      total += item.product.sellPrice * item.quantity;
    });
    return total;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <DayStatusBanner />
      
      {/* Warning banner for closed day (vendors only) */}
      {isDayClosed && !isAdmin && (
        <View style={styles.closedDayBanner}>
          <Text style={styles.closedDayBannerText}>⚠️ DÍA CERRADO - Productos bloqueados</Text>
        </View>
      )}
      
      <ScrollView style={styles.content}>
        <Text style={styles.heading}>Productos</Text>

        {/* 🔍 QUICK SEARCH SECTION - NEW */}
        <View style={styles.quickSearchSection}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={20} color={THEME.colors.textSecondary} style={styles.searchIcon} />
            <TextInput
              placeholder="🔍 Buscar productos por nombre o SKU..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor={THEME.colors.textSecondary}
              style={styles.searchInputField}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                <Ionicons name="close-circle" size={18} color={THEME.colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          
          {/* Search Results Count */}
          {searchQuery.length > 0 && (
            <View style={styles.searchResultsInfo}>
              <Text style={styles.searchResultsText}>
                📦 {quickSearchProducts.length} de {displayedProducts.length} productos encontrados
              </Text>
            </View>
          )}
        </View>

        {/* Quick Cart Summary - when there are items */}
        {quickCartItems.size > 0 && (
          <TouchableOpacity 
            style={styles.quickCartSummary}
            onPress={() => {
              // This would navigate to a quick cart view if needed
              // For now, just show the summary
            }}
          >
            <View style={styles.quickCartSummaryContent}>
              <Text style={styles.quickCartLabel}>🛒 Carrito Rápido</Text>
              <Text style={styles.quickCartStats}>
                {getTotalQuickCartItems()} items · ${getTotalQuickCartPrice().toFixed(2)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={THEME.colors.primary} />
          </TouchableOpacity>
        )}

        {/* Botón de Carga Inicial - VISIBLE */}
        {!initialLoadCompleted && (
          <TouchableOpacity style={styles.initialLoadBtn} onPress={openInitialLoadModal}>
            <Text style={styles.initialLoadBtnText}>📦 Carga Inicial de Productos (Una sola vez)</Text>
          </TouchableOpacity>
        )}

        {/* Inventory Entry Button */}
        <TouchableOpacity style={styles.entryBtn} onPress={openInventoryEntry}>
          <Text style={styles.entryBtnText}>📥 Entradas de Inventario</Text>
        </TouchableOpacity>

        {/* Other Exits Button */}
        <TouchableOpacity style={styles.otherExitsBtn} onPress={() => setOtherExitsModalVisible(true)}>
          <Text style={styles.otherExitsBtnText}>⬇️ Otras Salidas (Daño/Pérdida)</Text>
        </TouchableOpacity>

        {/* Operations Report Button */}
        <TouchableOpacity style={styles.reportBtn} onPress={() => setReportVisible(true)}>
          <Text style={styles.reportBtnText}>📊 Reporte de Operaciones</Text>
        </TouchableOpacity>

        {/* Physical Inventory Button */}
        <TouchableOpacity style={styles.physicalBtn} onPress={startPhysicalCount}>
          <Text style={styles.physicalBtnText}>📋 Inventario Físico</Text>
        </TouchableOpacity>

        {/* Product List Header */}
        <View style={styles.listHeader}>
          <Text style={styles.listHeaderText}>
            {searchQuery.length > 0 ? `Resultados: ${quickSearchProducts.length}` : 'Existencias e Importes'}
          </Text>
        </View>

        {/* Product List - now filtered by search, or show all */}
        {(searchQuery.length > 0 ? quickSearchProducts : displayedProducts).map((item) => {
          // Calcular existencia visible por contexto (vendedor: su tienda; admin: suma de todas las tiendas)
          const storesInfo = productStoreStock[item.id] || [];
          const sellerQty = isSeller && currentStoreId
            ? (storesInfo.find(s => s.storeId === currentStoreId)?.quantity || 0)
            : null;
          const totalQtyAllStores = storesInfo.reduce((sum, s) => sum + s.quantity, 0);
          const visibleQty = (sellerQty !== null ? sellerQty : totalQtyAllStores);

          const costValue = visibleQty * item.costPrice;
          const sellValue = visibleQty * item.sellPrice;
          const profit = sellValue - costValue;
          const profitPercent = costValue > 0 ? ((profit / costValue) * 100) : 0;

          // Obtener tiendas donde está disponible el producto
          const productStores = productStoreStock[item.id] || [];

          return (
            <View key={item.id} style={styles.productCard}>
              <View style={styles.productCardHeader}>
                <ProductRow 
                  product={item} 
                  onPress={() => openEdit(item)} 
                  onToggleExtra={async (enabled) => { 
                    await updateProductFlag(item.id, enabled); 
                    await load(); 
                  }} 
                />
                {/* Quick Add Button - if searching */}
                {searchQuery.length > 0 && (
                  <TouchableOpacity 
                    style={styles.quickAddButton}
                    onPress={() => addToQuickCart(item)}
                  >
                    <Ionicons name="add-circle" size={28} color={THEME.colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
              
              {/* Indicador de tiendas donde está el producto */}
              {productStores.length > 0 && (
                <View style={styles.productStoresSection}>
                  <Text style={styles.productStoresLabel}>📍 Disponible en:</Text>
                  <View style={styles.productStoresContainer}>
                    {productStores.map(({ storeId, storeName, quantity }) => (
                      <View key={storeId} style={styles.storeChip}>
                        <Text style={styles.storeChipName}>{storeName}</Text>
                        <Text style={styles.storeChipQty}>({quantity})</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              <View style={styles.productStats}>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Existencia:</Text>
                  <Text style={styles.statValue}>{visibleQty} unidades</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Importe al Costo:</Text>
                  <Text style={styles.statValue}>${costValue.toFixed(2)}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Importe a la Venta:</Text>
                  <Text style={styles.statValue}>${sellValue.toFixed(2)}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Utilidad:</Text>
                  <Text style={[styles.statValue, profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
                    ${profit.toFixed(2)} ({profitPercent.toFixed(1)}%)
                  </Text>
                </View>
                
                {/* NEW: Ver Historial Button */}
                <TouchableOpacity 
                  style={[styles.addToCartBtn, { backgroundColor: '#3B82F6', marginTop: SPACING.small }]} 
                  onPress={() => openProductHistory(item)}
                >
                  <Text style={[styles.addToCartBtnText]}>📊 Ver Historial</Text>
                </TouchableOpacity>
                
                {/* Admin-only: Open Reassign Stock Modal */}
                {isAdmin && (
                  <TouchableOpacity style={[styles.addToCartBtn, { backgroundColor: '#2563EB', marginTop: SPACING.small }]} onPress={() => openReassignModal(item)}>
                    <Text style={[styles.addToCartBtnText]}>🔄 Reasignar Stock entre Áreas</Text>
                  </TouchableOpacity>
                )}
                {/* Botón Otras Salidas */}
                <TouchableOpacity style={[styles.addToCartBtn, { backgroundColor: '#DC2626', marginTop: SPACING.small }]} onPress={() => openOtherExitModal(item)}>
                  <Text style={[styles.addToCartBtnText]}>⬇️ Otras Salidas</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {/* Empty State - when searching with no results */}
        {searchQuery.length > 0 && quickSearchProducts.length === 0 && (
          <View style={styles.emptySearchState}>
            <Ionicons name="search-outline" size={48} color={THEME.colors.textSecondary} />
            <Text style={styles.emptySearchText}>No se encontraron productos</Text>
            <Text style={styles.emptySearchSubtext}>Intenta con otro nombre o código SKU</Text>
          </View>
        )}
      </ScrollView>

      <ProductEditModal
        visible={modalVisible}
        product={editingProduct}
        onClose={() => { setModalVisible(false); setEditingProduct(null); }}
        onSave={handleSaveEdit}
        onDelete={handleDelete}
      />

      {/* NEW: Product History Modal */}
      <ProductHistoryModal
        visible={historyModalVisible}
        product={historyProduct}
        onClose={() => {
          setHistoryModalVisible(false);
          setHistoryProduct(null);
        }}
      />

      {/* Hidden file input for web CSV import */}
      {Platform.OS === 'web' && (
        // @ts-ignore - web-only element
        <input
          type="file"
          accept=".csv,text/csv"
          ref={webFileInputRef}
          style={{ display: 'none' }}
          onChange={handleWebFileChange}
        />
      )}

      {/* CSV Paste Modal (native) */}
      <Modal visible={importModalVisible} animationType="slide" onRequestClose={() => setImportModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📥 Importar Productos desde CSV</Text>
            <Text style={styles.modalSubtitle}>Pega el contenido del archivo CSV y presiona Importar.</Text>
          </View>
          <View style={{ flex: 1, padding: SPACING.medium }}>
            <TextInput
              style={styles.csvTextArea}
              value={csvText}
              onChangeText={setCsvText}
              placeholder={"name,sku,costPrice,sellPrice,quantity,chargeExtra10Percent\nCoca Cola 600ml,COCA600,10.00,15.00,100,true"}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setImportModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={() => importFromCsv(csvText)} disabled={!csvText.trim()}>
              <Text style={styles.confirmBtnText}>Importar</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Physical Count Modal */}
      <Modal visible={physicalCountVisible} animationType="slide" onRequestClose={cancelPhysicalCount}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📋 Inventario Físico</Text>
            <Text style={styles.modalSubtitle}>Ingrese la cantidad física contada de cada producto</Text>
          </View>

          <ScrollView style={[styles.modalContent, { maxHeight: '70%' }]} showsVerticalScrollIndicator={true}>
            {products.length > 10 && (
              <Text style={{ fontSize: 12, color: THEME.colors.textSecondary, marginBottom: SPACING.small, textAlign: 'center' }}>
                📱 Desliza para ver más productos
              </Text>
            )}
            {products.map(product => {
              const physicalQty = parseFloat(physicalCounts[product.id] || '0');
              // Usar el stock de la tienda precalculado, no el global
              const systemQty = physicalCountStockMap[product.id] ?? 0;
              const diff = physicalQty - systemQty;
              const hasDiff = physicalCounts[product.id] && physicalCounts[product.id] !== '' && diff !== 0;

              return (
                <View key={product.id} style={[styles.countRow, hasDiff && styles.countRowDiff]}>
                  <View style={[styles.countInfo, { maxHeight: 50 }]}>
                    <Text style={[styles.countProductName, { fontSize: 13 }]} numberOfLines={1}>{product.name}</Text>
                    <Text style={[styles.countSystemQty, { fontSize: 11 }]}>Sistema: {systemQty}</Text>
                  </View>
                  <View style={styles.countInputContainer}>
                    <TextInput
                      placeholder="Físico"
                      value={physicalCounts[product.id]}
                      onChangeText={(val) => setPhysicalCounts(prev => ({ ...prev, [product.id]: val }))}
                      keyboardType="numeric"
                      style={[styles.countInput, { width: 60 }]}
                    />
                    {hasDiff && (
                      <Text style={[styles.diffBadge, diff > 0 ? styles.diffPositive : styles.diffNegative, { fontSize: 11 }]}>
                        {diff > 0 ? '+' : ''}{diff}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={cancelPhysicalCount}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={confirmPhysicalCount}>
              <Text style={styles.confirmBtnText}>Confirmar Conteo</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Inventory Entry Modal */}
      <Modal visible={entryModalVisible} animationType="slide" onRequestClose={() => setEntryModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📥 Entrada de Inventario</Text>
            <Text style={styles.modalSubtitle}>Registre compras, transferencias recibidas o ajustes</Text>
          </View>

          <ScrollView style={{ flex: 1, padding: SPACING.medium }}>
            {/* Success/Error Message Banner */}
            {successMessage && (
              <View style={[styles.messageBanner, successMessage.startsWith('✅') ? styles.successBanner : styles.errorBanner]}>
                <Text style={styles.messageText}>{successMessage}</Text>
              </View>
            )}

            {/* Entry Type Selection */}
            <Text style={styles.sectionLabel}>Tipo de Entrada</Text>
            <View style={styles.typeButtons}>
              <TouchableOpacity 
                style={[styles.typeBtn, entryType === 'purchase' && styles.typeBtnActive]}
                onPress={() => setEntryType('purchase')}
              >
                <Text style={[styles.typeBtnText, entryType === 'purchase' && styles.typeBtnTextActive]}>🛒 Compra</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.typeBtn, entryType === 'transfer_in' && styles.typeBtnActive]}
                onPress={() => setEntryType('transfer_in')}
              >
                <Text style={[styles.typeBtnText, entryType === 'transfer_in' && styles.typeBtnTextActive]}>📦 Transferencia</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.typeBtn, entryType === 'adjustment' && styles.typeBtnActive]}
                onPress={() => setEntryType('adjustment')}
              >
                <Text style={[styles.typeBtnText, entryType === 'adjustment' && styles.typeBtnTextActive]}>⚖️ Ajuste</Text>
              </TouchableOpacity>
            </View>

            {/* Store Selection - always visible for all users */}
            <View style={styles.storeSelection}>
              <Text style={styles.sectionLabel}>Tienda de Destino</Text>
              <View style={styles.storeButtons}>
                {isAdmin && (
                  <TouchableOpacity 
                    style={[styles.storeBtn, entryStoreId === null && styles.storeBtnActive]}
                    onPress={() => setEntryStoreId(null)}
                  >
                    <Text style={[styles.storeBtnText, entryStoreId === null && styles.storeBtnTextActive]}>🌍 Sin Tienda</Text>
                  </TouchableOpacity>
                )}
                {stores.map(store => (
                  <TouchableOpacity 
                    key={store.id}
                    style={[styles.storeBtn, entryStoreId === store.id && styles.storeBtnActive, isSeller && { opacity: 0.6 }]}
                    onPress={() => !isSeller && setEntryStoreId(store.id)}
                    disabled={isSeller && currentStoreId !== store.id}
                  >
                    <Text style={[styles.storeBtnText, entryStoreId === store.id && styles.storeBtnTextActive]}>
                      {store.name} {isSeller && currentStoreId === store.id && '📍'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {isSeller && currentStoreId && (
                <Text style={[styles.sectionLabel, { marginTop: SPACING.small, fontSize: 12, color: THEME.colors.textSecondary }]}>
                  ℹ️ Tu tienda asignada: {stores.find(s => s.id === currentStoreId)?.name || 'Cargando...'}
                </Text>
              )}
            </View>

            {/* Cart Items List */}
            {cartItems.length > 0 && (
              <View style={styles.cartSection}>
                <Text style={styles.sectionLabel}>Carrito ({cartItems.length} productos)</Text>
                {cartItems.map((item, index) => (
                  <View key={index} style={styles.cartItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cartItemName}>{item.name}</Text>
                      <Text style={styles.cartItemDetail}>
                        {item.quantity} × ${item.costPrice.toFixed(2)} = ${(item.quantity * item.costPrice).toFixed(2)}
                      </Text>
                      {item.sku && <Text style={styles.cartItemSku}>SKU: {item.sku}</Text>}
                    </View>
                    <TouchableOpacity onPress={() => removeFromCart(index)} style={styles.removeBtn}>
                      <Text style={styles.removeBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.cartTotal}>
                  <Text style={styles.cartTotalLabel}>Total al Costo:</Text>
                  <Text style={styles.cartTotalValue}>
                    ${cartItems.reduce((sum, item) => sum + (item.quantity * item.costPrice), 0).toFixed(2)}
                  </Text>
                </View>
              </View>
            )}

            {/* Product Info */}
            <Text style={styles.sectionLabel}>Agregar Producto</Text>
            <TextInput 
              placeholder="Código/SKU (opcional)" 
              value={entrySku} 
              onChangeText={async (text) => {
                setEntrySku(text);
                setShowSkuSuggestions(true);
                try {
                  const results = await searchProducts(text);
                  setSkuSuggestions(results.slice(0, 6));
                  // If exact match, auto-fill name
                  const exact = results.find(r => r.code.toUpperCase() === text.trim().toUpperCase());
                  if (exact) {
                    setEntryName(exact.description);
                  }
                } catch {}
              }} 
              style={styles.input}
              autoCapitalize="characters"
            />
            {showSkuSuggestions && skuSuggestions.length > 0 && (
              <View style={{ backgroundColor: THEME.colors.surface, borderColor: THEME.colors.outline, borderWidth: 1, borderRadius: THEME.radii.md, marginTop: -8, marginBottom: SPACING.small, ...THEME.shadow }}>
                {skuSuggestions.map((sug) => (
                  <TouchableOpacity
                    key={sug.id}
                    onPress={() => {
                      setEntrySku(sug.code);
                      setEntryName(sug.description);
                      setShowSkuSuggestions(false);
                      setSkuSuggestions([]);
                    }}
                    style={{ padding: SPACING.small, borderBottomWidth: 1, borderBottomColor: THEME.colors.outline }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: THEME.colors.primary }}>{sug.code}</Text>
                    <Text style={{ fontSize: 12, color: THEME.colors.text }}>{sug.description}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput 
              placeholder="Nombre del Producto *" 
              value={entryName} 
              onChangeText={(t) => { setEntryName(t); setShowSkuSuggestions(false); }} 
              style={styles.input}
            />
            
            {/* Pricing and Quantity */}
            <Text style={styles.sectionLabel}>Cantidades y Precios</Text>
            <TextInput 
              placeholder="Cantidad *" 
              value={entryQuantity} 
              onChangeText={setEntryQuantity} 
              keyboardType="numeric"
              style={styles.input}
            />
            <View style={styles.rowInputs}>
              <TextInput 
                placeholder="Precio Costo *" 
                value={entryCost} 
                onChangeText={setEntryCost} 
                keyboardType="numeric"
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput 
                placeholder="Precio Venta *" 
                value={entrySellPrice} 
                onChangeText={setEntrySellPrice} 
                keyboardType="numeric"
                style={[styles.input, { flex: 1, marginLeft: SPACING.small }]}
              />
            </View>

            {/* Calculated Importe */}
            {entryQuantity && entryCost && !isNaN(parseFloat(entryQuantity)) && !isNaN(parseFloat(entryCost)) && (
              <View style={styles.importeBox}>
                <Text style={styles.importeLabel}>Importe al Costo:</Text>
                <Text style={styles.importeValue}>
                  ${(parseFloat(entryQuantity) * parseFloat(entryCost)).toFixed(2)}
                </Text>
              </View>
            )}

            {/* Add to Cart Button */}
            <TouchableOpacity style={styles.addToCartBtn} onPress={addToCart}>
              <Text style={styles.addToCartBtnText}>➕ Agregar al Carrito</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEntryModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.confirmBtn, cartItems.length === 0 && { opacity: 0.5 }]} 
              onPress={confirmAllCartItems}
              disabled={cartItems.length === 0}
            >
              <Text style={styles.confirmBtnText}>
                Confirmar Todo ({cartItems.length})
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Stock Reassignment Module */}
      <StockReassignmentModule
        visible={reassignmentModuleVisible}
        product={reassignProduct}
        onClose={() => setReassignmentModuleVisible(false)}
        stores={stores}
        onReassignmentComplete={async () => { await load(); }}
      />

      {/* Operations Report Modal */}
      <Modal visible={reportVisible} animationType="slide" onRequestClose={() => setReportVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📊 Reporte de Operaciones</Text>
            <Text style={styles.modalSubtitle}>Historial completo de movimientos de inventario y ventas</Text>
          </View>

          <OperationsReport />

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.confirmBtn} onPress={() => setReportVisible(false)}>
              <Text style={styles.confirmBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Other Exits Modal */}
      <Modal visible={otherExitsModalVisible} animationType="slide" onRequestClose={() => setOtherExitsModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>⬇️ Otras Salidas</Text>
            <Text style={styles.modalSubtitle}>Registrar daño, pérdida o salidas de stock</Text>
          </View>

          <ScrollView style={{ flex: 1, padding: SPACING.medium }}>
            {otherExitProduct && (
              <>
                <View style={styles.productInfoBox}>
                  <Text style={styles.productInfoLabel}>Producto Seleccionado:</Text>
                  <Text style={styles.productInfoValue}>{otherExitProduct.name}</Text>
                  <Text style={styles.productInfoSubtitle}>Stock Actual: {otherExitProduct.quantity} unidades</Text>
                </View>

                <Text style={styles.sectionLabel}>Tipo de Salida</Text>
                <View style={styles.typeButtons}>
                  <TouchableOpacity 
                    style={[styles.typeBtn, otherExitReason === 'damaged' && styles.typeBtnActive]}
                    onPress={() => setOtherExitReason('damaged')}
                  >
                    <Text style={[styles.typeBtnText, otherExitReason === 'damaged' && styles.typeBtnTextActive]}>🔨 Daño</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.typeBtn, otherExitReason === 'lost' && styles.typeBtnActive]}
                    onPress={() => setOtherExitReason('lost')}
                  >
                    <Text style={[styles.typeBtnText, otherExitReason === 'lost' && styles.typeBtnTextActive]}>❌ Pérdida</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.typeBtn, otherExitReason === 'other' && styles.typeBtnActive]}
                    onPress={() => setOtherExitReason('other')}
                  >
                    <Text style={[styles.typeBtnText, otherExitReason === 'other' && styles.typeBtnTextActive]}>📋 Otro</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.sectionLabel}>Cantidad a Rebajar</Text>
                <TextInput
                  placeholder="Ingresa la cantidad"
                  value={otherExitQuantity}
                  onChangeText={setOtherExitQuantity}
                  keyboardType="numeric"
                  style={styles.input}
                />

                <Text style={styles.sectionLabel}>Nota (Opcional)</Text>
                <TextInput
                  placeholder="Describe el motivo de la salida"
                  value={otherExitNote}
                  onChangeText={setOtherExitNote}
                  multiline
                  numberOfLines={4}
                  style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
                />

                {otherExitQuantity && !isNaN(parseFloat(otherExitQuantity)) && (
                  <View style={styles.summaryBox}>
                    <Text style={styles.summaryLabel}>Resumen de Salida:</Text>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryText}>Cantidad a rebajar:</Text>
                      <Text style={styles.summaryValue}>{otherExitQuantity} unidades</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryText}>Valor al costo:</Text>
                      <Text style={styles.summaryValue}>${(parseFloat(otherExitQuantity) * otherExitProduct.costPrice).toFixed(2)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryText}>Stock después:</Text>
                      <Text style={styles.summaryValue}>{otherExitProduct.quantity - parseFloat(otherExitQuantity)} unidades</Text>
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setOtherExitsModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.confirmBtn, (!otherExitProduct || !otherExitQuantity) && { opacity: 0.5 }]}
              onPress={handleOtherExit}
              disabled={!otherExitProduct || !otherExitQuantity}
            >
              <Text style={styles.confirmBtnText}>Registrar Salida</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Initial Product Load Modal - MEJORADO */}
      <Modal visible={showInitialLoadModal} animationType="slide" onRequestClose={() => {}}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📦 Carga Inicial de Productos</Text>
            <Text style={styles.modalSubtitle}>Configura cantidades y precios. Los cálculos se actualizan automáticamente.</Text>
          </View>

          <ScrollView style={{ flex: 1, padding: SPACING.medium }}>
            {/* 🔍 SEARCH FILTER FOR INITIAL LOAD MODAL */}
            <View style={styles.quickSearchSection}>
              <View style={styles.searchInputContainer}>
                <Ionicons name="search" size={20} color={THEME.colors.textSecondary} style={styles.searchIcon} />
                <TextInput
                  placeholder="🔍 Buscar por código o descripción..."
                  value={initialLoadSearchQuery}
                  onChangeText={setInitialLoadSearchQuery}
                  placeholderTextColor={THEME.colors.textSecondary}
                  style={styles.searchInputField}
                />
                {initialLoadSearchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setInitialLoadSearchQuery('')} style={styles.clearButton}>
                    <Ionicons name="close-circle" size={18} color={THEME.colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* 📥 BOTÓN IMPORTAR CSV MASIVO */}
            <TouchableOpacity
              style={{ backgroundColor: '#3B82F6', padding: SPACING.medium, borderRadius: THEME.radii.md, alignItems: 'center', marginBottom: SPACING.medium }}
              onPress={() => setInitialLoadCSVModalVisible(true)}
            >
              <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 16 }}>📥 Importar CSV Masivo</Text>
            </TouchableOpacity>

            {/* Lista de todos los productos del clasificador - FILTERED BY SEARCH */}
            {initialLoadClassified.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { marginBottom: SPACING.medium, color: THEME.colors.textSecondary }]}>
                  {initialLoadClassified.length} productos disponibles del clasificador
                </Text>

                {initialLoadClassified.map((product) => {
                  const inCart = initialLoadCart.find(c => c.code === product.code);
                  const currentStock = existingStockByCode[product.code] ?? 0;

                  // FILTER: Hide products that don't match search query
                  if (initialLoadSearchQuery.trim()) {
                    const query = initialLoadSearchQuery.toLowerCase();
                    const matches = product.code.toLowerCase().includes(query) || 
                                   product.description.toLowerCase().includes(query);
                    if (!matches) return null;
                  }

                  if (inCart) {
                    // Producto ya en carrito - mostrar resumen
                    const importe_costo = inCart.quantity * inCart.costPrice;
                    const importe_venta = inCart.quantity * inCart.sellPrice;
                    const utilidad = importe_venta - importe_costo;

                    return (
                      <View key={product.id} style={[styles.productItemInCart, { backgroundColor: '#DBEAFE' }]}>
                        <View style={styles.cartItemTop}>
                          <Text style={styles.productCode}>{product.code}</Text>
                          <Text style={styles.productInCartBadge}>✅ En Carrito</Text>
                        </View>
                        <Text style={styles.productDescription}>{product.description}</Text>
                        <Text style={{ fontSize: 12, color: THEME.colors.textSecondary }}>Existencia actual: {currentStock} unidades</Text>

                        <View style={styles.detailsGrid}>
                          <View style={styles.detailCell}>
                            <Text style={styles.detailLabel}>Cantidad</Text>
                            <Text style={styles.detailValue}>{inCart.quantity}</Text>
                          </View>
                          <View style={styles.detailCell}>
                            <Text style={styles.detailLabel}>P. Costo</Text>
                            <Text style={styles.detailValue}>${inCart.costPrice.toFixed(2)}</Text>
                          </View>
                          <View style={styles.detailCell}>
                            <Text style={styles.detailLabel}>P. Venta</Text>
                            <Text style={styles.detailValue}>${inCart.sellPrice.toFixed(2)}</Text>
                          </View>
                        </View>

                        <View style={styles.summaryGrid}>
                          <View style={[styles.summaryCell, { backgroundColor: '#E0E7FF' }]}>
                            <Text style={styles.summaryLabel}>Importe Costo</Text>
                            <Text style={[styles.summaryValue, { color: '#4338CA' }]}>${importe_costo.toFixed(2)}</Text>
                          </View>
                          <View style={[styles.summaryCell, { backgroundColor: '#FEF3C7' }]}>
                            <Text style={styles.summaryLabel}>Importe Venta</Text>
                            <Text style={[styles.summaryValue, { color: '#92400E' }]}>${importe_venta.toFixed(2)}</Text>
                          </View>
                          <View style={[styles.summaryCell, { backgroundColor: '#DCFCE7' }]}>
                            <Text style={styles.summaryLabel}>Utilidad</Text>
                            <Text style={[styles.summaryValue, { color: '#15803D', fontWeight: '800' }]}>${utilidad.toFixed(2)}</Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          style={[styles.cartActionBtn, { backgroundColor: '#EF4444', marginTop: SPACING.medium }]}
                          onPress={() => removeFromInitialLoadCart(initialLoadCart.findIndex(c => c.code === product.code))}
                        >
                          <Text style={styles.cartActionBtnText}>🗑️ Eliminar del Carrito</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }

                  // Producto NO en carrito - mostrar formulario de entrada
                  return (
                    <View key={product.id} style={styles.productItemForm}>
                      <View style={styles.productHeaderForm}>
                        <Text style={styles.productCodeForm}>{product.code}</Text>
                        <Text style={styles.productUnitBadge}>{product.unit}</Text>
                      </View>
                      <Text style={styles.productDescriptionForm}>{product.description}</Text>
                      <Text style={{ fontSize: 12, color: THEME.colors.textSecondary, marginBottom: SPACING.tiny }}>Existencia actual: {currentStock} unidades</Text>

                      {/* Inputs: Cantidad, Costo, Venta */}
                      <View style={styles.formGrid}>
                        <View style={styles.formGroup}>
                          <Text style={styles.inputLabel}>Cantidad *</Text>
                          <TextInput
                            placeholder="0"
                            keyboardType="numeric"
                            style={styles.formInput}
                            onChangeText={(val) => {
                              if (initialLoadSelectedCode === product.code) {
                                setInitialLoadSelectedQty(val);
                              }
                            }}
                            value={initialLoadSelectedCode === product.code ? initialLoadSelectedQty : ''}
                            onFocus={() => setInitialLoadSelectedCode(product.code)}
                          />
                        </View>
                        <View style={styles.formGroup}>
                          <Text style={styles.inputLabel}>P. Costo *</Text>
                          <TextInput
                            placeholder="0.00"
                            keyboardType="numeric"
                            style={styles.formInput}
                            onChangeText={(val) => {
                              if (initialLoadSelectedCode === product.code) {
                                setInitialLoadSelectedCost(val);
                              }
                            }}
                            value={initialLoadSelectedCode === product.code ? initialLoadSelectedCost : ''}
                            onFocus={() => setInitialLoadSelectedCode(product.code)}
                          />
                        </View>
                        <View style={styles.formGroup}>
                          <Text style={styles.inputLabel}>P. Venta *</Text>
                          <TextInput
                            placeholder="0.00"
                            keyboardType="numeric"
                            style={styles.formInput}
                            onChangeText={(val) => {
                              if (initialLoadSelectedCode === product.code) {
                                setInitialLoadSelectedSell(val);
                              }
                            }}
                            value={initialLoadSelectedCode === product.code ? initialLoadSelectedSell : ''}
                            onFocus={() => setInitialLoadSelectedCode(product.code)}
                          />
                        </View>
                      </View>

                      {/* Cálculos en tiempo real si hay datos */}
                      {initialLoadSelectedCode === product.code && 
                       initialLoadSelectedQty && 
                       initialLoadSelectedCost && 
                       initialLoadSelectedSell && (
                        <View style={styles.calculationsPreview}>
                          <View style={styles.calcRow}>
                            <Text style={styles.calcLabel}>Importe al Costo:</Text>
                            <Text style={styles.calcValue}>
                              ${(parseFloat(initialLoadSelectedQty) * parseFloat(initialLoadSelectedCost)).toFixed(2)}
                            </Text>
                          </View>
                          <View style={styles.calcRow}>
                            <Text style={styles.calcLabel}>Importe a la Venta:</Text>
                            <Text style={styles.calcValue}>
                              ${(parseFloat(initialLoadSelectedQty) * parseFloat(initialLoadSelectedSell)).toFixed(2)}
                            </Text>
                          </View>
                          <View style={[styles.calcRow, { borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: SPACING.small, marginTop: SPACING.small }]}>
                            <Text style={[styles.calcLabel, { fontWeight: '700' }]}>Utilidad:</Text>
                            <Text style={[styles.calcValue, { fontWeight: '800', color: '#10B981' }]}>
                              ${(
                                parseFloat(initialLoadSelectedQty) * parseFloat(initialLoadSelectedSell) - 
                                parseFloat(initialLoadSelectedQty) * parseFloat(initialLoadSelectedCost)
                              ).toFixed(2)}
                            </Text>
                          </View>
                        </View>
                      )}

                      <TouchableOpacity
                        style={styles.addProductToLoadBtn}
                        onPress={() => addToInitialLoadCart(product.code)}
                        disabled={!initialLoadSelectedQty || !initialLoadSelectedCost || !initialLoadSelectedSell}
                      >
                        <Text style={styles.addProductToLoadBtnText}>➕ Agregar al Carrito</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: SPACING.xl }}>
                <Text style={{ fontSize: 16, color: THEME.colors.textSecondary, textAlign: 'center' }}>
                  No hay productos en el clasificador.\n\nCrea productos primero en Clasificador de Productos.
                </Text>
              </View>
            )}

            {/* Separador si hay carrito */}
            {initialLoadCart.length > 0 && (
              <View style={{ height: 1, backgroundColor: THEME.colors.outline, marginVertical: SPACING.large }} />
            )}

            {/* Resumen del carrito */}
            {initialLoadCart.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginBottom: SPACING.medium }]}>Resumen del Carrito ({initialLoadCart.length})</Text>

                <View style={styles.cartSummaryBox}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryText}>Total Productos:</Text>
                    <Text style={styles.summaryValue}>{initialLoadCart.length}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryText}>Total Unidades:</Text>
                    <Text style={styles.summaryValue}>{initialLoadCart.reduce((sum, item) => sum + item.quantity, 0)}</Text>
                  </View>
                  <View style={[styles.summaryRow, { backgroundColor: '#E0E7FF', paddingHorizontal: SPACING.small, paddingVertical: SPACING.small, borderRadius: THEME.radii.md, marginBottom: SPACING.small }]}>
                    <Text style={[styles.summaryText, { fontWeight: '700', color: '#4338CA' }]}>Total Importe Costo:</Text>
                    <Text style={[styles.summaryValue, { color: '#4338CA', fontWeight: '800', fontSize: 16 }]}>
                      ${initialLoadCart.reduce((sum, item) => sum + (item.quantity * item.costPrice), 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={[styles.summaryRow, { backgroundColor: '#FEF3C7', paddingHorizontal: SPACING.small, paddingVertical: SPACING.small, borderRadius: THEME.radii.md, marginBottom: SPACING.small }]}>
                    <Text style={[styles.summaryText, { fontWeight: '700', color: '#92400E' }]}>Total Importe Venta:</Text>
                    <Text style={[styles.summaryValue, { color: '#92400E', fontWeight: '800', fontSize: 16 }]}>
                      ${initialLoadCart.reduce((sum, item) => sum + (item.quantity * item.sellPrice), 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={[styles.summaryRow, { backgroundColor: '#DCFCE7', paddingHorizontal: SPACING.small, paddingVertical: SPACING.small, borderRadius: THEME.radii.md }]}>
                    <Text style={[styles.summaryText, { fontWeight: '700', color: '#15803D' }]}>Total Utilidad:</Text>
                    <Text style={[styles.summaryValue, { color: '#15803D', fontWeight: '800', fontSize: 16 }]}>
                      ${initialLoadCart.reduce((sum, item) => sum + (item.quantity * (item.sellPrice - item.costPrice)), 0).toFixed(2)}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity 
              style={styles.cancelBtn} 
              onPress={() => {
                setShowInitialLoadModal(false);
                setInitialLoadCart([]);
                setInitialLoadSelectedCode('');
                setInitialLoadSelectedQty('');
                setInitialLoadSelectedCost('');
                setInitialLoadSelectedSell('');
              }}
            >
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, initialLoadCart.length === 0 && { opacity: 0.5 }]}
              onPress={confirmInitialLoad}
              disabled={initialLoadCart.length === 0 || initialLoadLoading}
            >
              <Text style={styles.confirmBtnText}>
                {initialLoadLoading ? 'Procesando...' : `Confirmar Carga (${initialLoadCart.length})`}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* 📥 MODAL IMPORTAR CSV MASIVO PARA CARGA INICIAL */}
      <Modal visible={initialLoadCSVModalVisible} animationType="slide" onRequestClose={() => setInitialLoadCSVModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📥 Importar CSV Masivo - Carga Inicial</Text>
            <Text style={styles.modalSubtitle}>
              Formato: Código,Descripción,cantidad,PrecioCosto,PrecioVenta{'\n'}
              Ejemplo: 010003,VINAGRE,2.000,216.000,280.000
            </Text>
          </View>

          <ScrollView style={{ flex: 1, padding: SPACING.medium }}>
            <TextInput
              style={styles.csvTextArea}
              value={initialLoadCSVText}
              onChangeText={setInitialLoadCSVText}
              placeholder="Pega aquí el contenido CSV completo..."
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity 
              style={styles.cancelBtn} 
              onPress={() => {
                setInitialLoadCSVModalVisible(false);
                setInitialLoadCSVText('');
              }}
            >
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, !initialLoadCSVText.trim() && { opacity: 0.5 }]}
              onPress={() => {
                if (!initialLoadCSVText.trim()) {
                  Alert.alert('Error', 'Pega el contenido CSV primero');
                  return;
                }

                try {
                  // Parse CSV with user's exact format:
                  // Código,Descripción,cantidad,PrecioCosto,PrecioVenta,ImporteCosto,ImporteVenta,,
                  const lines = initialLoadCSVText.split('\n').filter(line => line.trim());
                  if (lines.length === 0) {
                    Alert.alert('Error', 'El CSV está vacío');
                    return;
                  }

                  // Check if first line is header
                  const firstLine = lines[0].toLowerCase();
                  const hasHeader = firstLine.includes('código') || firstLine.includes('codigo') || firstLine.includes('descripción') || firstLine.includes('descripcion');
                  const dataLines = hasHeader ? lines.slice(1) : lines;

                  const newItems: Array<{ code: string; description: string; quantity: number; costPrice: number; sellPrice: number }> = [];
                  const errors: string[] = [];

                  for (let i = 0; i < dataLines.length; i++) {
                    const line = dataLines[i].trim();
                    if (!line) continue;

                    const parts = line.split(',').map(p => p.trim());
                    if (parts.length < 5) {
                      errors.push(`Línea ${i + 1}: formato incorrecto (se esperan al menos 5 columnas)`);
                      continue;
                    }

                    const [codigo, descripcion, cantidadStr, costoStr, ventaStr] = parts;
                    
                    if (!codigo || !descripcion) {
                      errors.push(`Línea ${i + 1}: código o descripción vacíos`);
                      continue;
                    }

                    const cantidad = parseFloat(cantidadStr);
                    const costo = parseFloat(costoStr);
                    const venta = parseFloat(ventaStr);

                    if (isNaN(cantidad) || cantidad <= 0) {
                      errors.push(`Línea ${i + 1}: cantidad inválida`);
                      continue;
                    }

                    if (isNaN(costo) || costo < 0) {
                      errors.push(`Línea ${i + 1}: precio de costo inválido`);
                      continue;
                    }

                    if (isNaN(venta) || venta < 0) {
                      errors.push(`Línea ${i + 1}: precio de venta inválido`);
                      continue;
                    }

                    newItems.push({
                      code: codigo,
                      description: descripcion,
                      quantity: cantidad,
                      costPrice: costo,
                      sellPrice: venta,
                    });
                  }

                  if (newItems.length === 0) {
                    Alert.alert('Error', 'No se encontraron productos válidos en el CSV');
                    return;
                  }

                  // Add all parsed items to cart
                  setInitialLoadCart(prev => [...prev, ...newItems]);
                  
                  const successMsg = errors.length > 0
                    ? `✅ Se agregaron ${newItems.length} productos al carrito.\n\n⚠️ ${errors.length} errores encontrados`
                    : `✅ Se agregaron ${newItems.length} productos al carrito correctamente`;

                  Alert.alert('Importación Exitosa', successMsg);
                  setInitialLoadCSVModalVisible(false);
                  setInitialLoadCSVText('');
                } catch (err: any) {
                  Alert.alert('Error', 'No se pudo importar el CSV: ' + (err?.message || err));
                }
              }}
              disabled={!initialLoadCSVText.trim()}
            >
              <Text style={styles.confirmBtnText}>Importar al Carrito</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  content: { flex: 1, padding: SPACING.medium },
  heading: { fontSize: 22, fontWeight: '800', marginBottom: SPACING.medium },
  closedDayBanner: {
    backgroundColor: '#F44336',
    padding: SPACING.medium,
    marginHorizontal: SPACING.medium,
    marginTop: SPACING.medium,
    borderRadius: THEME.radii.md,
    ...THEME.shadow,
  },
  closedDayBannerText: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  input: { backgroundColor: THEME.colors.surfaceVariant, padding: SPACING.small, borderRadius: THEME.radii.sm, marginBottom: SPACING.small },
  rowInputs: { flexDirection: 'row', alignItems: 'center' },
  
  dateHeaderBanner: {
    backgroundColor: '#F3F4F6',
    padding: SPACING.small,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.medium,
  },
  dateHeaderLabel: { fontSize: 14, fontWeight: '600', color: THEME.colors.text },
  dateHeaderValue: { fontSize: 14, color: THEME.colors.textSecondary },

  entryBtn: { 
    backgroundColor: '#10B981', 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.md, 
    alignItems: 'center', 
    marginBottom: SPACING.medium,
    ...THEME.shadow 
  },
  entryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },

  initialLoadBtn: {
    backgroundColor: '#F59E0B',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    marginBottom: SPACING.medium,
    ...THEME.shadow
  },
  initialLoadBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },

  otherExitsBtn: {
    backgroundColor: '#DC2626',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    marginBottom: SPACING.medium,
    ...THEME.shadow
  },
  otherExitsBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },

  reportBtn: {
    backgroundColor: '#F59E0B',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    marginBottom: SPACING.medium,
    ...THEME.shadow
  },
  reportBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },

  physicalBtn: { 
    backgroundColor: '#8B5CF6', 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.md, 
    alignItems: 'center', 
    marginBottom: SPACING.medium,
    ...THEME.shadow 
  },
  physicalBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },

  // Physical Count Modal
  modalContainer: { flex: 1, backgroundColor: THEME.colors.background },
  modalHeader: { 
    padding: SPACING.medium, 
    backgroundColor: THEME.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.outline
  },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: SPACING.tiny },
  modalSubtitle: { fontSize: 13, color: THEME.colors.textSecondary },
  modalContent: { flex: 1, padding: SPACING.medium },
  
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  countRowDiff: {
    borderWidth: 2,
    borderColor: '#F59E0B',
  },
  countInfo: { flex: 1 },
  countProductName: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  countSystemQty: { fontSize: 13, color: THEME.colors.textSecondary },
  countInputContainer: { flexDirection: 'row', alignItems: 'center' },
  countInput: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    width: 80,
    textAlign: 'center',
    fontWeight: '600',
  },
  diffBadge: {
    marginLeft: SPACING.small,
    paddingHorizontal: SPACING.small,
    paddingVertical: 2,
    borderRadius: THEME.radii.sm,
    fontWeight: '700',
    fontSize: 13,
  },
  diffPositive: { backgroundColor: '#10B981', color: '#FFF' },
  diffNegative: { backgroundColor: '#EF4444', color: '#FFF' },

  modalFooter: {
    flexDirection: 'row',
    padding: SPACING.medium,
    backgroundColor: THEME.colors.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.outline,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    marginRight: SPACING.small,
  },
  cancelBtnText: { fontWeight: '700', color: THEME.colors.text },
  confirmBtn: {
    flex: 1,
    backgroundColor: THEME.colors.primary,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  confirmBtnText: { fontWeight: '700', color: THEME.colors.onPrimary },

  // CSV paste text area
  csvTextArea: {
    flex: 1,
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.md,
    padding: SPACING.medium,
    fontSize: 13,
  },

  // Product List
  listHeader: { 
    backgroundColor: THEME.colors.surface, 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.md, 
    marginBottom: SPACING.medium 
  },
  listHeaderText: { fontSize: 18, fontWeight: '700', color: THEME.colors.text },
  productCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
    ...THEME.shadow,
  },
  productCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.small,
  },
  productStats: {
    marginTop: SPACING.small,
    paddingTop: SPACING.small,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.outline,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statLabel: { fontSize: 12, color: THEME.colors.textSecondary },
  statValue: { fontSize: 13, fontWeight: '600' },
  profitPositive: { color: '#10B981' },
  profitNegative: { color: '#EF4444' },
  productStockOut: { fontSize: 12, color: THEME.colors.error, fontWeight: '700' },
  cartBadge: { backgroundColor: THEME.colors.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginTop: 4 },
  cartBadgeText: { color: THEME.colors.onPrimary, fontSize: 10, fontWeight: '700' },

  // Estilos para indicador de tiendas
  productStoresSection: {
    marginTop: SPACING.small,
    paddingTop: SPACING.small,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.outline,
  },
  productStoresLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
    marginBottom: SPACING.tiny,
  },
  productStoresContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.tiny,
  },
  storeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceVariant,
    paddingHorizontal: SPACING.small,
    paddingVertical: 4,
    borderRadius: THEME.radii.sm,
    gap: 4,
  },
  storeChipName: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  storeChipQty: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.colors.primary,
  },
  
  cartSection: { backgroundColor: THEME.colors.surface, padding: SPACING.medium, borderRadius: THEME.radii.md, ...THEME.shadow, marginBottom: SPACING.large },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface,
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    marginBottom: SPACING.small,
  },
  cartItemName: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  cartItemDetail: { fontSize: 12, color: THEME.colors.textSecondary },
  cartItemSku: { fontSize: 11, color: THEME.colors.textSecondary, fontStyle: 'italic' },
  removeBtn: {
    backgroundColor: '#EF4444',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  cartTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.small,
    paddingTop: SPACING.small,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.outline,
  },
  cartTotalLabel: { fontSize: 15, fontWeight: '700' },
  cartTotalValue: { fontSize: 18, fontWeight: '800', color: THEME.colors.primary },
  addToCartBtn: {
    backgroundColor: '#10B981',
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    marginTop: SPACING.medium,
  },
  addToCartBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  
  // Message banner
  messageBanner: {
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.medium,
    alignItems: 'center',
  },
  successBanner: {
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  messageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },

  // Store Selection
  storeSelection: {
    marginBottom: SPACING.large,
  },
  storeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.small,
  },
  storeBtn: {
    flex: 1,
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    backgroundColor: THEME.colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  storeBtnActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  storeBtnText: { color: THEME.colors.text, fontWeight: '600', fontSize: 13 },
  storeBtnTextActive: { color: THEME.colors.onPrimary },

  // Operations Report
  sectionLabel: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  summaryCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  operationRow: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  operationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  operationType: { fontSize: 14, fontWeight: '700' },
  operationDate: { fontSize: 12, color: THEME.colors.textSecondary },
  operationProduct: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  operationDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  operationText: { fontSize: 12, color: THEME.colors.textSecondary },
  operationTotal: { fontSize: 14, fontWeight: '700', color: THEME.colors.primary },
  operationNote: { fontSize: 12, color: THEME.colors.textSecondary, fontStyle: 'italic' },

  // Other Exits Modal
  productInfoBox: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.large,
  },
  productInfoLabel: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  productInfoValue: { fontSize: 16, fontWeight: '700' },
  productInfoSubtitle: { fontSize: 12, color: THEME.colors.textSecondary },
  summaryBox: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.large,
  },

  // Initial Load Modal
  classifiedProductRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  classifiedProductName: { fontSize: 14, fontWeight: '700', flex: 1 },
  classifiedProductDesc: { fontSize: 12, color: THEME.colors.textSecondary, flex: 1 },
  inCartBadge: { backgroundColor: '#10B981', color: '#FFF', padding: 4, borderRadius: 10, fontSize: 10, fontWeight: '700' },
  addProductBtn: {
    backgroundColor: '#10B981',
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    alignItems: 'center',
  },
  addProductBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  cartItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  cartItemCode: { fontSize: 14, fontWeight: '700', flex: 1 },
  cartItemDesc: { fontSize: 12, color: THEME.colors.textSecondary, flex: 1 },
  cartItemDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flex: 1,
    marginTop: 2,
  },
  cartItemDetailText: { fontSize: 12, color: THEME.colors.textSecondary },
  cartItemDetailValue: { fontSize: 12, fontWeight: '700', color: THEME.colors.primary },
  cartActionBtn: {
    backgroundColor: '#3B82F6',
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
  },
  cartSummary: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginTop: SPACING.small,
  },
  cartSummaryBox: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginTop: SPACING.small,
  },
  cartItemCompact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: THEME.colors.surface,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  cartItemCompactCode: { fontSize: 14, fontWeight: '700', flex: 1 },
  cartItemCompactInfo: { fontSize: 12, color: THEME.colors.textSecondary },
  productItemInCart: {
    backgroundColor: '#DBEAFE',
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.small,
  },
  cartItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.small,
  },
  detailsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.small,
  },
  detailCell: {
    flex: 1,
    padding: SPACING.small,
  },
  detailLabel: { fontSize: 12, fontWeight: '700', color: THEME.colors.textSecondary },
  detailValue: { fontSize: 13, fontWeight: '600' },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.small,
  },
  summaryCell: {
    flex: 1,
    padding: SPACING.small,
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.sm,
  },
  formGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.small,
  },
  formGroup: {
    flex: 1,
    padding: SPACING.small,
  },
  inputLabel: { fontSize: 12, fontWeight: '700', color: THEME.colors.textSecondary },
  formInput: { backgroundColor: THEME.colors.surfaceVariant, padding: SPACING.small, borderRadius: THEME.radii.sm, fontSize: 14 },
  calculationsPreview: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    marginBottom: SPACING.small,
  },
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  calcLabel: { fontSize: 12, fontWeight: '700', color: THEME.colors.textSecondary },
  calcValue: { fontSize: 13, fontWeight: '600' },
  addProductToLoadBtn: {
    backgroundColor: '#10B981',
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.small,
  },
  addProductToLoadBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  cartActionBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  quickSearchSection: {
    marginBottom: SPACING.large,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceVariant,
    borderRadius: THEME.radii.md,
    padding: SPACING.small,
    marginBottom: SPACING.small,
  },
  searchIcon: { marginRight: SPACING.small },
  searchInputField: { 
    flex: 1, 
    fontSize: 14, 
    fontWeight: '600',
    color: THEME.colors.text,
  },
  clearButton: {
    padding: SPACING.small,
  },
  searchResultsInfo: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  searchResultsText: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  quickCartSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.medium,
  },
  quickCartSummaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickCartLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  quickCartStats: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  quickAddButton: {
    backgroundColor: THEME.colors.primary,
    padding: SPACING.small,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.small,
  },
  emptySearchState: {
    alignItems: 'center',
    padding: SPACING.large,
  },
  emptySearchText: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  emptySearchSubtext: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
  },
  
  // Styles for Initial Load Modal & Inventory Entry Modal
  typeButtons: {
    flexDirection: 'row',
    gap: SPACING.small,
    marginBottom: SPACING.medium,
  },
  typeBtn: {
    flex: 1,
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    backgroundColor: THEME.colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBtnActive: {
    backgroundColor: THEME.colors.primary,
  },
  typeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  typeBtnTextActive: {
    color: THEME.colors.onPrimary,
  },
  importeBox: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.medium,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  importeLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  importeValue: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME.colors.primary,
  },
  productCode: {
    fontSize: 14,
    fontWeight: '800',
    color: THEME.colors.primary,
  },
  productInCartBadge: {
    backgroundColor: '#10B981',
    color: '#FFF',
    paddingHorizontal: SPACING.small,
    paddingVertical: 4,
    borderRadius: THEME.radii.sm,
    fontSize: 11,
    fontWeight: '700',
  },
  productDescription: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.text,
    marginBottom: SPACING.tiny,
  },
  productItemForm: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.medium,
    ...THEME.shadow,
  },
  productHeaderForm: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.small,
  },
  productCodeForm: {
    fontSize: 15,
    fontWeight: '800',
    color: THEME.colors.primary,
  },
  productUnitBadge: {
    backgroundColor: THEME.colors.surfaceVariant,
    paddingHorizontal: SPACING.small,
    paddingVertical: 4,
    borderRadius: THEME.radii.sm,
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
  },
  productDescriptionForm: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.text,
    marginBottom: SPACING.small,
  },
  // Shared styles used in multiple places (keep single definition)
  summaryLabel: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  summaryValue: { fontSize: 18, fontWeight: '800', color: THEME.colors.primary },
  summaryCount: { fontSize: 12, color: THEME.colors.textSecondary },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  summaryText: { fontSize: 12, color: THEME.colors.textSecondary },
  cartActionBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});

function OperationsReport() {
  const [entries, setEntries] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [entriesData, salesData, productsData] = await Promise.all([
        getInventoryEntries(),
        getSales(),
        getProducts(),
      ]);
      setEntries(entriesData);
      setSales(salesData);
      setProducts(productsData);
    } catch (err) {
      console.error('Load operations report error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.large }}>
        <Text>Cargando reporte...</Text>
      </View>
    );
  }

  // Calculate totals
  const purchaseTotal = entries
    .filter(e => e.type === 'purchase')
    .reduce((sum, e) => sum + (e.quantity * e.unitCost), 0);
  
  const transferInTotal = entries
    .filter(e => e.type === 'transfer_in')
    .reduce((sum, e) => sum + (e.quantity * e.unitCost), 0);
  
  const adjustmentTotal = entries
    .filter(e => e.type === 'adjustment')
    .reduce((sum, e) => sum + (e.quantity * e.unitCost), 0);

  // Excluir ventas canceladas de totales y COGS
  const cancelledIds = new Set((sales || []).filter((s:any) => (s.status || 'active') === 'cancelled').map((s:any) => s.id));
  const activeSalesList = (sales || []).filter((s:any) => (s.status || 'active') !== 'cancelled');

  const salesTotal = activeSalesList.reduce((sum, s) => sum + (s.total || 0), 0);

  // Helper: extraer saleId de la nota 'Venta <id>'
  const extractSaleIdFromNote = (note?: string) => {
    if (!note) return null;
    const m = note.match(/Venta\s+([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  };

  // COGS (Costo de Ventas): suma del costo unitario x cantidad en movimientos de tipo 'sale' que NO pertenezcan a ventas canceladas
  const cogsTotal = entries
    .filter(e => e.type === 'sale')
    .filter(e => {
      const id = extractSaleIdFromNote(e.note);
      // Si no podemos extraer id, asumimos que es válido; si existe y está cancelado, excluir
      return !id || !cancelledIds.has(id);
    })
    .reduce((sum, e) => sum + (e.unitCost * e.quantity), 0);

  // Utilidad Bruta = Ventas - COGS
  const grossProfit = salesTotal - cogsTotal;
  const grossMarginPct = salesTotal > 0 ? (grossProfit / salesTotal) * 100 : 0;

  const getProductName = (productId: string) => {
    const product = products.find(p => p.id === productId);
    return product?.name || 'Producto desconocido';
  };

  const formatType = (type: string) => {
    switch(type) {
      case 'purchase': return '🛒 Compra';
      case 'transfer_in': return '📦 Transferencia';
      case 'adjustment': return '⚖️ Ajuste';
      case 'sale': return '💰 Venta';
      default: return type;
    }
  };

  return (
    <ScrollView style={{ flex: 1, padding: SPACING.medium }}>
      {/* Summary Cards */}
      <Text style={styles.sectionLabel}>Resumen de Operaciones</Text>
      
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>🛒 Total Compras</Text>
        <Text style={styles.summaryValue}>${purchaseTotal.toFixed(2)}</Text>
        <Text style={styles.summaryCount}>{entries.filter(e => e.type === 'purchase').length} operaciones</Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>📦 Total Transferencias</Text>
        <Text style={styles.summaryValue}>${transferInTotal.toFixed(2)}</Text>
        <Text style={styles.summaryCount}>{entries.filter(e => e.type === 'transfer_in').length} operaciones</Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>⚖️ Total Ajustes</Text>
        <Text style={styles.summaryValue}>${adjustmentTotal.toFixed(2)}</Text>
        <Text style={styles.summaryCount}>{entries.filter(e => e.type === 'adjustment').length} operaciones</Text>
      </View>

      <View style={[styles.summaryCard, { backgroundColor: '#10B981' }]}>
        <Text style={[styles.summaryLabel, { color: '#FFF' }]}>💰 Total Ventas</Text>
        <Text style={[styles.summaryValue, { color: '#FFF' }]}>${salesTotal.toFixed(2)}</Text>
        <Text style={[styles.summaryCount, { color: '#FFF' }]}>{activeSalesList.length} ventas</Text>
      </View>

      {/* New: COGS and Gross Profit */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>📉 Costo de Ventas (COGS)</Text>
        <Text style={styles.summaryValue}>${cogsTotal.toFixed(2)}</Text>
        <Text style={styles.summaryCount}>{entries.filter(e => e.type === 'sale').filter(e => { const id = extractSaleIdFromNote(e.note); return !id || !cancelledIds.has(id); }).length} líneas de venta</Text>
      </View>

      <View style={[styles.summaryCard, { backgroundColor: grossProfit >= 0 ? '#059669' : '#DC2626' }]}>
        <Text style={[styles.summaryLabel, { color: '#FFF' }]}>📈 Utilidad Bruta</Text>
        <Text style={[styles.summaryValue, { color: '#FFF' }]}>${grossProfit.toFixed(2)}</Text>
        <Text style={[styles.summaryCount, { color: '#FFF' }]}>Margen: {grossMarginPct.toFixed(1)}%</Text>
      </View>

      {/* Recent Entries */}
      <Text style={[styles.sectionLabel, { marginTop: SPACING.large }]}>Últimas Entradas de Inventario</Text>
      {entries.slice(0, 20).map((entry, index) => (
        <View key={entry.id || index} style={styles.operationRow}>
          <View style={styles.operationHeader}>
            <Text style={styles.operationType}>{formatType(entry.type)}</Text>
            <Text style={styles.operationDate}>
              {dateToDisplay(new Date(entry.createdAt))}
            </Text>
          </View>
          <Text style={styles.operationProduct}>{getProductName(entry.productId)}</Text>
          <View style={styles.operationDetails}>
            <Text style={styles.operationText}>Cantidad: {entry.quantity}</Text>
            <Text style={styles.operationText}>Costo Unit: ${entry.unitCost.toFixed(2)}</Text>
            <Text style={styles.operationTotal}>Total: ${(entry.quantity * entry.unitCost).toFixed(2)}</Text>
          </View>
          {entry.note && <Text style={styles.operationNote}>{entry.note}</Text>}
        </View>
      ))}

      {entries.length === 0 && (
        <Text style={{ textAlign: 'center', color: THEME.colors.textSecondary, marginTop: SPACING.large }}>
          No hay entradas de inventario registradas
        </Text>
      )}
    </ScrollView>
  );
}