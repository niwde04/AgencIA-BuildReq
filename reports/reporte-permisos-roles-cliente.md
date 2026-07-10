# Reporte de permisos por rol

Fecha de corte: 2026-07-10

Este reporte resume el comportamiento actual del sistema BuildReq por rol. Incluye acceso a pantallas, permisos funcionales, ventanas/modales principales y observaciones donde el permiso visual del frontend no es exactamente igual al permiso real del backend.

## Resumen ejecutivo

- Contabilidad puede consultar Articulos, Proveedores, Proyectos, Ordenes de Compra, Recepciones, Facturas, Reportes, Impuestos, Retenciones y Activos fijos pendientes. En Ordenes de Compra y Recepciones su acceso es de consulta; no crea, edita ni registra.
- La creacion y edicion de articulos queda limitada a Administrador del sistema, Administracion Central y Bodega Central. Contabilidad y Superintendente pueden consultar articulos; Contabilidad tambien puede resolver activos fijos pendientes.
- La creacion de proveedores queda limitada a Administrador del sistema y Administracion Central. Bodega Central puede editar el catalogo; Administracion Proyecto puede gestionar contactos, fiscal/documentos y agenda del proveedor, pero no crear proveedores nuevos.
- Los roles de proyecto se limitan a sus proyectos asignados cuando el backend usa alcance por proyecto. Si un usuario de proyecto no tiene proyectos asignados, algunas pantallas tratan ese caso como acceso a todos los proyectos para ese rol.
- Hay diferencias puntuales entre menu y backend. Se documentan como observaciones para no confundir "aparece en el menu" con "la API permite la accion".

## Leyenda de roles

| Sigla | Rol visible | Codigo interno |
| --- | --- | --- |
| ADM | Administrador del sistema | `admin` |
| AC | Administracion Central | `administracion_central` |
| BC | Bodega Central | `jefe_bodega_central` |
| AP | Administracion Proyecto | `administrador_proyecto` |
| BP | Bodega Proyecto | `bodeguero_proyecto` |
| IR | Ingeniero Residente / Requiriente | `ingeniero_residente` |
| SUP | Superintendente | `superintendente` |
| CON | Contable | `contable` |

Convenciones usadas:

| Marca | Significado |
| --- | --- |
| Si | Puede ver la pantalla desde la navegacion normal. |
| No | No aparece en la navegacion normal o el sistema lo redirige. |
| PA | Acceso limitado a proyectos asignados. |
| Propias | Acceso limitado a requisiciones creadas por el usuario. |
| Directo/API | La pantalla o API responde si se accede directamente, aunque no aparezca en el menu. |
| Lectura | Puede consultar, pero no crear, editar, registrar, aprobar ni cancelar. |

## Matriz general de pantallas

| Pantalla | Ruta | ADM | AC | BC | AP | BP | IR | SUP | CON |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | `/` | Si | Si | Si | Si | Si | Si | Si | No |
| Requisiciones | `/solicitudes` | Si | Si | Si | PA | PA | Propias | PA | No |
| Nueva / editar requisicion | `/solicitudes/nueva`, `/solicitudes/:id/editar` | Si | Si | Si | PA | PA | Propias | No | No |
| Flujos de Abastecimiento | `/flujos` | Si | Si | Si | PA | PA | Propias lectura | No | No |
| Logistica Inversa | `/devoluciones` | Directo/API | Si lectura | Si | No | No | No | No | No |
| Inventario | `/inventario` | Directo/API | Si | Si | PA | PA | No | No | No |
| Saldos Iniciales | `/saldos-iniciales` | Si | Si | Si | No | No | No | No | No |
| Articulos | `/articulos` | Si | Si | Si | Si | Si | Si | Si | Si |
| Activos fijos pendientes | `/activos-fijos-pendientes` | Si | No | No | No | No | No | No | Si |
| Proveedores | `/proveedores` | Si | Si | Si | Si | Si lectura | No | No | Si lectura |
| Salidas de Inventario | `/salidas-inventario` | Si | Si | Si | No | PA | No | No | No |
| Almacenes | `/almacenes` | Si | Si | Si lectura | PA | PA lectura | No | No | No |
| Solicitudes de Compra | `/solicitudes-compra` | Si | Si | Si | PA | PA lectura/cotiza | No | No | No |
| Ordenes de Compra | `/ordenes-compra` | Si | Si | Si | PA | PA lectura | No | No | Lectura |
| Solicitudes de Traslado | `/solicitudes-traslado` | Si | Si | Si | PA | PA | No | No | No |
| Traslados | `/traslados` | Si | Si | Si | PA | PA | No | No | Detalle por recepcion |
| Recepciones | `/recepciones` | Si | Si | Si | PA | PA | No | No | Lectura |
| Facturas | `/facturas` | Si | Si | Si lectura | PA | PA lectura | No | No | Si |
| Reportes | `/reportes` | No | Si | No | PA | No | No | No | Si |
| Impuestos | `/impuestos` | Si | Si | Si lectura | Si lectura | Si lectura | No | No | Si |
| Retenciones | `/retenciones` | Si | Si lectura | No | Si lectura | No | No | No | Si |
| Proyectos | `/proyectos` | Si | Si | Si | PA | PA | PA | PA | Si |
| Usuarios | `/usuarios` | Si | Si | No | No | No | No | No | No |
| Datos Demo | `/datos-demo` | Si | No | No | No | No | No | No | No |
| Notificaciones | `/notificaciones` | Si | Si | Si | Si | Si | Si | No | No |

