# Plan de integración BuildReq–SAP con colas persistentes y recuperación de errores

Fecha: 17 de septiembre de 2026.

**Estado: plan guardado para implementación posterior. No implementado.** Guardar este documento no autoriza ejecutar migraciones, desplegar servicios ni enviar documentos a SAP.

Estudio de referencia: [Estudio de ERP Sync](estudio-api-sap.md).

Documentación de la API: [ReDoc](http://192.168.10.82:3030/docs) y [OpenAPI](http://192.168.10.82:3030/docs/private/api.json).

## Decisiones acordadas con el usuario

- Cubrir todo lo que permita sincronizar la API, usando los flujos y datos existentes en BuildReq.
- Si ERP Sync o SAP están caídos, completar la contabilización local y conservar el envío pendiente.
- Incluir un módulo de administración de colas, reintentos, resultados inciertos y cola muerta.
- **Guardar las colas en la base PostgreSQL de Supabase que utiliza BuildReq**, mediante tablas privadas de integración. Un worker del backend procesará esas tablas; las colas no dependerán de la memoria del servidor ni del navegador.
- Solo podemos consumir ERP Sync; el plan no depende de modificar su implementación.
- Revisar las diferencias de proveedores existentes antes de actualizarlos, sin sobrescritura automática.
- Automatizar desde una fecha de corte; incorporar históricos mediante selección y revisión manual.
- No crear nuevas pantallas contables para capturar los datos faltantes de notas o conciliaciones. Las operaciones incompletas deben quedar bloqueadas con una explicación.
- La implementación queda para después. No hay código de integración, migraciones, worker ni llamadas de negocio ejecutadas como parte de este plan.

## 1. Arquitectura y decisiones principales

Implementar una **bandeja de salida transaccional —outbox— en PostgreSQL de Supabase**, un **worker separado** y un módulo **“Integración SAP”** para supervisar y recuperar operaciones.

La contabilización local y el registro del envío pendiente se guardarán en la **misma transacción**. Si ERP Sync está desconectado, BuildReq continuará operando y conservará los pendientes. Si falla la persistencia del pendiente, se revertirá esa transacción para evitar documentos contabilizados que nunca se envíen. Este es el propósito del patrón [transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).

**Flujo:**

**Operación en BuildReq → pendiente durable en Supabase → worker → ERP Sync → procesamiento en SAP → confirmación en BuildReq.**

- Usar PostgreSQL, ya presente en el proyecto, como almacenamiento de la cola. No incorporar Redis ni otro intermediario en esta entrega.
- Ejecutar el worker como servicio independiente en Docker Compose/Dokploy, construido desde el mismo proyecto.
- Separar la entrega **BuildReq → ERP Sync** del procesamiento **ERP Sync → SAP**. Un HTTP 201 confirma recepción, no contabilización final en SAP.
- Cubrir las capacidades publicadas: proveedores, facturas, pagos, anticipos, notas de crédito, conciliaciones y consulta de registros.
- Automatizar documentos nuevos desde una fecha de corte. Los históricos requerirán selección y revisión previa.
- Comparar proveedores existentes antes de actualizarlos; las diferencias necesitarán una decisión de Contabilidad.
- Integrar los flujos existentes, sin crear nuevas pantallas contables de captura. Una operación sin datos suficientes quedará **bloqueada con una explicación concreta**.

**Límite fundamental:** la API no ofrece una garantía documentada de idempotencia para todas las escrituras. Por ello, la solución no prometerá ejecución remota “exactamente una vez”. Evitará reenvíos automáticos cuando exista la posibilidad de que el documento ya se haya creado.

## 2. Operaciones, dependencias y datos persistentes

### Disparadores de sincronización

| Operación | Disparador y comportamiento |
| --- | --- |
| Proveedores | Al requerirse para un documento nuevo, consultar por código y crear si falta. Detectar cambios posteriores de campos compatibles y presentar diferencias antes de actualizar. |
| Facturas | Al contabilizar una factura revisada, guardar su operación pendiente dentro de la transacción existente. Esperar a que su proveedor esté resuelto. |
| Pagos | Al contabilizar un abono confirmado por el banco en Tesorería. Crear un pago por línea contabilizada, usando el importe efectivamente pagado. |
| Anticipos | Al contabilizar el desembolso correspondiente. Registrar un pago sin asignaciones únicamente cuando ese comportamiento y sus campos requeridos estén verificados. |
| Aplicaciones de anticipos | Registrar cada incremento aplicado como un evento inmutable; generar la conciliación cuando estén confirmados la factura y los pagos origen. |
| Notas de crédito | Vincular la operación con el flujo actual de devolución a proveedor. Enviar únicamente si existen factura origen, importes y correspondencia de líneas verificables. |
| Conciliaciones | Reflejar aplicaciones existentes que aún no se hayan enviado. No volver a aplicar pagos que ya llevaron asignaciones en su creación. |
| Consultas y registros | Recuperar estados, referencias SAP, saldos, eventos e intentos para seguimiento y diagnóstico. |

Las aplicaciones de anticipos necesitan atención especial: hoy BuildReq puede **incrementar un importe acumulado**. La integración capturará el incremento individual, no reenviará el total acumulado. Cuando un anticipo tenga varios desembolsos, distribuirá las aplicaciones por orden de contabilización de esos desembolsos, reservando sus saldos para impedir dobles aplicaciones.

El worker nunca volverá a ejecutar contabilizaciones locales, movimientos de inventario ni descuentos de saldo como parte de un reintento.

### Persistencia

Añadir estructuras propias de integración en PostgreSQL de Supabase, manteniendo los registros SAP anteriores como antecedentes:

- **Operaciones/outbox:** entidad local, ambiente y destino, acción, clave única, instantánea de datos, versión del mapeo, dependencias, estado, próxima ejecución y reserva temporal del worker.
- **Intentos y auditoría:** solicitud identificada, resultado HTTP, duración, error clasificado, actor, fechas y acciones de recuperación. Sin credenciales.
- **Correspondencias:** identificador local, UUID de ERP Sync, identificadores SAP y relaciones entre líneas y asignaciones.
- **Control de conexión:** pausa operativa, capacidades habilitadas, fecha de corte, límites y estado del circuito de protección.

La identidad de una creación financiera será estable por **ambiente, destino, tipo de documento y entidad local**. Un reintento, reinicio o regreso a revisión no generará una identidad nueva para recrear el mismo documento.

Las facturas y pagos conservarán dos estados independientes:

- **Estado local:** contabilizada, revisada y demás estados actuales.
- **Estado de integración:** pendiente, procesando, esperando dependencia, esperando SAP, bloqueada, resultado incierto, cola muerta, sincronizada o cancelada antes del envío.

Las correcciones locales deberán coordinarse con la cola: antes de enviar podrán invalidar el pendiente de forma atómica. Si el documento está en tránsito, aceptado o confirmado, no se permitirá que una corrección origine otra creación. Se requerirá resolver la situación remota, porque la API no publica edición o cancelación de esos documentos.

## 3. Procesamiento, reintentos y cola muerta

### Worker y concurrencia

- Reservar trabajos mediante transacciones cortas y `FOR UPDATE SKIP LOCKED`, mecanismo que PostgreSQL contempla para consumidores de tablas de cola. [Referencia oficial](https://www.postgresql.org/docs/current/sql-select.html).
- Cerrar la transacción antes de llamar a la API.
- Utilizar una reserva de **90 segundos**, renovada cada **15 segundos**, y un token de propiedad para impedir actualizaciones tardías de un worker que perdió el trabajo.
- Registrar que comenzó el envío antes de iniciar una escritura remota. Un worker caído después de ese punto dejará la operación para verificación, no para reenvío ciego.
- Mantener orden por proveedor y documento, respetando dependencias entre factura, pago y conciliación.
- Valores iniciales configurables: **un worker, una escritura simultánea, dos lecturas simultáneas, máximo global de una solicitud por segundo y pool del worker de dos conexiones**.
- Reservar capacidad tanto para envíos como para consultas de confirmación, evitando que una acumulación de lecturas paralice los documentos nuevos.

### Política de errores

| Situación | Acción |
| --- | --- |
| GET con timeout, 429 o error temporal 5xx | Reintentar con espera progresiva y variación aleatoria; respetar `Retry-After`. |
| Escritura que se puede demostrar que no salió del cliente | Reprogramar con la política limitada de reintentos. |
| POST con timeout, desconexión tras comenzar el envío, 5xx o respuesta ilegible | Marcar **resultado incierto** y buscar evidencia del resultado antes de repetir. |
| 400 o datos locales incompatibles | Bloquear indicando los campos o reglas por corregir. |
| 401/403 | Pausar la conexión y avisar al administrador; no consumir intentos de todos los documentos. |
| 404 | Resolver la referencia o dependencia faltante; no tratarlo automáticamente como error temporal. |
| 409 | Investigar duplicado o conflicto. Solo vincular un objeto remoto si se verifica que corresponde a la operación local. |
| ERP Sync aceptó el documento y SAP lo rechazó | Consultar registros e intentos. No volver a crear el documento. |
| Intentos seguros agotados | Pasar el trabajo a la **cola muerta**. |

Para llamadas cuya repetición sea segura: **ocho intentos totales**, con esperas base de **15 segundos, 1 minuto, 5 minutos, 15 minutos, 1 hora, 3 horas y 6 horas**, añadiendo variación aleatoria. Conexión limitada a **5 segundos** y llamada completa a **30 segundos**.

Los reintentos con efectos externos necesitan idempotencia o conciliación del resultado; una política de espera, por sí sola, no evita duplicados. [Referencia sobre reintentos seguros](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).

### Desconexiones y seguimiento de SAP

- Abrir el circuito después de **cinco fallos técnicos consecutivos** y suspender nuevas entregas durante **cinco minutos**.
- Probar la recuperación con una sola lectura controlada. Las pausas del circuito no consumirán intentos de cada documento.
- Tras aceptación, consultar el estado a los **15 segundos**, después cada minuto durante los primeros 30 minutos y cada cinco minutos hasta 24 horas.
- A las 24 horas sin resolución, pasar a **requiere revisión**, conservando el UUID remoto. La demora no autoriza otra creación.
- Un fallo al consultar estado no convertirá automáticamente una factura en fallida ni permitirá reenviarla.
- El reintento remoto mediante `/logs/{id}/retry` será una acción controlada sobre el evento correcto, habilitada cuando ERP Sync informe que puede reintentarse. Después se continuará observando ese mismo documento.

### Cola muerta y resultados inciertos

La cola muerta será una clasificación persistente; no se borrará el mensaje ni se perderá su historial.

Permitir:

- Ver causa, intentos, dependencias y documento relacionado.
- Corregir datos en los módulos existentes y volver a validar.
- Reprogramar únicamente operaciones que se puedan repetir con seguridad.
- Vincular un documento remoto existente con verificación y motivo auditado.
- Cerrar una incidencia conservando su evidencia.

**No habrá un botón de “reenviar todo” que incluya documentos con resultado incierto.** Para facturas sin UUID recuperable, la API actual no permite una búsqueda general fiable: esos casos necesitarán conciliación manual con el responsable de ERP Sync.

## 4. Módulo de colas, permisos y contratos

Crear la ruta **“Integración SAP”**, reutilizando los componentes actuales de BuildReq.

La pantalla tendrá:

- Resumen de pendientes, esperando SAP, bloqueados, inciertos y cola muerta.
- Filtros por operación, proyecto, proveedor, documento, fecha y estado.
- Paginación, búsqueda y ordenamiento en servidor; 25 filas por defecto, opciones de 50 y 100.
- Detalle con cronología, intentos, próxima ejecución, dependencias, referencias remotas y error comprensible.
- Acciones de verificar estado, revalidar, reintentar de forma segura, revisar diferencias de proveedor y seleccionar históricos.
- Actualización automática cada 15 segundos mientras la pantalla esté visible.
- Indicador SAP y enlace al detalle de integración en facturas y pagos.

**Permisos propuestos:**

- **Superadministrador:** configuración, pausa global, habilitación de capacidades y resolución de vínculos ambiguos.
- **Contabilidad:** supervisión, revisión de diferencias de proveedores, históricos y recuperación permitida.
- Los demás usuarios autorizados sobre el documento podrán ver su estado SAP, sin acceder al control global de las colas.
- Todas las comprobaciones se ejecutarán en backend, respetando el acceso por proyecto.

Añadir un router tRPC protegido para listado, detalle, métricas y acciones. Ninguna llamada desde el navegador accederá directamente a ERP Sync.

Las tablas de integración quedarán en un esquema privado, fuera de la exposición de la Data API, con permisos para los procesos necesarios. `X-Auth-Key` se guardará como secreto del worker. Las URL devueltas por `Location` deberán pertenecer al origen y rutas permitidos; no se enviará la clave a redirecciones arbitrarias.

### Condiciones para habilitar cada operación

El cliente de ERP Sync tendrá adaptadores explícitos y validación de entradas y respuestas. No se generará directamente desde el OpenAPI sin tratar sus inconsistencias.

Cada capacidad quedará deshabilitada para escritura hasta verificar los aspectos que necesita:

- Formato real de respuestas 201 y ubicación del UUID.
- Parámetros de filtros y paginación.
- Moneda, impuestos, retenciones y significado de `line_total`.
- Confirmación del proveedor y clasificación `is_local`.
- Valores de `source_type` y estados de sincronización.
- Numeración de líneas para notas de crédito.
- Reglas de anticipos y cuentas de transferencia.

**No se inventarán valores ni se descartarán conceptos contables para hacer que el documento pase.** Si BuildReq carece de un dato obligatorio y no existe una fuente verificada, la operación quedará bloqueada. Esto respeta la decisión de integrar lo existente sin añadir formularios contables nuevos.

## 5. Entrega, operación y pruebas de aceptación

### Secuencia de implementación

1. **Cerrar el contrato consumible:** consolidar el estudio, preparar respuestas de referencia y probar los comportamientos necesarios en un ambiente autorizado de pruebas. Sin cambios en ERP Sync.
2. **Construir la base durable:** migraciones aditivas, outbox en Supabase, correspondencias, worker, control de concurrencia y auditoría.
3. **Entregar el módulo de colas** y conectar proveedores y facturas.
4. **Conectar pagos, anticipos y aplicaciones**, manteniendo separados desembolso y conciliación.
5. **Conectar notas y demás operaciones compatibles**; mostrar expresamente las que queden bloqueadas por falta de datos.
6. **Activar progresivamente:** modo de validación sin envío, piloto de un proyecto y habilitación por capacidad.
7. **Incorporar históricos seleccionados**, con vista previa de documentos, dependencias, vínculos existentes y posibles duplicados.

Las pausas operativas conservarán la captura de nuevas operaciones. Reanudar no descartará pendientes. El apagado del worker dejará de reservar trabajos y permitirá terminar las llamadas en curso.

Supervisar profundidad y antigüedad de cola, demora hasta confirmación SAP, fallos por operación, resultados inciertos, cola muerta, circuito y latido del worker. Crear alertas internas para autenticación fallida, worker sin latido por dos minutos, nuevos resultados inciertos y pendientes sin iniciar por más de 15 minutos. Agrupar alertas repetidas durante una desconexión.

El respaldo incluirá operaciones, correspondencias e historial. **Después de restaurar una base de datos, los envíos permanecerán pausados hasta reconciliar con ERP Sync**, porque SAP podría contener operaciones posteriores al respaldo.

### Pruebas obligatorias

- Rollback local: no queda un envío pendiente sin su operación contable.
- Commit seguido de caída: el pendiente se recupera tras reiniciar.
- Doble clic, dos workers y solicitudes concurrentes: una sola operación lógica.
- Caída antes, durante y después del POST, incluida respuesta aceptada que no pudo guardarse.
- Expiración de reservas y rechazo de actualizaciones tardías del worker.
- 400, 401/403, 404, 409, 429, 5xx, respuestas inesperadas y espera progresiva.
- Desconexión prolongada y recuperación sin avalancha de solicitudes.
- Factura esperando proveedor; pago esperando factura; conciliación esperando todos sus documentos.
- Anticipos pagados en partes y aplicaciones incrementales sin duplicar importes.
- Notas sin factura o numeración de líneas: bloqueo explícito y sin repetir movimientos de inventario.
- Corrección y regreso a revisión de documentos pendientes, aceptados y sincronizados.
- Reprocesamiento de cola muerta conservando identidad e historial.
- Permisos por rol/proyecto, ausencia de secretos y validación de `Location`.
- Restauración de respaldo y conciliación antes de reanudar.
- Verificación del módulo en escritorio, móvil y navegación por teclado.

Ejecutar pruebas de integración con PostgreSQL real aislado y un servidor ERP simulado, además de las pruebas contables existentes, `pnpm check`, `pnpm test` y `pnpm build`.

**Criterio de aceptación:** toda operación contabilizada después de la fecha de corte queda durablemente registrada para integración; puede seguirse hasta su confirmación o hasta una causa explícita de bloqueo; sobrevive a reinicios; y ningún resultado incierto se convierte en otra creación automática.

## 6. Cómo retomar este trabajo

1. Leer este plan y el [estudio de ERP Sync](estudio-api-sap.md).
2. Confirmar el estado vigente del código y de la especificación; los hallazgos corresponden a la revisión del 17 de septiembre de 2026.
3. Retomar la secuencia de implementación de la sección 5 cuando el usuario solicite ejecutarla. Mantener las decisiones acordadas y no confundir capacidades documentadas con comportamientos probados.
4. Antes de escrituras reales, disponer del ambiente correspondiente, conectividad del worker y credenciales por el mecanismo seguro del despliegue. Este documento no contiene claves.

No se han ejecutado las pruebas de aceptación ni se han creado las tablas de colas. El estudio de la API y este plan son los entregables documentales existentes.
