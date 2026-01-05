// lib/exportImportCore.ts - ARCHIVO COMPLETO Y FUNCIONAL
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

// ==================== CONFIGURACIÓN INICIAL ====================

// Configurar DocumentPicker para Android
const documentPickerOptions = {
  type: 'application/json',
  copyToCacheDirectory: true,
  multiple: false
} as const;

// ==================== FUNCIONES DE UTILIDAD ====================

// Obtener fingerprint del dispositivo
export async function getDeviceFingerprint(): Promise<string> {
  try {
    let deviceId = await AsyncStorage.getItem('@device_unique_id');
    if (!deviceId) {
      deviceId = `device_${Platform.OS}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      await AsyncStorage.setItem('@device_unique_id', deviceId);
    }
    return deviceId;
  } catch (error) {
    return `device_${Platform.OS}_unknown_${Date.now()}`;
  }
}

// Normalizar nombre para consistencia
export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 30);
}

// Generar timestamp legible
export function getReadableTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
}

// ==================== FUNCIÓN PARA EXPORTAR DATOS ====================

export async function exportForMultiDevice(storeName: string, userId: string): Promise<boolean> {
  try {
    Alert.alert('📤 Exportando', 'Preparando backup de la tienda...');
    
    // 1. Recopilar datos de AsyncStorage
    const allData = await collectAllAsyncStorageData();
    
    // 2. Preparar metadata
    const deviceFingerprint = await getDeviceFingerprint();
    const timestamp = getReadableTimestamp();
    
    // 3. Crear estructura del backup
    const backupData = {
      // Metadata del sistema
      system: {
        app: 'POS_MultiStore',
        version: '2.0',
        exportType: 'store_backup',
        createdAt: new Date().toISOString(),
        formatVersion: '1'
      },
      
      // Información del dispositivo origen
      source: {
        deviceId: deviceFingerprint,
        platform: Platform.OS,
        platformVersion: Platform.Version
      },
      
      // Información del negocio
      business: {
        storeName: storeName,
        normalizedStoreName: normalizeName(storeName),
        userId: userId,
        exportDate: new Date().toISOString().split('T')[0]
      },
      
      // Estadísticas
      stats: {
        products: allData.products?.length || 0,
        sales: allData.sales?.length || 0,
        expenses: allData.expenses?.length || 0,
        users: allData.users?.length || 0,
        stocks: allData.stocks?.length || 0
      },
      
      // Datos reales
      data: allData,
      
      // Instrucciones
      instructions: {
        compatibleWith: [storeName],
        importWarning: 'Importar solo en la misma tienda',
        backupType: 'multi_device_offline'
      }
    };
    
    // 4. Crear nombre de archivo seguro
    const safeStoreName = storeName
      .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]/g, '_')
      .substring(0, 25);
    
    const filename = `POS_Backup_${safeStoreName}_${timestamp}.json`;
    
    // 5. Guardar archivo localmente
    const fileUri = `${FileSystem.documentDirectory}${filename}`;
    
    await FileSystem.writeAsStringAsync(
      fileUri,
      JSON.stringify(backupData, null, 2),
      { encoding: FileSystem.EncodingType.UTF8 }
    );
    
    // 6. Verificar que se creó el archivo
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
      throw new Error('No se pudo crear el archivo de backup');
    }
    
    console.log('✅ Archivo de backup creado en:', fileUri);
    
    // 7. Compartir archivo (Android)
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: `Backup: ${storeName}`,
          UTI: 'public.json'
        });
      } else {
        // Alternativa: mostrar información del archivo
        Alert.alert(
          '✅ Backup Creado',
          `Archivo: ${filename}\n\nUbicación: ${fileUri}\n\nComparte este archivo con otro dispositivo.`,
          [
            { text: 'OK', style: 'default' },
            { 
              text: 'Ver Detalles', 
              onPress: () => {
                Alert.alert(
                  '📊 Detalles del Backup',
                  `Tienda: ${storeName}\nProductos: ${backupData.stats.products}\nVentas: ${backupData.stats.sales}\nFecha: ${timestamp}`
                );
              }
            }
          ]
        );
      }
    }
    
    // 8. Guardar registro de exportación
    await saveSyncRecord({
      type: 'export',
      storeName: storeName,
      filename: filename,
      success: true,
      timestamp: new Date().toISOString(),
      stats: backupData.stats
    });
    
    return true;
    
  } catch (error: any) {
    console.error('❌ Error en exportación:', error);
    
    Alert.alert(
      '❌ Error al Exportar',
      `No se pudo crear el backup:\n\n${error.message || 'Error desconocido'}`,
      [{ text: 'OK', style: 'default' }]
    );
    
    await saveSyncRecord({
      type: 'export',
      storeName: storeName,
      filename: 'ERROR',
      success: false,
      timestamp: new Date().toISOString(),
      error: error.message
    });
    
    return false;
  }
}

// ==================== FUNCIÓN PARA IMPORTAR DATOS ====================

export async function importForMultiDevice(currentStoreName: string): Promise<boolean> {
  try {
    console.log('📥 Iniciando proceso de importación...');
    
    // 1. Seleccionar archivo
    let result;
    try {
      result = await DocumentPicker.getDocumentAsync(documentPickerOptions);
    } catch (pickerError: any) {
      console.error('Error con DocumentPicker:', pickerError);
      Alert.alert(
        '❌ Error',
        'No se pudo abrir el selector de archivos. Verifica los permisos de almacenamiento.',
        [{ text: 'OK', style: 'default' }]
      );
      return false;
    }
    
    if (result.type === 'cancel') {
      console.log('Importación cancelada por el usuario');
      return false;
    }
    
    if (!result.assets || result.assets.length === 0) {
      throw new Error('No se seleccionó ningún archivo');
    }
    
    const fileAsset = result.assets[0];
    console.log('📁 Archivo seleccionado:', fileAsset.name);
    
    // 2. Leer contenido del archivo
    let fileContent;
    try {
      fileContent = await FileSystem.readAsStringAsync(fileAsset.uri);
    } catch (readError: any) {
      throw new Error(`No se pudo leer el archivo: ${readError.message}`);
    }
    
    // 3. Parsear JSON
    let importData;
    try {
      importData = JSON.parse(fileContent);
    } catch (parseError) {
      throw new Error('El archivo no es un JSON válido');
    }
    
    // 4. Validar estructura básica
    if (!importData || !importData.system || !importData.data) {
      throw new Error('Archivo de backup inválido');
    }
    
    // 5. Validar compatibilidad de la app
    if (importData.system.app !== 'POS_MultiStore') {
      throw new Error('Este no es un backup de POS MultiStore');
    }
    
    // 6. Obtener información del backup
    const backupStoreName = importData.business?.storeName || 'Desconocida';
    const backupStats = importData.stats || {};
    
    // 7. Mostrar confirmación al usuario
    const userConfirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        '📊 Confirmar Importación',
        `¿Importar datos de "${backupStoreName}"?\n\n` +
        `📦 Productos: ${backupStats.products || 0}\n` +
        `💰 Ventas: ${backupStats.sales || 0