## Permisos por pantalla

| Pantalla | Roles con consulta | Roles con acciones principales |
| --- | --- | --- |
| Dashboard | ADM, AC, BC, AP, BP, IR, SUP. | Solo muestra indicadores y conteos segun alcance. CON es redirigido a Facturas. |
| Requisiciones | ADM, AC, BC, AP, BP, IR, SUP. AP/BP/SUP ven proyectos asignados; IR ve propias. | Crear/guardar/editar borrador: ADM, AC, BC, AP, BP, IR. Aprobar/rechazar autorizacion: ADM, AC, BC, AP, BP. Traducir SAP y asignar flujos: ADM, AC, BC, AP, BP. Rechazar item aprobado: ADM, AC, AP. SUP solo consulta. |
| Flujos de Abastecimiento | ADM, AC, BC, AP, BP, IR. IR queda en lectura sobre sus requisiciones. | Procesar todos los flujos: ADM, AC, BC. AP procesa compra directa y solicitud de compra. BP procesa compra directa, despacho, traslado y solicitud de compra. Convertir a orden de compra: ADM, AC, AP. |
| Logistica Inversa | Menu para AC y BC; ADM puede operar por ruta directa/API. | Crear devolucion, generar nota de credito, crear traslado a bodega central y cambiar estado: ADM, BC. AC queda como consulta visual si entra por menu. |
| Inventario | AC, BC, AP, BP desde menu; ADM por ruta directa/API. AP/BP segun proyectos/bodegas asignadas. | Crear/editar item de inventario en backend: ADM, AC. Reasignacion masiva/clasificacion de inventario: ADM, AC, BC. Kardex y detalle: roles con consulta. IR no tiene acceso. |
| Saldos Iniciales | ADM, AC, BC. | Crear, editar y consultar saldos iniciales: ADM, AC, BC. |
| Articulos | ADM, AC, BC, AP, BP, IR, SUP, CON. | Crear/editar catalogo: ADM, AC, BC. Resolver activos fijos pendientes: ADM, BC, CON. AP/BP/IR/SUP consultan sin modificar. |
| Activos fijos pendientes | ADM, CON. | Resolver codigo real y atributos de activo fijo: ADM, CON; BC tambien tiene permiso de resolucion desde Articulos aunque esta ruta solo aparece para ADM/CON. |
| Proveedores | ADM, AC, BC, AP, BP, CON. | Crear proveedor: ADM, AC. Editar catalogo/RTN/estado: ADM, AC, BC. Gestionar contactos, perfil fiscal y documentos: ADM, AC, BC, AP. BP y CON solo consultan. |
| Salidas de Inventario | ADM, AC, BC, BP. BP limitado por proyecto asignado. | Crear/gestionar salidas: ADM, AC, BC, BP. Generar devoluciones desde salida emitida: ADM, BC. |
| Almacenes | ADM, AC, BC, AP, BP. AP/BP segun proyecto/asignacion. | Crear/editar/desactivar bodegas: ADM, AC, AP. Marcar bodega central o multiproyecto: ADM, AC. BC y BP consultan bodegas asignadas. |
| Solicitudes de Compra | ADM, AC, BC, AP, BP. AP/BP por proyecto. | Crear/editar solicitud: ADM, AC, BC, AP. Adjuntar cotizaciones: ADM, AC, BC, AP, BP. Editar destino: ADM, AC, AP. Convertir a OC: ADM, AC, AP. Rechazar/anular: ADM, AP. BP consulta y adjunta cotizaciones. |
| Ordenes de Compra | ADM, AC, BC, AP, BP, CON. AP/BP por proyecto. | Crear desde solicitud de compra: ADM, AC, AP. Editar orden, precios, terminos, lineas, cancelar, reabrir borrador y enviar proveedor: ADM, AC, BC, AP segun estado. Adjuntos de OC: ADM, AC, AP si no esta recibida/anulada. BP y CON solo consultan. |
| Solicitudes de Traslado | ADM, AC, BC, AP, BP. AP/BP por proyecto origen o destino. | La creacion manual esta deshabilitada en UI. Convertir solicitud a traslado: ADM, BC, BP. Cancelar solicitud: ADM, BC. BP no ve cantidades de origen. |
| Traslados | ADM, AC, BC, AP, BP. AP/BP por proyecto. CON puede abrir detalle cuando viene desde recepciones. | Gestion operativa de traslado: ADM, AC, BC, AP, BP. CON no lista traslados, solo detalle requerido para consulta de recepciones. |
| Recepciones | ADM, AC, BC, AP, BP, CON. AP/BP por proyecto. | Crear/guardar borrador/registrar recepcion: ADM, AC, BC, AP, BP. Adjuntos de recepcion: ADM, AC, BC, AP, BP. Resolver activos fijos en recepcion: roles que gestionan recepcion y segun estado. Corregir recepcion con factura no contabilizada: ADM, AC, AP. CON solo consulta. |
| Facturas | ADM, AC, BC, AP, BP, CON. AP/BP por proyecto. | Editar factura y retenciones en borrador/rechazada: ADM, AC, AP. Enviar a revision: ADM, AC, AP. Contabilizar o rechazar desde Contabilidad: ADM, CON. Corregir recepcion asociada desde Facturas: ADM, AC, AP si no esta contabilizada. BC/BP consultan segun acceso. |
| Reportes | AC, AP, CON. AP limitado por proyecto. | Generar/descargar reportes DMC y SAR: AC, AP, CON. ADM no tiene acceso backend ni menu en el estado actual. |
| Impuestos | ADM, AC, BC, AP, BP, CON. | Crear/editar/desactivar impuestos: ADM, AC, CON. BC/AP/BP solo consultan. |
| Retenciones | ADM, AC, AP, CON. | Crear/editar/desactivar retenciones: ADM, CON. AC/AP solo consultan. |
| Proyectos | ADM, AC, BC, AP, BP, IR, SUP, CON. Roles de proyecto ven alcance asignado. | Crear proyectos: ADM, AC. Editar proyectos: ADM. Gestionar subproyectos: ADM, AC, AP. Gestionar bodegas de proyecto: ADM, AC, AP. Otros roles consultan. |
| Usuarios | ADM, AC. | Gestionar usuarios y roles: ADM, AC. AC no puede gestionar usuarios base `admin`. Invitaciones por correo usan procedimiento de admin, por lo que quedan para ADM. |
| Datos Demo | ADM. | Importar o borrar informacion demo: ADM. |
| Notificaciones | ADM, AC, BC, AP, BP, IR. | Ver y marcar notificaciones propias como leidas. No aparece para CON ni SUP. |

