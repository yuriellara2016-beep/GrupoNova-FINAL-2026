# 📱 Sistema de Punto de Venta - Grupo Nova S.R.L

Sistema completo de punto de venta (POS) para gestión multi-tienda con roles de usuario y consolidación administrativa.

## 🎯 Características Principales

### 🔐 Sistema de Usuarios y Permisos

#### Pantalla de Inicio (UserSelectScreen)
- **Nombre de empresa**: "Grupo Nova S.R.L" destacado en la cabecera
- **Selección de usuarios**: Tarjetas visuales con foto de perfil, nombre y rol
- **Autenticación por contraseña**: Todos los usuarios requieren contraseña para acceder
- **Gestión de usuarios**: Crear nuevos usuarios (requiere contraseña de administrador)
- **Estados de usuario**: Activo/Desactivado con indicadores visuales

#### Roles de Usuario

**👤 Vendedor (Seller)**
- ✅ **Solo ve sus propias ventas** - Filtrado automático por `userId`
- ✅ **Opera en su punto de venta asignado** - Filtrado por `storeId`
- ✅ **Gestión de inventario** - Solo de su tienda
- ✅ **Realizar ventas** - Asociadas a su usuario y tienda
- ✅ **Registrar gastos** - De su punto de venta
- ✅ **Gestionar caja** - Apertura/cierre de su turno
- ✅ **Ver productos** - Catálogo completo
- ✅ **Generar reportes** - De su actividad

**👑 Administrador (Admin)**
- ✅ **Vista consolidada** - Ve TODAS las ventas de todos los vendedores
- ✅ **Filtrar por tienda** - Selector de tienda para análisis específico
- ✅ **Gestión de usuarios** - Crear, editar, activar/desactivar usuarios
- ✅ **Gestión de tiendas** - Administrar puntos de venta
- ✅ **Reportes consolidados** - Ventas, gastos, inventario de todas las tiendas
- ✅ **Control total** - Acceso a todas las funcionalidades

### 📊 Gestión de Ventas

#### Filtrado por Usuario y Tienda
```typescript
// Vendedores: solo ven sus ventas
const filter = {
  storeId: currentStoreId,
  userId: user.id
};

// Admin: puede filtrar por tienda o ver todo
const filter = {
  storeId: selectedStoreFilter || null // null = todas las tiendas
};
```

#### Funcionalidades de Venta
- 📦 **Carrito de compras** con ajuste de cantidades
- 💰 **Tres métodos de pago**:
  - 💵 Efectivo
  - 💳 Transferencia (con datos de cliente y comisión bancaria 1.5%)
  - 💵💳 Pago mixto (efectivo + transferencia)
- 🧾 **Generación de tickets** con impresión/compartir
- 📋 **Historial de ventas** filtrado por usuario y tienda
- 📄 **Exportación MVT** para reportes contables
- 🔍 **Búsqueda de productos** por nombre o SKU
- 📷 **Escaneo de códigos de barras** (móvil)

### 📦 Gestión de Inventario por Tienda

#### Inventario Separado por Punto de Venta
- Cada tienda tiene su propio stock independiente
- Tabla `store_product_stock` con índices optimizados
- Transferencias entre tiendas registradas

#### Movimientos de Inventario
- **Compras** - Incrementa stock de la tienda
- **Ventas** - Reduce stock automáticamente (asociado a vendedor)
- **Ajustes** - Correcciones manuales de stock
- **Transferencias** - Entre tiendas (salida + entrada)
- **Trazabilidad completa** - Cada movimiento registrado con fecha, tipo y usuario

### 💼 Gestión de Gastos

- Registro por tienda
- Categorías: Material, servicios, salarios, otros
- Comisiones bancarias automáticas (1.5% en transferencias)
- Cargo adicional 10% (configurable por producto)
- Filtrado por punto de venta

### 💰 Caja y Sesiones

- Apertura de caja con monto inicial
- Seguimiento en tiempo real de ventas del turno
- Cálculo automático de:
  - Total en efectivo
  - Total en transferencias
  - Gastos del turno
  - Balance esperado
