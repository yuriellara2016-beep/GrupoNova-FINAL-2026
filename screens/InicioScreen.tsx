import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, DeviceEventEmitter } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import * as db from '../lib/db';
import { isoToDate, pad } from '../lib/date';

// Función para formatear fecha en formato dd-mm-yyyy (SIN usar fecha del dispositivo como fallback)
const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '--';

  const date = isoToDate(dateString);
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
};

interface DashboardScreenProps {
  navigation?: any;
}

export default function DashboardScreen({ navigation }: DashboardScreenProps) {
  const { user, logout, businessDate, stores } = useAuth();
  
  // Estados para las tarjetas
  const [totalSales, setTotalSales] = useState(0);
  const [totalTickets, setTotalTickets] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);

  // Función para cargar los datos del resumen
  const loadSummaryData = useCallback(async () => {
    try {
      // Obtener el storeId del usuario actual
      const storeId = user?.storeId;
      const userId = user?.id;

      // Si no hay fecha de trabajo activa, no mostramos totales (evita usar fecha del dispositivo como fallback)
      const baseIso = typeof businessDate === 'string' ? businessDate.slice(0, 10) : '';
      if (!baseIso) {
        setTotalSales(0);
        setTotalTickets(0);
        setTotalExpenses(0);
        // Bajo stock no depende de fecha
        const products = await db.getProducts();
        const lowStock = products.filter((p) => {
          const minStock = 5;
          return (p.quantity || 0) < minStock;
        });
        setLowStockCount(lowStock.length);
        return;
      }

      const getRowIsoBusinessDay = (row: any): string => {
        const biz = typeof row?.businessDate === 'string' ? row.businessDate.slice(0, 10) : '';
        if (biz) return biz;
        const created = typeof row?.createdAt === 'string' ? row.createdAt.slice(0, 10) : '';
        return created;
      };

      // Ventas totales y cantidad de tickets (filtradas por businessDate)
      const salesFilter = user?.role === 'admin' ? {} : { storeId, userId };
      const sales = await db.getSales(salesFilter);
      const activeSales = sales.filter((s: any) => s.status !== 'cancelled');

      // Filtrar ventas por fecha de trabajo (businessDate)
      const todaySales = activeSales.filter((s: any) => getRowIsoBusinessDay(s) === baseIso);
      const salesTotal = todaySales.reduce((sum: number, sale: any) => sum + (sale.total || 0), 0);
      const ticketsCount = todaySales.length;

      // Gastos totales (filtrados por businessDate)
      // IMPORTANTE: los gastos son de la TIENDA. Algunos gastos (p.ej. gastos manuales creados por admin,
      // comisiones u otros procesos) pueden tener userId null o distinto al usuario actual.
      // Por eso, en Inicio filtramos por storeId (tienda) y NO por userId.
      const expensesFilter = user?.role === 'admin' ? {} : { storeId };
      const expenses = await db.getExpenses(expensesFilter);

      // Filtrar gastos por fecha de trabajo (businessDate)
      const todayExpenses = expenses.filter((e: any) => getRowIsoBusinessDay(e) === baseIso);
      const expensesTotal = todayExpenses.reduce((sum: number, exp: any) => sum + (exp.amount || 0), 0);

      // Productos con bajo stock (esto no depende de la fecha)
      const products = await db.getProducts();
      const lowStock = products.filter((p) => {
        const minStock = 5; // Valor mínimo por defecto
        return (p.quantity || 0) < minStock;
      });

      setTotalSales(salesTotal);
      setTotalTickets(ticketsCount);
      setTotalExpenses(expensesTotal);
      setLowStockCount(lowStock.length);
    } catch (error) {
      console.error('Error loading summary data:', error);
    }
  }, [user, businessDate]);

  // Cargar datos al montar el componente
  useEffect(() => {
    loadSummaryData();

    // Escuchar eventos para actualizar automáticamente
    const saleListener = DeviceEventEmitter.addListener('saleCreated', loadSummaryData);
    const expenseListener = DeviceEventEmitter.addListener('expenseCreated', loadSummaryData);
    const saleCancelledListener = DeviceEventEmitter.addListener('saleCancelled', loadSummaryData);

    return () => {
      saleListener.remove();
      expenseListener.remove();
      saleCancelledListener.remove();
    };
  }, [loadSummaryData]);

  // Obtener el nombre de la tienda del usuario actual
  const getStoreName = () => {
    if (user?.role === 'admin') {
      return 'Grupo Nova S.R.L';
    }
    const store = stores.find(s => s.id === user?.storeId);
    return store?.name || 'Grupo Nova S.R.L';
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <View style={styles.container}>
      {/* Header azul */}
      <View style={styles.header}>
        <SafeAreaView edges={['top']} style={styles.safeArea}>
          <View style={styles.headerContent}>
            {/* Icono y información del usuario */}
            <View style={styles.userSection}>
              <View style={styles.iconContainer}>
                <Ionicons name="shield-outline" size={40} color="#fff" />
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{user?.name || 'Usuario'}</Text>
                <Text style={styles.companyName}>{getStoreName()}</Text>
                <Text style={styles.workingDate}>{formatDate(businessDate)}</Text>
              </View>
            </View>

            {/* Botón de cerrar sesión */}
            <TouchableOpacity 
              style={styles.logoutButton}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={32} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      {/* Contenido principal */}
      <View style={styles.content}>
        {/* Título */}
        <View style={styles.titleContainer}>
          <Text style={styles.titleIcon}>📊</Text>
          <Text style={styles.title}>Resumen del Día</Text>
        </View>

        {/* Grid de tarjetas 2x2 */}
        <View style={styles.grid}>
          {/* Tarjeta de Ventas - Verde */}
          <TouchableOpacity 
            style={[styles.card, styles.cardGreen]}
            onPress={() => navigation?.navigate?.('Ventas')}
          >
            <Text style={styles.cardIcon}>💰</Text>
            <Text style={styles.cardValue}>${totalSales.toFixed(2)}</Text>
            <Text style={styles.cardLabel}>Ventas</Text>
          </TouchableOpacity>

          {/* Tarjeta de Tickets - Azul */}
          <TouchableOpacity 
            style={[styles.card, styles.cardBlue]}
            onPress={() => navigation?.navigate?.('Ventas')}
          >
            <Text style={styles.cardIcon}>🧾</Text>
            <Text style={styles.cardValue}>{totalTickets}</Text>
            <Text style={styles.cardLabel}>Tickets</Text>
          </TouchableOpacity>

          {/* Tarjeta de Gastos - Rojo */}
          <TouchableOpacity 
            style={[styles.card, styles.cardRed]}
            onPress={() => navigation?.navigate?.('Gastos')}
          >
            <Text style={styles.cardIcon}>💸</Text>
            <Text style={styles.cardValue}>${totalExpenses.toFixed(2)}</Text>
            <Text style={styles.cardLabel}>Gastos</Text>
          </TouchableOpacity>

          {/* Tarjeta de Bajo Stock - Naranja */}
          <TouchableOpacity 
            style={[styles.card, styles.cardOrange]}
            onPress={() => navigation?.navigate?.('Productos')}
          >
            <Text style={styles.cardIcon}>⚠️</Text>
            <Text style={styles.cardValue}>{lowStockCount}</Text>
            <Text style={styles.cardLabel}>Bajo Stock</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    backgroundColor: '#2196F3',
  },
  safeArea: {
    backgroundColor: 'transparent',
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '400',
    marginBottom: 2,
  },
  companyName: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
  },
  workingDate: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '400',
  },
  logoutButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  cardGreen: {
    backgroundColor: '#4CAF50',
  },
  cardBlue: {
    backgroundColor: '#2196F3',
  },
  cardRed: {
    backgroundColor: '#F44336',
  },
  cardOrange: {
    backgroundColor: '#FF9800',
  },
  cardIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  cardValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  cardLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
});