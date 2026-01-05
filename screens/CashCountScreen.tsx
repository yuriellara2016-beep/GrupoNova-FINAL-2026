import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useAuth } from '../lib/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { exportDatabaseAsJSON } from '../lib/db';
import { exportStorageSnapshot } from '../lib/storage';
import { exportJSONFile } from '../lib/file';
import { useStore } from '../lib/useStore';
import { Directory, Paths } from 'expo-file-system';

type RouteParams = {
  CashCount: {
    isClosing?: boolean;
  };
};

interface Denomination {
  value: number;
  count: number;
  label: string;
}

const CashCountScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'CashCount'>>();
  const { currentUser, businessDate, closeBusinessDay } = useAuth();
  const { currentStore, stores } = useStore();
  
  const isClosing = route.params?.isClosing || false;

  const [denominations, setDenominations] = useState<Denomination[]>([
    { value: 100000, count: 0, label: '$100.000' },
    { value: 50000, count: 0, label: '$50.000' },
    { value: 20000, count: 0, label: '$20.000' },
    { value: 10000, count: 0, label: '$10.000' },
    { value: 5000, count: 0, label: '$5.000' },
    { value: 2000, count: 0, label: '$2.000' },
    { value: 1000, count: 0, label: '$1.000' },
    { value: 500, count: 0, label: '$500' },
    { value: 200, count: 0, label: '$200' },
    { value: 100, count: 0, label: '$100' },
    { value: 50, count: 0, label: '$50' },
    { value: 10, count: 0, label: '$10' },
    { value: 5, count: 0, label: '$5' },
  ]);

  const [expectedCash, setExpectedCash] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadExpectedCash();
  }, []);

  const loadExpectedCash = async () => {
    try {
      const salesJson = await AsyncStorage.getItem('@sales');
      const expensesJson = await AsyncStorage.getItem('@expenses');
      
      let totalSales = 0;
      let totalExpenses = 0;

      if (salesJson) {
        const sales = JSON.parse(salesJson);
        totalSales = sales
          .filter((s: any) => s.paymentMethod === 'cash' && s.date === businessDate?.date)
          .reduce((sum: number, s: any) => sum + s.total, 0);
      }

      if (expensesJson) {
        const expenses = JSON.parse(expensesJson);
        totalExpenses = expenses
          .filter((e: any) => e.date === businessDate?.date)
          .reduce((sum: number, e: any) => sum + e.amount, 0);
      }

      setExpectedCash(totalSales - totalExpenses);
    } catch (error) {
      console.error('Error loading expected cash:', error);
    }
  };

  const updateCount = (index: number, value: string) => {
    const numValue = parseInt(value) || 0;
    setDenominations((prev) =>
      prev.map((denom, i) =>
        i === index ? { ...denom, count: numValue } : denom
      )
    );
  };

  const calculateTotal = () => {
    return denominations.reduce((sum, denom) => sum + denom.value * denom.count, 0);
  };

  const createAutomaticBackup = async () => {
    try {
      const json = await exportDatabaseAsJSON();
      const parsed = JSON.parse(json);
      const storage = await exportStorageSnapshot();
      
      // Create automatic backup with timestamp
      const payload = { 
        ...parsed, 
        storage,
        _exportMetadata: {
          isAutomaticBackup: true,
          storeName: currentStore?.name || 'Desconocido',
          storeId: currentStore?.id,
          exportedAt: new Date().toISOString(),
          businessDate: businessDate?.date,
          autoBackupReason: 'Cierre de día automático'
        }
      };
      
      const sanitizedStoreName = (currentStore?.name || 'salva').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      const filename = `salva_auto_${sanitizedStoreName}_${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.json`;
      
      await exportJSONFile(filename, payload);
      console.log('✅ Respaldo automático creado:', filename);
    } catch (e: any) {
      console.warn('⚠️ No se pudo crear el respaldo automático:', e?.message || e);
      // No bloqueamos el cierre si falla el backup
    }
  };

  const handleSave = async () => {
    if (!currentUser || !businessDate) {
      Alert.alert('Error', 'No hay usuario o fecha de negocio activa');
      return;
    }

    setIsSaving(true);

    try {
      const countedCash = calculateTotal();
      const difference = countedCash - expectedCash;

      const arqueoData = {
        id: Date.now().toString(),
        date: businessDate.date,
        userId: currentUser.id,
        userName: currentUser.name,
        expectedCash,
        countedCash,
        difference,
        denominations,
        timestamp: new Date().toISOString(),
      };

      const arqueosJson = await AsyncStorage.getItem('@arqueos');
      const arqueos = arqueosJson ? JSON.parse(arqueosJson) : [];
      arqueos.push(arqueoData);
      await AsyncStorage.setItem('@arqueos', JSON.stringify(arqueos));

      if (isClosing) {
        const auditReport = generateAuditReport(arqueoData);
        await saveAuditReport(auditReport);
        
        // Crear respaldo automático antes de cerrar el día
        await createAutomaticBackup();
        
        await closeBusinessDay();
        
        Alert.alert(
          'Día Cerrado',
          `Arqueo guardado.\nEfectivo esperado: $${expectedCash.toLocaleString()}\nEfectivo contado: $${countedCash.toLocaleString()}\nDiferencia: $${difference.toLocaleString()}\n\n✅ Respaldo automático creado\n\nEl día de trabajo ha sido cerrado.`,
          [
            {
              text: 'OK',
              onPress: () => navigation.navigate('Home'),
            },
          ]
        );
      } else {
        Alert.alert('Éxito', 'Arqueo guardado correctamente');
        navigation.goBack();
      }
    } catch (error) {
      Alert.alert('Error', 'No se pudo guardar el arqueo');
    } finally {
      setIsSaving(false);
    }
  };

  const generateAuditReport = (arqueoData: any) => {
    let report = `REPORTE DE ARQUEO DE CAJA\n`;
    report += `Fecha: ${arqueoData.date}\n`;
    report += `Usuario: ${arqueoData.userName}\n`;
    report += `Hora: ${new Date().toLocaleString()}\n`;
    report += `\n${'='.repeat(50)}\n\n`;
    
    report += `EFECTIVO ESPERADO: $${arqueoData.expectedCash.toLocaleString()}\n`;
    report += `EFECTIVO CONTADO: $${arqueoData.countedCash.toLocaleString()}\n`;
    report += `DIFERENCIA: $${arqueoData.difference.toLocaleString()}\n\n`;
    
    report += `DETALLE DE DENOMINACIONES:\n`;
    report += `${'-'.repeat(50)}\n`;
    
    arqueoData.denominations.forEach((denom: Denomination) => {
      if (denom.count > 0) {
        const total = denom.value * denom.count;
        report += `${denom.label} x ${denom.count} = $${total.toLocaleString()}\n`;
      }
    });

    return report;
  };

  const saveAuditReport = async (report: string) => {
    try {
      const fileName = `auditoria_arqueo_${new Date().getTime()}.txt`;

      const auditsDir = new Directory(Paths.document, 'auditorias');
      auditsDir.create({ intermediates: true, idempotent: true });

      const auditFile = auditsDir.createFile(fileName, 'text/plain');
      auditFile.write(report);

      const audits = await AsyncStorage.getItem('@audit_reports');
      const auditList = audits ? JSON.parse(audits) : [];
      auditList.push({
        id: Date.now().toString(),
        type: 'cash_count',
        fileName,
        filePath: auditFile.uri,
        date: new Date().toISOString(),
        userId: currentUser?.id,
      });
      await AsyncStorage.setItem('@audit_reports', JSON.stringify(auditList));
    } catch (error) {
      console.error('Error saving audit report:', error);
    }
  };

  const countedCash = calculateTotal();
  const difference = countedCash - expectedCash;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>
        {isClosing ? 'Arqueo de Caja - Cierre' : 'Arqueo de Caja'}
      </Text>
      <Text style={styles.subtitle}>Fecha: {businessDate?.date}</Text>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Efectivo Esperado:</Text>
        <Text style={styles.summaryValue}>${expectedCash.toLocaleString()}</Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Efectivo Contado:</Text>
        <Text style={styles.summaryValue}>${countedCash.toLocaleString()}</Text>
      </View>

      {difference !== 0 && (
        <View style={[styles.summaryCard, difference > 0 ? styles.positive : styles.negative]}>
          <Text style={styles.summaryLabel}>Diferencia:</Text>
          <Text style={styles.summaryValue}>
            {difference > 0 ? '+' : ''}${difference.toLocaleString()}
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Denominaciones</Text>

      {denominations.map((denom, index) => (
        <View key={index} style={styles.denominationRow}>
          <Text style={styles.denominationLabel}>{denom.label}</Text>
          <TextInput
            style={styles.input}
            value={denom.count.toString()}
            onChangeText={(value) => updateCount(index, value)}
            keyboardType="numeric"
            placeholder="0"
          />
          <Text style={styles.denominationTotal}>
            ${(denom.value * denom.count).toLocaleString()}
          </Text>
        </View>
      ))}

      <TouchableOpacity 
        style={[styles.button, isSaving ? styles.buttonDisabled : null]}
        onPress={handleSave}
        disabled={isSaving}
      >
        <Text style={styles.buttonText}>
          {isSaving ? 'Guardando...' : isClosing ? 'Guardar y Cerrar Día' : 'Guardar Arqueo'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    color: '#666',
  },
  summaryCard: {
    backgroundColor: '#fff',
    padding: 15,
    marginBottom: 10,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  summaryLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  positive: {
    backgroundColor: '#E8F5E9',
  },
  negative: {
    backgroundColor: '#FFEBEE',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 15,
  },
  denominationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  denominationLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 8,
    width: 70,
    textAlign: 'center',
    fontSize: 16,
    marginHorizontal: 10,
  },
  denominationTotal: {
    width: 120,
    textAlign: 'right',
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 40,
  },
  buttonDisabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default CashCountScreen;