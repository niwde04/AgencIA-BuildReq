# BuildReq - Matriz de Brechas y Plan

Fecha de revision: 2026-04-12

## Estado General

La app actual ya cubre autenticacion, roles base, requisiciones con items, flujos por item, inventario, devoluciones, usuarios, invitaciones y una seccion basica de ordenes de compra. Sin embargo, varios requerimientos nuevos todavia estan `parcial` o `no estan`, especialmente en compras urgentes, solicitudes de compra como modulo propio, recepciones, traslados formales y reglas de inventario comprometido.

## Matriz

| Area | Requerimiento | Estado | Evidencia actual | Brecha |
| --- | --- | --- | --- | --- |
| Requisiciones | Renombrar `Solicitudes` a `Requisiciones` | Esta | El menu y las pantallas principales ya muestran `Requisiciones` | Revisar mas textos secundarios al seguir iterando |
| Requisiciones | Todo pasa primero por bodega del proyecto | No esta | Hoy la requisicion puede dirigirse a `bodega_central`, `administrador_proyecto` o `solicitud_compra` | Falta rediseñar el flujo principal |
| Requisiciones | Bienes van a Bodega y servicios a Oficina Central | No esta | No existe clasificacion `bienes/servicios` en esquema o UI | Requiere cambios de modelo y UI |
| Requisiciones | Admins deben ver todo | Esta | Los administradores del sistema ya tienen visibilidad amplia | Mantener al agregar nuevos modulos |
| Requisiciones | Agregar `Fecha necesaria` | Parcial | Ya esta implementado en esquema, backend, UI y BD conectada | Falta extenderlo al resto de modulos que consumen compras |
| Requisiciones | Clasificacion `Urgente / No urgente` | Parcial | Ya existe logica, captura en UI y persistencia en BD | Falta extenderlo al resto de modulos que consumen compras |
| Requisiciones | Politica de 5 dias calendario | Parcial | La UI muestra la politica y el backend asigna `+5 dias` a no urgentes | Falta llevarla a reportes, compras y alertas mas avanzadas |
| Requisiciones | Notificacion por vencimiento | Parcial | Ya se emite notificacion base con fecha necesaria al crear la requisicion | Falta motor de recordatorios o alertas proactivas cercanas al vencimiento |
| Compras | Generar OC en la app | Parcial | Ya existe conversion de SC a OC y correlativo | Falta documento formal, proveedor, impresion y envio |
| Inventario | Inventario comprometido | No esta | Solo existe `currentStock` y `minimumStock` | Falta calculo basado en items pendientes |
| Inventario | Despacho parcial + SC automatica por faltante | No esta | Existe `deliveredQuantity`, pero no automatiza faltantes | Falta logica de negocio |
| Flujos | Campo `Cantidad despachada` en pantalla de flujo | Parcial | Existe en datos como `deliveredQuantity` | No esta expuesto en pantalla de flujo |
| Flujos | Si despacha menos, permitir SC o pedir a bodega | No esta | No hay rama automatica posterior al parcial | Falta UX + reglas |
| Flujos | Flujo SC local -> Bodega Central / extranjera -> Oficina Central | Parcial | Existe `purchaseType local/extranjera` | No existe destino operativo visible |
| OC | Separar `OC` y `CD` | No esta | Hay una sola pantalla de ordenes de compra | Falta clasificacion y columnas |
| Item | Flujo por item | Esta | Ya existe `assignedFlow` por item y UI inline | Mantener |
| Item | Existencias en SAP por item | No esta | Solo hay traduccion SAP y catalogo | Falta campo e integracion |
| Item | Mostrar existencias del proyecto | No esta | Inventario no esta modelado por proyecto | Falta esquema y consultas |
| SC | Modulo propio `Solicitudes de Compra` | No esta | Hoy la SC vive dentro de `supplyFlowRecords` | Falta menu, tabla, pantalla y acciones |
| SC | Imprimir / editar / descargar documento / adjuntar cotizacion | No esta | No existe modulo propio | Falta todo el flujo documental |
| Compras | Seleccionar solo algunos items para OC | No esta | La conversion actual opera sobre el flujo, no seleccion de items | Falta UI y modelo |
| Compras | Cambiar item en la OC si ya no existe | No esta | No hay reemplazo de item en OC | Falta interfaz y trazabilidad |
| Traslados | Solicitudes de Traslado y Traslados como modulos | No esta | Solo existe el flujo `traslado_proyecto` | Falta menu, tablas y acciones |
| Traslados | Guia de Remision | No esta | No existe en esquema ni UI | Falta documento y correlativo |
| Flujos | Eliminar `Despacho de Bodega` y dejar 3 flujos | No esta | `despacho_bodega` sigue en esquema, backend y frontend | Requiere refactor completo |
| Requisiciones | Agregar `Salida de bodega` en tabla | No esta | No hay columna en detalle/listado | Falta UI y datos |
| Recepciones | Modulo `Recepciones` | No esta | No existe ruta ni esquema | Falta todo el modulo |
| Compras | Permitir rechazar SC | No esta | No existe estatus de rechazo para SC | Falta modelo y permisos |
| Flujo | Bodega -> Administrador del Proyecto -> aprueba/rechaza | No esta | El flujo actual no tiene esa aprobacion intermedia | Requiere rediseño |

