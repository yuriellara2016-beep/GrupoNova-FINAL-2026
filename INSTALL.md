# 📱 Sistema POS - Guía de Instalación Completa

## 🎯 Aplicación de Punto de Venta Offline para Android

### Requisitos previos
- Node.js instalado (v14 o superior)
- Expo CLI: `npm install -g expo-cli`
- Dispositivo Android físico o emulador

---

## 📦 Dependencias Requeridas

Ejecuta estos comandos en la raíz del proyecto:

### Dependencias principales
```bash
# Core de Expo
expo install expo-sqlite
expo install @react-native-async-storage/async-storage
expo install react-native-safe-area-context

# Navegación
npm install @react-navigation/native @react-navigation/bottom-tabs
expo install react-native-screens

# Utilidades
npm install react-native-get-random-values uuid

# File System y Exportación
expo install expo-file-system
expo install expo-sharing
expo install expo-print
expo install expo-document-picker

# Scanner de códigos de barras
expo install expo-barcode-scanner

# Icons
npm install @expo/vector-icons
```

### Comando único (copiar y pegar):
```bash
expo install expo-sqlite @react-native-async-storage/async-storage react-native-safe-area-context react-native-screens expo-file-system expo-sharing expo-print expo-document-picker expo-barcode-scanner && npm install @react-navigation/native @react-navigation/bottom-tabs react-native-get-random-values uuid @expo/vector-icons
```

---

## 🚀 Pasos de Instalación

### 1. Instalar dependencias
```bash
npm install
# o
yarn install
```

### 2. Iniciar el servidor de desarrollo
```bash
npx expo start
# o
expo start
```

### 3. Probar en dispositivo/emulador
- **Expo Go (recomendado para desarrollo):**
  - Instala Expo Go desde Google Play Store
  - Escanea el código QR que aparece en la terminal

- **Build nativo (para producción):**
  ```bash
  eas build --platform android
  ```

---

## ✅ Funcionalidades Implementadas

### 🛒 Módulo de Ventas
- ✅ Búsqueda de productos
- ✅ Scanner de códigos de barras (SKU)
- ✅ Carrito con validación de stock en tiempo real
- ✅ Métodos de pago: Efectivo y Transferencia
- ✅ Comisión 1.5% en transferencias (registrada como gasto, NO se cobra al cliente)
- ✅ Opción +10% por producto sobre precio de venta
- ✅ Impresión de recibos en PDF (compartir/imprimir)
- ✅ Reducción automática de inventario al confirmar venta

### 🏷️ Módulo de Productos
- ✅ Crear/editar/eliminar productos
- ✅ Campos: Nombre, SKU, Precio Costo, Precio Venta, Cantidad, Flag +10%
- ✅ Búsqueda por nombre o SKU

### 📦 Módulo de Inventario
- ✅ Entradas por Compra (actualiza precio costo)
- ✅ Entradas por Transferencia
- ✅ Entradas por Ajuste
- ✅ Búsqueda de productos al registrar entrada
- ✅ Historial completo de entradas

### 💰 Módulo de Caja
- ✅ Abrir/Cerrar sesiones de caja
- ✅ **Desglose de efectivo** (billetes y monedas) con cálculo automático
- ✅ Resumen diario: ventas efectivo vs transferencia
- ✅ Separación de comisiones bancarias vs gastos operativos
- ✅ Registro de gastos: Salario, Arrendamiento, Otros
- ✅ Reconciliación automática (esperado vs contado)
- ✅ Historial de sesiones

### 📊 Módulo de Reportes y Ganancias
- ✅ Reporte de ganancias detallado:
  - Ingresos totales
  - Costo de ventas (COGS)
  - Ganancia bruta
  - Comisiones bancarias (separadas)
  - Gastos operativos
  - Ganancia neta
  - Margen de ganancia (%)
- ✅ Selector de período (Hoy, Semana, Mes, Todo)
- ✅ Exportar reporte de ganancias en PDF
- ✅ Exportar ventas en CSV
- ✅ Exportar/importar base de datos completa (JSON)

