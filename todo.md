# BuildReq - Project TODO

## Base de Datos
- [x] Esquema de proyectos (hasta 20 activos)
- [x] Esquema de solicitudes de materiales (ítems, cantidades, destinatario)
- [x] Esquema de líneas de solicitud (detalle de ítems)
- [x] Esquema de flujos de abastecimiento (4 caminos)
- [x] Esquema de logística inversa (devoluciones)
- [x] Esquema de documentos SAP (preparación para integración)
- [x] Esquema de adjuntos (S3)
- [x] Esquema de notificaciones in-app
- [x] Migración completa a BD

## Backend - API tRPC
- [x] Router de proyectos (CRUD, listado, códigos)
- [x] Router de solicitudes de materiales (crear, listar, actualizar estatus)
- [x] Router de flujos de abastecimiento (4 caminos)
- [x] Router de logística inversa (devoluciones con justificación obligatoria)
- [x] Router de inventario (consulta stock por bodega/proyecto)
- [x] Router de dashboard (métricas, KPIs)
- [x] Router de adjuntos (upload/download S3)
- [x] Router de notificaciones (in-app)
- [x] Router de exportación (Excel/PDF)
- [x] Router de documentos SAP (estructura preparada)
- [x] Lógica de roles (Ing. Residente, Jefe de Bodega Central, Administración Central)

## Tests Unitarios
- [x] Tests de lógica de flujos de abastecimiento
- [x] Tests de cambio de estatus de solicitudes
- [x] Tests de validación de devoluciones (justificación obligatoria)
- [x] Tests de permisos por rol

## Frontend - Tema y Layout
- [x] Configurar tema Swiss Style (Estilo Tipográfico Internacional)
- [x] DashboardLayout con navegación por rol
- [x] Página de login/landing

## Frontend - Módulos
- [x] Página de solicitudes de materiales (formulario + listado)
- [x] Detalle de solicitud con asignación de flujo y traducción SAP
- [x] Página de gestión de flujos (vista por rol)
- [x] Página de logística inversa (devoluciones + nueva devolución)
- [x] Página de dashboard con métricas y gráficos
- [x] Página de gestión de proyectos
- [x] Página de inventario (solo Jefe de Bodega)
- [x] Página de órdenes de compra (Administración Central)
- [x] Componente de adjuntos (upload/preview)
- [x] Sistema de notificaciones in-app
- [x] Gestión de usuarios y asignación de roles
- [x] Exportación de reportes (Excel/PDF) - Backend preparado

## Integración SAP B1
- [x] Estructura de datos compatible con documentos SAP
- [x] Endpoint preparado para entrada de mercancía
- [x] Endpoint preparado para salida/transferencia de inventario
- [x] Endpoint preparado para solicitud de compra
- [x] Endpoint preparado para orden de compra
- [x] Documentación de mapeo SAP - Estructura preparada en sapSyncLog

## Datos de Prueba
- [x] Cargar proyecto Proy-01
- [x] Cargar proyecto Proy-02

## Sistema de Invitación de Usuarios
- [x] Tabla de invitaciones en BD (email, rol, proyecto, token, estatus)
- [x] Endpoint para crear invitación (admin only)
- [x] Envío de email de invitación con enlace de acceso
- [x] Auto-asignación de rol y proyecto al autenticarse usuario invitado
- [x] Frontend: formulario de invitación en página de Usuarios
- [x] Frontend: listado de invitaciones pendientes/aceptadas
- [x] Tests unitarios para flujo de invitación

## Correcciones y Ajustes v2
- [x] Bug: Error al traducir ítem a código SAP en detalle de solicitud
- [x] Bug: Error al asignar flujo de abastecimiento en detalle de solicitud
- [x] Logística inversa: Solo Jefe de Bodega Central puede generar devoluciones (no Ing. Residente)
- [x] Flujos para Administrador de Proyectos: solo Compra directa y Solicitud de Compra
- [x] Asignación de flujo debe ser ítem por ítem (no por solicitud completa)
- [x] Jefe de Bodega debe verificar producto por producto si tiene stock

## Correcciones v3 - Permisos por Rol y Flujo por Ítem
- [x] Backend: Agregar requestItemId a supplyFlowRecords para flujo por ítem
- [x] Backend: Restringir creación de logística inversa SOLO a jefe_bodega_central
- [x] Backend: Filtrar flujos disponibles según rol
- [x] Backend: Refactorizar supplyFlows para aceptar requestItemId
- [x] Frontend: SolicitudDetalle - asignar flujo ítem por ítem
- [x] Frontend: Devoluciones - ocultar "Nueva Devolución" a Ing. Residente
- [x] Frontend: DashboardLayout - restringir Logística Inversa a jefe_bodega_central y admin
- [x] Frontend: Flujos - filtrar tipos visibles según rol
- [x] Frontend: Verificar navegación diferenciada para los 3 roles
- [x] Promover cuenta natiana@potencialconsultores.org a admin del sistema

## Correcciones v4
- [x] Bug: Error de login con cuenta natiana.colindres@imperii.biz (Ing. Residente) - retry logic added
- [x] Lógica: Solicitud de Compra del Jefe de Bodega debe dirigirse a Administración Central

## Cambios v5 - Lógica de negocio y catálogo SAP
- [x] Estatus automáticos: En espera → En proceso (al asignar flujo) → Cerrado. Eliminar "Atendida"
- [x] Destinatario: agregar "Solicitud de Compra" como opción para Jefe de Bodega
- [x] Unidad de medida: cambiar a Select desplegable con lista predefinida
- [x] Tabla inline: flujo y código SAP directamente en columnas (sin diálogos)
- [x] Textbox búsqueda SAP: autocomplete con código + descripción (estilo imagen referencia)
- [x] Crear tabla sapCatalog y cargar 22 ítems de ejemplo
- [x] Crear tabla suppliers y cargar 20 proveedores de ejemplo
- [x] Afectaciones SAP: Despacho→Salida Inventario, SC→SC SAP, Traslado→Solicitud Transferencia
- [x] Compra Directa: flujo 2 pasos (OC en app → Entrada Mercancías → SAP Módulo Compras)
- [x] Botón "Enviar a SAP" al final de tabla de ítems
- [x] Fix: error ECONNRESET en OAuth callback (retry logic)

## Correcciones v6
- [x] Bug: Dropdown de búsqueda SAP no muestra lista desplegable de resultados
- [x] Auto-numeración de OC y todas las transacciones (correlativo automático)
- [x] Tipo de compra en OC debe heredarse del documento original
- [x] Quitar botón "Enviar a SAP" de la parte superior (solo dejar el de abajo)
- [x] Bug: Órdenes de Compra no se refrescan al crear
- [x] Bug: "Invalid Date" en listado de Órdenes de Compra
- [x] Bug: ID muestra "#" en lugar del número real
- [x] Agregar selector de Proveedor en popup de Compra Directa
- [x] Cargar 20 proveedores con código SN de la lista compartida (usando proveedores existentes en BD)