## Cambios Seguros Aplicados en Esta Iteracion

- Renombrar el lenguaje visible de `Solicitudes` a `Requisiciones` en menu y pantallas principales.
- Alinear textos del dashboard y mensajes principales para hablar de requisiciones.
- Agregar `Urgente / No urgente` y `Fecha necesaria` en la creacion de requisiciones.
- Calcular automaticamente la fecha necesaria para compras no urgentes con la politica de `5 dias calendario`.
- Validar que una compra urgente tenga fecha manual y que esa fecha quede dentro de la ventana definida por la politica.
- Mostrar `Urgencia` y `Fecha necesaria` en listado y detalle de requisiciones.
- Incluir la fecha necesaria en las notificaciones de registro de la requisicion.

## Plan Propuesto

### Fase 1 - Lenguaje y campos base

- Renombrar toda la capa visible a `Requisiciones`.
- Agregar `fechaNecesaria`, `clasificacionUrgencia` y texto de politica.
- Definir reglas:
  - Urgente: requiere fecha manual.
  - No urgente: calcular fecha +5 dias calendario.
- Emitir notificacion base ligada a la fecha necesaria.

### Fase 2 - Rediseño del flujo de negocio

- Agregar tipo `bienes/servicios`.
- Introducir destino operativo real:
  - Bienes -> Bodega.
  - Servicios -> Oficina Central.
- Crear o formalizar rol `Administrador del Proyecto`.
- Hacer que toda requisicion pase primero por bodega del proyecto.

### Fase 3 - Compras como modulos propios

- Crear modulo `Solicitudes de Compra`.
- Expandir `Ordenes de Compra`.
- Separar `OC` y `CD`.
- Permitir imprimir, editar, descargar y adjuntar cotizacion.

### Fase 4 - Inventario y abastecimiento avanzado

- Calcular inventario comprometido.
- Soportar despacho parcial con faltante automatico.
- Mostrar existencias SAP y existencias del proyecto por item.
- Eliminar `Despacho de Bodega` del modelo de flujo final.

### Fase 5 - Traslados y recepciones

- Crear `Solicitudes de Traslado` y `Traslados`.
- Crear `Recepciones`.
- Agregar `Guia de Remision` y correlativos SAP.

## Nota de Implementacion

La parte de `fecha necesaria` y urgencia ya fue aplicada tambien sobre la BD conectada el 2026-04-12. Los siguientes pasos fuertes, como recepciones, SC como modulo y cambios de flujo principal, seguiran requiriendo cambios de esquema y conviene tratarlos con el mismo cuidado si el entorno apunta a una base productiva.
