// COPIAR TODO ESTE CÓDIGO EN syncHelpers.ts
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 1. Función para normalizar nombres (EJEMPLO: "Mi Tienda" → "mi_tienda")
export function normalizeId(text: string, type?: string): string {
  if (!text) return '';
  
  // Para emails, mantener igual
  if (text.includes('@')) {
    return text.toLowerCase().trim();
  }
  
  // Para códigos/SKU, mantener igual en mayúsculas
  if (type === 'sku') {
    return text.trim().toUpperCase();
  }
  
  // Quitar acentos y espacios
  let result = text
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Sin acentos
    .replace(/\s+/g, '_') // Espacios → _
    .replace(/[^a-z0-9_]/g, ''); // Solo letras y números
  
  // Agregar prefijo
  if (type === 'store') {
    return `store_${result}`;
  } else if (type === 'product') {
    return `prod_${result}`;
  } else if (type === 'user') {
    return `user_${result}`;
  }
  
  return result;
}

// 2. Obtener ID del dispositivo
export async function getDeviceId(): Promise<string> {
  try {
    let deviceId = await AsyncStorage.getItem('@device_id');
    if (!deviceId) {
      deviceId = `device_${Date.now()}`;
      await AsyncStorage.setItem('@device_id', deviceId);
    }
    return deviceId;
  } catch {
    return 'unknown';
  }
}

// 3. Crear metadata para exportación
export function createExportMetadata(storeName: string, userName: string) {
  return {
    exportedAt: new Date().toISOString(),
    store: storeName,
    user: userName,
    device: Platform.OS,
    version: '3.0'
  };
}