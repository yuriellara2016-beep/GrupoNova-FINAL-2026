import React, { useState, useEffect } from 'react';
import { Alert, Platform, SafeAreaView, ScrollView, Text, TouchableOpacity, View, ActivityIndicator, TextInput, DeviceEventEmitter, StyleSheet } from 'react-native';
import { initDb, getSales, getExpenses, getAllSaleItems, getInventoryEntries } from '../lib/db';
import { useAuthSafe } from '../hooks/useAuth';
import { getUsageCounts, getClassifiedProducts } from '../lib/classifiedProducts';
import { dateToDisplay } from '../lib/date';
import { useAuthSafe as useLibAuthSafe } from '../lib/AuthContext';

const SPACING = { s: 8, m: 16, l: 24 };
const COLORS = {
  bg: '#FFFFFF',
  surface: '#F8F9FA',
  primary: '#4F46E5',
  onPrimary: '#FFFFFF',
  text: '#1A1A1A',
  subtitle: '#6B7280',
  outline: '#E5E7EB',
  success: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
};

type Period = 'day' | 'month' | 'year' | 'range';

export default function ReportsScreen() {
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<Period>('day');
  const [sales, setSales] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saleItems, setSaleItems] = useState<any[]>([]);
  const [inventoryEntries, setInventoryEntries] = useState<any[]>([]);
  // Custom range (YYYY-MM-DD)
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const { user } = useAuthSafe();
  const { businessDate } = useLibAuthSafe();
  const bizDateCtx = businessDate || new Date().toISOString().slice(0, 10);

  useEffect(() => {
    loadData();
  }, []);

  // Refresh report when relevant app-wide events occur
  useEffect(() => {
    const s1 = DeviceEventEmitter.addListener('saleCreated', () => { loadData(); });
    const s2 = DeviceEventEmitter.addListener('expenseCreated', () => { loadData(); });
    const s3 = DeviceEventEmitter.addListener('saleCancelled', () => { loadData(); });
    const s4 = DeviceEventEmitter.addListener('databaseCleaned', () => { loadData(); });
    return () => {
      try { s1.remove(); } catch (_) {}
      try { s2.remove(); } catch (_) {}
      try { s3.remove(); } catch (_) {}
      try { s4.remove(); } catch (_) {}
    };
  }, []);

  // Guard for sellers
  if (user?.role === 'seller') {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg }}>
        <Text style={{ color: COLORS.subtitle, fontSize: 16, padding: 16, textAlign: 'center' }}>
          Acceso restringido. Esta sección (Reportes) está disponible solo para administradores.
        </Text>
      </SafeAreaView>
    );
  }

  async function loadData() {
    try {
      await initDb();
      const [salesData, expensesData, saleItemsData, inventoryData] = await Promise.all([
        getSales(),
        getExpenses(),
        getAllSaleItems(),
        getInventoryEntries(),
      ]);
      setSales(salesData);
      setExpenses(expensesData);
      setSaleItems(saleItemsData);
      setInventoryEntries(inventoryData);
    } catch (e) {
      console.error('Failed to load report data:', e);
    } finally {
      setLoading(false);
    }
  }

  function filterByPeriod(items: any[], period: Period) {
    const baseDate = bizDateCtx ? new Date(bizDateCtx + 'T00:00:00') : new Date();
    return items.filter(item => {
      if (!item.createdAt) return false;
      const itemDate = new Date(item.createdAt);
      
      if (period === 'day') {
        const d = (item.createdAt || '').slice(0, 10);
        const baseDay = bizDateCtx || new Date().toISOString().slice(0, 10);
        return d === baseDay;
      } else if (period === 'month') {
        return (
          itemDate.getFullYear() === baseDate.getFullYear() &&
          itemDate.getMonth() === baseDate.getMonth()
        );
      } else if (period === 'year') {
        return itemDate.getFullYear() === baseDate.getFullYear();
      } else {
        // range: compare YYYY-MM-DD strings
        const d = (item.createdAt || '').slice(0, 10);
        const start = rangeStart.trim();
        const end = rangeEnd.trim();
        if (!start || !end) return false;
        return d >= start && d <= end;
      }
    });
  }

  const filteredSales = filterByPeriod(sales, period);
  const filteredExpenses = filterByPeriod(expenses, period);
  const filteredInventoryEntries = filterByPeriod(inventoryEntries, period);

  // Exclude cancelled tickets from revenue and computations
  const activeSales = filteredSales.filter((s: any) => (s.status || 'active') !== 'cancelled');

  // Revenue from active sales only
  const totalRevenue = activeSales.reduce((sum, s) => sum + (s.total || 0), 0);
  
  // Calculate COGS from sale items belonging to active sales (more accurate when cancellations occur)
  const activeSaleIds = new Set(activeSales.map((s: any) => s.id));
  const totalCOGS = (saleItems || [])
    .filter((it: any) => activeSaleIds.has(it.saleId))
    .reduce((sum: number, it: any) => {
      const unitCost = Number(it.unitCost || 0);
      const qty = Number(it.quantity || 0);
      return sum + (unitCost * qty);
    }, 0);
  
  // Calculate ALL expenses including accounting entries (they are removed on cancellation)
  const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const grossProfit = totalRevenue - totalCOGS;
  const netProfit = grossProfit - totalExpenses;
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  async function printReport() {
    try {
      const periodLabel = period === 'day' ? 'Hoy' : period === 'month' ? 'Este Mes' : 'Este Año';
      const date = new Date().toISOString().slice(0, 10);
      
      // Build HTML for PDF
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reporte de Utilidad - ${periodLabel}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #fff; }
    h1 { color: #1A1A1A; border-bottom: 3px solid #4F46E5; padding-bottom: 10px; }
    h2 { color: #4F46E5; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #E5E7EB; }
    th { background: #F8F9FA; font-weight: 700; color: #374151; }
    .metric { background: #F8F9FA; padding: 15px; border-radius: 8px; margin: 10px 0; }
    .metric-label { font-weight: 600; color: #6B7280; font-size: 14px; }
    .metric-value { font-size: 24px; font-weight: 800; margin-top: 5px; }
    .positive { color: #10B981; }
    .negative { color: #EF4444; }
    .summary { background: #EEF2FF; padding: 20px; border-radius: 8px; border-left: 4px solid #4F46E5; }
    .footer { margin-top: 40px; text-align: center; color: #9CA3AF; font-size: 12px; }
  </style>
</head>
<body>
  <h1>📊 Reporte de Utilidad - ${periodLabel}</h1>
  <p style="color: #6B7280;">Generado el ${dateToDisplay(new Date())} a las ${new Date().toLocaleTimeString('es-ES')}</p>
  
  <div class="summary">
    <h2>Resumen Ejecutivo</h2>
    <div class="metric">
      <div class="metric-label">Ingresos Totales (Ventas)</div>
      <div class="metric-value positive">$${totalRevenue.toFixed(2)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Costo de Ventas</div>
      <div class="metric-value negative">-$${totalCOGS.toFixed(2)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Utilidad Bruta</div>
      <div class="metric-value ${grossProfit >= 0 ? 'positive' : 'negative'}">$${grossProfit.toFixed(2)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Gastos Operativos</div>
      <div class="metric-value negative">-$${totalExpenses.toFixed(2)}</div>
    </div>
    <div class="metric" style="background: ${netProfit >= 0 ? '#ECFDF5' : '#FEF2F2'}; border: 2px solid ${netProfit >= 0 ? '#10B981' : '#EF4444'};">
      <div class="metric-label">Utilidad Neta</div>
      <div class="metric-value ${netProfit >= 0 ? 'positive' : 'negative'}">$${netProfit.toFixed(2)}</div>
      <div style="font-size: 14px; margin-top: 5px; color: #6B7280;">Margen: ${profitMargin.toFixed(1)}%</div>
    </div>
  </div>

  <h2>Detalle de Ventas (${activeSales.length} operaciones)</h2>
  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Cliente</th>
        <th>Total</th>
        <th>Método</th>
      </tr>
    </thead>
    <tbody>
      ${activeSales.map(s => `
        <tr>
          <td>${dateToDisplay(new Date(s.createdAt))}</td>
          <td>${s.customerName || 'Cliente general'}</td>
          <td style="color: #10B981; font-weight: 700;">$${(s.total || 0).toFixed(2)}</td>
          <td>${s.paymentMethod || 'N/A'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Detalle de Gastos (${filteredExpenses.length} operaciones)</h2>
  <table>
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Tipo</th>
        <th>Nota</th>
        <th>Monto</th>
      </tr>
    </thead>
    <tbody>
      ${filteredExpenses.map(e => {
        const note = (e.note || '').toLowerCase();
        const isAccounting = 
          note.includes('cargo 10%') || 
          note.includes('extra 10%') || 
          note.includes('comision bancaria') ||
          note.includes('comision banco') ||
          (note.includes('comision') && (note.includes('1.5') || note.includes('1,5')));
        
        if (isAccounting) return ''; // Skip accounting entries in detail
        
        return `
        <tr>
          <td>${dateToDisplay(new Date(e.createdAt))}</td>
          <td>${e.type || 'N/A'}</td>
          <td>${e.note || '(sin nota)'}</td>
          <td style="color: #EF4444; font-weight: 700;">-$${(e.amount || 0).toFixed(2)}</td>
        </tr>
        `;
      }).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>Grupo Nova S.R.L - Sistema de Gestión</p>
    <p>Este reporte fue generado automáticamente</p>
  </div>
</body>
</html>
      `;

      if (Platform.OS === 'web') {
        const printWindow = window.open('', '', 'width=800,height=600');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
            printWindow.close();
          }, 250);
        }
      } else {
        // Native: dynamically import expo-print only when needed
        try {
          const Print = await import('expo-print');
          await Print.printAsync({ html });
        } catch (err) {
          Alert.alert('Error', 'La función de impresión no está disponible en este dispositivo');
        }
      }
    } catch (error) {
      Alert.alert('Error', 'No se pudo generar el reporte');
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: SPACING.m, color: COLORS.subtitle }}>Cargando datos...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ padding: SPACING.m }}>
        <Text style={{ color: COLORS.text, fontSize: 24, fontWeight: '800', marginBottom: SPACING.s }}>
          📊 Reporte de Utilidad
        </Text>
        <Text style={{ color: COLORS.subtitle, marginBottom: SPACING.l, fontSize: 14 }}>
          Análisis de ingresos, costos y gastos para calcular la utilidad del negocio
        </Text>

        {/* Period Selector */}
        <View style={{ flexDirection: 'row', gap: SPACING.s, marginBottom: SPACING.s }}>
          {(['day', 'month', 'year', 'range'] as Period[]).map(p => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              style={{
                flex: 1,
                padding: SPACING.m,
                borderRadius: 10,
                backgroundColor: period === p ? COLORS.primary : COLORS.surface,
                borderWidth: 2,
                borderColor: period === p ? COLORS.primary : 'transparent',
              }}
            >
              <Text style={{ 
                textAlign: 'center', 
                fontWeight: '700',
                color: period === p ? COLORS.onPrimary : COLORS.text 
              }}>
                {p === 'day' ? '📅 Hoy' : p === 'month' ? '📆 Este Mes' : p === 'year' ? '📊 Este Año' : '📑 Rango'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {period === 'range' && (
          <View style={{ flexDirection: 'row', gap: SPACING.s, marginBottom: SPACING.l }}>
            <TextInput
              style={{ flex: 1, backgroundColor: COLORS.surface, borderColor: COLORS.outline, borderWidth: 1, padding: SPACING.s, borderRadius: 8 }}
              placeholder="YYYY-MM-DD inicio"
              value={rangeStart}
              onChangeText={setRangeStart}
            />
            <TextInput
              style={{ flex: 1, backgroundColor: COLORS.surface, borderColor: COLORS.outline, borderWidth: 1, padding: SPACING.s, borderRadius: 8 }}
              placeholder="YYYY-MM-DD fin"
              value={rangeEnd}
              onChangeText={setRangeEnd}
            />
            <TouchableOpacity
              onPress={() => { /* trigger recalculation via state change */ setRangeStart(rangeStart.trim()); setRangeEnd(rangeEnd.trim()); }}
              style={{ paddingHorizontal: SPACING.m, justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 8 }}
            >
              <Text style={{ color: COLORS.onPrimary, fontWeight: '700' }}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Summary Cards */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.m, marginBottom: SPACING.m }}>
          <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: SPACING.m, color: COLORS.text }}>
            Resumen Financiero
          </Text>

          <View style={{ marginBottom: SPACING.s }}>
            <Text style={{ fontSize: 13, color: COLORS.subtitle, marginBottom: 4 }}>Ingresos (Ventas)</Text>
            <Text style={{ fontSize: 28, fontWeight: '800', color: COLORS.success }}>
              ${totalRevenue.toFixed(2)}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.subtitle }}>{activeSales.length} ventas</Text>
          </View>

          <View style={{ marginBottom: SPACING.s }}>
            <Text style={{ fontSize: 13, color: COLORS.subtitle, marginBottom: 4 }}>Costo de Ventas</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: COLORS.danger }}>
              -${totalCOGS.toFixed(2)}
            </Text>
          </View>

          <View style={{ marginBottom: SPACING.s }}>
            <Text style={{ fontSize: 13, color: COLORS.subtitle, marginBottom: 4 }}>Utilidad Bruta</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: grossProfit >= 0 ? COLORS.success : COLORS.danger }}>
              ${grossProfit.toFixed(2)}
            </Text>
          </View>

          <View style={{ marginBottom: SPACING.s }}>
            <Text style={{ fontSize: 13, color: COLORS.subtitle, marginBottom: 4 }}>Gastos Operativos</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: COLORS.danger }}>
              -${totalExpenses.toFixed(2)}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.subtitle }}>{filteredExpenses.length} gastos</Text>
          </View>

          <View 
            style={{ 
              backgroundColor: netProfit >= 0 ? '#ECFDF5' : '#FEF2F2', 
              padding: SPACING.m, 
              borderRadius: 10,
              borderWidth: 2,
              borderColor: netProfit >= 0 ? COLORS.success : COLORS.danger,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.subtitle, marginBottom: 4 }}>
              💰 Utilidad Neta
            </Text>
            <Text style={{ 
              fontSize: 32, 
              fontWeight: '800', 
              color: netProfit >= 0 ? COLORS.success : COLORS.danger 
            }}>
              ${netProfit.toFixed(2)}
            </Text>
            <Text style={{ fontSize: 13, color: COLORS.subtitle, marginTop: 4 }}>
              Margen: {profitMargin.toFixed(1)}%
            </Text>
          </View>
        </View>

        {/* Top Classified Products by Usage */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: SPACING.m, marginTop: SPACING.l }}>
          <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: SPACING.m, color: COLORS.text }}>
            Productos Clasificados más usados (Entradas)
          </Text>
          <TopClassifiedUsage />
        </View>

        {/* Export PDF Button */}
        <TouchableOpacity 
          onPress={printReport} 
          disabled={busy}
          style={{ 
            backgroundColor: COLORS.danger, 
            padding: SPACING.m, 
            borderRadius: 10,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          {busy ? (
            <ActivityIndicator color={COLORS.onPrimary} />
          ) : (
            <Text style={{ color: COLORS.onPrimary, fontWeight: '700', fontSize: 16 }}>
              📄 Exportar Reporte en PDF
            </Text>
          )}
        </TouchableOpacity>

        <Text style={{ marginTop: SPACING.m, fontSize: 12, color: COLORS.subtitle, textAlign: 'center' }}>
          {period === 'day' && 'Mostrando datos de hoy'}
          {period === 'month' && 'Mostrando datos del mes actual'}
          {period === 'year' && 'Mostrando datos del año actual'}
          {period === 'range' && `Mostrando datos del rango ${rangeStart} a ${rangeEnd}`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function TopClassifiedUsage() {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Array<{ code: string; description: string; unit: string; count: number }>>([]);

  useEffect(() => {
    (async () => {
      setBusy(true);
      try {
        const [counts, classified] = await Promise.all([getUsageCounts(), getClassifiedProducts()]);
        const rows: Array<{ code: string; description: string; unit: string; count: number }> = [];
        for (const [code, count] of Object.entries(counts)) {
          const prod = classified.find(p => p.code.toUpperCase() === code.toUpperCase());
          rows.push({ code, description: prod?.description || '(desconocido)', unit: prod?.unit || '-', count });
        }
        rows.sort((a, b) => b.count - a.count);
        setItems(rows.slice(0, 10));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  if (busy) {
    return <Text style={{ color: COLORS.subtitle }}>Cargando...</Text>;
  }

  if (items.length === 0) {
    return <Text style={{ color: COLORS.subtitle }}>Sin datos de uso aún</Text>;
  }

  return (
    <View style={{ gap: SPACING.s }}>
      {items.map((it) => (
        <View key={it.code} style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#FFF', borderColor: COLORS.outline, borderWidth: 1, borderRadius: 8, padding: SPACING.s }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', color: COLORS.text }}>{it.code}</Text>
            <Text style={{ color: COLORS.subtitle, fontSize: 12 }}>{it.description}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontWeight: '800', color: COLORS.primary }}>{it.count}</Text>
            <Text style={{ color: COLORS.subtitle, fontSize: 12 }}>{it.unit}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}