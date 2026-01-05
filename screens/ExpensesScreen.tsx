import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView, ActivityIndicator } from 'react-native';
import { initDb, createExpense, getExpenses } from '../lib/db';
import { THEME, SPACING } from '../lib/theme';
import { useStore } from '../lib/useStore';
import DayStatusBanner from '../components/DayStatusBanner';
import { useAuthSafe as useLibAuthSafe } from '../lib/AuthContext';
import { isoToDisplay, dateToDisplay } from '../lib/date';
import * as localDb from '../lib/localDb';

type Period = 'day' | 'month' | 'year' | 'range';

export default function ExpensesScreen() {
  const { currentStoreId, isAdmin, stores } = useStore();
  const { user, businessDate } = useLibAuthSafe();
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string | null>(null);
  
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'operational' | 'other' | 'salary' | 'rent'>('operational');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [period, setPeriod] = useState<Period>('day');
  const [exportingPDF, setExportingPDF] = useState(false);
  const [rangeStart, setRangeStart] = useState(''); // YYYY-MM-DD
  const [rangeEnd, setRangeEnd] = useState('');
  
  // Estado del día cerrado
  const [isDayClosed, setIsDayClosed] = useState(false);

  // Determine which store to filter by
  const activeStoreFilter = isAdmin ? selectedStoreFilter : (currentStoreId || user?.storeId || 'store_default');

  function isSameLocalDay(iso: string, ref: Date) {
    const d = new Date(iso);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
  }

  function filterByPeriod(items: any[], period: Period) {
    // Base date is the business (work) date when available
    const baseIso = businessDate || new Date().toISOString().slice(0, 10);
    const baseDate = new Date(`${baseIso}T00:00:00`);
    return items.filter(item => {
      if (!item.createdAt) return false;
      const itemDate = new Date(item.createdAt);
      
      if (period === 'day') {
        const itemDay = (item.createdAt || '').slice(0, 10);
        return itemDay === baseIso;
      } else if (period === 'month') {
        return (
          itemDate.getFullYear() === baseDate.getFullYear() &&
          itemDate.getMonth() === baseDate.getMonth()
        );
      } else if (period === 'year') {
        return itemDate.getFullYear() === baseDate.getFullYear();
      } else {
        const d = (item.createdAt || '').slice(0,10);
        const start = rangeStart.trim();
        const end = rangeEnd.trim();
        if (!start || !end) return false;
        return d >= start && d <= end;
      }
    });
  }

  const filteredExpenses = useMemo(() => {
    return filterByPeriod(expenses, period);
  }, [expenses, period, rangeStart, rangeEnd]);

  const totals = useMemo(() => {
    let operational = 0; let other = 0; let salary = 0; let rent = 0; let total = 0;
    for (const e of filteredExpenses) {
      const amt = Number(e.amount || 0);
      total += amt;
      if (e.type === 'operational') operational += amt;
      else if (e.type === 'salary') salary += amt;
      else if (e.type === 'rent') rent += amt;
      else other += amt;
    }
    return { operational, other, salary, rent, total };
  }, [filteredExpenses]);

  const load = useCallback(async () => {
    try {
      await initDb();
      const filter = activeStoreFilter ? { storeId: activeStoreFilter } : {};
      const all = await getExpenses(filter);
      setExpenses(all);
      
      // Verificar si el día está cerrado
      const closed = await localDb.isDayClosed();
      setIsDayClosed(closed);
    } catch (e) {
      console.warn('Failed to load expenses', e);
    }
  }, [activeStoreFilter]);

  useEffect(() => { load(); }, [load]);

  // Refresh when expenses or sales are created elsewhere in the app
  useEffect(() => {
    const { DeviceEventEmitter } = require('react-native');
    const sub1 = DeviceEventEmitter.addListener('expenseCreated', () => { load(); });
    const sub2 = DeviceEventEmitter.addListener('saleCreated', () => { load(); });
    
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
      sub1.remove(); 
      sub2.remove();
      dayClosedListener.remove();
      dayOpenedListener.remove();
    }
  }, [load]);

  async function saveExpense() {
    // Verificar si el día está cerrado y el usuario es vendedor
    if (isDayClosed && !isAdmin) {
      Alert.alert('Día Cerrado', 'No se pueden registrar gastos porque el día está cerrado. Contacta al administrador.');
      return;
    }

    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      Alert.alert('Monto inválido', 'Ingresa un monto válido');
      return;
    }
    setLoading(true);
    try {
      // Use admin's selected store filter if available, otherwise use vendor's assigned store
      const storeIdToUse = isAdmin && selectedStoreFilter ? selectedStoreFilter : (currentStoreId || user?.storeId || 'store_default');
      await createExpense({ 
        type, 
        amount: amt, 
        note: note || null,
        storeId: storeIdToUse,
        userId: user?.id || null,
      });
      setAmount(''); setNote('');
      await load();
      Alert.alert('Gasto registrado', `Tipo: ${type}\nMonto: $${amt.toFixed(2)}`);
    } catch (e) {
      Alert.alert('Error', 'No se pudo registrar el gasto');
    } finally {
      setLoading(false);
    }
  }

  async function handlePrintPDF() {
    try {
      setExportingPDF(true);
      const periodLabel = period === 'day' ? 'Hoy' : period === 'month' ? 'Este Mes' : period === 'year' ? 'Este Año' : `Rango ${rangeStart} a ${rangeEnd}`;
      
      // Use business date for report generation
      const reportDate = businessDate ? new Date(`${businessDate}T00:00:00`) : new Date();
      
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Informe de Gastos - ${periodLabel}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: #fff; }
    h1 { color: #1A1A1A; border-bottom: 3px solid #EF4444; padding-bottom: 10px; }
    h2 { color: #EF4444; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #E5E7EB; }
    th { background: #FEF2F2; font-weight: 700; color: #991B1B; }
    .metric { background: #FEF2F2; padding: 15px; border-radius: 8px; margin: 10px 0; }
    .metric-label { font-weight: 600; color: #6B7280; font-size: 14px; }
    .metric-value { font-size: 24px; font-weight: 800; margin-top: 5px; color: #EF4444; }
    .summary { background: #FEF2F2; padding: 20px; border-radius: 8px; border-left: 4px solid #EF4444; }
    .footer { margin-top: 40px; text-align: center; color: #9CA3AF; font-size: 12px; }
  </style>
</head>
<body>
  <h1>💸 Informe de Gastos - ${periodLabel}</h1>
  <p style="color: #6B7280;">Generado el ${dateToDisplay(reportDate)} a las ${reportDate.toLocaleTimeString('es-ES')}</p>
  
  <div class="summary">
    <h2>Resumen de Gastos</h2>
    <div class="metric">
      <div class="metric-label">Gastos Operativos</div>
      <div class="metric-value">$${totals.operational.toFixed(2)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Salarios</div>
      <div class="metric-value">$${totals.salary.toFixed(2)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Renta</div>
      <div class="metric-value">$${totals.rent.toFixed(2)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Otros Gastos</div>
      <div class="metric-value">$${totals.other.toFixed(2)}</div>
    </div>
    <div class="metric" style="background: #991B1B; color: white; border: 2px solid #7F1D1D;">
      <div class="metric-label" style="color: #FEE2E2;">Total de Gastos</div>
      <div class="metric-value" style="color: white; font-size: 32px;">$${totals.total.toFixed(2)}</div>
    </div>
  </div>

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
      ${filteredExpenses.map(e => `
        <tr>
          <td>${dateToDisplay(new Date(e.createdAt))}</td>
          <td>${e.type === 'operational' ? 'Operativo' : e.type === 'salary' ? 'Salario' : e.type === 'rent' ? 'Renta' : 'Otro'}</td>
          <td>${e.note || '(sin nota)'}</td>
          <td style="color: #EF4444; font-weight: 700;">$${(e.amount || 0).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>Grupo Nova S.R.L - Sistema de Gestión</p>
    <p>Este informe fue generado automáticamente</p>
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
        const { printAsync } = await import('expo-print');
        await printAsync({ html });
      }
    } catch (error) {
      Alert.alert('Error', 'No se pudo generar el PDF');
    } finally {
      setExportingPDF(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <DayStatusBanner />
      
      {/* Warning banner for closed day (vendors only) */}
      {isDayClosed && !isAdmin && (
        <View style={styles.closedDayBanner}>
          <Text style={styles.closedDayBannerText}>⚠️ DÍA CERRADO - No se pueden registrar gastos</Text>
        </View>
      )}
      
      <ScrollView>
        <View style={styles.content}>
          <Text style={styles.heading}>💸 Gastos</Text>

          {/* Store Filter for Admin */}
          {isAdmin && stores.length > 0 && (
            <View style={styles.storeFilterContainer}>
              <Text style={styles.label}>Filtrar por Tienda</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storeTabsScroll}>
                <TouchableOpacity
                  style={[styles.storeTab, selectedStoreFilter === null && styles.storeTabActive]}
                  onPress={() => setSelectedStoreFilter(null)}
                >
                  <Text style={[styles.storeTabText, selectedStoreFilter === null && styles.storeTabTextActive]}>
                    🌐 Todas
                  </Text>
                </TouchableOpacity>
                {stores.map(store => (
                  <TouchableOpacity
                    key={store.id}
                    style={[styles.storeTab, selectedStoreFilter === store.id && styles.storeTabActive]}
                    onPress={() => setSelectedStoreFilter(store.id)}
                  >
                    <Text style={[styles.storeTabText, selectedStoreFilter === store.id && styles.storeTabTextActive]}>
                      {store.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Period Filter */}
          <Text style={styles.label}>Período</Text>
          <View style={styles.periodRow}>
            {(['day', 'month', 'year', 'range'] as Period[]).map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.periodBtn, period === p && styles.periodBtnActive]}
                onPress={() => setPeriod(p)}
              >
                <Text style={[styles.periodBtnText, period === p && styles.periodBtnTextActive]}>
                  {p === 'day' ? 'Hoy' : p === 'month' ? 'Este Mes' : p === 'year' ? 'Este Año' : 'Rango'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {period === 'range' && (
            <View style={{ flexDirection: 'row', gap: SPACING.small, marginBottom: SPACING.medium }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="YYYY-MM-DD inicio" value={rangeStart} onChangeText={setRangeStart} />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="YYYY-MM-DD fin" value={rangeEnd} onChangeText={setRangeEnd} />
            </View>
          )}

          {/* Export PDF Button */}
          <TouchableOpacity 
            style={styles.exportBtn} 
            onPress={handlePrintPDF}
            disabled={exportingPDF}
          >
            {exportingPDF ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.exportBtnText}>📄 Exportar Informe en PDF</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider} />

          <Text style={styles.heading}>Registrar Gasto</Text>

          <Text style={styles.label}>Monto</Text>
          <TextInput
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            style={styles.input}
          />

          <Text style={styles.label}>Tipo</Text>
          <View style={styles.typeRow}>
            {(['operational', 'other', 'salary', 'rent'] as const).map(t => (
              <TouchableOpacity key={t} style={[styles.typeBtn, type === t && styles.typeBtnActive]} onPress={() => setType(t)}>
                <Text style={[styles.typeBtnText, type === t && styles.typeBtnTextActive]}>
                  {t === 'operational' ? 'Operativo' : t === 'other' ? 'Otro' : t === 'salary' ? 'Salario' : 'Renta'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Nota (opcional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Descripción breve"
            style={[styles.input, { height: 44 }]}
          />

          <TouchableOpacity disabled={loading} style={styles.saveBtn} onPress={saveExpense}>
            <Text style={styles.saveBtnText}>{loading ? 'Guardando...' : 'Guardar Gasto'}</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <Text style={styles.heading}>
            Gastos de {period === 'day' ? 'Hoy' : period === 'month' ? 'Este Mes' : period === 'year' ? 'Este Año' : `Rango ${rangeStart} a ${rangeEnd}`}
          </Text>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Operativos</Text><Text style={[styles.summaryValue, { color: '#c62828' }]}>-${totals.operational.toFixed(2)}</Text></View>
            <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Salarios</Text><Text style={[styles.summaryValue, { color: '#f57c00' }]}>-${totals.salary.toFixed(2)}</Text></View>
            <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Renta</Text><Text style={[styles.summaryValue, { color: '#f57c00' }]}>-${totals.rent.toFixed(2)}</Text></View>
            <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Otros</Text><Text style={[styles.summaryValue, { color: '#f57c00' }]}>-${totals.other.toFixed(2)}</Text></View>
            <View style={[styles.summaryRow, { backgroundColor: '#FFEBEE', borderRadius: 8, paddingVertical: 8 }]}>
              <Text style={[styles.summaryLabel, { fontWeight: '800' }]}>Total</Text>
              <Text style={[styles.summaryValue, { color: '#c62828', fontWeight: '800' }]}>-${totals.total.toFixed(2)}</Text>
            </View>
          </View>

          <Text style={styles.subheading}>Últimos Gastos ({filteredExpenses.length})</Text>
          {filteredExpenses.length === 0 ? (
            <Text style={styles.empty}>No hay gastos registrados en este período</Text>
          ) : (
            filteredExpenses.map((item) => (
              <View key={item.id} style={styles.expenseItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expenseNote}>{item.note || '(sin nota)'}</Text>
                  <Text style={styles.expenseType}>{item.type} • {isoToDisplay(item.createdAt)}</Text>
                </View>
                <Text style={styles.expenseAmount}>-${Number(item.amount || 0).toFixed(2)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  content: { flex: 1, padding: SPACING.medium },
  heading: { fontSize: 20, fontWeight: '800', marginBottom: SPACING.small },
  subheading: { fontSize: 16, fontWeight: '700', marginTop: SPACING.medium, marginBottom: SPACING.small },
  label: { fontWeight: '600', marginBottom: SPACING.tiny, marginTop: SPACING.small, fontSize: 14 },
  input: { backgroundColor: THEME.colors.surfaceVariant, padding: SPACING.medium, borderRadius: THEME.radii.sm, fontSize: 16, fontWeight: '700' },
  periodRow: { flexDirection: 'row', gap: SPACING.small, marginBottom: SPACING.medium },
  periodBtn: { flex: 1, padding: SPACING.small, borderRadius: THEME.radii.sm, backgroundColor: THEME.colors.surfaceVariant, alignItems: 'center' },
  periodBtnActive: { backgroundColor: THEME.colors.primary },
  periodBtnText: { fontWeight: '600', color: '#333', fontSize: 13 },
  periodBtnTextActive: { color: THEME.colors.onPrimary },
  exportBtn: { backgroundColor: '#EF4444', padding: SPACING.medium, borderRadius: THEME.radii.md, alignItems: 'center', marginBottom: SPACING.medium },
  exportBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  typeRow: { flexDirection: 'row', gap: SPACING.small, marginBottom: SPACING.small },
  typeBtn: { padding: SPACING.small, borderRadius: THEME.radii.sm, backgroundColor: THEME.colors.surfaceVariant },
  typeBtnActive: { backgroundColor: THEME.colors.primary },
  typeBtnText: { fontWeight: '600', color: '#333' },
  typeBtnTextActive: { color: THEME.colors.onPrimary },
  saveBtn: { backgroundColor: THEME.colors.primary, padding: SPACING.medium, borderRadius: THEME.radii.sm, alignItems: 'center', marginTop: SPACING.medium },
  saveBtnText: { color: THEME.colors.onPrimary, fontWeight: '800' },
  divider: { height: 1, backgroundColor: THEME.colors.outline, marginVertical: SPACING.large },
  summaryCard: { backgroundColor: THEME.colors.surface, borderRadius: THEME.radii.md, padding: SPACING.medium, ...THEME.shadow, marginBottom: SPACING.medium },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.small },
  summaryLabel: { fontWeight: '700' },
  summaryValue: { fontWeight: '800' },
  expenseItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.small, borderBottomWidth: 1, borderBottomColor: THEME.colors.outline },
  expenseNote: { fontWeight: '700', fontSize: 14 },
  expenseType: { fontSize: 12, color: THEME.colors.textSecondary },
  expenseAmount: { fontWeight: '800', color: '#c62828' },
  empty: { color: THEME.colors.textSecondary, fontStyle: 'italic', textAlign: 'center', paddingVertical: SPACING.large },
  storeFilterContainer: { marginBottom: SPACING.medium },
  storeTabsScroll: { flexDirection: 'row' },
  storeTab: { padding: SPACING.small, borderRadius: THEME.radii.sm, backgroundColor: THEME.colors.surfaceVariant, alignItems: 'center' },
  storeTabActive: { backgroundColor: THEME.colors.primary },
  storeTabText: { fontWeight: '600', color: '#333' },
  storeTabTextActive: { color: THEME.colors.onPrimary },
  closedDayBanner: { 
    backgroundColor: '#F44336', 
    padding: SPACING.medium, 
    borderRadius: THEME.radii.md, 
    margin: SPACING.medium,
    ...THEME.shadow 
  },
  closedDayBannerText: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
});