- Cierre de caja con conteo físico
- Reapertura de sesión sin perder datos
- Diferencias automáticamente calculadas

### 📈 Reportes

#### Para Vendedores
- Ventas del día (solo propias)
- Productos más vendidos
- Movimientos de inventario de su tienda

#### Para Administrador (Consolidado)
- **Ventas totales** de todas las tiendas
- **Desglose por tienda** y por vendedor
- **Reporte de productos** con totales agregados
- **Movimientos de inventario** multi-tienda
- **Exportación MVT** por período

### 🏪 Gestión de Tiendas

- Crear/editar/desactivar puntos de venta
- Asignar usuarios a tiendas
- Ver inventario por tienda
- Reportes individuales o consolidados

## 🎨 Interfaz de Usuario

### Navegación Mejorada
- **Tab bar ampliado** con iconos grandes (28px)
- **Scroll horizontal** cuando hay muchas pestañas
- **Indicador visual** de pestaña activa con fondo destacado
- **Pestañas adaptadas por rol**:
  - Vendedores: 6 pestañas (Ventas, Gastos, Inventario, Caja, Productos, Reportes)
  - Admin: 8 pestañas (+ Usuarios, Tiendas)

### Pantalla de Inicio
- **Encabezado destacado** con nombre de empresa
- **Tarjetas de usuario** con foto, nombre, rol y estado
- **Diseño limpio** con jerarquía visual clara
- **Modales de autenticación** con validación de contraseña

## 📱 Compatibilidad

- ✅ **Web** - Funciona completamente en navegador
- ✅ **iOS** - App nativa con escaneo de códigos
- ✅ **Android** - App nativa con escaneo de códigos
- ✅ **Persistencia local** - AsyncStorage (sin backend)

## 🔒 Seguridad

### Autenticación
- **Contraseñas por defecto**:
  - Admin: `12345`
  - Vendedores: `{Nombre}123*` (ej: "Juan123*")
- **Contraseñas personalizables** al crear usuarios
- **Validación obligatoria** en cada inicio de sesión
- **Permisos de administrador** para operaciones sensibles

### Filtros de Seguridad
```typescript
// Vendedores SIEMPRE filtrados por su userId
if (!isAdmin && user?.id) {
  filter.userId = user.id;
}

// Stock separado por tienda
await getProductStockInStore(productId, storeId);

// Ventas asociadas a usuario y tienda
await createSale({
  ...saleData,
  userId: user.id,
  storeId: currentStoreId
});
```

## 🗄️ Estructura de Datos

### Usuarios
```typescript
{
  id: string;
  name: string;
  role: 'admin' | 'seller';
  active: boolean;
  password: string;
  storeId?: string; // Tienda asignada (vendedores)
}
```

### Ventas
```typescript
{
  id: string;
  createdAt: string;
  paymentMethod: 'cash' | 'transfer' | 'mixed';
  subtotal: number;
  total: number;
  commission: number;
  storeId: string;
  userId: string; // 🔐 Identificador del vendedor
  // ... otros campos
}
```

### Inventario por Tienda
```typescript
{
  storeId: string;
  productId: string;
  quantity: number;
}
```

## 🚀 Uso del Sistema

### 1. Inicio de Sesión
1. Abrir la app
2. Ver pantalla "Grupo Nova S.R.L"
3. Seleccionar usuario
4. Ingresar contraseña
5. Acceder al dashboard según rol

### 2. Vendedor - Realizar Venta
1. Ir a pestaña "Ventas"
2. Buscar o escanear productos
3. Agregar al carrito
4. Ajustar cantidades
5. Seleccionar método de pago
6. Confirmar venta
7. Imprimir ticket (opcional)

**Resultado**: 
- Venta registrada con `userId` del vendedor
- Stock reducido en su tienda (`storeId`)
- Solo visible para el vendedor y admin