## Ventanas, modales y dialogos principales

| Pantalla | Ventana/modal | Quien puede abrirla | Permisos dentro del modal |
| --- | --- | --- | --- |
| Global | Mi perfil | Todos los usuarios autenticados con acceso al layout. | Ver informacion personal, rol y proyectos asignados. |
| Global | Cambiar contrasena / contrasena temporal | Todos los usuarios autenticados; obligatorio si `mustChangePassword`. | Actualizar contrasena propia. |
| Requisiciones | Detalle de requisicion | Roles con consulta de requisicion. | Acciones segun rol: aprobar, rechazar, traducir SAP, asignar flujo, registrar despacho o solo leer. |
| Requisiciones | Rechazar saldo pendiente | ADM, AC, BC. | Devuelve saldo pendiente con motivo. |
| Requisiciones | Rechazar item aprobado | ADM, AC, AP. | Rechaza item ya aprobado con motivo. |
| Requisiciones | Rechazar item | ADM, AC, BC, AP, BP. | Rechazo durante revision/autorizacion. |
| Requisiciones | Selectores SAP, bodega y flujo | Roles que pueden traducir/asignar/registrar despacho. | Busqueda de codigo SAP, seleccion de bodega y flujo operativo. |
| Flujos | Panel de procesamiento de flujo | ADM, AC, BC, AP, BP segun tipo de flujo. | Compra directa, despacho, traslado, solicitud de compra y conversion a OC segun rol. |
| Logistica Inversa | Detalle de devolucion | AC, BC; ADM por ruta directa/API. | BC/ADM pueden completar acciones; AC consulta. |
| Logistica Inversa | Generar nota de credito | ADM, BC. | Genera nota de credito para devolucion a proveedor. |
| Logistica Inversa | Nueva devolucion | ADM, BC. | Crear devolucion a bodega central, bodega proyecto, entre proyectos o proveedor. |
| Inventario | Nuevo item de inventario | UI: ADM, BC. Backend: ADM, AC. | Crea item de inventario; existe diferencia entre UI y backend para BC/AC. |
| Inventario | Clasificar inventario / asignacion masiva | ADM, AC, BC segun accion. | Clasifica o asigna inventario no clasificado a proyecto/bodega. |
| Inventario | Detalle de item | Roles con consulta. | Ver informacion de inventario. |
| Inventario | Kardex | Roles con consulta. | Consulta movimientos del item. |
| Saldos Iniciales | Nuevo saldo inicial | ADM, AC, BC. | Crear saldo inicial por proyecto/bodega. |
| Saldos Iniciales | Detalle de saldo inicial | ADM, AC, BC. | Ver o editar saldo segun estado. |
| Articulos | Crear articulo | ADM, AC, BC. | Alta de articulo en catalogo. |
| Articulos | Editar articulo | ADM, AC, BC. | Modificar datos de catalogo. |
| Articulos | Ver atributos del articulo | AP, BP, IR, SUP, CON y roles sin edicion. | Consulta de atributos. |
| Articulos | Resolver codigo de activo fijo | ADM, BC, CON. | Captura codigo real y detalles de activo fijo. |
| Proveedores | Nuevo proveedor | ADM, AC. | Alta de proveedor. |
| Proveedores | Editar proveedor | ADM, AC, BC, AP segun seccion. | Catalogo/RTN: ADM, AC, BC. Contactos/fiscal/documentos: ADM, AC, BC, AP. |
| Proveedores | Contactos del proveedor / Ver proveedor | BP, CON o roles sin permisos de edicion. | Consulta o gestion de contactos si AP/BC/AC/ADM. |
| Proveedores | Subir/editar documento | ADM, AC, BC, AP. | Adjuntar documentos del proveedor. |
| Proveedores | Tipos de documento | ADM, AC, BC, AP. | Administrar catalogo de tipos usado para documentos de proveedor. |
| Salidas de Inventario | Detalle de salida | ADM, AC, BC, BP. | Ver salida; BP por proyecto. |
| Salidas de Inventario | Entrega / despacho | ADM, AC, BC, BP. | Registrar entrega cuando hay saldo disponible. |
| Salidas de Inventario | Devolucion desde salida | ADM, BC. | Genera panel de devolucion sobre salida emitida. |
| Almacenes | Nueva bodega | ADM, AC, AP. | Crear bodega. AP solo para proyectos asignados. |
| Almacenes | Detalle/editar bodega | ADM, AC, AP; BC/BP en lectura. | Editar datos, proyectos y usuarios asignados segun rol. |
| Solicitudes de Compra | Detalle/editar solicitud de compra | ADM, AC, BC, AP, BP. | ADM/AC/BC/AP editan; BP consulta y adjunta cotizaciones. |
| Solicitudes de Compra | Correo preparado | Roles que preparan/envian solicitud. | Vista previa de correo relacionado a solicitud de compra. |
| Solicitudes de Compra | Selector de destino | ADM, AC, AP. | Define subproyecto o activo fijo destino. |
| Ordenes de Compra | Nueva orden de compra | ADM, AC, AP. | Crear OC desde solicitud de compra. |
| Ordenes de Compra | Detalle/editar orden de compra | ADM, AC, BC, AP; BP/CON lectura. | Editar estructura, proveedor, precios, terminos, contrato y lineas segun estado. |
| Ordenes de Compra | Confirmaciones de reabrir/cancelar/enviar | ADM, AC, BC, AP segun accion y estado. | Confirma acciones sensibles de OC. |
| Ordenes de Compra | Selectores de origen/proveedor/contacto/reemplazo SAP | Roles con creacion o edicion de OC. | Busqueda y seleccion de SC, proveedor, contacto o item SAP. |
| Solicitudes de Traslado | Nueva solicitud de traslado | Deshabilitada en UI (`allowManualTransferRequests = false`). | No se usa desde pantalla; traslados salen desde requisicion/flujo. |
| Solicitudes de Traslado | Detalle de solicitud | ADM, AC, BC, AP, BP. | ADM/BC/BP convierten; ADM/BC cancelan. |
| Solicitudes de Traslado | Cancelar solicitud de traslado | ADM, BC. | Anula solicitud y libera items. |
| Traslados | Detalle de traslado | ADM, AC, BC, AP, BP; CON por detalle vinculado a recepcion. | Consulta de traslado; gestion operativa segun rol backend. |
| Recepciones | Registrar recepcion | ADM, AC, BC, AP, BP. | Crear/guardar borrador/registrar recepcion desde OC o traslado. |
| Recepciones | Detalle de recepcion | ADM, AC, BC, AP, BP, CON. | Consulta; roles de gestion pueden imprimir, corregir, adjuntar o editar borrador segun estado. |
| Recepciones | Resolver codigo de activo fijo | Roles con gestion de recepcion cuando aplica. | Captura codigo real de activo fijo recibido. |
| Recepciones | Corregir recepcion | ADM, AC, AP. | Crea correccion cuando la factura vinculada no esta contabilizada. |
| Recepciones | Cerrar saldo de traslado | AC y AP con proyecto permitido. | Cierra saldo pendiente en recepcion de traslado. |
| Recepciones | Cerrar linea de recepcion | Roles con gestion de recepciones y condicion de cierre. | Cierra saldo de linea con confirmacion. |
| Facturas | Detalle/edicion de factura | ADM, AC, AP; BC/BP/CON consulta segun estado. | ADM/AC/AP editan borrador/rechazada y envian a revision. |
| Facturas | Corregir recepcion | ADM, AC, AP. | Correccion de recepcion asociada si factura no esta contabilizada. |
| Facturas | Rechazar factura | ADM, CON. | Rechaza factura revisada con comentario. |
| Facturas | Adjuntos de factura | Ver: roles con acceso a factura. Gestionar: ADM, AC, AP en borrador/rechazada. | Subir/eliminar documentos. |
| Impuestos | Nuevo/editar impuesto | ADM, AC, CON. | Crear, editar, activar o desactivar impuesto. |
| Retenciones | Nueva/editar retencion | ADM, CON. | Crear, editar, activar o desactivar retencion. |
| Proyectos | Nuevo proyecto | ADM, AC. | Alta de proyecto. |
| Proyectos | Detalle de proyecto | Roles con consulta de proyectos. | ADM edita proyecto; ADM/AC/AP gestionan subproyectos y bodegas de proyecto. |
| Usuarios | Nuevo usuario directo | ADM, AC. | Crear usuario y asignar rol/proyectos. |
| Usuarios | Invitar usuario | ADM. | Crear invitacion por correo. |
| Usuarios | Editar usuario | ADM, AC. | Cambiar rol/proyectos; AC no gestiona usuarios base `admin`. |
| Usuarios | Restablecer contrasena temporal | ADM, AC. | Generar contrasena temporal si puede gestionar el usuario. |
| Usuarios | Asignacion de proyectos | ADM, AC. | Seleccionar proyectos por rol. |
| Datos Demo | Borrar informacion demo | ADM. | Confirmacion para limpiar datos demo. |

