import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, Platform, ActivityIndicator, Modal } from 'react-native';
// Removed static imports of expo-file-system and expo-sharing to avoid runtime resolution issues on platforms/snacks where modules are not present.
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProducts, initDb, createSale, getSales, getSaleItemsBySaleId, getProductById, createExpense, cancelSale, getStores } from '../lib/db';
// ... existing code ...
import { Product } from '../types';
// ... existing code ...
import { DeviceEventEmitter } from 'react-native';
// Add per-store stock helpers
import { getProductStockInStore, getProductStockAllStores } from '../lib/db';
// NEW: import theme and hooks used throughout this screen
import { THEME, SPACING } from '../lib/theme';
import { useStore } from '../lib/useStore';
import { useAuthSafe } from '../hooks/useAuth';
// NEW: import day ledger functions
import { appendSaleToDay, appendExpenseToDay } from '../lib/dayManager';
import DayStatusBanner from '../components/DayStatusBanner';
import { dateToDisplay, isoToDate } from '../lib/date';
import * as localDb from '../lib/localDb';
import { exportTextFile } from '../lib/file';

// Browser globals for web platform
declare const Blob: any;
declare const URL: any;

type CartLine = {
  product: Product;
  quantity: number;
};

type TicketFilterMode = 'today' | 'range';