### 3. Admin - Consolidación
1. Ir a pestaña "Ventas"
2. Ver **todas las ventas** de todos los vendedores
3. Filtrar por tienda específica (opcional)
4. Exportar reporte MVT consolidado
5. Analizar ventas por vendedor/tienda

### 4. Admin - Gestión de Usuarios
1. Ir a pestaña "Usuarios"
2. Ver lista completa
3. Crear nuevo usuario (requiere contraseña admin)
4. Asignar rol y tienda
5. Activar/desactivar según necesidad

### 5. Admin - Gestión de Tiendas
1. Ir a pestaña "Tiendas"
2. Ver puntos de venta
3. Crear/editar tiendas
4. Asignar usuarios
5. Ver inventario por tienda

## 📋 Usuarios de Prueba

| Usuario | Contraseña | Rol | Tienda |
|---------|-----------|-----|--------|
| Admin Principal | `12345` | Administrador | - |
| Vendedor 1 | `Vendedor1123*` | Vendedor | Tienda 1 |
| Vendedor 2 | `Vendedor2123*` | Vendedor | Tienda 2 |

## 🎯 Flujo de Datos

### Venta de Vendedor
```
Vendedor → Selecciona productos → Crea venta
  ↓
Sistema registra:
  - userId: "vendedor_id"
  - storeId: "tienda_asignada"
  - Reduce stock en store_product_stock
  ↓
Venta solo visible para:
  - El vendedor que la creó
  - Administradores (consolidado)
```

### Consulta de Admin
```
Admin → Filtra ventas
  ↓
Sin filtro de tienda:
  - Ve TODAS las ventas de TODOS los vendedores
  ↓
Con filtro de tienda específica:
  - Ve solo ventas de esa tienda
  - De todos los vendedores de esa tienda
```

## 🔧 Configuración

### Iconos del Tab Bar
- **Tamaño**: 28px (ampliado)
- **Espaciado**: Scroll horizontal
- **Indicador activo**: Fondo con color primario
- **Mínimo ancho**: 80px por tab

### Colores del Tema
- **Primario**: `#2E7D32` (Verde corporativo)
- **Superficie**: `#F7F7F7`
- **Texto**: `#1F2937`
- **Error**: `#D32F2F`
- **Advertencia**: `#FF9800`

## 📦 Exportaciones

### Formato MVT
```
[Documento]
Operacion=VENTA
Fecha=2024-01-15

[Movimientos]
SKU|Unidad|Descripción|Cantidad|Precio|Existencia
PROD001|Uno|Producto A|10|25.00|90
```

### Uso
1. Filtrar período (hoy o rango)
2. Presionar "Exportar .mvt"
3. Archivo descargado o compartido
4. Importar en sistema contable

## 🛠️ Tecnologías

- **React Native** / Expo
- **TypeScript**
- **AsyncStorage** (persistencia local)
- **expo-print** (generación de tickets)
- **expo-barcode-scanner** (escaneo móvil)
- **expo-sharing** (compartir archivos)

## 📝 Notas Importantes

✅ **Sin backend**: Todo funciona localmente con AsyncStorage  
✅ **Sin dependencias de navegación externa**: Tabs internos funcionan en web  
✅ **Separación de inventario**: Cada tienda tiene stock independiente  
✅ **Trazabilidad completa**: Cada venta registra vendedor y tienda  
✅ **Admin como consolidador**: Ve todo sin restricciones  
✅ **Vendedores limitados**: Solo ven sus propias operaciones  

## 🎉 Estado del Proyecto

✅ Pantalla de inicio con nombre de empresa implementada  
✅ Iconos ampliados y scroll horizontal en tab bar  
✅ Sistema de permisos por usuario funcionando  
✅ Filtrado automático de ventas por vendedor  
✅ Admin ve consolidado de todas las tiendas  
✅ Inventario separado por punto de venta  
✅ Gestión completa de usuarios y tiendas  
✅ Exportación e importación de datos  
✅ Sistema de caja con sesiones  
✅ Reportes detallados y consolidados  

**¡Sistema completamente funcional y listo para usar!** 🚀