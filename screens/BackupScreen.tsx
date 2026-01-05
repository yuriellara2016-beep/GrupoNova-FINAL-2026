import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform, ActivityIndicator, DeviceEventEmitter } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { resetDatabaseClean } from '../lib/db';
import * as localDb from '../lib/localDb';
import { exportDatabaseAsJSON, importDatabaseFromJSON } from '../lib/db';
import { exportJSONFile, importJSONFile } from '../lib/file';
import { exportStorageSnapshot, importStorageSnapshot } from '../lib/storage';
import { useStore } from '../lib/useStore';
import { useAuthSafe } from '../hooks/useAuth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DayStatusBanner from '../components/DayStatusBanner';

export default function BackupScreen() {
  const [importing, setImporting] = useState(false);
  const { currentStore, isAdmin, stores, currentStoreId } = useStore();
  const auth = useAuthSafe();
  const [selectedStoreForExport, setSelectedStoreForExport] = useState<string | null>(null);

  function getFriendlyImportErrorMessage(err: any): string {
    const raw = (err && typeof err === 'object' && 'message' in err) ? String((err as any).message) : String(err);
    const msg = raw || 'Error desconocido';

    // Common Hermes/JSC message when trying to iterate a non-array.
    if (msg.includes('iterator method is not callable') || msg.includes('is not iterable')) {
      return (
        'La salva parece estar en un formato antiguo o está dañada.\n\n' +
        'Recomendación: genera una nueva salva desde la misma versión de la app y vuelve a importarla.'
      );
    }

    if (msg.toLowerCase().includes('json') || msg.toLowerCase().includes('parse')) {
      return (
        'No se pudo leer el archivo. Parece no ser un JSON válido o está incompleto.\n\n' +
        'Asegúrate de seleccionar un archivo .json exportado por la app.'
      );
    }

    return msg;
  }

  // Request storage/media permissions on Android so that the file picker and exports work reliably.
  async function requestStoragePermissions() {
    if (Platform.OS !== 'android') return;
    try {
      const MediaLibraryModule = await import('expo-media-library');
      const MediaLibrary: any = (MediaLibraryModule as any).default ?? MediaLibraryModule;
      if (!MediaLibrary?.requestPermissionsAsync) {
        console.warn('MediaLibrary module loaded but requestPermissionsAsync is not available');
        return;
      }
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        console.warn('Storage permission not granted');
      }
    } catch (e) {
      console.warn('Cannot request media library permissions:', e);
    }
  }

  async function handleClearAll() {
    Alert.alert(
      'Confirmar',
      `Se eliminarán todos los datos transaccionales del punto de venta "${currentStore?.name || 'actual'}" (ventas, gastos, sesiones, transferencias, inventarios físicos). ¿Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', style: 'destructive', onPress: async () => {
          try {
            await resetDatabaseClean();
            
            // Clear transfer requests and physical inventory history
            try {
              await AsyncStorage.removeItem('arqueoHistory:list');
              await AsyncStorage.removeItem('inventoryHistory:list');
              
              // Clear daily arqueo and inventory records
              const keys = await AsyncStorage.getAllKeys();
              const keysToRemove = keys.filter((k: string) => 
                k.startsWith('arqueo:') || 
                k.startsWith('inventory:') || 
                k.startsWith('closedDay:')
              );
              if (keysToRemove.length > 0) {
                await AsyncStorage.multiRemove(keysToRemove);
              }
            } catch (e) {
              console.warn('Error clearing storage history:', e);
            }
            
            Alert.alert('Éxito', `Datos de "${currentStore?.name || 'punto de venta'}" limpiados (incluye transferencias e inventarios físicos)`);
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Error al limpiar');
          }
        }}
      ]
    );
  }

  async function handleExportarSalva() {
    try {
      await requestStoragePermissions();
      
      // Determine which store to export
      const storeToExport = isAdmin && selectedStoreForExport ? selectedStoreForExport : currentStoreId;
      const storeInfo = stores.find(s => s.id === storeToExport);
      
      if (!storeToExport) {
        Alert.alert('Error', 'No hay punto de venta seleccionado. Asigna un punto de venta primero.');
        return;
      }
      
      const json = await exportDatabaseAsJSON();
      const parsed = JSON.parse(json);
      const storage = await exportStorageSnapshot();
      
      // Add storeId to the export to isolate per store
      const payload = { 
        ...parsed, 
        storage,
        _exportMetadata: {
          storeId: storeToExport,
          storeName: storeInfo?.name || 'Desconocido',
          exportedAt: new Date().toISOString()
        }
      };
      
      const sanitizedStoreName = (storeInfo?.name || 'salva').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      const filename = `salva_${sanitizedStoreName}_${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.json`;
      
      await exportJSONFile(filename, payload);
      Alert.alert('Listo', `Archivo guardado en Descargas:\n"${filename}"\n\nPuedes compartirlo por WhatsApp, Email, Bluetooth, etc.`);
    } catch (e: any) {
      console.error('Export error:', e);
      Alert.alert('Error', 'No se pudo exportar la salva: ' + (e?.message || e));
    }
  }

  async function handleImportarSalva() {
    try {
      await requestStoragePermissions();
      // Support selecting JSON or SQLite DB backups
      const { pickBackupFile } = await import('../lib/file');
      const storeToImport = isAdmin && selectedStoreForExport ? selectedStoreForExport : currentStoreId;
      const storeInfo = stores.find(s => s.id === storeToImport);
      const sanitizedStoreName = (storeInfo?.name || 'salva').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
      const picked = await pickBackupFile({ mode: Platform.OS === 'android' ? 'auto-store' : 'picker', sanitizedStoreName });

      if (!picked) {
        // El usuario canceló el selector o no se pudo leer el archivo seleccionado
        Alert.alert(
          'Importación cancelada',
          'No se seleccionó ningún archivo. Vuelve a intentar y elige una salva (.json o .db/.sqlite) desde tu gestor de archivos.'
        );
        return;
      }

      // JSON backup flow (previous behavior)
      if (picked.kind === 'json') {
        const data: any = picked.data;
        // Validate storeId in import file
        const importedStoreId = data?._exportMetadata?.storeId;
        const importedStoreName = data?._exportMetadata?.storeName || 'Desconocido';
        
        if (!importedStoreId) {
          Alert.alert('Advertencia', 'Este archivo no contiene información del punto de venta. Se importará de todas formas, pero recomendamos usar salvaguardas recientes.');
        }
        
        if (importedStoreId && importedStoreId !== currentStoreId && !isAdmin) {
          Alert.alert('Error', `Esta salva es del punto de venta "${importedStoreName}" pero tú estás trabajando en "${currentStore?.name || 'otro punto de venta'}". Solo administradores pueden importar salvaguardas de otros puntos de venta.`);
          return;
        }

        if (Platform.OS === 'web') {
          const ok = (globalThis as any).confirm?.(`Esto sobrescribirá los datos del punto de venta "${currentStore?.name || 'actual'}" con el contenido del archivo ${importedStoreName ? `de "${importedStoreName}"` : 'seleccionado'}. ¿Continuar?`);
          if (!ok) return;
          try {
            setImporting(true);
            await importDatabaseFromJSON(JSON.stringify(data));
            if (data.storage) {
              await importStorageSnapshot(data.storage);
            }
            try { DeviceEventEmitter.emit('databaseImported'); } catch (_) {}
            Alert.alert('Éxito', `Salva de "${importedStoreName}" importada correctamente`);
          } catch (err: any) {
            console.error('Import error', err);
            Alert.alert('Error', 'No se pudo importar la salva:\n\n' + getFriendlyImportErrorMessage(err));
          } finally {
            setImporting(false);
          }
          return;
        }

        Alert.alert(
          'Importar Salva',
          `Esto sobrescribirá los datos del punto de venta "${currentStore?.name || 'actual'}" con el contenido del archivo ${importedStoreName ? `de "${importedStoreName}"` : 'seleccionado'}. ¿Continuar?`,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Importar', style: 'destructive', onPress: async () => {
              try {
                setImporting(true);
                await importDatabaseFromJSON(JSON.stringify(data));
                if (data.storage) {
                  await importStorageSnapshot(data.storage);
                }
                try { DeviceEventEmitter.emit('databaseImported'); } catch (_) {}
                Alert.alert('Éxito', `Salva de "${importedStoreName}" importada correctamente`);
              } catch (err: any) {
                console.error('Import error', err);
                Alert.alert('Error', 'No se pudo importar la salva:\n\n' + getFriendlyImportErrorMessage(err));
              } finally {
                setImporting(false);
              }
            }}
          ]
        );
        return;
      }

      // SQLite DB backup flow
      if (picked.kind === 'sqlite') {
        const dbName = picked.name || 'base de datos';
        if (Platform.OS === 'web') {
          Alert.alert('No soportado en web', 'La importación de archivos .db/.sqlite no está disponible en web. Usa un respaldo .json.');
          return;
        }
        const okMsg = `Esto reemplazará completamente la base de datos local con el archivo "${dbName}". Se cerrarán sesiones y se recargará el contenido. ¿Continuar?`;
        Alert.alert(
          'Restaurar Base de Datos',
          okMsg,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Reemplazar', style: 'destructive', onPress: async () => {
              try {
                setImporting(true);
                const { restoreSqliteDatabaseBackup } = await import('../lib/db');
                await restoreSqliteDatabaseBackup(picked.uri);
                try { DeviceEventEmitter.emit('databaseImported'); } catch (_) {}
                Alert.alert('Éxito', 'Base de datos restaurada correctamente.');
              } catch (err: any) {
                console.error('SQLite restore error', err);
                Alert.alert('Error', 'No se pudo restaurar la base de datos: ' + (err?.message || err));
              } finally {
                setImporting(false);
              }
            }}
          ]
        );
        return;
      }
    } catch (e: any) {
      console.error('handleImportarSalva error', e);
      setImporting(false);
      Alert.alert(
        'Error',
        'No se pudo iniciar el selector de archivos o el sistema lo bloqueó. Revisa los permisos de almacenamiento en Configuración y asegúrate de tener una app de "Archivos" instalada.'
      );
    }
  }

  async function handleExportarSalvaGeneral() {
    try {
      await requestStoragePermissions();
      
      const json = await exportDatabaseAsJSON();
      const parsed = JSON.parse(json);
      const storage = await exportStorageSnapshot();
      
      // Export all stores as general backup
      const payload = { 
        ...parsed, 
        storage,
        _exportMetadata: {
          isGeneralBackup: true,
          exportedAt: new Date().toISOString(),
          appVersion: '1.0.0',
          storeCount: stores.length
        }
      };
      
      const filename = `salva_general_${new Date().toISOString().replace(/:/g, '-').split('.')[0]}.json`;
      
      await exportJSONFile(filename, payload);
      Alert.alert('Listo', `Archivo guardado en Descargas:\n"${filename}"\n\nPuedes compartirlo por WhatsApp, Email, Bluetooth, etc.`);
    } catch (e: any) {
      console.error('Export general error:', e);
      Alert.alert('Error', 'No se pudo exportar la salva general: ' + (e?.message || e));
    }
  }

  async function handleImportarSalvaGeneral() {
    try {
      await requestStoragePermissions();
      // Support selecting JSON or SQLite DB backups
      const { pickBackupFile } = await import('../lib/file');
      const picked = await pickBackupFile({ mode: Platform.OS === 'android' ? 'auto-general' : 'picker' });

      if (!picked) {
        Alert.alert(
          'Importación cancelada',
          'No se encontró ninguna salva general reciente en la carpeta Descargas. Primero exporta una salva general desde este dispositivo y vuelve a intentarlo.'
        );
        return;
      }

      if (picked.kind === 'json') {
        const data: any = picked.data;
        const isGeneralBackup = data?._exportMetadata?.isGeneralBackup === true;
        const storeCount = data?._exportMetadata?.storeCount || 'desconocida';
        
        if (!isGeneralBackup) {
          Alert.alert('Advertencia', 'Este archivo no parece ser una salva general. Se importará de todas formas, pero es recomendable usar archivos de salva general.');
        }
        
        if (Platform.OS === 'web') {
          const ok = (globalThis as any).confirm?.(`Esto sobrescribirá todos los datos de la aplicación (${storeCount} punto(s) de venta). ¿Continuar?`);
          if (!ok) return;
          try {
            setImporting(true);
            await importDatabaseFromJSON(JSON.stringify(data));
            if (data.storage) {
              await importStorageSnapshot(data.storage);
            }
            try { DeviceEventEmitter.emit('databaseImported'); } catch (_) {}
            Alert.alert('Éxito', `Salva general importada correctamente. Se han restaurado ${storeCount} punto(s) de venta.`);
          } catch (err: any) {
            console.error('Import general error', err);
            Alert.alert('Error', 'No se pudo importar la salva general: ' + (err?.message || err));
          } finally {
            setImporting(false);
          }
          return;
        }

        Alert.alert(
          'Importar Salva General',
          `Esto sobrescribirá todos los datos de la aplicación (${storeCount} punto(s) de venta). ¿Continuar?`,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Importar', style: 'destructive', onPress: async () => {
              try {
                setImporting(true);
                await importDatabaseFromJSON(JSON.stringify(data));
                if (data.storage) {
                  await importStorageSnapshot(data.storage);
                }
                try { DeviceEventEmitter.emit('databaseImported'); } catch (_) {}
                Alert.alert('Éxito', `Salva general importada correctamente. Se han restaurado ${storeCount} punto(s) de venta.`);
              } catch (err: any) {
                console.error('Import general error', err);
                Alert.alert('Error', 'No se pudo importar la salva general: ' + (err?.message || err));
              } finally {
                setImporting(false);
              }
            }}
          ]
        );
        return;
      }

      if (picked.kind === 'sqlite') {
        const dbName = picked.name || 'base de datos';
        if (Platform.OS === 'web') {
          Alert.alert('No soportado en web', 'La importación de archivos .db/.sqlite no está disponible en web. Usa un respaldo .json.');
          return;
        }
        const okMsg = `Esto reemplazará completamente TODA la base de datos local con el archivo "${dbName}" (todas las tiendas). ¿Continuar?`;
        Alert.alert(
          'Restaurar Base de Datos (General)',
          okMsg,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Reemplazar', style: 'destructive', onPress: async () => {
              try {
                setImporting(true);
                const { restoreSqliteDatabaseBackup } = await import('../lib/db');
                await restoreSqliteDatabaseBackup(picked.uri);
                try { DeviceEventEmitter.emit('databaseImported'); } catch (_) {}
                Alert.alert('Éxito', 'Base de datos general restaurada correctamente.');
              } catch (err: any) {
                console.error('SQLite restore error (general)', err);
                Alert.alert('Error', 'No se pudo restaurar la base de datos: ' + (err?.message || err));
              } finally {
                setImporting(false);
              }
            }}
          ]
        );
        return;
      }
    } catch (e: any) {
      console.error('handleImportarSalvaGeneral error', e);
      setImporting(false);
      Alert.alert(
        'Error',
        'No se pudo iniciar el selector de archivos. Revisa los permisos de almacenamiento y vuelve a intentarlo.'
      );
    }
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <DayStatusBanner />
        
        <ScrollView>
          <View style={styles.header}>
            <Text style={styles.title}>Respaldo</Text>
            <Text style={styles.subtitle}>Exporta e importa salvaguardas de puntos de venta</Text>
          </View>
          
          {/* Show current store info */}
          <View style={styles.section}>
            <View style={[styles.card, styles.infoCard]}>
              <Text style={styles.infoLabel}>📍 Punto de Venta Actual</Text>
              <Text style={styles.infoValue}>{currentStore?.name || 'Sin asignar'}</Text>
              {isAdmin && (
                <Text style={styles.hint}>Eres administrador. Puedes exportar cualquier punto de venta e importar salvaguardas de otros puntos.</Text>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.label}>💾 Salva por Punto de Venta</Text>
              
              {/* Admin: Store selection for export */}
              {isAdmin && stores.length > 1 ? (
                <>
                  <Text style={styles.hint}>Selecciona el punto de venta que deseas exportar o importar:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storeScroll}>
                    {stores.map(store => (
                      <TouchableOpacity
                        key={store.id}
                        style={[
                          styles.storeBtn,
                          (selectedStoreForExport || currentStoreId) === store.id && styles.storeBtnActive
                        ]}
                        onPress={() => setSelectedStoreForExport(store.id)}
                      >
                        <Text style={[
                          styles.storeBtnText,
                          (selectedStoreForExport || currentStoreId) === store.id && styles.storeBtnTextActive
                        ]}>
                          {store.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  
                  <View style={styles.selectedStoreIndicator}>
                    <Text style={styles.selectedStoreText}>
                      📤 Exportar: <Text style={styles.selectedStoreName}>
                        {stores.find(s => s.id === (selectedStoreForExport || currentStoreId))?.name || 'Ninguno'}
                      </Text>
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.hint}>Exporta o importa el estado completo de "{currentStore?.name || 'punto de venta actual'}" (productos, ventas, gastos, sesiones, inventarios, stock).</Text>
              )}
              
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity style={[styles.buttonPrimary, { flex: 1 }]} onPress={handleExportarSalva}>
                  <Text style={styles.buttonTextPrimary}>📥 Exportar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.buttonSecondary, { flex: 1 }]} onPress={handleImportarSalva}>
                  <Text style={styles.buttonTextSecondary}>📤 Importar</Text>
                </TouchableOpacity>
              </View>
              
              <Text style={[styles.hint, { marginTop: 8, fontSize: 12 }]}>
                💡 El archivo exportado incluirá el nombre del punto de venta. Al importar, se validará que coincida con tu selección.
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>🗑️ Limpiar Todo</Text>
              <Text style={styles.hint}>Limpia ventas, gastos, inventarios y sesiones del punto de venta actual ("{currentStore?.name || 'actual'}").</Text>
              <TouchableOpacity style={styles.buttonDanger} onPress={handleClearAll}>
                <Text style={styles.buttonText}>Limpiar Todo</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Admin-only: General backup section */}
          {isAdmin && (
            <View style={styles.section}>
              <View style={[styles.card, styles.adminCard]}>
                <Text style={styles.label}>🔐 Salva General (Administrador)</Text>
                <Text style={styles.hint}>Exporta e importa TODOS los datos de la aplicación ({stores.length} punto(s) de venta). Esta opción crea una copia completa de toda la app.</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.buttonPrimary, { flex: 1 }]} onPress={handleExportarSalvaGeneral}>
                    <Text style={styles.buttonTextPrimary}>📥 Exportar General</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.buttonSecondary, { flex: 1 }]} onPress={handleImportarSalvaGeneral}>
                    <Text style={styles.buttonTextSecondary}>📤 Importar General</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.hint, { marginTop: 8, fontSize: 12 }]}>
                  ⚠️ La salva general sobrescribe TODA la base de datos, incluyendo todos los puntos de venta.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>
        
        {importing && (
          <View style={styles.overlay}>
            <View style={styles.overlayInner}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.overlayText}>Importando...</Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 14, color: '#555' },
  section: { padding: 16 },
  card: { backgroundColor: 'white', borderRadius: 10, padding: 12, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  infoCard: { borderLeftWidth: 4, borderLeftColor: '#0A84FF' },
  infoLabel: { fontWeight: '600', color: '#0A84FF', marginBottom: 4 },
  infoValue: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 8 },
  label: { fontWeight: '600', marginBottom: 8, fontSize: 15 },
  hint: { color: '#777', marginBottom: 8, fontSize: 13 },
  storeScroll: { marginBottom: 8 },
  storeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f0f0f0', marginRight: 8 },
  storeBtnActive: { backgroundColor: '#0A84FF' },
  storeBtnText: { fontWeight: '600', color: '#333', fontSize: 13 },
  storeBtnTextActive: { color: '#fff' },
  buttonPrimary: { backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  buttonTextPrimary: { color: 'white', fontWeight: '700' },
  buttonSecondary: { backgroundColor: '#34C759', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  buttonTextSecondary: { color: 'white', fontWeight: '700' },
  buttonDanger: { backgroundColor: '#EF4444', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: '700' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },
  overlayInner: { backgroundColor: '#222', padding: 16, borderRadius: 10, alignItems: 'center' },
  overlayText: { color: 'white', marginTop: 8 },
  adminCard: { borderLeftWidth: 4, borderLeftColor: '#FF9500' },
  selectedStoreIndicator: { 
    backgroundColor: '#f0f8ff', 
    padding: 12, 
    borderRadius: 8, 
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#0A84FF'
  },
  selectedStoreText: { 
    fontWeight: '600', 
    color: '#333',
    fontSize: 14
  },
  selectedStoreName: {
    color: '#0A84FF',
    fontWeight: '700'
  },
});