export default function SalesScreen() {
  const { currentStoreId, isAdmin, stores, setStores } = useStore();
  const { user, businessDate } = useAuthSafe();
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string | null>(null);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [BarCodeScannerComponent, setBarCodeScannerComponent] = useState<React.ComponentType<any> | null>(null);
  
  // Estado del día cerrado
  const [isDayClosed, setIsDayClosed] = useState(false);
  
  // Visible stock per product based on store context
  const [visibleStockMap, setVisibleStockMap] = useState<Record<string, number>>({});

  // Mixed payment modal
  const [showMixedPayment, setShowMixedPayment] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  
  // Transfer info modal (for transfer-only payment)
  const [showTransferInfo, setShowTransferInfo] = useState(false);
  
  // Transfer/customer details
  const [operationNumber, setOperationNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  
  // Tickets section
  const [ticketFilterMode, setTicketFilterMode] = useState<TicketFilterMode>('today');
  const [rangeStart, setRangeStart] = useState(''); // YYYY-MM-DD
  const [rangeEnd, setRangeEnd] = useState('');
  const [filteredSales, setFilteredSales] = useState<any[]>([]);
  const [showTicketDetail, setShowTicketDetail] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [ticketItems, setTicketItems] = useState<any[]>([]);

  const [rangeMode, setRangeMode] = useState<'hoy' | 'rango'>('hoy');
  const [dateRangeStart, setDateRangeStart] = useState('');
  const [dateRangeEnd, setDateRangeEnd] = useState('');
  const [sales, setSales] = useState<any[]>([]);
  const [exportingMVT, setExportingMVT] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await initDb();
        await load();
        await refreshTickets();
        
        // Verificar si el día está cerrado
        const closed = await localDb.isDayClosed();
        setIsDayClosed(closed);
        
        // Load stores for admin selector
        const storesList = await getStores();
        setStores(storesList.map(s => ({ id: s.id, name: s.name })));
        
        if (Platform.OS !== 'web') {
          const mod = await import('expo-barcode-scanner');
          const { status } = await mod.BarCodeScanner.requestPermissionsAsync();
          setHasPermission(status === 'granted');
          setBarCodeScannerComponent(() => mod.BarCodeScanner);
        } else {
          setHasPermission(false);
        }
      } catch (e) {
        console.warn('DB init or camera permission failed:', e?.message ?? e);
        return;
      }
    })();
    
    // Listen for sale events to refresh tickets list
    const createdListener = DeviceEventEmitter.addListener('saleCreated', () => {
      refreshTickets();
    });
    const cancelledListener = DeviceEventEmitter.addListener('saleCancelled', async () => {
      await refreshTickets();
      await load(); // refresh products to reflect returned stock
    });
    const dbCleanedListener = DeviceEventEmitter.addListener('databaseCleaned', async () => {
      await refreshTickets();
      await load();
    });
    
    // Listen for day closed/opened events
    const dayClosedListener = DeviceEventEmitter.addListener('dayClosed', async () => {
      const closed = await localDb.isDayClosed();
      setIsDayClosed(closed);
    });
    const dayOpenedListener = DeviceEventEmitter.addListener('dayOpened', async () => {
      const closed = await localDb.isDayClosed();
      setIsDayClosed(closed);
    });
    
    return () => {
      createdListener.remove();
      cancelledListener.remove();
      dbCleanedListener.remove();
      dayClosedListener.remove();
      dayOpenedListener.remove();
    };
  }, []);

  async function load() {
    const prods = await getProducts();
    setProducts(prods);
  }
  
  // Recompute visible stock when products or store context changes
  useEffect(() => {
    (async () => {
      const map: Record<string, number> = {};
      if (products.length === 0) { setVisibleStockMap(map); return; }
      if (isAdmin) {
        if (selectedStoreFilter) {
          for (const p of products) {
            map[p.id] = await getProductStockInStore(p.id, selectedStoreFilter);
          }
        } else {
          for (const p of products) {
            const all = await getProductStockAllStores(p.id);
            map[p.id] = all.reduce((sum, s) => sum + (s.quantity || 0), 0);
          }
        }
      } else {
        const storeId = currentStoreId || 'store_default';
        for (const p of products) {
          map[p.id] = await getProductStockInStore(p.id, storeId);
        }
      }
      setVisibleStockMap(map);
    })();
  }, [products, selectedStoreFilter, currentStoreId, isAdmin]);

  async function refreshTickets() {
    // Determine which storeId to filter by: admin can choose, sellers use their currentStoreId
    const filterStoreId = isAdmin ? selectedStoreFilter : currentStoreId;
    
    // Build filter object: mostrar todos los tickets de la tienda (sin filtrar por usuario)
    const filter: { storeId?: string | null; userId?: string | null } = {};
    if (filterStoreId) filter.storeId = filterStoreId;
    
    const allSales = await getSales(Object.keys(filter).length > 0 ? filter : undefined);
    let list = allSales;

    // Helper: la fuente de "día" para tickets debe ser businessDate (fecha de trabajo).
    // Si por algún motivo una venta antigua no tiene businessDate, se cae a createdAt.
    const getSaleIsoDay = (s: any): string => {
      const biz = typeof s?.businessDate === 'string' ? s.businessDate.slice(0, 10) : '';
      if (biz) return biz;
      const ca = typeof s?.createdAt === 'string' ? s.createdAt : '';
      return ca ? ca.slice(0, 10) : '';
    };

    if (ticketFilterMode === 'today') {
      const baseIso = businessDate || new Date().toISOString().slice(0, 10);
      list = allSales.filter((s: any) => getSaleIsoDay(s) === baseIso);
    } else {
      const start = rangeStart.trim();
      const end = rangeEnd.trim();
      if (start && end) {
        list = allSales.filter((s: any) => {
          const d = getSaleIsoDay(s);
          return d >= start && d <= end;
        });
      }
    }

    setFilteredSales(list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
  }

  // Refresh tickets when store filter changes
  useEffect(() => {
    refreshTickets();
  }, [selectedStoreFilter, currentStoreId, ticketFilterMode, rangeStart, rangeEnd]);

  async function exportFilteredSalesReportMVT() {
    try {
      setExportingMVT(true);

      // 1) Determinar rango de fechas respetando la FECHA DE TRABAJO (businessDate)
      const todayIso = businessDate || new Date().toISOString().slice(0, 10);

      let startText = todayIso;
      let endText = todayIso;

      if (ticketFilterMode === 'range') {
        const start = rangeStart.trim();
        const end = rangeEnd.trim();

        if (!start || !end) {
          Alert.alert('Fechas requeridas', 'Selecciona fecha inicio y fecha fin para exportar por rango.');
          setExportingMVT(false);
          return;
        }

        startText = start;
        endText = end;
      }

      // 2) Filtrar ventas
      let filtered = filteredSales.filter((s) => (s.status || 'active') === 'active');
      if (selectedStoreFilter && selectedStoreFilter !== 'all') {
        filtered = filtered.filter((s) => s.storeId === selectedStoreFilter);
      }

      if (filtered.length === 0) {
        Alert.alert('Sin datos', 'No hay ventas para exportar en el período seleccionado.');
        setExportingMVT(false);
        return;
      }

      // 3) Agrupar por SKU
      const skuMap = new Map<
        string,
        {
          name: string;
          sku: string;
          unit: string;
          quantitySold: number;
        }
      >();

      for (const sale of filtered) {
        const items = await getSaleItemsBySaleId(sale.id);
        for (const item of items) {
          const product = products.find((p) => p.id === item.productId);
          if (!product) continue;

          const sku = product.sku || product.id.substring(0, 6);
          const existing = skuMap.get(sku);
          if (existing) {
            existing.quantitySold += item.quantity;
          } else {
            skuMap.set(sku, {
              name: product.name,
              sku: sku,
              unit: 'Uno',
              quantitySold: item.quantity,
            });
          }
        }
      }

      const aggregated = Array.from(skuMap.values()).sort((a, b) => a.sku.localeCompare(b.sku));

      if (aggregated.length === 0) {
        Alert.alert('Sin productos', 'No se encontraron productos en las ventas seleccionadas.');
        setExportingMVT(false);
        return;
      }

      // 4) Construir el contenido MVT con saltos de línea reales
      let content = '[Documento]\n';
      content += 'Operacion=VENTA\n';
      content += `Fecha=${startText}\n\n\n`;
      content += '[Movimientos]\n';
      for (const item of aggregated) {
        content += `${item.sku}|${item.unit}|${item.quantitySold.toFixed(2)}\n`;
      }
      content += 'Código|Unidad de medida|Cantidad\n';

      // 5) Guardar archivo usando exportTextFile (misma lógica que BackupScreen)
      const filename =
        ticketFilterMode === 'today'
          ? `venta_${startText}.mvt`
          : `venta_${startText}_${endText}.mvt`;

      await exportTextFile({
        filename,
        content,
        mimeType: 'text/plain',
      });

      Alert.alert(
        '✅ Éxito',
        `Archivo ${filename} exportado correctamente.\n\n${aggregated.length} productos incluidos.`
      );
    } catch (err: any) {
      console.error('Error al exportar MVT:', err);
      Alert.alert('Error', `No se pudo exportar el archivo MVT.\n\nDetalle: ${err?.message || 'Error desconocido'}`);
    } finally {
      setExportingMVT(false);
    }
  }

  async function handleExportarMVT() {
    // Obsoleto: el exportador válido es exportFilteredSalesReportMVT() (botón "📄 Exportar .mvt").
    // Se deja como stub para evitar referencias viejas a exportToMVT.
    return;
  }

  async function openTicketDetail(sale: any) {
    const items = await getSaleItemsBySaleId(sale.id);
    // Enrich items with product names
    const enriched = await Promise.all(items.map(async (item: any) => {
      const product = await getProductById(item.productId);
      return {
        ...item,
        productName: product?.name || 'Producto desconocido',
      };
    }));
    setTicketItems(enriched);
    setSelectedTicket(sale);
    setShowTicketDetail(true);
  }
  
  async function reprintTicket(sale: any, items: any[]) {
    const itemsHtml = items.map(item => {
      const itemTotal = item.unitPrice * item.quantity;
      return `
        <tr>
          <td>${item.productName}</td>
          <td>${item.quantity}</td>
          <td>$${item.unitPrice.toFixed(2)}</td>
          <td>$${itemTotal.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const paymentMethodLabel = 
      sale.paymentMethod === 'cash' ? 'Efectivo' :
      sale.paymentMethod === 'transfer' ? 'Transferencia' :
      `Mixto (Efectivo: $${(sale.cashAmount || 0).toFixed(2)} | Transferencia: $${(sale.transferAmount || 0).toFixed(2)})`;

    const shouldShowCustomerData = (sale.paymentMethod === 'transfer' || 
                                     (sale.paymentMethod === 'mixed' && (sale.transferAmount || 0) > 0)) &&
                                     (sale.operationNumber || sale.customerName || sale.customerPhone);

    const saleBusinessDateIso =
      (typeof sale?.createdAt === 'string' ? sale.createdAt.slice(0, 10) : '') ||
      (typeof sale?.businessDate === 'string' ? sale.businessDate.slice(0, 10) : '') ||
      (businessDate || '').slice(0, 10);
    const saleDisplayDate = saleBusinessDateIso ? dateToDisplay(isoToDate(saleBusinessDateIso)) : dateToDisplay(new Date(sale.createdAt));
    const saleTime = sale.createdAt ? new Date(sale.createdAt).toLocaleTimeString() : '';

    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { text-align: center; margin-bottom: 5px; }
            .info { text-align: center; margin-bottom: 20px; font-size: 12px; color: #666; }
            .customer-info { background: #E3F2FD; padding: 10px; border-radius: 5px; margin-bottom: 15px; }
            .customer-info p { margin: 3px 0; font-size: 12px; font-weight: 600; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .total-row { font-weight: bold; font-size: 16px; }
            .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <h1>Recibo de Venta</h1>
          <div class="info">
            <p>Fecha: ${saleDisplayDate} ${saleTime}</p>
            <p>ID: ${sale.id.substring(0, 8)}</p>
            <p>Método de pago: ${paymentMethodLabel}</p>
          </div>
          ${shouldShowCustomerData ? `
          <div class="customer-info">
            <p><strong>📋 Datos de Transferencia:</strong></p>
            ${sale.operationNumber ? `<p>Nº Operación: ${sale.operationNumber}</p>` : ''}
            ${sale.customerName ? `<p>Cliente: ${sale.customerName}</p>` : ''}
            ${sale.customerPhone ? `<p>Teléfono: ${sale.customerPhone}</p>` : ''}
          </div>
          ` : ''}
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant</th>
                <th>Precio</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              <tr class="total-row">
                <td colspan="3">TOTAL</td>
                <td>$${sale.total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          ${sale.commission > 0 ? `<p style="font-size:12px;color:#856404;background:#FFF3CD;padding:10px;border-radius:5px;">⚠️ Comisión bancaria (gasto interno): $${sale.commission.toFixed(2)}</p>` : ''}
          <div class="footer">
            <p>¡Gracias por su compra!</p>
          </div>
        </body>
      </html>
    `;

    await printAndShare(html);
  }

  async function printAndShare(html: string) {
    try {
      // Dynamically import to avoid Snack/web resolution issues
      const Print = await import('expo-print');
      const Sharing = await import('expo-sharing');
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri);
    } catch (e) {
      console.warn('Print failed:', e);
      Alert.alert('Impresión no disponible', 'No se pudo imprimir/compartir el ticket en esta plataforma.');
    }
  }

  function handleBarCodeScanned({ type, data }: { type: string; data: string }) {
    setShowScanner(false);
    const product = products.find(p => p.sku === data);
    if (product) {
      addToCart(product);
    } else {
      Alert.alert('Producto no encontrado', `SKU: ${data}`);
    }
  }

  function addToCart(product: Product) {
    // Verificar si el día está cerrado y el usuario es vendedor
    if (isDayClosed && !isAdmin) {
      return Alert.alert('Día Cerrado', 'No se pueden realizar ventas porque el día está cerrado. Contacta al administrador.');
    }

    const available = visibleStockMap[product.id] || 0;
    if (available <= 0) {
      return Alert.alert('Sin stock', `${product.name} no tiene unidades disponibles en esta tienda`);
    }

    const existing = cart.find(p => p.product.id === product.id);
    const currentQtyInCart = existing ? existing.quantity : 0;

    if (currentQtyInCart >= available) {
      return Alert.alert('Stock insuficiente', `Solo hay ${available} unidades disponibles en esta tienda`);
    }

    setCart(prev => {
      const ex = prev.find(p => p.product.id === product.id);
      if (ex) {
        // Create a completely new array with new object references
        return prev.map(p => 
          p.product.id === product.id 
            ? { product: { ...p.product }, quantity: p.quantity + 1 } 
            : { ...p }
        );
      }
      // Create new array with new item
      return [...prev, { product: { ...product }, quantity: 1 }];
    });
  }

  function changeQty(productId: string, qty: number) {
    // Verificar si el día está cerrado y el usuario es vendedor
    if (isDayClosed && !isAdmin) {
      return Alert.alert('Día Cerrado', 'No se pueden realizar ventas porque el día está cerrado. Contacta al administrador.');
    }

    const product = products.find(p => p.id === productId);
    if (!product) return;

    const available = visibleStockMap[productId] || 0;
    if (qty > available) {
      Alert.alert('Stock insuficiente', `Solo hay ${available} unidades disponibles en esta tienda`);
      return;
    }

    if (qty <= 0) {
      setCart(prev => prev.filter(l => l.product.id !== productId));
    } else {
      setCart(prev => prev.map(line => 
        line.product.id === productId ? { ...line, quantity: qty } : line
      ));
    }
  }

  const subtotal = useMemo(() => {
    return cart.reduce((s, line) => {
      const base = line.product.sellPrice * line.quantity;
      // Remove the extra 10% from customer's total - it will be registered as an expense instead
      return s + base;
    }, 0);
  }, [cart]);

  const commissionAmount = useMemo(() => subtotal * 0.015, [subtotal]);
  const totalToPay = subtotal;
  
  // Calculate the 10% expense amount (not charged to customer, but registered as expense)
  const expense10Percent = useMemo(() => {
    return cart.reduce((s, line) => {
      const extra = line.product.chargeExtra10Percent ? (line.product.sellPrice * 0.1) * line.quantity : 0;
      return s + extra;
    }, 0);
  }, [cart]);

  async function printReceipt(saleId: string, paymentMethod: 'cash' | 'transfer', customerData?: { operationNumber?: string; customerName?: string; customerPhone?: string }) {
    const itemsHtml = cart.map(line => {
      const itemTotal = line.product.sellPrice * line.quantity;
      return `
        <tr>
          <td>${line.product.name}</td>
          <td>${line.quantity}</td>
          <td>$${line.product.sellPrice.toFixed(2)}</td>
          <td>$${itemTotal.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const workIso = (businessDate || '').slice(0, 10);
    const displayWorkDate = workIso ? dateToDisplay(isoToDate(workIso)) : dateToDisplay(new Date());
    const nowTime = new Date().toLocaleTimeString();

    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { text-align: center; margin-bottom: 5px; }
            .info { text-align: center; margin-bottom: 20px; font-size: 12px; color: #666; }
            .customer-info { background: #E3F2FD; padding: 10px; border-radius: 5px; margin-bottom: 15px; }
            .customer-info p { margin: 3px 0; font-size: 12px; font-weight: 600; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .total-row { font-weight: bold; font-size: 16px; }
            .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <h1>Recibo de Venta</h1>
          <div class="info">
            <p>Fecha: ${displayWorkDate} ${nowTime}</p>
            <p>ID: ${saleId.substring(0, 8)}</p>
            <p>Método de pago: ${paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}</p>
          </div>
          ${paymentMethod === 'transfer' && customerData && (customerData.operationNumber || customerData.customerName || customerData.customerPhone) ? `
          <div class="customer-info">
            <p><strong>📋 Datos de Transferencia:</strong></p>
            ${customerData.operationNumber ? `<p>Nº Operación: ${customerData.operationNumber}</p>` : ''}
            ${customerData.customerName ? `<p>Cliente: ${customerData.customerName}</p>` : ''}
            ${customerData.customerPhone ? `<p>Teléfono: ${customerData.customerPhone}</p>` : ''}
          </div>
          ` : ''}
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant</th>
                <th>Precio</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              <tr class="total-row">
                <td colspan="3">TOTAL</td>
                <td>$${totalToPay.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          ${paymentMethod === 'transfer' ? `<p style="font-size:12px;color:#856404;background:#FFF3CD;padding:10px;border-radius:5px;">⚠️ Comisión bancaria (gasto interno): $${commissionAmount.toFixed(2)}</p>` : ''}
          <div class="footer">
            <p>¡Gracias por su compra!</p>
          </div>
        </body>
      </html>
    `;

    await printAndShare(html);
  }

  async function confirmSale(paymentMethod: 'cash' | 'transfer') {
    // Verificar si el día está cerrado y el usuario es vendedor
    if (isDayClosed && !isAdmin) {
      return Alert.alert('Día Cerrado', 'No se pueden realizar ventas porque el día está cerrado. Contacta al administrador.');
    }

    if (cart.length === 0) return Alert.alert('Carrito vacío');

    // Final stock validation por tienda/área
    for (const line of cart) {
      const available = visibleStockMap[line.product.id] || 0;
      if (line.quantity > available) {
        return Alert.alert('Stock insuficiente', `No hay suficiente ${line.product.name} en esta tienda (disponible: ${available})`);
      }
    }

    const items = cart.map(line => ({
      saleId: '',
      productId: line.product.id,
      quantity: line.quantity,
      unitCost: line.product.costPrice,
      unitPrice: line.product.sellPrice,
      extra10PercentAmount: line.product.chargeExtra10Percent ? (line.product.sellPrice * 0.1) * line.quantity : 0,
    }));

    const saleRecord: any = {
      paymentMethod,
      subtotal,
      total: totalToPay,
      commission: paymentMethod === 'transfer' ? commissionAmount : 0,
      storeId: currentStoreId || 'store_default',
      userId: user?.id || null,
      businessDate: businessDate || new Date().toISOString().slice(0, 10),
    };

    // Add transfer details if applicable
    if (paymentMethod === 'transfer') {
      if (operationNumber) saleRecord.operationNumber = operationNumber;
      if (customerName) saleRecord.customerName = customerName;
      if (customerPhone) saleRecord.customerPhone = customerPhone;
    }
    
    // Save customer data before clearing state
    const customerDataForPrint = paymentMethod === 'transfer' ? {
      operationNumber,
      customerName,
      customerPhone,
    } : undefined;

    try {
      const saleId = await createSale(saleRecord, items);
      
      // NEW: Register sale to today's ledger
      await appendSaleToDay(saleId);
      
      // Create automatic expense for 10% charge (if any)
      if (expense10Percent > 0) {
        await createExpense({
          type: 'other',
          amount: expense10Percent,
          note: `Cargo 10% por venta - Ticket #${saleId.substring(0, 8)}`,
        });
        // remove invalid manual append (createExpense already appends to ledger)
        // await appendExpenseToDay(/* need expense ID - will handle in next step */);
      }

      // Clear transfer details
      setOperationNumber('');
      setCustomerName('');
      setCustomerPhone('');
      
      const alertMessage = `Total cobrado: $${saleRecord.total.toFixed(2)}\\nMétodo: ${paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}${paymentMethod === 'transfer' ? `\\n\\n⚠️ Comisión bancaria (gasto): $${commissionAmount.toFixed(2)}` : ''}${expense10Percent > 0 ? `\\n\\n⚠️ Cargo 10% registrado como gasto: $${expense10Percent.toFixed(2)}` : ''}`;
      
      Alert.alert(
        '✅ Venta registrada',
        alertMessage,
        [
          { text: 'OK', onPress: () => {} },
          {
            text: '🖨️ Imprimir',
            onPress: () => printReceipt(saleId, paymentMethod, customerDataForPrint),
          },
        ]
      );
      
      setCart([]);
      await load();
    } catch (e) {
      Alert.alert('Error', 'No se pudo registrar la venta');
    }
  }
  
  function openMixedPaymentModal() {
    setCashAmount('');
    setTransferAmount('');
    setOperationNumber('');
    setCustomerName('');
    setCustomerPhone('');
    setShowMixedPayment(true);
  }
  
  function openTransferInfoModal() {
    setOperationNumber('');
    setCustomerName('');
    setCustomerPhone('');
    setShowTransferInfo(true);
  }
  
  async function confirmMixedSale() {
    // Verificar si el día está cerrado y el usuario es vendedor
    if (isDayClosed && !isAdmin) {
      return Alert.alert('Día Cerrado', 'No se pueden realizar ventas porque el día está cerrado. Contacta al administrador.');
    }

    const cash = parseFloat(cashAmount) || 0;
    const transfer = parseFloat(transferAmount) || 0;
    const total = cash + transfer;
    
    if (total < totalToPay) {
      Alert.alert('Monto insuficiente', `Falta: $${(totalToPay - total).toFixed(2)}`);
      return;
    }
    
    if (total > totalToPay + 0.01) {
      Alert.alert('Monto incorrecto', `El total ingresado ($${total.toFixed(2)}) excede el monto a cobrar ($${totalToPay.toFixed(2)})`);
      return;
    }

    if (cart.length === 0) return Alert.alert('Carrito vacío');

    // Validación final de stock por tienda/área
    for (const line of cart) {
      const available = visibleStockMap[line.product.id] || 0;
      if (line.quantity > available) {
        return Alert.alert('Stock insuficiente', `No hay suficiente ${line.product.name} en esta tienda (disponible: ${available})`);
      }
    }

    const items = cart.map(line => ({
      saleId: '',
      productId: line.product.id,
      quantity: line.quantity,
      unitCost: line.product.costPrice,
      unitPrice: line.product.sellPrice,
      extra10PercentAmount: line.product.chargeExtra10Percent ? (line.product.sellPrice * 0.1) * line.quantity : 0,
    }));

    // Commission only on transfer portion
    const mixedCommission = transfer * 0.015;

    const saleRecord: any = {
      paymentMethod: 'mixed' as const,
      subtotal,
      total: totalToPay,
      commission: mixedCommission,
      cashAmount: cash,
      transferAmount: transfer,
      storeId: currentStoreId || 'store_default',
      userId: user?.id || null,
      businessDate: businessDate || new Date().toISOString().slice(0, 10),
    };

    // Add transfer details if applicable
    if (transfer > 0) {
      if (operationNumber) saleRecord.operationNumber = operationNumber;
      if (customerName) saleRecord.customerName = customerName;
      if (customerPhone) saleRecord.customerPhone = customerPhone;
    }
    
    // Save customer data before clearing state
    const customerDataForPrint = transfer > 0 ? {
      operationNumber,
      customerName,
      customerPhone,
    } : undefined;

    try {
      const saleId = await createSale(saleRecord, items);
      
      // Create automatic expense for 10% charge (if any)
      if (expense10Percent > 0) {
        await createExpense({
          type: 'other',
          amount: expense10Percent,
          note: `Cargo 10% por venta - Ticket #${saleId.substring(0, 8)}`,
        });
      }
      
      setShowMixedPayment(false);
      
      // Clear transfer details
      setOperationNumber('');
      setCustomerName('');
      setCustomerPhone('');
      
      const alertMessage = `Total cobrado: $${saleRecord.total.toFixed(2)}\\nEfectivo: $${cash.toFixed(2)}\\nTransferencia: $${transfer.toFixed(2)}${mixedCommission > 0 ? `\\n\\n⚠️ Comisión bancaria (gasto): $${mixedCommission.toFixed(2)}` : ''}${expense10Percent > 0 ? `\\n\\n⚠️ Cargo 10% registrado como gasto: $${expense10Percent.toFixed(2)}` : ''}`;
      
      Alert.alert(
        '✅ Venta registrada (Pago Mixto)',
        alertMessage,
        [
          { text: 'OK', onPress: () => {} },
          {
            text: '🖨️ Imprimir',
            onPress: () => printReceiptMixed(saleId, cash, transfer, customerDataForPrint),
          },
        ]
      );
      
      setCart([]);
      await load();
    } catch (e) {
      Alert.alert('Error', 'No se pudo registrar la venta');
    }
  }
  
  async function printReceiptMixed(saleId: string, cash: number, transfer: number, customerData?: { operationNumber?: string; customerName?: string; customerPhone?: string }) {
    const itemsHtml = cart.map(line => {
      const itemTotal = line.product.sellPrice * line.quantity;
      return `
        <tr>
          <td>${line.product.name}</td>
          <td>${line.quantity}</td>
          <td>$${line.product.sellPrice.toFixed(2)}</td>
          <td>$${itemTotal.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const mixedCommission = transfer * 0.015;

    const workIso = (businessDate || '').slice(0, 10);
    const displayWorkDate = workIso ? dateToDisplay(isoToDate(workIso)) : dateToDisplay(new Date());
    const nowTime = new Date().toLocaleTimeString();

    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { text-align: center; margin-bottom: 5px; }
            .info { text-align: center; margin-bottom: 20px; font-size: 12px; color: #666; }
            .customer-info { background: #E3F2FD; padding: 10px; border-radius: 5px; margin-bottom: 15px; }
            .customer-info p { margin: 3px 0; font-size: 12px; font-weight: 600; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .total-row { font-weight: bold; font-size: 16px; }
            .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <h1>Recibo de Venta</h1>
          <div class="info">
            <p>Fecha: ${displayWorkDate} ${nowTime}</p>
            <p>ID: ${saleId.substring(0, 8)}</p>
            <p>Método de pago: Mixto (Efectivo + Transferencia)</p>
            <p>Efectivo: $${cash.toFixed(2)} | Transferencia: $${transfer.toFixed(2)}</p>
          </div>
          ${transfer > 0 && customerData && (customerData.operationNumber || customerData.customerName || customerData.customerPhone) ? `
          <div class="customer-info">
            <p><strong>📋 Datos de Transferencia:</strong></p>
            ${customerData.operationNumber ? `<p>Nº Operación: ${customerData.operationNumber}</p>` : ''}
            ${customerData.customerName ? `<p>Cliente: ${customerData.customerName}</p>` : ''}
            ${customerData.customerPhone ? `<p>Teléfono: ${customerData.customerPhone}</p>` : ''}
          </div>
          ` : ''}
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant</th>
                <th>Precio</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              <tr class="total-row">
                <td colspan="3">TOTAL</td>
                <td>$${totalToPay.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          ${mixedCommission > 0 ? `<p style="font-size:12px;color:#856404;background:#FFF3CD;padding:10px;border-radius:5px;">⚠️ Comisión bancaria sobre transferencia (gasto interno): $${mixedCommission.toFixed(2)}</p>` : ''}
          <div class="footer">
            <p>¡Gracias por su compra!</p>
          </div>
        </body>
      </html>
    `;

    await printAndShare(html);
  }

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Use visible stock per context
  const availableProducts = filteredProducts.filter(p => (visibleStockMap[p.id] || 0) > 0);
  const outOfStock = filteredProducts.filter(p => (visibleStockMap[p.id] || 0) <= 0);

  if (showScanner) {
    if (Platform.OS === 'web') {
      return (
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text>El escáner no está disponible en web. Usa búsqueda o la app en Android/iOS.</Text>
            <TouchableOpacity style={[styles.scanBtn, { marginTop: SPACING.medium }]} onPress={() => setShowScanner(false)}>
              <Text style={styles.closeScannerText}>Volver</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    if (hasPermission === null) {
      return <View style={styles.container}><Text>Solicitando permiso de cámara...</Text></View>;
    }
    if (hasPermission === false || !BarCodeScannerComponent) {
      return <View style={styles.container}><Text>No hay acceso a la cámara</Text></View>;
    }

    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.scannerContainer}>
          <BarCodeScannerComponent
            onBarCodeScanned={handleBarCodeScanned}
            style={StyleSheet.absoluteFillObject}
          />
          <TouchableOpacity style={styles.closeScannerBtn} onPress={() => setShowScanner(false)}>
            <Text style={styles.closeScannerText}>✕ Cerrar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <DayStatusBanner showLogoutButton={false} />
      
      {/* Warning banner for closed day (vendors only) */}
      {isDayClosed && !isAdmin && (
        <View style={styles.closedDayBanner}>
          <Text style={styles.closedDayBannerText}>⚠️ DÍA CERRADO - No se pueden realizar operaciones</Text>
        </View>
      )}
      
      <ScrollView style={styles.content}>
        <Text style={styles.heading}>Realizar Venta</Text>
        <Text style={styles.subheading}>Toca un producto para agregar al carrito</Text>

        {/* Store selector for admin */}
        {isAdmin && stores.length > 0 && (
          <View style={styles.storeFilterContainer}>
            <Text style={styles.storeFilterLabel}>📍 Filtrar por tienda:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storeFilterScroll}>
              <TouchableOpacity
                style={[styles.storeFilterBtn, selectedStoreFilter === null && styles.storeFilterBtnActive]}
                onPress={() => setSelectedStoreFilter(null)}
              >
                <Text style={[styles.storeFilterBtnText, selectedStoreFilter === null && styles.storeFilterBtnTextActive]}>
                  Todas las tiendas
                </Text>
              </TouchableOpacity>
              {stores.map(store => (
                <TouchableOpacity
                  key={store.id}
                  style={[styles.storeFilterBtn, selectedStoreFilter === store.id && styles.storeFilterBtnActive]}
                  onPress={() => setSelectedStoreFilter(store.id)}
                >
                  <Text style={[styles.storeFilterBtnText, selectedStoreFilter === store.id && styles.storeFilterBtnTextActive]}>
                    {store.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Tickets Filter */}
        <View style={[styles.ticketsSection, { marginTop: SPACING.small }]}>
          <Text style={styles.ticketsTitle}>🧾 Filtro de Tickets</Text>
          <View style={{ flexDirection: 'row', gap: SPACING.small, marginTop: SPACING.small }}>
            <TouchableOpacity 
              style={[styles.exportMVTBtn, ticketFilterMode === 'today' && { backgroundColor: THEME.colors.primary }]} 
              onPress={() => { setTicketFilterMode('today'); refreshTickets(); }}
            >
              <Text style={styles.exportMVTBtnText}>Hoy</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.exportMVTBtn, ticketFilterMode === 'range' && { backgroundColor: THEME.colors.primary }]} 
              onPress={() => setTicketFilterMode('range')}
            >
              <Text style={styles.exportMVTBtnText}>Rango</Text>
            </TouchableOpacity>
          </View>
          {ticketFilterMode === 'range' && (
            <View style={{ flexDirection: 'row', gap: SPACING.small, marginTop: SPACING.small }}>
              <TextInput style={[styles.searchInput, { flex: 1 }]} placeholder="YYYY-MM-DD inicio" value={rangeStart} onChangeText={setRangeStart} />
              <TextInput style={[styles.searchInput, { flex: 1 }]} placeholder="YYYY-MM-DD fin" value={rangeEnd} onChangeText={setRangeEnd} />
              <TouchableOpacity style={styles.exportMVTBtn} onPress={refreshTickets}>
                <Text style={styles.exportMVTBtnText}>Aplicar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Tickets section */}
        {filteredSales.length > 0 && (
          <View style={styles.ticketsSection}>
            <View style={styles.ticketsSectionHeader}>
              <Text style={styles.ticketsTitle}>🧾 Tickets ({filteredSales.length})</Text>
              <TouchableOpacity 
                style={styles.exportMVTBtn} 
                onPress={exportFilteredSalesReportMVT}
              >
                <Text style={styles.exportMVTBtnText}>📄 Exportar .mvt</Text>
              </TouchableOpacity>
            </View>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={true}
              style={styles.ticketsScrollContainer}
              contentContainerStyle={styles.ticketsScrollContent}
              scrollEventThrottle={16}
            >
              {filteredSales.map((sale: any) => {
                const paymentIcon = 
                  sale.paymentMethod === 'cash' ? '💵' :
                  sale.paymentMethod === 'transfer' ? '💳' :
                  '💵💳';
                const isCancelled = (sale.status || 'active') === 'cancelled';
                
                return (
                  <TouchableOpacity 
                    key={sale.id} 
                    style={[styles.ticketCard, isCancelled && { opacity: 0.6, borderWidth: 2, borderColor: '#F44336' }]}
                    onPress={() => openTicketDetail(sale)}
                  >
                    <View style={styles.ticketHeader}>
                      <Text style={styles.ticketTime}>
                        {new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                      <Text style={styles.ticketIcon}>{paymentIcon}</Text>
                    </View>
                    <Text style={styles.ticketTotal}>${sale.total.toFixed(2)}</Text>
                    <Text style={styles.ticketId}>#{sale.id.substring(0, 6)}</Text>
                    {isCancelled && (
                      <View style={{ marginTop: 6, backgroundColor: '#F44336', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 10 }}>CANCELADO</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Search and Scanner */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="🔍 Buscar producto o código..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity style={styles.scanBtn} onPress={() => setShowScanner(true)}>
            <Text style={styles.scanBtnText}>📷</Text>
          </TouchableOpacity>
        </View>

        {/* Products List */}
        <View style={styles.productsSection}>
          <Text style={styles.sectionTitle}>Productos Disponibles</Text>
          {availableProducts.length === 0 && <Text style={styles.empty}>No hay productos con stock</Text>}
          {availableProducts.map(item => {
            const inCart = cart.find(c => c.product.id === item.id);
            const qtyInCart = inCart ? inCart.quantity : 0;
            const available = visibleStockMap[item.id] || 0;
            const remaining = Math.max(0, available - qtyInCart);

            return (
              <TouchableOpacity key={item.id} onPress={() => addToCart(item)} style={styles.productCard}>
                <View style={styles.productLeft}>
                  <Text style={styles.productName}>{item.name}</Text>
                  {item.sku && <Text style={styles.productSku}>SKU: {item.sku}</Text>}
                  <Text style={styles.productPrice}>${item.sellPrice.toFixed(2)}</Text>
                  {item.chargeExtra10Percent && <Text style={styles.productExtra}>+10% extra</Text>}
                </View>
                <View style={styles.productRight}>
                  <Text style={[styles.productStock, remaining <= 5 && remaining > 0 && styles.productStockLow]}>
                    {remaining} disponibles
                  </Text>
                  {qtyInCart > 0 && (
                    <View style={styles.cartBadge}>
                      <Text style={styles.cartBadgeText}>{qtyInCart} en carrito</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}

          {outOfStock.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: SPACING.medium }]}>Sin Stock</Text>
              {outOfStock.map(item => (
                <View key={item.id} style={[styles.productCard, styles.productOutOfStock]}>
                  <View style={styles.productLeft}>
                    <Text style={[styles.productName, { color: '#999' }]}>{item.name}</Text>
                    {item.sku && <Text style={styles.productSku}>SKU: {item.sku}</Text>}
                    <Text style={styles.productPrice}>${item.sellPrice.toFixed(2)}</Text>
                  </View>
                  <Text style={styles.productStockOut}>Agotado</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* Cart */}
        <View style={styles.cartSection}>
          <Text style={styles.cartTitle}>🛒 Carrito de Venta</Text>
          {cart.length === 0 && <Text style={styles.empty}>El carrito está vacío</Text>}
          {cart.map(line => {
            const itemTotal = line.product.sellPrice * line.quantity;
            // No longer adding 10% to customer's price
            const lineTotal = itemTotal;

            return (
              <View key={line.product.id} style={styles.cartItem}>
                <View style={styles.cartItemLeft}>
                  <Text style={styles.cartItemName}>{line.product.name}</Text>
                  <Text style={styles.cartItemDetails}>
                    ${line.product.sellPrice.toFixed(2)} × {line.quantity}
                    {line.product.chargeExtra10Percent && ` (10% interno)`}
                  </Text>
                </View>
                <View style={styles.cartItemRight}>
                  <Text style={styles.cartItemTotal}>${lineTotal.toFixed(2)}</Text>
                  <View style={styles.qtyControls}>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => changeQty(line.product.id, Math.max(0, line.quantity - 1))}
                    >
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyText}>{line.quantity}</Text>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => changeQty(line.product.id, line.quantity + 1)}
                    >
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Footer */}
      {cart.length > 0 && (
        <View style={styles.footer}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total a cobrar:</Text>
            <Text style={styles.totalsValue}>${totalToPay.toFixed(2)}</Text>
          </View>
          {commissionAmount > 0 && (
            <View style={styles.commissionNote}>
              <Text style={styles.commissionText}>
                ℹ️ Si cobra por transferencia, se registrará un gasto de ${commissionAmount.toFixed(2)} (comisión 1.5%)
              </Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.paymentButtons}>
            <TouchableOpacity style={[styles.payBtn, styles.payBtnCash]} onPress={() => confirmSale('cash')}>
              <Text style={styles.payBtnLabel}>💵 Efectivo</Text>
              <Text style={styles.payBtnAmount}>${totalToPay.toFixed(2)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.payBtn, styles.payBtnTransfer]} onPress={openTransferInfoModal}>
              <Text style={styles.payBtnLabel}>💳 Transferencia</Text>
              <Text style={styles.payBtnAmount}>${totalToPay.toFixed(2)}</Text>
            </TouchableOpacity>
          </View>
          {/* Botón de pago mixto más grande - ocupa todo el ancho */}
          <TouchableOpacity style={[styles.payBtn, styles.payBtnMixed]} onPress={openMixedPaymentModal}>
            <Text style={styles.payBtnLabel}>💵💳 Pago Mixto</Text>
            <Text style={styles.payBtnAmount}>${totalToPay.toFixed(2)}</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Mixed Payment Modal */}
      <Modal visible={showMixedPayment} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>💵💳 Pago Mixto</Text>
            <Text style={styles.modalSubtitle}>Total a cobrar: ${totalToPay.toFixed(2)}</Text>
            
            <Text style={styles.label}>Monto en Efectivo</Text>
            <TextInput
              keyboardType="numeric"
              value={cashAmount}
              onChangeText={setCashAmount}
              style={styles.input}
              placeholder="0.00"
            />
            
            <Text style={styles.label}>Monto en Transferencia</Text>
            <TextInput
              keyboardType="numeric"
              value={transferAmount}
              onChangeText={setTransferAmount}
              style={styles.input}
              placeholder="0.00"
            />
            
            {(parseFloat(transferAmount) || 0) > 0 && (
              <>
                <Text style={styles.label}>Número de Operación</Text>
                <TextInput
                  value={operationNumber}
                  onChangeText={setOperationNumber}
                  style={styles.input}
                  placeholder="1234567890"
                />
                
                <Text style={styles.label}>Nombre del Cliente</Text>
                <TextInput
                  value={customerName}
                  onChangeText={setCustomerName}
                  style={styles.input}
                  placeholder="Juan Pérez"
                />
                
                <Text style={styles.label}>Teléfono del Cliente</Text>
                <TextInput
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  style={styles.input}
                  placeholder="555-123-4567"
                />
              </>
            )}
            
            {(parseFloat(cashAmount) || 0) + (parseFloat(transferAmount) || 0) > 0 && (
              <View style={styles.mixedSummary}>
                <Text style={styles.mixedSummaryLabel}>Total ingresado:</Text>
                <Text style={styles.mixedSummaryValue}>
                  ${((parseFloat(cashAmount) || 0) + (parseFloat(transferAmount) || 0)).toFixed(2)}
                </Text>
              </View>
            )}
            
            {(parseFloat(transferAmount) || 0) > 0 && (
              <View style={styles.commissionNote}>
                <Text style={styles.commissionText}>
                  ℹ️ Comisión sobre transferencia: ${((parseFloat(transferAmount) || 0) * 0.015).toFixed(2)}
                </Text>
              </View>
            )}
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnCancel]} 
                onPress={() => setShowMixedPayment(false)}
              >
                <Text style={styles.modalBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnConfirm]} 
                onPress={confirmMixedSale}
              >
                <Text style={styles.modalBtnText}>Confirmar Venta</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Transfer Info Modal */}
      <Modal visible={showTransferInfo} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>💳 Transferencia</Text>
            <Text style={styles.modalSubtitle}>Por favor, complete los detalles de transferencia</Text>
            
            <Text style={styles.label}>Número de Operación</Text>
            <TextInput
              value={operationNumber}
              onChangeText={setOperationNumber}
              style={styles.input}
              placeholder="1234567890"
            />
            
            <Text style={styles.label}>Nombre del Cliente</Text>
            <TextInput
              value={customerName}
              onChangeText={setCustomerName}
              style={styles.input}
              placeholder="Juan Pérez"
            />
            
            <Text style={styles.label}>Teléfono del Cliente</Text>
            <TextInput
              value={customerPhone}
              onChangeText={setCustomerPhone}
              style={styles.input}
              placeholder="555-123-4567"
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnCancel]} 
                onPress={() => setShowTransferInfo(false)}
              >
                <Text style={styles.modalBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnConfirm]} 
                onPress={() => {
                  setShowTransferInfo(false);
                  confirmSale('transfer');
                }}
              >
                <Text style={styles.modalBtnText}>Confirmar Transferencia</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Ticket Detail Modal - CON SCROLLVIEW AGREGADO */}
      <Modal visible={showTicketDetail} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView 
            contentContainerStyle={styles.modalContentScrollContainer}
            style={styles.modalScrollView}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>🧾 Detalle del Ticket</Text>
              {selectedTicket && (
                <>
                  <View style={styles.ticketDetailHeader}>
                    {(() => {
                      const ticketBizIso =
                        (typeof selectedTicket?.createdAt === 'string' ? selectedTicket.createdAt.slice(0, 10) : '') ||
                        (typeof selectedTicket?.businessDate === 'string' ? selectedTicket.businessDate.slice(0, 10) : '') ||
                        (businessDate || '').slice(0, 10);
                      const displayTicketDate = ticketBizIso
                        ? dateToDisplay(isoToDate(ticketBizIso))
                        : dateToDisplay(new Date(selectedTicket.createdAt));
                      const displayTicketTime = selectedTicket.createdAt
                        ? new Date(selectedTicket.createdAt).toLocaleTimeString()
                        : '';

                      return (
                        <Text style={styles.ticketDetailInfo}>
                          Fecha: {displayTicketDate} {displayTicketTime}
                        </Text>
                      );
                    })()}
                    <Text style={styles.ticketDetailInfo}>ID: #{selectedTicket.id.substring(0, 8)}</Text>
                    <Text style={styles.ticketDetailInfo}>
                      Pago: {
                        selectedTicket.paymentMethod === 'cash' ? '💵 Efectivo' :
                        selectedTicket.paymentMethod === 'transfer' ? '💳 Transferencia' :
                        '💵💳 Mixto'
                      }
                    </Text>
                    {selectedTicket.paymentMethod === 'mixed' && (
                      <>
                        <Text style={styles.ticketDetailInfo}>Efectivo: ${(selectedTicket.cashAmount || 0).toFixed(2)}</Text>
                        <Text style={styles.ticketDetailInfo}>Transferencia: ${(selectedTicket.transferAmount || 0).toFixed(2)}</Text>
                      </>
                    )}
                    {(selectedTicket.paymentMethod === 'transfer' || (selectedTicket.paymentMethod === 'mixed' && (selectedTicket.transferAmount || 0) > 0)) &&
                     (selectedTicket.operationNumber || selectedTicket.customerName || selectedTicket.customerPhone) ? (
                      <View style={styles.transferInfoBox}>
                        <Text style={[styles.ticketItemsTitle, { marginBottom: SPACING.tiny }]}>📋 Datos de Transferencia</Text>
                        {selectedTicket.operationNumber ? (
                          <Text style={styles.transferInfoText}>Nº Operación: {selectedTicket.operationNumber}</Text>
                        ) : null}
                        {selectedTicket.customerName ? (
                          <Text style={styles.transferInfoText}>Cliente: {selectedTicket.customerName}</Text>
                        ) : null}
                        {selectedTicket.customerPhone ? (
                          <Text style={styles.transferInfoText}>Teléfono: {selectedTicket.customerPhone}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  
                  <View style={styles.ticketItemsContainer}>
                    <Text style={styles.ticketItemsTitle}>Productos:</Text>
                    {ticketItems.map((item, idx) => {
                      const itemTotal = item.unitPrice * item.quantity;
                      return (
                        <View key={idx} style={styles.ticketDetailItem}>
                          <View style={styles.ticketDetailItemLeft}>
                            <Text style={styles.ticketDetailItemName}>{item.productName}</Text>
                            <Text style={styles.ticketDetailItemQty}>
                              ${item.unitPrice.toFixed(2)} × {item.quantity}
                            </Text>
                          </View>
                          <Text style={styles.ticketDetailItemTotal}>${itemTotal.toFixed(2)}</Text>
                        </View>
                      );
                    })}
                  </View>
                  
                  <View style={styles.ticketDetailTotals}>
                    <View style={styles.ticketDetailTotalRow}>
                      <Text style={styles.ticketDetailTotalLabel}>Subtotal:</Text>
                      <Text style={styles.ticketDetailTotalValue}>${selectedTicket.subtotal.toFixed(2)}</Text>
                    </View>
                    <View style={styles.ticketDetailTotalRow}>
                      <Text style={[styles.ticketDetailTotalLabel, { fontWeight: '800', fontSize: 17 }]}>TOTAL:</Text>
                      <Text style={[styles.ticketDetailTotalValue, { fontWeight: '800', fontSize: 17, color: THEME.colors.primary }]}>
                        ${selectedTicket.total.toFixed(2)}
                      </Text>
                    </View>
                    {selectedTicket.commission > 0 && (
                      <View style={styles.commissionNote}>
                        <Text style={styles.commissionText}>
                          ℹ️ Comisión bancaria: ${selectedTicket.commission.toFixed(2)}
                        </Text>
                      </View>
                    )}
                  </View>
                  
                  <View style={styles.modalButtons}>
                    <TouchableOpacity 
                      style={[styles.modalBtn, styles.modalBtnCancel]} 
                      onPress={() => setShowTicketDetail(false)}
                    >
                      <Text style={styles.modalBtnText}>Cerrar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.modalBtn, styles.modalBtnConfirm]} 
                      onPress={() => {
                        reprintTicket(selectedTicket, ticketItems);
                        setShowTicketDetail(false);
                      }}
                    >
                      <Text style={styles.modalBtnText}>🖨️ Reimprimir</Text>
                    </TouchableOpacity>
                    {selectedTicket.status !== 'cancelled' && (
                      <TouchableOpacity 
                        style={[styles.modalBtn, { backgroundColor: '#F44336' }]} 
                        onPress={() => {
                          if (Platform.OS === 'web') {
                            const ok = window.confirm('¿Estás seguro de cancelar esta venta? Se revertirán todos los movimientos (productos, gastos, inventario).');
                            if (!ok) return;
                            (async () => {
                              try {
                                await cancelSale(selectedTicket.id);
                                Alert.alert('✅ Venta cancelada', 'Se ha cancelado la venta y revertido todas las operaciones.');
                                setShowTicketDetail(false);
                                await refreshTickets();
                                await load(); // refresh products to reflect returned stock
                              } catch (e: any) {
                                Alert.alert('Error', e?.message || 'No se pudo cancelar la venta');
                              }
                            })();
                            return;
                          } else {
                            Alert.alert(
                              'Cancelar Venta',
                              '¿Estás seguro de cancelar esta venta? Se revertirán todos los movimientos (productos, gastos, inventario).',
                              [
                                { text: 'No', style: 'cancel' },
                                { text: 'Sí, Cancelar', style: 'destructive', onPress: async () => {
                                  try {
                                    await cancelSale(selectedTicket.id);
                                    Alert.alert('✅ Venta cancelada', 'Se ha cancelado la venta y revertido todas las operaciones.');
                                    setShowTicketDetail(false);
                                    await refreshTickets();
                                    await load(); // refresh products to reflect returned stock
                                  } catch (e: any) {
                                    Alert.alert('Error', e?.message || 'No se pudo cancelar la venta');
                                  }
                                }}
                              ]
                            );
                          }
                        }}
                      >
                        <Text style={styles.modalBtnText}>❌ Cancelar Venta</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  content: { flex: 1, padding: SPACING.medium },
  heading: { fontSize: 22, fontWeight: '800', marginBottom: SPACING.tiny },
  subheading: { color: THEME.colors.muted, marginBottom: SPACING.small, fontSize: 14 },
  
  // Store filter
  storeFilterContainer: { 
    backgroundColor: THEME.colors.surface, 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.md, 
    marginBottom: SPACING.medium,
    ...THEME.shadow 
  },
  storeFilterLabel: { fontSize: 14, fontWeight: '700', marginBottom: SPACING.small, color: '#333' },
  storeFilterScroll: { flexDirection: 'row' },
  storeFilterBtn: { 
    backgroundColor: THEME.colors.surfaceVariant, 
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small, 
    borderRadius: THEME.radii.sm, 
    marginRight: SPACING.small,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  storeFilterBtnActive: { 
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  storeFilterBtnText: { color: '#666', fontWeight: '600', fontSize: 13 },
  storeFilterBtnTextActive: { color: THEME.colors.onPrimary, fontWeight: '700', fontSize: 13 },
  
  // Tickets section
  ticketsSection: { 
    backgroundColor: THEME.colors.surface, 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.md, 
    marginBottom: SPACING.medium,
    ...THEME.shadow 
  },
  ticketsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.small,
  },
  ticketsTitle: { fontSize: 16, fontWeight: '700' },
  exportMVTBtn: {
    backgroundColor: '#FF9800',
    paddingHorizontal: SPACING.small,
    paddingVertical: 6,
    borderRadius: THEME.radii.sm,
  },
  exportMVTBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  ticketsScrollContainer: { },
  ticketsScrollContent: { paddingHorizontal: SPACING.small, flexDirection: 'row', alignItems: 'center' },
  ticketCard: { 
    backgroundColor: THEME.colors.surfaceVariant, 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.sm, 
    marginRight: SPACING.small,
    width: 140,
    flexShrink: 0,
    alignItems: 'center',
  },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: SPACING.tiny },
  ticketTime: { fontSize: 11, color: '#666', fontWeight: '600' },
  ticketIcon: { fontSize: 16 },
  ticketTotal: { fontSize: 18, fontWeight: '800', color: THEME.colors.primary, marginVertical: SPACING.tiny },
  ticketId: { fontSize: 10, color: '#999', fontWeight: '600' },
  
  // Ticket detail modal
  modalScrollView: {
    flex: 1,
    maxHeight: '80%',
  },
  modalContentScrollContainer: {
    padding: SPACING.medium,
  },
  ticketDetailHeader: { 
    backgroundColor: THEME.colors.surfaceVariant, 
    padding: SPACING.small, 
    borderRadius: THEME.radii.sm, 
    marginBottom: SPACING.medium 
  },
  ticketDetailInfo: { fontSize: 13, marginBottom: 2, fontWeight: '600' },
  ticketItemsContainer: { marginBottom: SPACING.medium },
  ticketItemsTitle: { fontSize: 15, fontWeight: '700', marginBottom: SPACING.small },
  ticketDetailItem: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    paddingVertical: SPACING.small, 
    borderBottomWidth: 1, 
    borderBottomColor: THEME.colors.outline 
  },
  ticketDetailItemLeft: { flex: 1 },
  ticketDetailItemName: { fontWeight: '700', fontSize: 14, marginBottom: 2 },
  ticketDetailItemQty: { fontSize: 12, color: '#666' },
  ticketDetailItemTotal: { fontWeight: '700', fontSize: 15, color: THEME.colors.primary },
  ticketDetailTotals: { 
    backgroundColor: THEME.colors.surfaceVariant, 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.sm 
  },
  ticketDetailTotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.tiny },
  ticketDetailTotalLabel: { fontSize: 15, fontWeight: '600' },
  ticketDetailTotalValue: { fontSize: 15, fontWeight: '700' },
  
  searchRow: { flexDirection: 'row', marginBottom: SPACING.medium, gap: SPACING.small },
  searchInput: { flex: 1, backgroundColor: THEME.colors.surface, padding: SPACING.small, borderRadius: THEME.radii.sm, fontSize: 15 },
  scanBtn: { width: 50, backgroundColor: THEME.colors.primary, borderRadius: THEME.radii.sm, alignItems: 'center', justifyContent: 'center' },
  scanBtnText: { fontSize: 20 },
  
  scannerContainer: { flex: 1, position: 'relative' },
  closeScannerBtn: { position: 'absolute', top: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.7)', padding: SPACING.medium, borderRadius: THEME.radii.sm },
  closeScannerText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  productsSection: { marginBottom: SPACING.medium },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: SPACING.small },
  empty: { color: THEME.colors.muted, fontStyle: 'italic', textAlign: 'center', paddingVertical: SPACING.large },
  
  productCard: { backgroundColor: THEME.colors.surface, padding: SPACING.medium, borderRadius: THEME.radii.sm, marginBottom: SPACING.small, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', ...THEME.shadow },
  productOutOfStock: { opacity: 0.5 },
  productLeft: { flex: 1 },
  productName: { fontWeight: '700', fontSize: 15, marginBottom: 2 },
  productSku: { fontSize: 11, color: '#999', marginBottom: 2 },
  productPrice: { fontSize: 14, color: THEME.colors.primary, fontWeight: '600' },
  productExtra: { fontSize: 11, color: '#FF9800', fontWeight: '600', marginTop: 2 },
  productRight: { alignItems: 'flex-end' },
  productStock: { fontSize: 12, color: '#666', fontWeight: '600' },
  productStockLow: { color: '#FF9800' },
  productStockOut: { fontSize: 12, color: THEME.colors.error, fontWeight: '700' },
  cartBadge: { backgroundColor: THEME.colors.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginTop: 4 },
  cartBadgeText: { color: THEME.colors.onPrimary, fontSize: 10, fontWeight: '700' },
  
  cartSection: { backgroundColor: THEME.colors.surface, padding: SPACING.medium, borderRadius: THEME.radii.md, ...THEME.shadow, marginBottom: SPACING.large },
  cartTitle: { fontSize: 16, fontWeight: '700', marginBottom: SPACING.small },
  cartItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.small, borderBottomWidth: 1, borderBottomColor: THEME.colors.outline },
  cartItemLeft: { flex: 1 },
  cartItemName: { fontWeight: '700', fontSize: 14, marginBottom: 2 },
  cartItemDetails: { fontSize: 12, color: '#666' },
  cartItemRight: { alignItems: 'flex-end' },
  cartItemTotal: { fontWeight: '700', fontSize: 15, color: THEME.colors.primary, marginBottom: 4 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 6, backgroundColor: THEME.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: '#333' },
  qtyText: { fontSize: 14, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  
  footer: { backgroundColor: THEME.colors.surface, padding: SPACING.medium, borderTopWidth: 1, borderTopColor: THEME.colors.outline, ...THEME.shadow },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalsLabel: { fontSize: 17, fontWeight: '800' },
  totalsValue: { fontSize: 17, fontWeight: '800', color: THEME.colors.primary },
  commissionNote: { backgroundColor: '#FFF3CD', padding: SPACING.small, borderRadius: THEME.radii.sm, marginTop: SPACING.small },
  commissionText: { fontSize: 11, color: '#856404', fontWeight: '600' },
  divider: { height: 1, backgroundColor: THEME.colors.outline, marginVertical: SPACING.small },
  paymentButtons: { flexDirection: 'row', gap: SPACING.small },
  payBtn: { 
    flex: 1, 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.sm, 
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60, // Altura mínima para botones
  },
  payBtnCash: { backgroundColor: '#4CAF50' },
  payBtnTransfer: { backgroundColor: THEME.colors.primary },
  // Botón de pago mixto ahora ocupa todo el ancho
  payBtnMixed: { 
    backgroundColor: '#9C27B0', 
    marginTop: SPACING.small,
    width: '100%', // Ocupa todo el ancho disponible
  },
  payBtnLabel: { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  payBtnAmount: { color: '#fff', fontSize: 17, fontWeight: '800' },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: SPACING.medium },
  modalContent: { backgroundColor: THEME.colors.surface, borderRadius: THEME.radii.md, padding: SPACING.large },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: SPACING.tiny },
  modalSubtitle: { fontSize: 15, color: THEME.colors.muted, marginBottom: SPACING.medium, fontWeight: '600' },
  label: { fontWeight: '600', marginBottom: SPACING.tiny, marginTop: SPACING.small, fontSize: 14 },
  input: { backgroundColor: THEME.colors.surfaceVariant, padding: SPACING.medium, borderRadius: THEME.radii.sm, fontSize: 16, fontWeight: '700' },
  mixedSummary: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#E8F5E9', padding: SPACING.small, borderRadius: THEME.radii.sm, marginTop: SPACING.medium },
  mixedSummaryLabel: { fontSize: 15, fontWeight: '600' },
  mixedSummaryValue: { fontSize: 16, fontWeight: '800', color: '#2E7D32' },
  modalButtons: { flexDirection: 'row', gap: SPACING.small, marginTop: SPACING.medium },
  modalBtn: { flex: 1, padding: SPACING.medium, borderRadius: THEME.radii.sm, alignItems: 'center' },
  modalBtnCancel: { backgroundColor: '#95A5A6' },
  modalBtnConfirm: { backgroundColor: THEME.colors.primary },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  transferInfoBox: { backgroundColor: '#E3F2FD', padding: SPACING.small, borderRadius: THEME.radii.sm, marginTop: SPACING.small },
  transferInfoText: { fontSize: 12, fontWeight: '600', color: '#1E88E5' },
  
  closedDayBanner: { 
    backgroundColor: '#F44336', 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.md, 
    marginBottom: SPACING.medium,
    ...THEME.shadow 
  },
  closedDayBannerText: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
});