## Observaciones tecnicas relevantes

- `admin` no aparece en el menu de Inventario y Logistica Inversa porque esos items no incluyen `admin` en la lista de roles del menu. Aun asi, varias APIs y paginas permiten operar al Super Admin si entra por ruta directa.
- Reportes no incluye `admin` ni en menu ni en backend; solo AC, AP y CON pueden consultar/generar reportes.
- Inventario tiene una diferencia entre frontend y backend: el frontend muestra "Nuevo item de inventario" a ADM y BC, pero el backend permite crear/editar item solo a ADM y AC. La reasignacion masiva si permite ADM, AC y BC.
- Logistica Inversa permite a AC ver la pantalla desde el menu, pero las acciones operativas principales estan protegidas para ADM y BC.
- Contabilidad puede consultar Ordenes de Compra y Recepciones, incluyendo adjuntos, pero no puede crear, modificar, registrar ni administrar adjuntos en esos modulos.
- Los adjuntos heredan reglas por entidad: Proveedores, Ordenes de Compra, Recepciones, Facturas, Solicitudes de Compra y Requisiciones tienen validaciones backend propias para ver o administrar documentos.
- Los roles AP, BP, IR y SUP deben interpretarse con alcance por proyecto cuando el registro pertenece a un proyecto. IR se limita principalmente a sus propias requisiciones; SUP queda en lectura para requisiciones y articulos.
