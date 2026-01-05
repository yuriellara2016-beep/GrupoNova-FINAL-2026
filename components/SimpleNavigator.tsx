import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import { useAuthSafe } from '../hooks/useAuth';
import { DeviceEventEmitter } from 'react-native';

import InicioScreen from '../screens/InicioScreen';
import SalesScreen from '../screens/SalesScreen';
import CashScreen from '../screens/CashScreen';
import InventoryScreen from '../screens/InventoryScreen';
import ProductsScreen from '../screens/ProductsScreen';
import ReportsScreen from '../screens/ReportsScreen';
import ExpensesScreen from '../screens/ExpensesScreen';
import ManageUsersScreen from '../screens/ManageUsersScreen';
import BackupScreen from '../screens/BackupScreen';
import ProductClassifierScreen from '../screens/ProductClassifierScreen';
import TransfersScreen from '../screens/TransfersScreen';
import AuditoriaScreen from '../screens/AuditoriaScreen';

type TabName = 'home' | 'sales' | 'cash' | 'inventory' | 'products' | 'reports' | 'expenses' | 'users' | 'backup' | 'classifier' | 'transfers' | 'auditoria';

interface Tab {
  name: TabName;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  component: React.ComponentType<any>;
}

const ALL_TABS: Tab[] = [
  { name: 'home', label: 'Inicio', icon: 'home', component: InicioScreen },
  { name: 'sales', label: 'Ventas', icon: 'cart', component: SalesScreen },
  { name: 'cash', label: 'Caja', icon: 'cash', component: CashScreen },
  { name: 'inventory', label: 'Inventario', icon: 'layers', component: InventoryScreen },
  { name: 'products', label: 'Productos', icon: 'pricetag', component: ProductsScreen },
  { name: 'classifier', label: 'Clasificador', icon: 'pricetags', component: ProductClassifierScreen },
  { name: 'transfers', label: 'Transferencias', icon: 'swap-horizontal', component: TransfersScreen },
  { name: 'reports', label: 'Reportes', icon: 'stats-chart', component: ReportsScreen },
  { name: 'auditoria', label: 'Auditoría', icon: 'document-text', component: AuditoriaScreen },
  { name: 'expenses', label: 'Gastos', icon: 'trending-down', component: ExpensesScreen },
  { name: 'users', label: 'Usuarios', icon: 'people', component: ManageUsersScreen },
  { name: 'backup', label: 'Respaldo', icon: 'cloud-upload', component: BackupScreen },
];

export default function SimpleNavigator() {
  const { user } = useAuthSafe();
  const [activeTab, setActiveTab] = useState<TabName>('home');

  const navigationShim = useMemo(() => {
    const normalize = (name: string) => (name || '').trim().toLowerCase();

    const routeToTab: Record<string, TabName> = {
      home: 'home',
      inicio: 'home',

      sales: 'sales',
      ventas: 'sales',

      cash: 'cash',
      caja: 'cash',

      inventory: 'inventory',
      inventario: 'inventory',

      products: 'products',
      productos: 'products',

      reports: 'reports',
      reportes: 'reports',

      expenses: 'expenses',
      gastos: 'expenses',

      users: 'users',
      usuarios: 'users',

      backup: 'backup',
      respaldo: 'backup',

      classifier: 'classifier',
      clasificador: 'classifier',

      transfers: 'transfers',
      transferencias: 'transfers',

      auditoria: 'auditoria',
      'auditoría': 'auditoria',
    };

    const navigate = (routeName: string, params?: any) => {
      const key = normalize(routeName);
      const tab = routeToTab[key];
      if (!tab) return;

      setActiveTab(tab);

      // Handle special navigation with params for Caja (Cash) screen
      if (tab === 'cash' && params && params.openArqueo) {
        setTimeout(() => {
          try {
            DeviceEventEmitter.emit('openArqueoFromCierre', {
              fromCierreFlow: params.fromCierreFlow || false
            });
          } catch {}
        }, 200);
      }

      // Handle special navigation with params for Productos (Products) screen
      if (tab === 'products' && params && params.forcePhysicalCount) {
        setTimeout(() => {
          try {
            DeviceEventEmitter.emit('startPhysicalInventoryCierreFlow', {
              fromCierreFlow: params.fromCierreFlow || false
            });
          } catch {}
        }, 300);
      }
    };

    return {
      navigate,
      goBack: () => {},
      setParams: () => {},
    };
  }, []);

  const visibleTabs = useMemo(() => {
    if (user?.role === 'seller') {
      // Sellers see home, sales, cash, products, classifier, backup, expenses
      return ALL_TABS.filter((t) => ['home', 'sales', 'cash', 'products', 'classifier', 'backup', 'expenses'].includes(t.name));
    }
    // Admins see everything including transfers, reports, and auditoria
    return ALL_TABS;
  }, [user?.role]);

  // Ensure activeTab is always permitted when role changes
  useEffect(() => {
    if (!visibleTabs.find((t) => t.name === activeTab)) {
      setActiveTab('home');
    }
  }, [visibleTabs, activeTab]);

  // Listen for cierre flow requests from products to go to cash and open arqueo (web/simple navigator)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('goToCashFromCierre', () => {
      setActiveTab('cash');
      // After CashScreen mounts, emit event so it opens the arqueo modal and marks cierre flow
      setTimeout(() => {
        try { DeviceEventEmitter.emit('openArqueoFromCierre'); } catch {}
      }, 200);
    });
    return () => { try { sub.remove(); } catch {} };
  }, []);

  const ActiveComponent = (visibleTabs.find((tab) => tab.name === activeTab) || visibleTabs[0] || ALL_TABS[0]).component;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.screenContainer}>
        <ActiveComponent
          navigateTo={(tab: TabName) => setActiveTab(tab)}
          onNavigate={(tab: TabName) => setActiveTab(tab)}
          navigation={navigationShim}
        />
      </View>

      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBarContent}
        >
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.name;
            return (
              <TouchableOpacity
                key={tab.name}
                style={[styles.tabButton, isActive && styles.tabButtonActive]}
                onPress={() => setActiveTab(tab.name)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={tab.icon}
                  size={20}
                  color={isActive ? theme.colors.primary : theme.colors.outline}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  screenContainer: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.outline,
    ...theme.shadows.medium,
  },
  tabBarContent: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.xs,
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    minWidth: 70,
    gap: 4,
  },
  tabButtonActive: {
    backgroundColor: `${theme.colors.primary}15`,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: theme.colors.outline,
  },
  tabLabelActive: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
});