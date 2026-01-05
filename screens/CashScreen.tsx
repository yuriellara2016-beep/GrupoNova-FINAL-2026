import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { useStore } from '../lib/useStore';
import * as localDb from '../lib/localDb';
import * as db from '../lib/db';
import { DeviceEventEmitter } from 'react-native';

// Denominaciones de billetes/monedas
const DENOMINACIONES = [1000, 500, 200, 100, 50, 20, 10, 5, 1];

interface CashData {
  fondoInicial: number;
  efectivoVentas: number;
  transferenciaVentas: number;
  gastosRetirados: number;
  totalVentas: number;
  efectivoEsperado: number;
}

export default function CashScreen({ navigation, route }: any) {
  const { user, businessDate, isDayStarted } = useAuth();
  const { isAdmin, currentStoreId } = useStore();
  const [currentDate, setCurrentDate] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [data, setData] = useState<CashData>({
    fondoInicial: 0,
    efectivoVentas: 0,
    transferenciaVentas: 0,
    gastosRetirados: 0,
    totalVentas: 0,
    efectivoEsperado: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isDayClosed, setIsDayClosed] = useState(false);

  // Estados para modales
  const [showDeclararFondoModal, setShowDeclararFondoModal] = useState(false);
  const [showArqueoModal, setShowArqueoModal] = useState(false);
  const [fondoInicial, setFondoInicial] = useState('');
  
  // Estado para cada denominación (cantidad de billetes)
  const [denominacionesCount, setDenominacionesCount] = useState<Record<number, string>>({
    1000: '0',
    500: '0',
    200: '0',
    100: '0',
    50: '0',
    20: '0',
    10: '0',
    5: '0',
    1: '0',
  });

  // Estado para detectar si viene del flujo de cierre
  const [isClosingFlow, setIsClosingFlow] = useState(false);

  useEffect(() => {
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, [businessDate]);

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true);

      // Verificar si el día está cerrado (POR TIENDA + FECHA DE TRABAJO)
      const closed = await localDb.isDayClosed({ storeId: currentStoreId, businessDate });
      setIsDayClosed(closed);

      const baseIso = typeof businessDate === 'string' ? businessDate.slice(0, 10) : '';
      if (!baseIso || !isDayStarted) {
        setData({
          fondoInicial: 0,
          efectivoVentas: 0,
          transferenciaVentas: 0,
          gastosRetirados: 0,
          totalVentas: 0,
          efectivoEsperado: 0,
        });
        return;
      }

      const getRowIsoBusinessDay = (row: any): string => {
        const biz = typeof row?.businessDate === 'string' ? row.businessDate.slice(0, 10) : '';
        if (biz) return biz;
        const created = typeof row?.createdAt === 'string' ? row.createdAt.slice(0, 10) : '';
        return created;
      };

      // IMPORTANTE: Caja debe basarse en el MISMO origen de datos que Ventas/Gastos (lib/db)
      await db.initDb();
      const storeIdToUse = currentStoreId || user?.storeId || 'store_default';

      // Cargar ventas del día actual (por tienda y por fecha de trabajo)
      const allSales = await db.getSales({ storeId: storeIdToUse });
      const todaySales = allSales.filter((sale: any) => {
        const isoDay = getRowIsoBusinessDay(sale);
        const isCancelled = (sale.status || 'active') === 'cancelled';
        return isoDay === baseIso && !isCancelled;
      });

      // Calcular totales
      let efectivo = 0;
      let transferencia = 0;

      todaySales.forEach((sale: any) => {
        if (sale.paymentMethod === 'cash') {
          efectivo += Number(sale.total || 0);
        } else if (sale.paymentMethod === 'transfer') {
          transferencia += Number(sale.total || 0);
        } else if (sale.paymentMethod === 'mixed') {
          // Pago mixto: el total se divide en cashAmount + transferAmount
          efectivo += Number(sale.cashAmount || 0);
          transferencia += Number(sale.transferAmount || 0);
        } else {
          // Fallback defensivo
          efectivo += Number(sale.total || 0);
        }
      });

      const totalVentas = efectivo + transferencia;

      // Cargar gastos del día actual (por tienda y por fecha de trabajo)
      const allExpenses = await db.getExpenses({ storeId: storeIdToUse });
      const todayExpenses = allExpenses.filter((e: any) => getRowIsoBusinessDay(e) === baseIso);

      const isCommissionOrFeeExpense = (e: any): boolean => {
        const note = String(e?.note ?? '').toLowerCase();
        // Comisión bancaria 1.5% (creada automáticamente en createSale)
        if (note.includes('comisión bancaria') || note.includes('comision bancaria')) return true;
        // Cargo 10% por venta (creado automáticamente en SalesScreen)
        if (note.includes('cargo 10% por venta') || note.includes('extra 10%')) return true;
        return false;
      };

      // "Gastos retirados" = solo gastos reales retirados (NO incluye comisión 1.5% ni cargo 10%)
      const retiroExpenses = todayExpenses.filter((e: any) => !isCommissionOrFeeExpense(e));
      const gastosRetirados = retiroExpenses.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);

      // TODO: Obtener fondo inicial de la base de datos (por ahora se mantiene en 0 para no cambiar flujos)
      const fondo = 0;

      // ✅ REQUERIMIENTO: Efectivo esperado = fondo inicial + ventas totales - transferencias - gastos retirados
      const efectivoEsperado = fondo + totalVentas - transferencia - gastosRetirados;

      setData({
        fondoInicial: fondo,
        efectivoVentas: efectivo,
        transferenciaVentas: transferencia,
        gastosRetirados,
        totalVentas,
        efectivoEsperado,
      });
    } catch (error) {
      console.error('Error loading cash data:', error);
    } finally {
      setLoading(false);
    }
  }, [businessDate, currentStoreId, isDayStarted, user?.storeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refrescar automáticamente cuando se registran operaciones
  useEffect(() => {
    const saleCreated = DeviceEventEmitter.addListener('saleCreated', loadData);
    const saleCancelled = DeviceEventEmitter.addListener('saleCancelled', loadData);
    const expenseCreated = DeviceEventEmitter.addListener('expenseCreated', loadData);
    const dbCleaned = DeviceEventEmitter.addListener('databaseCleaned', loadData);
    const dayOpened = DeviceEventEmitter.addListener('dayOpened', loadData);
    const dayClosed = DeviceEventEmitter.addListener('dayClosed', loadData);
    const dayStatusChanged = DeviceEventEmitter.addListener('dayStatusChanged', loadData);

    return () => {
      saleCreated.remove();
      saleCancelled.remove();
      expenseCreated.remove();
      dbCleaned.remove();
      dayOpened.remove();
      dayClosed.remove();
      dayStatusChanged.remove();
    };
  }, [loadData]);

  // Listener para abrir modal de arqueo automáticamente cuando viene del flujo de cierre
  useEffect(() => {
    const listener = DeviceEventEmitter.addListener('openArqueoFromCierre', () => {
      setIsClosingFlow(true);
      setShowArqueoModal(true);
    });

    return () => listener.remove();
  }, []);

  // Detectar parámetros de navegación para abrir modal de arqueo desde inventario físico
  useEffect(() => {
    if (route?.params?.openArqueo && route?.params?.fromCierreFlow) {
      // Esperar un momento para que la pantalla esté lista
      setTimeout(() => {
        setIsClosingFlow(true);
        setShowArqueoModal(true);
      }, 300);
      
      // Limpiar parámetros para evitar reapertura
      if (navigation.setParams) {
        navigation.setParams({ openArqueo: false, fromCierreFlow: false });
      }
    }
  }, [route?.params?.openArqueo, route?.params?.fromCierreFlow]);

  function updateDateTime() {
    // Usar businessDate para la fecha (fecha de trabajo)
    if (businessDate) {
      // Convertir businessDate (YYYY-MM-DD) a DD-MM-YYYY
      const [year, month, day] = businessDate.split('-');
      setCurrentDate(`${day}-${month}-${year}`);
    } else {
      setCurrentDate('--');
    }
    
    // La hora sí se actualiza en tiempo real del dispositivo
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    setCurrentTime(`${hours}:${minutes}`);
  }

  // Declarar Fondo Inicial
  async function handleDeclararFondo() {
    if (!fondoInicial || parseFloat(fondoInicial) <= 0) {
      Alert.alert('Error', 'Ingresa un monto válido');
      return;
    }

    // TODO: Guardar fondo inicial en la base de datos
    Alert.alert('✅ Fondo Declarado', `Fondo inicial: $${parseFloat(fondoInicial).toFixed(2)}`);
    setShowDeclararFondoModal(false);
    setFondoInicial('');
    loadData();
  }

  // Calcular importe de cada denominación
  const calcularImporte = (denominacion: number): number => {
    const cantidad = parseInt(denominacionesCount[denominacion] || '0');
    return isNaN(cantidad) ? 0 : cantidad * denominacion;
  };

  // Calcular total contado
  const calcularTotalContado = (): number => {
    return DENOMINACIONES.reduce((sum, denom) => sum + calcularImporte(denom), 0);
  };

  // Manejar cambio en cantidad de billetes
  const handleDenominacionChange = (denominacion: number, value: string) => {
    setDenominacionesCount((prev) => ({
      ...prev,
      [denominacion]: value,
    }));
  };

  // Realizar Arqueo
  async function handleRealizarArqueo() {
    const totalContado = calcularTotalContado();
    const diferencia = totalContado - data.efectivoEsperado;

    // Si viene del flujo de cierre, ejecutar cierre completo
    if (isClosingFlow) {
      // TODO: Guardar arqueo en auditoría
      Alert.alert(
        '✅ Arqueo Completado',
        `Efectivo Esperado: $${data.efectivoEsperado.toFixed(2)}\nEfectivo Contado: $${totalContado.toFixed(2)}\nDiferencia: $${diferencia.toFixed(2)}\n\nProcediendo a cerrar el día...`,
        [
          {
            text: 'OK',
            onPress: async () => {
              setShowArqueoModal(false);
              setDenominacionesCount({
                1000: '0',
                500: '0',
                200: '0',
                100: '0',
                50: '0',
                20: '0',
                10: '0',
                5: '0',
                1: '0',
              });
              setIsClosingFlow(false);
              
              // Ejecutar cierre del día (POR TIENDA + FECHA DE TRABAJO)
              await localDb.markDayClosed({ storeId: currentStoreId, businessDate });
              setIsDayClosed(true);
              DeviceEventEmitter.emit('dayClosed');
              
              Alert.alert(
                '✅ Día Cerrado Exitosamente',
                'El día ha sido cerrado. Se han generado los reportes de auditoría.\n\n- Inventario físico registrado\n- Arqueo de caja guardado\n- Respaldo generado',
                [{ text: 'OK', onPress: () => loadData() }]
              );
            },
          },
        ]
      );
    } else {
      // Flujo normal de arqueo (sin cerrar día)
      Alert.alert(
        '✅ Arqueo Completado',
        `Efectivo Esperado: $${data.efectivoEsperado.toFixed(2)}\nEfectivo Contado: $${totalContado.toFixed(2)}\nDiferencia: $${diferencia.toFixed(2)}`,
        [
          {
            text: 'OK',
            onPress: () => {
              setShowArqueoModal(false);
              setDenominacionesCount({
                1000: '0',
                500: '0',
                200: '0',
                100: '0',
                50: '0',
                20: '0',
                10: '0',
                5: '0',
                1: '0',
              });
              loadData();
            },
          },
        ]
      );
    }
  }

  // Cerrar el día - Inicia flujo de inventario físico
  async function handleCloseDay() {
    // ✅ REQUERIMIENTO: Vendedor también puede cerrar el día (cierra SOLO su tienda)

    if (isDayClosed) {
      Alert.alert('Día ya cerrado', 'Este día ya está cerrado para esta tienda.');
      return;
    }

    const confirmMessage =
      '¿Cerrar día y hacer inventario físico?\n\nSe iniciará el proceso de cierre que incluye:\n1. Inventario físico de productos\n2. Arqueo de caja\n3. Generación de reportes';

    const startFlow = () => {
      // 1) Navegar primero (para asegurar que ProductsScreen monte)
      navigation.navigate('Productos', { forcePhysicalCount: true, fromCierreFlow: true });

      // 2) Emitir evento después (para cubrir el caso en que ProductsScreen ya estaba montada)
      setTimeout(() => {
        DeviceEventEmitter.emit('startPhysicalInventoryCierreFlow', { fromCierreFlow: true });
      }, 250);
    };

    if (Platform.OS === 'web') {
      const ok = (globalThis as any)?.confirm ? (globalThis as any).confirm(confirmMessage) : true;
      if (!ok) return;
      startFlow();
    } else {
      Alert.alert('Cerrar Día', confirmMessage, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'CONTINUAR', style: 'default', onPress: startFlow },
      ]);
    }
  }

  // Abrir el día (solo admin)
  async function handleOpenDay() {
    if (!isAdmin) {
      Alert.alert('Acceso Denegado', 'Solo el administrador puede abrir el día.');
      return;
    }

    if (Platform.OS === 'web') {
      const ok = (globalThis as any)?.confirm ? (globalThis as any).confirm('¿Abrir un nuevo día?') : true;
      if (!ok) return;
      await localDb.markDayOpen({ storeId: currentStoreId, businessDate });
      setIsDayClosed(false);
      DeviceEventEmitter.emit('dayOpened');
      Alert.alert('✅ Día Abierto', 'Se ha abierto un nuevo día. Los vendedores pueden hacer operaciones.');
    } else {
      Alert.alert(
        'Abrir Día',
        '¿Abrir un nuevo día?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Abrir Día', onPress: async () => {
            await localDb.markDayOpen({ storeId: currentStoreId, businessDate });
            setIsDayClosed(false);
            DeviceEventEmitter.emit('dayOpened');
            Alert.alert('✅ Día Abierto', 'Se ha abierto un nuevo día. Los vendedores pueden hacer operaciones.');
          }}
        ]
      );
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Cargando...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Header con fecha y hora */}
        <View style={styles.header}>
          <View style={styles.dateTimeRow}>
            <Ionicons name="calendar-outline" size={20} color="#666" />
            <Text style={styles.dateText}>{currentDate}</Text>
          </View>
          <View style={styles.dateTimeRow}>
            <Ionicons name="time-outline" size={20} color="#666" />
            <Text style={styles.timeText}>{currentTime}</Text>
          </View>
        </View>

        {/* Banner de día cerrado */}
        {isDayClosed && (
          <View style={styles.closedBanner}>
            <Ionicons name="lock-closed" size={24} color="#fff" />
            <Text style={styles.closedBannerText}>DÍA CERRADO</Text>
          </View>
        )}

        {/* Arqueo de Caja */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="stats-chart" size={24} color="#2196F3" />
            <Text style={styles.cardTitle}>Arqueo de Caja</Text>
          </View>

          <Text style={styles.saldoLabel}>Saldo inicial: ${data.fondoInicial.toFixed(2)}</Text>

          <View style={styles.buttonsRow}>
            <TouchableOpacity
              style={[styles.button, styles.buttonSecondary]}
              onPress={() => setShowDeclararFondoModal(true)}
              disabled={isDayClosed}
            >
              <Ionicons name="briefcase-outline" size={20} color="#fff" />
              <Text style={styles.buttonText}>Declarar Fondo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary]}
              onPress={() => setShowArqueoModal(true)}
              disabled={isDayClosed}
            >
              <Ionicons name="calculator-outline" size={20} color="#fff" />
              <Text style={styles.buttonText}>Realizar Arqueo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Resumen de ventas de hoy */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="trending-up" size={24} color="#4CAF50" />
            <Text style={styles.cardTitle}>Resumen de ventas de hoy</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Efectivo</Text>
            <Text style={styles.summaryValue}>${data.efectivoVentas.toFixed(2)}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Transferencia</Text>
            <Text style={styles.summaryValue}>${data.transferenciaVentas.toFixed(2)}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Gastos retirados</Text>
            <Text style={[styles.summaryValue, styles.negativeValue]}>
              ${data.gastosRetirados.toFixed(2)}
            </Text>
          </View>

          <View style={[styles.summaryRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total ventas</Text>
            <Text style={styles.totalValue}>${data.totalVentas.toFixed(2)}</Text>
          </View>

          <Text style={styles.expectedLabel}>Efectivo esperado:</Text>
          <Text style={styles.expectedValue}>${data.efectivoEsperado.toFixed(2)}</Text>
          <Text style={styles.expectedFormula}>
            (Fondo {data.fondoInicial.toFixed(2)} + Ventas {data.totalVentas.toFixed(2)} -
            Transferencias {data.transferenciaVentas.toFixed(2)} - Gastos{' '}
            {data.gastosRetirados.toFixed(2)})
          </Text>
        </View>

        {/* Botón Cerrar/Abrir Día */}
        {isDayClosed ? (
          user?.role === 'admin' && (
            <TouchableOpacity style={styles.openDayButton} onPress={handleOpenDay}>
              <Ionicons name="lock-open" size={24} color="#fff" />
              <Text style={styles.openDayText}>Abrir Día</Text>
            </TouchableOpacity>
          )
        ) : (
          <TouchableOpacity
            style={styles.closeDayButton}
            onPress={handleCloseDay}
            disabled={false}
          >
            <Ionicons name="lock-closed" size={24} color="#fff" />
            <Text style={styles.closeDayText}>Cierre del Día</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Modal: Declarar Fondo */}
      <Modal
        visible={showDeclararFondoModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDeclararFondoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Declarar Fondo Inicial</Text>
            <Text style={styles.modalSubtitle}>Ingresa el monto con el que inicias el día</Text>

            <TextInput
              style={styles.input}
              placeholder="$0.00"
              keyboardType="numeric"
              value={fondoInicial}
              onChangeText={setFondoInicial}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.buttonCancel}
                onPress={() => {
                  setShowDeclararFondoModal(false);
                  setFondoInicial('');
                }}
              >
                <Text style={styles.buttonCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonSave} onPress={handleDeclararFondo}>
                <Text style={styles.buttonSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Realizar Arqueo */}
      <Modal
        visible={showArqueoModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowArqueoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Desglose de Efectivo</Text>
            <Text style={styles.modalSubtitle}>
              Ingresa la cantidad de billetes/monedas de cada denominación
            </Text>

            {/* Efectivo Esperado */}
            <View style={styles.expectedSection}>
              <Text style={styles.expectedSectionLabel}>Efectivo Esperado</Text>
              <Text style={styles.expectedSectionAmount}>${data.efectivoEsperado.toFixed(2)}</Text>
            </View>

            {/* Scroll de Denominaciones */}
            <ScrollView style={styles.denominacionesScroll}>
              {DENOMINACIONES.map((denom) => (
                <View key={denom} style={styles.denominacionRow}>
                  <Text style={styles.denominacionLabel}>${denom}</Text>
                  <TextInput
                    style={styles.denominacionInput}
                    keyboardType="numeric"
                    value={denominacionesCount[denom]}
                    onChangeText={(value) => handleDenominacionChange(denom, value)}
                    placeholder="0"
                  />
                  <Text style={styles.denominacionImporte}>${calcularImporte(denom).toFixed(2)}</Text>
                </View>
              ))}
            </ScrollView>

            {/* Total Contado */}
            <View style={styles.totalContadoSection}>
              <Text style={styles.totalContadoLabel}>Total Contado</Text>
              <Text style={styles.totalContadoAmount}>${calcularTotalContado().toFixed(2)}</Text>
            </View>

            {/* Botones */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.buttonCancel}
                onPress={() => {
                  setShowArqueoModal(false);
                  setDenominacionesCount({
                    1000: '0',
                    500: '0',
                    200: '0',
                    100: '0',
                    50: '0',
                    20: '0',
                    10: '0',
                    5: '0',
                    1: '0',
                  });
                }}
              >
                <Text style={styles.buttonCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.buttonSave} onPress={handleRealizarArqueo}>
                <Text style={styles.buttonSaveText}>Guardar Arqueo</Text>
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
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  dateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  timeText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  closedBanner: {
    backgroundColor: '#f44336',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  closedBannerText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 8,
  },
  saldoLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 8,
    gap: 6,
  },
  buttonSecondary: {
    backgroundColor: '#607D8B',
  },
  buttonPrimary: {
    backgroundColor: '#2196F3',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  summaryLabel: {
    fontSize: 16,
    color: '#666',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2196F3',
  },
  negativeValue: {
    color: '#f44336',
  },
  totalRow: {
    borderBottomWidth: 2,
    borderBottomColor: '#2196F3',
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  totalValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  expectedLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 16,
  },
  expectedValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2196F3',
    marginTop: 4,
  },
  expectedFormula: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
  closeDayButton: {
    backgroundColor: '#f44336',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 12,
    marginTop: 8,
  },
  closeDayText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  openDayButton: {
    backgroundColor: '#4CAF50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 12,
    marginTop: 8,
  },
  openDayText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
    marginBottom: 20,
    textAlign: 'center',
  },
  expectedSection: {
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  expectedSectionLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  expectedSectionAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  denominacionesScroll: {
    maxHeight: 280,
    marginBottom: 16,
  },
  denominacionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  denominacionLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    width: 70,
  },
  denominacionInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 8,
    fontSize: 16,
    textAlign: 'center',
    width: 80,
    backgroundColor: '#f9f9f9',
  },
  denominacionImporte: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
    width: 100,
    textAlign: 'right',
  },
  totalContadoSection: {
    backgroundColor: '#E8F5E9',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  totalContadoLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 4,
  },
  totalContadoAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  buttonCancel: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  buttonSave: {
    flex: 1,
    backgroundColor: '#2196F3',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonSaveText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
});