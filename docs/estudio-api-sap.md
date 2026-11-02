# Estudio de ERP Sync para la integración de BuildReq con SAP

Fecha de revisión: 17 de septiembre de 2026.

**Estado: documentación consultada y analizada. Integración no implementada ni probada contra operaciones de negocio.**

## 1. Resultado principal y fuentes

La API se identifica como **ERP Sync | API, versión 1.0.0**, con especificación **OpenAPI 3.1.0**. Publica **23 operaciones sobre 19 rutas y 29 modelos de datos**, distribuidas en proveedores, facturas de proveedores, pagos, notas de crédito, conciliaciones y registros de integración.

Su documentación describe un servicio que recibe documentos y los encola para sincronizarlos con **SAP Business One**. Esto confirma el producto SAP de destino mencionado por el servicio; no identifica su versión, sociedad ni ambiente.

**El alcance publicado es principalmente financiero y de proveedores.** No se documentan operaciones de catálogo de artículos, existencias, almacenes, órdenes de compra, recepciones, salidas ni transferencias de inventario. Su ausencia en esta especificación no prueba que no existan en otros servicios, pero impide contar con ellas para esta integración.

Fuentes primarias consultadas:

- [Documentación ReDoc](http://192.168.10.82:3030/docs): respondió HTTP 200 al reintentar después de restablecer la conexión.
- [Especificación OpenAPI utilizada por ReDoc](http://192.168.10.82:3030/docs/private/api.json): respondió HTTP 200 y se examinó completa.
- Huella SHA-256 del contenido OpenAPI leído, codificado como UTF-8: `57365042a64497fa2bfcdf39ae387f21b804795a1ec59cf5899969742abe404d`.

La nota preliminar de falta de acceso queda sustituida por este estudio. Solo se hicieron lecturas de las páginas de documentación y de archivos locales: no se enviaron credenciales, no se invocaron endpoints de negocio y no se modificaron código, configuración, bases de datos ni datos de SAP.

En este documento, «documentado» significa declarado por OpenAPI; «propuesto» identifica una correspondencia o decisión por validar. No se ha comprobado el comportamiento real de las operaciones protegidas.

## 2. Acceso y reglas generales del contrato

| Aspecto | Lo documentado u observado |
| --- | --- |
| Origen consultado | `http://192.168.10.82:3030`, dentro de una red privada. |
| Prefijo de operaciones | `/api/v1`. |
| URL de operaciones | Las rutas se presentan relativas al origen consultado. OpenAPI no declara `servers`; confirmar con el responsable el origen y ambiente definitivos antes de implementar. |
| Autenticación | Esquema `api_key`, enviado en la cabecera `X-Auth-Key`. Las 23 operaciones declaran esta seguridad. |
| Acceso documental | `/docs` y `/docs/private/api.json` fueron legibles sin enviar clave. |
| Solicitudes con cuerpo | JSON, conforme al modelo de cada operación. |
| Consultas correctas | Generalmente HTTP 200 con `application/json`. |
| Altas | HTTP 201, cabecera `Location` y cuerpo `text/plain` de tipo string. No se debe asumir una respuesta JSON con un campo `id`. |
| Actualización de proveedor | HTTP 204. |
| Reencolado de evento fallido | HTTP 202; no equivale a sincronización terminada. |
| Identificadores | Facturas, pagos, notas de crédito, conciliaciones y eventos consultados por ruta usan UUID. Los proveedores se consultan y actualizan por `code`. |
| Importes y cantidades | Se definen como strings, incluidos `quantity`, `line_total`, `total` y `amount`. No se documentan precisión, redondeo, signo ni formato decimal. |
| Fechas | Fechas de negocio: string `date`; marcas de eventos: string `date-time`. |
| Transporte | La URL consultada es HTTP. No se ha comprobado un acceso HTTPS ni la conectividad desde el servidor que ejecutará BuildReq. |

La documentación no explica la emisión, rotación, caducidad o permisos de la clave, selección de sociedad, límites de llamadas, tiempos de espera, CORS ni disponibilidad. Tampoco especifica respuestas 401/403. La falta de esas respuestas en OpenAPI no significa que las operaciones sean públicas.

## 3. Inventario completo de operaciones

Las rutas de esta tabla son relativas al prefijo **`/api/v1`**. Los nombres entre paréntesis son los modelos publicados.

| Grupo | Método y ruta | Finalidad y respuesta de éxito |
| --- | --- | --- |
| Proveedores | POST `/suppliers` | Crear proveedor con `NewSupplier`; 201, texto y `Location`. |
| Proveedores | GET `/suppliers/{code}` | Consultar por código; 200 `SupplierView`. |
| Proveedores | PUT `/suppliers/{code}` | Actualizar con `SupplierUpdate`; 204. |
| Facturas | POST `/invoices` | Crear y encolar factura con `NewInvoice`; 201, texto y `Location`. |
| Facturas | GET `/invoices/{id}` | Consultar cabecera de factura; 200 `InvoiceDetail`. |
| Facturas | GET `/invoices/{id}/status` | Consultar sincronización; 200 `InvoiceStatus`. |
| Pagos | GET `/payments` | Listar pagos paginados; 200 `EntryPage`. |
| Pagos | POST `/payments` | Crear y encolar pago con `PaymentInput`; 201, texto y `Location`. |
| Pagos | GET `/payments/advances` | Consultar anticipos no aplicados de un proveedor; 200 lista de `Advance`. |
| Pagos | GET `/payments/invoices` | Consultar facturas con saldo disponible para pago; 200 lista de `PayableInvoice`. |
| Pagos | GET `/payments/{id}` | Consultar pago; 200 `PaymentDetail`. |
| Notas de crédito | GET `/credit-notes` | Listar notas paginadas; 200 `EntryPage`. |
| Notas de crédito | POST `/credit-notes` | Crear y encolar nota sobre una factura con `CreditInput`; 201, texto y `Location`. |
| Notas de crédito | GET `/credit-notes/advances` | Consultar notas sincronizadas con saldo disponible para conciliación de un proveedor; 200 lista de `Advance`. |
| Notas de crédito | GET `/credit-notes/{id}` | Consultar nota; 200 `CreditNoteDetail`. |
| Conciliaciones | GET `/reconciliations` | Listar conciliaciones paginadas; 200 `ReconciliationPage`. |
| Conciliaciones | POST `/reconciliations` | Crear y encolar aplicación de pagos o notas a facturas con `ReconciliationInput`; 201, texto y `Location`. |
| Conciliaciones | GET `/reconciliations/{id}` | Consultar conciliación y asignaciones; 200 `ReconciliationDetail`. |
| Registros | GET `/logs` | Listar eventos por tipo y página; 200 `LogPage`. |
| Registros | GET `/logs/types` | Consultar tipos de eventos registrados; 200 lista de `LogType`. |
| Registros | GET `/logs/{id}/attempts` | Consultar intentos de entrega de un evento; 200 lista de `Attempt`. |
| Registros | POST `/logs/{id}/retry` | Reencolar un evento en fallo terminal; 202. No declara cuerpo de solicitud. |
| Registros | GET `/logs/{object_type}/{object_id}` | Consultar eventos de un objeto; 200 lista de `LogEntry`. |

`object_type` admite, según su descripción, `suppliers`, `invoices`, `payments`, `reconciliations` o `credit-notes`. El identificador de objeto se declara UUID. No confundir el UUID de un objeto con el del evento que se usa para consultar intentos o solicitar reintentos.

No hay operaciones DELETE publicadas ni endpoints de edición o cancelación de documentos financieros. `LogEntry.can_delete` no viene acompañado de una ruta de borrado en esta especificación.

## 4. Contratos de entrada

«Obligatorio» se refiere exclusivamente a la lista `required` de OpenAPI. Pueden existir reglas de negocio adicionales no descritas. Las listas no declaran `minItems` y los importes string no tienen restricciones explícitas que garanticen valores positivos.

### 4.1. Proveedores

| Campo | Tipo | Creación `NewSupplier` | Actualización `SupplierUpdate` |
| --- | --- | --- | --- |
| `code` | string | Obligatorio. | Se identifica en la ruta; no figura en el cuerpo. |
| `name` | string | Obligatorio. | Obligatorio. |
| `is_active` | boolean | Obligatorio. | Obligatorio. |
| `is_local` | boolean | Obligatorio. | Obligatorio. |
| `allows_tax_withholding` | boolean | Obligatorio. | Obligatorio. |
| `federal_tax_id` | string o null | Opcional. | Opcional. |

El PUT documentado requiere los cuatro campos obligatorios: no asumir una actualización parcial. Tampoco se especifica si omitir `federal_tax_id` conserva o elimina su valor. No se documentan domicilio, correo, teléfono ni cuentas bancarias en estos cuerpos.

`SupplierView` devuelve `id`, `code`, `name`, `is_active`, `is_local`, `created_at` y `allows_tax_withholding`; además puede devolver `federal_tax_id` y `sap_card_code`, ambos nulos. El `id` se declara string sin formato UUID, aunque otras operaciones exigen un UUID en `supplier_id`: confirmar esa correspondencia. La creación de proveedor no describe con la misma claridad que las facturas cuándo termina su sincronización con SAP.

### 4.2. Facturas de proveedores

`NewInvoice` exige `supplier_code`, `project`, `posting_date`, `due_date` y `lines`.

| Campo | Tipo y observaciones |
| --- | --- |
| `supplier_code` | string obligatorio; debe corresponder al proveedor externo. |
| `project` | string obligatorio; confirmar si es el código SAP del proyecto. |
| `posting_date`, `due_date` | Fechas obligatorias, formato `date`. |
| `lines` | Lista obligatoria de `NewInvoiceLine`; mínimo de líneas no especificado. |
| `supplier_name`, `supplier_federal_tax_id` | Strings opcionales, admiten null; precedencia respecto del maestro no documentada. |
| `fiscal_info` | Opcional, admite null; cuando es objeto se aplican los campos fiscales siguientes. |

Cada `NewInvoiceLine` exige los cinco campos: `item_code`, `item_description`, `quantity`, `tax_code` y `line_total`. **Todos son strings.** No se declara precio unitario, unidad de medida, almacén, descuento, varios impuestos por línea, retenciones ni vínculo con líneas de una orden o recepción.

Tanto `DocumentFiscalInfo` como `InputDocumentFiscalInfo` contienen los mismos cinco campos obligatorios: `fiscal_number`, `authorization_code`, `fiscal_range_start`, `fiscal_range_end` e `issuance_deadline`. Los primeros cuatro son strings y el último es fecha. El primer modelo se utiliza en facturas y el segundo en notas de crédito.

Puntos que no deben inferirse:

- La creación de factura no incluye `currency`, `document_currency`, tipo de cambio, `external_reference` ni `reference`.
- La consulta devuelve `document_currency` y puede devolver `reference`, pero no explica cómo se determinan.
- No está definido si `line_total` incluye impuestos o si representa el importe antes de impuestos y descuentos.
- El esquema admite omitir `fiscal_info`; no explica la identificación ni prevención de duplicados para facturas sin información fiscal.
- No se documenta alta automática de artículos, ni de proveedores a partir de los datos opcionales de la factura.

### 4.3. Pagos a proveedores y anticipos

`PaymentInput` exige `external_reference`, `posting_date`, `transfer_date`, `bank_transfer_reference`, `total` y `allocations`.

Campos opcionales que admiten null: `supplier_id` —UUID—, `currency`, `project` y `transfer_account`. Los demás son strings, salvo las fechas y la lista según sus formatos.

Cada `Allocation` requiere `invoice_id` —UUID de la API— y `amount` —string—. La descripción permite crear pagos con asignación opcional a facturas, pero la propiedad `allocations` es obligatoria: una lista vacía es compatible con el esquema, sin demostrar qué condiciones de negocio habilitan un anticipo. Debe confirmarse cuándo se exige `supplier_id` y cómo se resuelven moneda, proyecto y cuenta de transferencia si se omiten.

El contrato no identifica métodos distintos de transferencia bancaria ni prueba que esta API ordene un movimiento bancario real; documenta registro y sincronización de pagos con SAP. No confundir el registro contable con la ejecución bancaria.

### 4.4. Notas de crédito

`CreditInput` exige `external_reference`, `source_invoice_id` —UUID—, `total`, `posting_date`, `due_date` y `allocations`. Admite `fiscal_info` opcional o null.

Cada `CreditAllocation` exige `line_number` —entero int32— y `amount` —string—. No se especifica si la numeración comienza en 0 o 1, si corresponde a la factura de ERP Sync o a SAP, ni si admite aplicaciones parciales. `GET /invoices/{id}` no documenta líneas, por lo que debe resolverse cómo conocer y conservar esa numeración.

El cuerpo no incluye proveedor, proyecto ni moneda. El detalle sí los expone; la forma de obtenerlos de la factura origen debe confirmarse con el responsable.

### 4.5. Conciliaciones

`ReconciliationInput` exige `external_reference`, `supplier_id` —UUID—, `project`, `recon_date` y `allocations`.

Cada `ReconciliationAllocation` exige `source_type`, `source_id` —UUID—, `invoice_id` —UUID— y `amount` —string—. La descripción indica que se aplican pagos o notas de crédito a facturas, pero **no define los valores literales válidos de `source_type`**. No inventar esos valores a partir de los nombres de rutas.

Confirmar restricciones por proveedor, sociedad, proyecto, moneda, saldo y estado de sincronización. Esta conciliación es aplicación de documentos de proveedor; no se debe equiparar automáticamente a la conciliación de un archivo bancario o al estado local `conciliacion` de tesorería.

## 5. Consultas, estados e identificadores

### 5.1. Confirmación asíncrona de facturas

La descripción de `GET /invoices/{id}/status` establece:

| Estado | Significado documentado |
| --- | --- |
| `queued` | Factura pendiente o en procesamiento. |
| `sent` | Sincronización completada correctamente. |
| `error` | Sincronización fallida o cancelada. |

`InvoiceStatus` contiene `status`, `message` y `timestamp`. El esquema representa `status` como string sin enum; los tres valores provienen de la descripción de la operación. No hay distinción en ese estado simplificado entre pendiente y procesando, ni entre fallo y cancelación.

**Un HTTP 201 confirma el alta en ERP Sync, no la terminación de la sincronización con SAP.** La futura integración debe conservar el identificador remoto, consultar el estado y registrar por separado la aceptación y la confirmación final.

### 5.2. Respuestas de detalle y saldos

| Modelo | Datos relevantes y límites |
| --- | --- |
| `InvoiceDetail` | UUID, proveedor, proyecto, moneda, fechas y `reference` opcional. `sap_doc_entry` y `sap_doc_num` pueden omitirse o ser null. No publica líneas, importes ni datos fiscales completos. |
| `PaymentDetail` | UUID, referencia externa, proveedor, moneda, fechas y total; proyecto opcional/null y referencias SAP opcionales/null. No declara la lista de asignaciones. |
| `CreditNoteDetail` | UUID, referencia, UUID de factura origen, proveedor, moneda, proyecto, fechas y total; referencias SAP opcionales/null. No declara sus asignaciones por línea. |
| `ReconciliationDetail` | UUID, referencia, proveedor, proyecto, fecha y asignaciones; `sap_recon_num` opcional/null. |
| `ReconciliationAllocationDetail` | Origen, factura y monto; agrega `source_sap_doc_num` e `invoice_sap_doc_num` opcionales/null. |
| `PayableInvoice` | UUID de factura y proveedor, código y nombre del proveedor, referencia, moneda, proyecto, vencimiento, saldo disponible y `sap_doc_num`. |
| `Advance` | UUID del objeto y proveedor, referencia externa, proveedor, moneda, proyecto, fecha, total, importe aplicado e importe disponible. Se reutiliza para anticipos y notas de crédito disponibles. |
| `Entry` | Identificación, referencia, proveedor, moneda, fecha, total, `sync_status`, `sync_terminal` y referencias SAP; importes aplicado y disponible opcionales/null. |
| `ReconciliationView` | Identificación, referencia, proveedor, proyecto, fecha, total, estado y marca terminal; número SAP de conciliación opcional/null. |

Conservar como conceptos distintos el identificador local de BuildReq, el UUID de ERP Sync, `sap_doc_entry`, `sap_doc_num` y, para conciliaciones, `sap_recon_num`. Un UUID de la API no sustituye a un código de proveedor ni a un número de documento SAP.

`EntryPage`, `ReconciliationPage` y `LogPage` devuelven `entries`, `page`, `total` y `page_size`. `page` se declara entero no negativo. No se explica si la primera página es 0 o 1, el tamaño usado, el orden estable ni si `total` cuenta registros o páginas. No hay parámetros de tamaño de página ni filtros de fecha publicados. Las consultas de anticipos, facturas pagables, tipos, eventos por objeto e intentos devuelven listas sin paginación documentada.

### 5.3. Seguimiento y reintentos

`LogEntry` incluye `id`, `timestamp`, `event_type`, `model_id`, `payload`, `status`, `inbox_status`, `message`, `retries`, `can_retry` y `can_delete`. `payload` tiene esquema libre. No se documentan enums de estados, política de retención de logs ni filtrado de información sensible.

`LogType` devuelve tipo, total y fecha más reciente. `Attempt` devuelve identificador, fecha, estado y mensaje de cada intento.

El reintento documentado actúa sobre un **evento en fallo terminal**, mediante `POST /logs/{id}/retry`. Hay respuestas 202, 409 y 500 con descripciones vacías. Confirmar qué eventos habilitan `can_retry`, límites de intentos y manejo de concurrencia. No se documentan webhooks, notificaciones salientes ni una política automática de espera entre intentos.

Para pagos, notas y conciliaciones no se publica un endpoint específico `/status`: el seguimiento disponible en el contrato está en los listados y registros por objeto, además de sus referencias SAP de detalle. No asumir que los valores de `sync_status`, `status` e `inbox_status` son intercambiables.

## 6. Errores, duplicados y recuperación

| Respuesta | Evidencia documental y tratamiento a definir |
| --- | --- |
| 400 | Datos, identificadores, configuración, paginación o asignaciones inválidos según operación. Corregir la causa antes de repetir. |
| 404 | Referencias u objeto inexistentes según operación. No asumir que sea un fallo temporal. |
| 409 | En proveedores y facturas, violación de restricciones únicas. En pagos, notas y conciliaciones, referencia externa existente. El conflicto de reintento no está explicado. |
| 500 | Error inesperado. En una escritura no demuestra por sí solo que no se haya creado el documento. |
| 401/403/429 | No documentados. Pedir al responsable el contrato de autenticación, permisos y límites. |

Las altas y varias consultas describen errores `text/plain`; otras respuestas solo tienen descripción sin esquema. No asumir que todos los errores sean JSON ni exponer al usuario todo el contenido técnico sin revisión.

No se declara `Idempotency-Key` ni otra cabecera equivalente. `external_reference` y los conflictos 409 permiten reconocer una posible protección frente a duplicados en pagos, notas y conciliaciones, pero no prueban sus alcances ni que repetir una solicitud devuelva el mismo objeto. Tampoco existe una consulta explícita por referencia externa para recuperar un alta cuya respuesta se perdió.

En facturas el problema es más importante: no hay referencia externa de entrada, listado general de facturas ni búsqueda documental por referencia. `/payments/invoices` solo describe facturas con saldo pagable, por lo que no debe considerarse una vía general de recuperación. Antes de permitir reintentos de creación debe acordarse cómo localizar una factura cuando se pierden su cuerpo de respuesta y `Location`.

Criterio propuesto: separar reintentar la entrega de un evento ya identificado de volver a crear el documento de negocio. Conciliar una respuesta incierta antes de repetir una creación; conservar siempre el UUID y la referencia externa cuando existan. La política concreta queda pendiente del responsable de la API.

## 7. Correspondencia propuesta con BuildReq

Esta tabla es una base para discutir el mapeo. La coincidencia de nombres no equivale a una validación de negocio ni autoriza a implementar todavía.

| Dato de ERP Sync | Candidato en BuildReq | Validación pendiente |
| --- | --- | --- |
| Proveedor `code` / factura `supplier_code` | `suppliers.supplierCode` | Compatibilidad con el código reconocido por ERP Sync y `sap_card_code`. |
| `name`, `is_active`, `allows_tax_withholding` | `suppliers.name`, `isActive`, `allowsTaxWithholding` | Acordar sistema dueño y reglas de actualización. |
| `federal_tax_id` | `suppliers.rtn` | Normalización y tratamiento de proveedores extranjeros. |
| `is_local` | Sin campo directo identificado en la tabla `suppliers` revisada. | Definir fuente y significado; no inferirlo únicamente del formato del RTN. |
| `supplier_id` UUID | Identificador remoto separado del entero `suppliers.id`. | Guardar la relación tras consulta o alta. |
| `project` | `projects.sapProjectCode` | Confirmar que este es el código que espera ERP Sync. |
| `posting_date`, `due_date` | `invoices.postingDate`, `invoices.documentDueDate` | Vencimiento local potencialmente nulo; fecha de negocio y zona horaria al convertir timestamp a date. |
| `fiscal_number`, `authorization_code` | `invoices.invoiceNumber`, `invoices.cai` | Reglas para documentos fiscales y no fiscales. |
| `fiscal_range_start`, `fiscal_range_end`, `issuance_deadline` | `documentRangeStart`, `documentRangeEnd`, `emissionDeadline` | Usar la información correspondiente al documento y preservar su historial. |
| `item_code` | `invoiceItems.currentSapItemCode` o `originalSapItemCode` | Elegir código definitivo y comprobar que exista en el sistema destino. |
| `item_description`, `quantity`, `tax_code` | `invoiceItems.itemName`, `quantity`, `taxCode` | Catálogo de impuestos, unidades y precisión aceptados. |
| `line_total` | `invoiceItems.subtotal` o `total`, según definición por confirmar. | No elegir hasta aclarar impuestos incluidos, descuentos y cargos. |
| Moneda y tipo de cambio de factura | `invoices.currency`, `exchangeRate`, `exchangeRateDate` | No tienen entrada explícita en `NewInvoice`; bloquear un mapeo silencioso por defecto. |
| `external_reference` de pago | Referencia estable a acordar para la operación local. | No asumir que un lote de tesorería equivale a un solo pago o proveedor. |
| `bank_transfer_reference`, `transfer_date`, `total` | `treasuryPaymentItems.bankReference`, `bankPaidDate`, `bankPaidAmount` | Elegir el hecho bancario confirmado y reglas de agrupación, no confundir monto solicitado con pagado. |
| `allocations.invoice_id` | Relación entre `invoices.id` local y UUID remoto. | Necesaria antes de aplicar pagos o conciliaciones. |
| Anticipo ERP Sync | `purchaseOrderAdvances` y fuentes de tesorería, según negocio. | El anticipo local ligado a una OC no tiene vínculo explícito a una OC en `PaymentInput`. |

Diferencias relevantes encontradas en los archivos locales:

- BuildReq maneja moneda, tipo de cambio, impuestos adicionales, retenciones, descuentos, otros cargos, exoneraciones, datos de importación y activos. Los cuerpos publicados no tienen equivalentes explícitos para todos esos conceptos. Deben clasificarse con el proveedor antes de enviar documentos reales.
- `sapSyncLog` tiene estados `pending`, `success` y `error`, pero sus tipos de entidad actuales son `supply_flow`, `reverse_logistic` e `inventory`. No documenta por sí mismo las relaciones específicas de esta API con facturas, pagos, proveedores, notas y conciliaciones. Habría que diseñar su representación; no se realizaron cambios.
- La acción `sendToSap` de requisiciones revisada crea registros locales pendientes, cambia el estado y muestra «Requisición enviada a SAP»; no realiza una llamada HTTP en esa función. Sus etiquetas de salidas, solicitudes, transferencias y órdenes de compra no corresponden a endpoints publicados en esta especificación. No debe conectarse directamente a esta API asumiendo equivalencia.
- Esa acción utiliza `request.project.code`, aunque existe `sapProjectCode`, y registra el identificador de requisición bajo `supply_flow`. Es un antecedente que necesitaría revisión si se reutilizara, no una integración remota ya terminada.
- La generación local de códigos de artículo usa 4 dígitos de grupo y 5 de secuencia. Esta API no publica un alta de artículos: no hay evidencia de que esos códigos se creen o reserven en SAP mediante este servicio.

## 8. Inconsistencias y vacíos concretos del OpenAPI

| Hallazgo verificable | Consecuencia para la integración |
| --- | --- |
| `page` y `sync_status` en GET `/payments`, `/credit-notes` y `/reconciliations` aparecen como `in: path`, pero las rutas no contienen esos segmentos. | Ubicación declarada inconsistente. Es plausible que sean query parameters, pero no se confirmó ni se probó esa hipótesis. |
| `supplier_id` en ambos endpoints `/advances`, y `event_type` y `page` en GET `/logs`, presentan el mismo problema. | Pedir URLs de ejemplo y corrección de la especificación antes de generar un cliente. En total son 10 parámetros inconsistentes en 6 operaciones GET. |
| `sync_status` se describe como filtro opcional, pero el parámetro se marca `required: true` y admite null. | Aclarar omisión, representación de null y valores válidos. |
| Los parámetros `{code}` de GET y PUT de proveedores no declaran `schema` ni `content`. | Definición de parámetro incompleta para herramientas OpenAPI. |
| `Entry.sap_doc_entry` y `sap_doc_num` son obligatorios y no nulos, mientras que los detalles admiten ausencia o null. | Confirmar qué devuelven los listados para documentos aún pendientes; no inventar que devuelven cero. |
| `SupplierView.id` es string sin formato, pero `supplier_id` se exige UUID en varias entradas. | Confirmar el tipo real antes de persistir o relacionar identificadores. |
| No hay enums para `source_type`, `sync_status`, `inbox_status` ni varios estados de logs. | Falta un vocabulario verificable de valores admitidos. |
| Falta referencia externa y moneda en `NewInvoice`, aunque el detalle expone referencia y moneda. | No está resuelta la trazabilidad de altas inciertas ni el envío de HNL/USD. |
| Las respuestas 201 solo tipan el cuerpo como string y declaran `Location`. | Confirmar texto exacto, dónde viene el UUID y si `Location` es absoluta o relativa. |
| No hay restricciones de longitud, precisión monetaria, mínimos de listas ni reglas completas de asignación. | El esquema no basta para validar el negocio ni los límites operativos. |
| Se declara `can_delete`, sin ruta DELETE, y el reintento tiene respuestas sin explicación. | No inferir capacidades de mantenimiento adicionales. |
| No hay configuración de `servers`, rate limits, tiempos de espera, webhooks ni política de reintentos. | Faltan condiciones operativas para la futura puesta en marcha. |

Estos hallazgos son sobre la documentación. No demuestran que el servidor implemente incorrectamente cada caso.

## 9. Flujo de integración propuesto para una fase posterior

1. Acordar sociedad, ambiente, conectividad, responsable y permisos de la clave; usar acceso desde backend y guardar credenciales fuera del navegador y de este documento.
2. Definir la fuente autorizada por entidad. BuildReq parece un candidato a originar documentos operativos y ERP Sync a informar su sincronización con SAP, pero esa asignación debe aprobarse con el negocio.
3. Resolver código de proveedor, código de proyecto, artículos e impuestos válidos. Consultar o crear el proveedor según las reglas acordadas y conservar su identificador remoto.
4. Tras el hito de aprobación contable que se decida, validar y enviar la factura; guardar la correspondencia local/remota y la respuesta de aceptación.
5. Consultar su estado hasta confirmar `sent` o gestionar `error`, con intervalos, límites y duración acordados. No cambiar a confirmado SAP por recibir solamente 201.
6. Para pagos efectivamente autorizados y ejecutados según el flujo local, utilizar los UUID de facturas/proveedor y saldos de ERP Sync; registrar anticipos o asignaciones según el contrato confirmado.
7. Usar notas y conciliaciones cuando se acuerden sus reglas, identificadores, numeración de líneas y estados previos necesarios.
8. Ante fallos, consultar eventos e intentos. Reencolar el evento correcto cuando sea aplicable; no crear otro documento como sustituto de un reintento sin reconciliar primero.

Son criterios documentales, no un plan de implementación autorizado. No se fija aún una frecuencia de polling, número de reintentos, tamaño de lote ni solución de cola propia: la API ya declara encolado remoto y faltan sus límites y garantías.

## 10. Preguntas prioritarias al responsable de ERP Sync

1. ¿Qué sociedad y versión de SAP Business One utiliza el servicio y cuál es el ambiente de pruebas? ¿Cuál es la URL definitiva y existe HTTPS?
2. ¿Cómo se entrega, restringe y rota `X-Auth-Key`? ¿La clave selecciona sociedad o ambiente?
3. ¿Puede corregirse la ubicación de los 10 parámetros de filtros y paginación y facilitarse una URL real de cada listado? ¿La primera página es 0 o 1 y qué significa `total`?
4. ¿Cómo se seleccionan moneda y tipo de cambio de una factura? ¿Cómo se transmiten o representan retenciones, varios impuestos, descuentos, exoneraciones y otros cargos de BuildReq?
5. ¿Qué representa `line_total`, qué precisión y redondeo se aplican, y qué códigos de artículo, proyecto e impuesto son válidos?
6. ¿Qué determina la unicidad de una factura, especialmente sin datos fiscales? ¿Cómo recuperar su UUID si se pierde la respuesta de alta? ¿Se puede incorporar una referencia externa estable?
7. ¿Qué devuelve exactamente el texto de los 201 y cuál es el formato de `Location`? ¿`SupplierView.id` es siempre UUID y cómo se confirma la sincronización del proveedor?
8. ¿Cuáles son los valores válidos de `source_type`, `sync_status`, `inbox_status` y estados de evento? ¿Qué marca `sync_terminal` y cuándo se habilita `can_retry`?
9. ¿Qué campos son obligatorios por negocio al registrar un anticipo sin asignaciones, y cómo se eligen proveedor, proyecto, moneda y cuenta de transferencia?
10. ¿Cómo se numeran las líneas para notas de crédito y cómo se recuperan? ¿Qué restricciones existen para aplicar pagos o notas a facturas y qué garantías hay ante operaciones parciales o concurrentes?
11. ¿Cómo se corrigen o cancelan documentos ya aceptados o sincronizados? ¿Qué alcance tiene `can_delete` sin endpoint documentado?
12. ¿Qué límites de llamadas, tiempos de respuesta, política de reintentos, observabilidad, retención de logs y soporte operativo ofrece el servicio?

El primer flujo concreto a integrar debe elegirse después de resolver estas preguntas relevantes para ese flujo. La API publicada permite estudiar una integración de proveedores y documentos financieros; no cubre documentalmente toda la operación de compras e inventario de BuildReq.

## 11. Validación realizada y fuentes locales

Validación efectuada: lectura HTTP 200 de ReDoc y del OpenAPI; inventario de 19 rutas, 23 operaciones y 29 modelos; revisión de campos obligatorios, respuestas, seguridad y parámetros; contraste con las estructuras locales citadas. No se ejecutaron pruebas funcionales ni llamadas autenticadas, altas, actualizaciones o reintentos contra ERP Sync o SAP. No se ejecutaron pruebas de la aplicación porque solo se actualizó este documento.

Para una fase de pruebas posterior harán falta casos de proveedor existente/nuevo, factura local/extranjera, datos fiscales incompletos, decimal y fecha límite, conflicto duplicado, respuesta perdida, fallo de SAP, pago parcial, anticipo, nota y conciliación. Su resultado permanece sin verificar.

Fuentes locales examinadas como contexto:

- [Definiciones de datos de BuildReq](../drizzle/schema.ts): proveedores, proyectos, facturas y líneas, tesorería, anticipos y registros SAP.
- [Operaciones locales de facturas](../server/routers/invoices.ts) y [proveedores](../server/routers/suppliers.ts): contexto de flujo y campos existentes.
- [Acción local de requisiciones](../server/routers/materialRequests.ts): `sendToSap`.
- [Persistencia local](../server/db.ts): `createSapSyncLog` y `getSapSyncLogByEntity`.
- [Asignación local de códigos de artículos](../server/sapItemCodeAllocator.ts) y [formato de códigos](../shared/sap-item-codes.ts).
- [Matriz histórica de brechas](requirements-gap-analysis.md): antecedente del 12 de abril de 2026; no se tomó como estado vigente frente al código actual.

Este archivo conserva el estudio para retomar la integración. No contiene credenciales, código de integración ni cambios de funcionamiento de BuildReq.