---

## 🔧 Configuración Inicial

### Denominaciones de efectivo (CashScreen.tsx)
Actualiza la constante `DENOMINATIONS` según tu moneda:
```typescript
const DENOMINATIONS = [
  { value: 100000, label: '$100.000', type: 'bill' },
  { value: 50000, label: '$50.000', type: 'bill' },
  // ... ajusta según tu país
];
```

---

## 📱 Generar APK para Distribución

### Opción 1: EAS Build (recomendado)
```bash
# Instalar EAS CLI
npm install -g eas-cli

# Login en Expo
eas login

# Configurar proyecto
eas build:configure

# Generar AAB para Play Store
eas build --platform android --profile production

# Generar APK para instalación directa
eas build --platform android --profile preview
```

### Opción 2: Build local
```bash
expo prebuild
cd android
./gradlew assembleRelease
```

El APK estará en: `android/app/build/outputs/apk/release/app-release.apk`

---

## 🧪 Flujo de Prueba Recomendado

1. **Productos:** Crear 2-3 productos con costo, venta, cantidad inicial y SKU
2. **Inventario:** Registrar una compra de 10 unidades (actualiza stock)
3. **Ventas:** 
   - Escanear código de barras o buscar producto
   - Agregar al carrito
   - Pagar en efectivo y transferencia (probar ambos)
   - Imprimir recibo
4. **Caja:**
   - Abrir sesión con balance inicial
   - Registrar gasto (ej: salario)
   - Cerrar con desglose de efectivo
   - Verificar reconciliación
5. **Reportes:**
   - Ver ganancias del día
   - Exportar reporte PDF
   - Exportar base de datos JSON

---

## 📋 Notas Importantes

### Comisión 1.5% en Transferencias
- El **cliente paga lo mismo** sea efectivo o transferencia
- La comisión se registra como **gasto interno** (expense)
- Esto afecta la ganancia neta en reportes
- **NO se suma al total cobrado al cliente**

### Desglose de Efectivo
- Al cerrar caja, usar la opción "Desglose de Efectivo"
- Ingresar cantidad de billetes/monedas
- El sistema calcula el total automáticamente
- Muestra diferencia entre esperado y contado

### Base de Datos
- SQLite en dispositivos Android/iOS nativos
- Fallback a AsyncStorage si SQLite no está disponible
- Export/Import vía JSON para migrar entre dispositivos
- Hacer backup regular usando "Exportar Base de Datos"

### Limitaciones Actuales
- Scanner de códigos funciona solo en builds nativos (no en Expo Go web)
- Impresión de recibos genera PDF compartible (no impresora Bluetooth directa aún)
- No hay sincronización en tiempo real entre dispositivos (usar export/import manual)

---

## 🐛 Solución de Problemas

### Error: "SQLite.openDatabase is not a function"
- Asegúrate de tener `expo-sqlite` instalado
- Reinicia Metro bundler: `expo start -c`
- Ejecuta en dispositivo nativo, no en web

### Scanner no funciona
- Verifica permisos de cámara
- Solo funciona en builds nativos (no Expo Go web)

### Imports fallan
- Ejecuta: `expo install @react-native-async-storage/async-storage`
- Limpia caché: `expo start -c`

---

## 📞 Soporte

Si encuentras problemas:
1. Verifica que todas las dependencias estén instaladas
2. Limpia cache: `expo start -c`
3. Revisa logs en consola
4. Reinstala node_modules: `rm -rf node_modules && npm install`

---

## 🎉 ¡Listo para Producción!

Tu sistema POS ahora está completamente funcional con:
- ✅ Ventas offline
- ✅ Control de inventario
- ✅ Arqueo de caja profesional
- ✅ Reportes de ganancia
- ✅ Scanner de códigos
- ✅ Impresión de recibos
- ✅ Export/Import de datos

**Siguiente paso:** Generar tu APK y distribuir la app.