import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'documentacion');
const OUTPUT_DOCX = path.join(OUTPUT_DIR, 'Manual_Funcional_Completo_BuildReq.docx');

const BLUE = '2E74B5';
const DARK_BLUE = '1F4E79';
const NAVY = '17365D';
const PALE_BLUE = 'E8EEF5';
const PALE_TEAL = 'E2F0D9';
const PALE_AMBER = 'FFF2CC';
const PALE_RED = 'FCE4D6';
const GRAY = '666666';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function breakableCode(value) {
  return String(value ?? '').replace(/([a-z0-9])([A-Z])/g, '$1\u200B$2');
}

function run(text, options = {}) {
  const props = [];
  if (options.bold) props.push('<w:b/>');
  if (options.italic) props.push('<w:i/>');
  if (options.color) props.push(`<w:color w:val="${options.color}"/>`);
  if (options.size) props.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`);
  if (options.font) props.push(`<w:rFonts w:ascii="${esc(options.font)}" w:hAnsi="${esc(options.font)}"/>`);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}<w:t${preserve}>${esc(text)}</w:t></w:r>`;
}

function p(text = '', style = null, options = {}) {
  const pPr = [];
  if (style) pPr.push(`<w:pStyle w:val="${style}"/>`);
  if (options.align) pPr.push(`<w:jc w:val="${options.align}"/>`);
  if (options.pageBreakBefore) pPr.push('<w:pageBreakBefore/>');
  if (options.keepNext) pPr.push('<w:keepNext/>');
  if (options.keepLines) pPr.push('<w:keepLines/>');
  if (options.spaceBefore || options.spaceAfter || options.line) {
    pPr.push(`<w:spacing${options.spaceBefore ? ` w:before="${options.spaceBefore}"` : ''}${options.spaceAfter ? ` w:after="${options.spaceAfter}"` : ''}${options.line ? ` w:line="${options.line}" w:lineRule="auto"` : ''}/>`);
  }
  if (options.shading) pPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shading}"/>`);
  const body = Array.isArray(text) ? text.join('') : run(String(text));
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${body}</w:p>`;
}

function h1(text) { return p(text, 'Heading1'); }
function h2(text) { return p(text, 'Heading2'); }
function h3(text) { return p(text, 'Heading3'); }
function labelPara(label, body, style = null) {
  return p([run(label, { bold: true, color: DARK_BLUE }), run(body)], style);
}
function bullet(text, level = 0) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`;
}
function numberItem(text, level = 0) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="2"/></w:numPr></w:pPr>${run(text)}</w:p>`;
}
function pageBreak() { return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }
const TABLE_SPACER = p('', null, { spaceAfter: 80 });

function cell(text, width, options = {}) {
  const tcPr = [`<w:tcW w:w="${width}" w:type="dxa"/>`];
  if (options.shading) tcPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shading}"/>`);
  if (options.vAlign) tcPr.push(`<w:vAlign w:val="${options.vAlign}"/>`);
  const paras = Array.isArray(text)
    ? text.map(v => (typeof v === 'string' && v.startsWith('<w:p') ? v : p(v))).join('')
    : p(text);
  return `<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr>${paras}</w:tc>`;
}

function table(headers, rows, widths, options = {}) {
  const layoutWidths = widths.map(width => Math.floor(width * 0.96));
  const total = layoutWidths.reduce((a, b) => a + b, 0);
  const grid = layoutWidths.map(w => `<w:gridCol w:w="${w}"/>`).join('');
  const borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="B4C6E7"/><w:left w:val="single" w:sz="4" w:color="B4C6E7"/><w:bottom w:val="single" w:sz="4" w:color="B4C6E7"/><w:right w:val="single" w:sz="4" w:color="B4C6E7"/><w:insideH w:val="single" w:sz="4" w:color="D9E2F3"/><w:insideV w:val="single" w:sz="4" w:color="D9E2F3"/></w:tblBorders>';
  const margins = '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>';
  const headerRow = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${headers.map((v, i) => cell([p([run(v, { bold: true, color: NAVY })])], layoutWidths[i], { shading: PALE_BLUE, vAlign: 'center' })).join('')}</w:tr>`;
  const bodyRows = rows.map((row, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((v, i) => cell(v, layoutWidths[i], { shading: options.band && ri % 2 ? 'F8FAFC' : null, vAlign: 'top' })).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}${margins}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headerRow}${bodyRows}</w:tbl>${TABLE_SPACER}`;
}

function callout(title, text, color = PALE_BLUE) {
  return table([title], [[text]], [9360], { band: false }).replace(`w:fill="${PALE_BLUE}"`, `w:fill="${color}"`);
}

const body = [];
const add = (...parts) => body.push(...parts.flat());
const bullets = items => items.forEach(item => add(bullet(item)));
const chapter = title => {
  const previous = body.at(-1);
  if (typeof previous === 'string' && previous.endsWith(TABLE_SPACER)) {
    body[body.length - 1] = previous.slice(0, -TABLE_SPACER.length);
  }
  add(p(title, 'Heading1', { pageBreakBefore: true }));
};

// Cover — editorial_cover pattern.
add(
  p('BUILDREQ', null, { align: 'right', spaceAfter: 220 }),
  p('', null, { spaceAfter: 900 }),
  p([run('MANUAL FUNCIONAL', { bold: true, color: BLUE, size: 22 })], null, { spaceAfter: 120 }),
  p([run('COMPLETO', { bold: true, color: BLUE, size: 22 })], null, { spaceAfter: 360 }),
  p([run('Plataforma integral de requisiciones, compras, inventario, logística y finanzas', { bold: true, color: NAVY, size: 32 })], null, { spaceAfter: 240 }),
  p('Referencia exhaustiva de funcionalidades, permisos, estados, reglas de negocio, reportes e integraciones visibles en la implementación actual.', 'Subtitle', { spaceAfter: 520 }),
  table(['EDICIÓN', 'FECHA DE CORTE', 'BASE DOCUMENTAL'], [[
    '1.0',
    '18 de agosto de 2026',
    'Inspección del código fuente y de la configuración de la aplicación'
  ]], [1600, 2200, 5560]),
  p('', null, { spaceAfter: 900 }),
  p([run('Documento de referencia interna', { bold: true, color: GRAY })], null, { align: 'right' }),
  p('BuildReq · Honduras', null, { align: 'right' }),
  pageBreak()
);

add(h1('Control del documento'));
add(table(['Campo', 'Detalle'], [
  ['Propósito', 'Explicar de forma integral las capacidades funcionales de BuildReq, quién puede utilizarlas, qué información manejan y qué reglas controlan cada proceso.'],
  ['Audiencia', 'Usuarios solicitantes, bodegas, administradores de proyecto y central, aprobadores, contabilidad, finanzas, soporte y responsables de auditoría.'],
  ['Alcance', 'Interfaz web, reglas de autorización, procedimientos del servidor, reportes, documentos generados, notificaciones, almacenamiento de archivos y estructuras de integración.'],
  ['Fuente', 'Código vigente en las capas de cliente, servidor, esquemas compartidos y base de datos. No se basa en pantallas aisladas ni en documentación histórica.'],
  ['Corte', 'Implementación observada al 18 de agosto de 2026. Los comportamientos pueden cambiar con futuras versiones o configuraciones.'],
  ['Criterio', 'Cuando una función depende de configuración, rol, proyecto, estatus o disponibilidad de datos, esa condición se declara expresamente.']
], [2200, 7160], { band: true }));
add(callout('LECTURA IMPORTANTE', 'Este manual describe lo que la aplicación soporta. La visibilidad real de cada opción depende del rol, del proyecto asignado, del estado del documento y de los módulos habilitados por el administrador.', PALE_AMBER));

add(h2('Mapa de contenidos'));
add(table(['Bloque', 'Capítulos cubiertos'], [
  ['Fundamentos', 'Visión integral, acceso, experiencia global, roles y permisos.'],
  ['Abastecimiento', 'Dashboard, requisiciones, flujos, solicitudes de compra, órdenes, anticipos y aprobaciones.'],
  ['Logística e inventario', 'Bodegas, existencias, saldos iniciales, salidas, traslados, recepciones y logística inversa.'],
  ['Catálogos y finanzas', 'Artículos, activos fijos, grupos financieros, proveedores, facturas, impuestos, retenciones y tesorería.'],
  ['Gobierno y análisis', 'Reportes, proyectos, usuarios, notificaciones, configuración, datos demo y verificación pública.'],
  ['Anexos', 'Rutas, estados, procedimientos del servidor, entidades, reglas transversales y glosario.']
], [2500, 6860], { band: true }));

chapter('1. Visión integral de la plataforma');
add(p('BuildReq centraliza el ciclo de abastecimiento de una constructora o una organización con proyectos, bodegas y control financiero. El hilo conductor comienza con una necesidad, determina cómo se atenderá, produce los documentos logísticos o de compra y termina en inventario, factura, pago y contabilización.'));
add(h2('1.1 Flujo funcional de punta a punta'));
[
  'Necesidad → requisición de materiales o servicios.',
  'Revisión → aprobación o rechazo por línea, traducción al catálogo SAP y definición del flujo.',
  'Abastecimiento → salida de bodega, compra directa, solicitud de traslado o solicitud de compra.',
  'Compra → cotizaciones, aprobación opcional, orden de compra o contrato, emisión y envío.',
  'Entrega → recepción parcial o total, control fiscal, ajustes y actualización de existencias.',
  'Finanzas → revisión contable de factura, retenciones, anticipos, liberaciones de calidad y pago por tesorería.',
  'Cierre y análisis → trazabilidad, reportes regulatorios, reportes internos, notificaciones y auditoría.'
].forEach((text, i) => add(numberItem(text)));
add(h2('1.2 Principios funcionales'));
bullets([
  'Control por rol y por proyecto: una misma pantalla puede mostrar datos o acciones distintas según la responsabilidad del usuario.',
  'Procesamiento por línea y por cantidad: una requisición, solicitud, orden, traslado o recepción puede avanzar parcialmente.',
  'Trazabilidad documental: los documentos conservan números, relaciones de origen, eventos, estatus, adjuntos y responsables.',
  'Separación entre borrador y emisión: los documentos operativos se preparan antes de producir movimientos definitivos.',
  'Configuración de aprobaciones: las aprobaciones de solicitudes, órdenes y lotes de pago pueden activarse o desactivarse.',
  'Orientación fiscal hondureña: CAI, rangos autorizados, retenciones y libros SAR forman parte del modelo.',
  'Preparación para SAP Business One: existen catálogo, códigos, correlativos y registros de sincronización, sin afirmar que toda instalación tenga integración en línea habilitada.'
]);
add(h2('1.3 Familias de documentos'));
add(table(['Familia', 'Documentos principales', 'Resultado'], [
  ['Demanda', 'Requisición e ítems solicitados', 'Necesidad aprobada, rechazada o en espera.'],
  ['Abastecimiento', 'Registro de flujo, salida, solicitud de traslado o solicitud de compra', 'Cantidad asignada a una ruta de atención.'],
  ['Compra', 'Solicitud de compra, cotización, orden, anticipo', 'Compromiso con proveedor y condiciones económicas.'],
  ['Logística', 'Traslado, guía de remisión, recepción, devolución', 'Movimiento físico y actualización de inventario.'],
  ['Fiscal', 'Factura, retención, impuesto, ajuste, liberación de calidad', 'Obligación revisada y contabilizable.'],
  ['Pago', 'Lote de tesorería, archivo bancario, conciliación y evento', 'Pago aprobado, conciliado y contabilizado.']
], [1800, 3900, 3660], { band: true }));

chapter('2. Acceso, cuenta y experiencia general');
add(h2('2.1 Inicio y recuperación de sesión'));
bullets([
  'Autenticación con correo y contraseña mediante Supabase Auth.',
  'Sincronización de la sesión con el servidor para aplicar permisos sobre cada procedimiento protegido.',
  'Registro e inicio de sesión según la política habilitada en el entorno.',
  'Recuperación de contraseña por correo y página dedicada para establecer una nueva clave.',
  'Controles para mostrar u ocultar la contraseña sin alterar su contenido.',
  'Cierre de sesión desde el perfil del usuario.'
]);
add(h2('2.2 Contraseña temporal y perfil'));
bullets([
  'Los usuarios creados directamente por un administrador pueden recibir una contraseña temporal.',
  'Cuando la cuenta está marcada para cambio obligatorio, el sistema bloquea el trabajo normal hasta actualizar la contraseña.',
  'Cada usuario puede editar su nombre visible desde el diálogo de perfil.',
  'El perfil permite cambiar la contraseña y cerrar sesión.',
  'Si la cuenta todavía no tiene un rol BuildReq válido, se muestra una pantalla de rol pendiente en vez del sistema operativo.'
]);
add(h2('2.3 Navegación y comportamiento global'));
bullets([
  'Barra lateral organizada en Compras, Inventario, Logística, Finanzas, Operaciones, Análisis y Sistema.',
  'Ancho de la barra ajustable entre 200 y 400 píxeles; la preferencia se conserva localmente.',
  'Modo colapsado con iconos y adaptación móvil.',
  'Badges con pendientes de requisiciones, flujos, solicitudes, órdenes, traslados, activos fijos y facturas.',
  'Actualización periódica de conteos y notificaciones aproximadamente cada 30 segundos.',
  'Aviso visible de versión beta.',
  'Entradas de texto, búsqueda, teléfono, URL y áreas de texto se normalizan a mayúsculas con configuración regional es-HN. Correo, usuario, contraseña, códigos de un solo uso y campos marcados para conservar formato no se convierten.',
  'La conversión a mayúsculas preserva la posición del cursor mientras se escribe.',
  'Las listas extensas utilizan búsqueda, filtros, acordeones de detalle y paginación; en módulos principales se manejan normalmente páginas de 50 registros y en tesorería de 25.'
]);

chapter('3. Roles, alcance y permisos');
add(p('Los permisos combinan el rol global de administrador, el rol funcional BuildReq, el proyecto asignado y el estado del documento. Las acciones sensibles vuelven a validarse en el servidor.'));
add(h2('3.1 Catálogo de roles'));
add(table(['Código', 'Nombre funcional', 'Alcance típico'], [
  ['admin', 'Administrador global', 'Configuración integral, usuarios, datos demo y operaciones excepcionales.'],
  ['administracion_central', 'Administración Central', 'Compras, catálogos, proyectos, almacenes, tesorería y administración operativa.'],
  ['jefe_bodega_central', 'Bodega Central', 'Inventario, despacho, traslados, recepciones y apoyo al abastecimiento.'],
  ['administrador_proyecto', 'Administración Proyecto', 'Compras, recepción, facturas y control de su proyecto.'],
  ['bodeguero_proyecto', 'Bodega Proyecto', 'Existencias, flujos, salidas, traslados y recepciones dentro de su alcance.'],
  ['ingeniero_residente', 'Requiriente', 'Creación y seguimiento de necesidades de proyectos asignados.'],
  ['superintendente', 'Superintendente', 'Consulta y seguimiento de requisiciones y artículos de su ámbito.'],
  ['superintendente_aprobador', 'Superintendente aprobador', 'Seguimiento y aprobaciones de compras cuando el flujo está habilitado.'],
  ['gerente', 'Gerente', 'Aprobación de solicitudes y órdenes, además de visibilidad de requisiciones.'],
  ['contable', 'Contable', 'Facturas, registro contable, activos fijos, impuestos, retenciones, reportes y tesorería.'],
  ['financiero', 'Financiero', 'Aprobación financiera y seguimiento de tesorería.']
], [2400, 2600, 4360], { band: true }));
add(h2('3.2 Alcance de proyectos'));
bullets([
  'Requiriente, Administración Proyecto, Bodega Proyecto, Superintendente, Superintendente aprobador y Gerente son roles ligados a proyecto.',
  'El usuario puede tener asignaciones explícitas; varias pantallas limitan consultas, creación y selección a esos proyectos.',
  'Un único proyecto asignado puede seleccionarse automáticamente al crear documentos.',
  'Administración Central y el administrador global gestionan asignaciones, almacenes principales y proyectos de forma más amplia.',
  'Las restricciones por proyecto se aplican además del permiso del módulo; ver una opción de menú no concede acceso a datos ajenos.'
]);
add(h2('3.3 Matriz resumida de módulos'));
add(table(['Módulo', 'Roles con acceso habitual', 'Observación'], [
  ['Dashboard', 'admin, central, bodega central, proyecto, bodega proyecto, requiriente, superintendencias y gerencia', 'Contabilidad y finanzas entran directamente a sus áreas especializadas.'],
  ['Requisiciones', 'Todos los roles operativos de proyecto y abastecimiento; no contable/financiero', 'Las acciones cambian entre creación, revisión, traducción y solo lectura.'],
  ['Flujos', 'admin, central, bodega central, proyecto, bodega proyecto y requiriente', 'El procesamiento está más restringido que la consulta.'],
  ['Inventario y salidas', 'admin, central, bodegas y administración de proyecto según pantalla', 'Siempre sujeto a almacenes y proyectos visibles.'],
  ['Solicitudes y órdenes', 'admin, central, bodegas, proyecto, aprobadores y contable según pantalla', 'Aprobadores tienen una vista compacta; contable es principalmente lector de órdenes.'],
  ['Recepciones y facturas', 'admin, central, bodegas, proyecto y contable', 'Contable registra facturas; usuarios operativos preparan y revisan.'],
  ['Tesorería', 'admin, central, proyecto, contable y financiero', 'El rol financiero se limita funcionalmente a tesorería y notificaciones.'],
  ['Reportes SAR', 'central, administración de proyecto y contable', 'La ruta de reportes no se muestra al administrador global por el diseño actual.'],
  ['Usuarios', 'admin y central', 'Solo admin maneja invitaciones y cuentas de administrador global.'],
  ['Configuración y demo', 'admin', 'Parámetros de aprobación, tesorería e importaciones controladas.']
], [2300, 3900, 3160], { band: true }));
add(callout('SEGURIDAD FUNCIONAL', 'La matriz anterior es orientativa. Cada acción se decide con reglas específicas del servidor; un enlace directo no evita el control de rol, proyecto, estatus o propiedad del registro.', PALE_RED));

chapter('4. Dashboard y seguimiento ejecutivo');
add(h2('4.1 Indicadores y accesos'));
bullets([
  'Total de requisiciones, proyectos activos, devoluciones totales y devoluciones pendientes.',
  'Tarjetas clicables para saltar al listado relacionado.',
  'Gráfico circular de requisiciones por estado.',
  'Gráfico circular de flujos de abastecimiento por tipo o situación.',
  'Gráfico de requisiciones por proyecto; puede ocultarse para aprobadores de compras cuando no agrega valor a su tarea.',
  'Panel plegable de requisiciones recientes con información esencial y acceso al detalle.',
  'Tarjetas de solicitudes y órdenes pendientes para Superintendente aprobador y Gerente cuando las aprobaciones correspondientes están activadas.'
]);
add(h2('4.2 Reporte financiero del dashboard'));
bullets([
  'Compara montos de órdenes aprobadas con facturas registradas por proyecto.',
  'Permite períodos histórico, año, mes o rango personalizado.',
  'Valida que las fechas personalizadas sean completas y coherentes.',
  'Presenta gráfico y tabla con montos en lempiras.',
  'Exporta los datos a Excel para análisis externo.'
]);

chapter('5. Requisiciones de materiales y servicios');
add(h2('5.1 Listado y búsqueda'));
bullets([
  'Búsqueda por número de requisición, artículo, proyecto o solicitante.',
  'Filtro por estado y paginación.',
  'Vista resumida con urgencia, fecha requerida, solicitante, proyecto y etapa del flujo.',
  'Vista desplegable de líneas, cantidades, unidad, destino contable y situación de atención.',
  'Indicadores de vencida, vence hoy, próxima a vencer o dentro del plazo.'
]);
add(h2('5.2 Creación y edición'));
bullets([
  'Selección del proyecto permitido y, para bienes, de la bodega del proyecto o bodega principal disponible.',
  'Tipo bienes o servicios; el tipo definitivo puede quedar alineado al catálogo SAP durante la traducción.',
  'Urgencia urgente o no urgente. El plazo estándar se calcula a cinco días calendario; una urgencia permite una fecha manual menor a ese plazo.',
  'Notas generales.',
  'Múltiples líneas con descripción, cantidad positiva, unidad y destino a subproyecto o activo fijo.',
  'Catálogo de unidades de construcción, entre ellas unidad, metro, pie, m², m³, metro lineal, kilogramo, tonelada, libra, galón, litro, saco, bolsa, rollo, lámina, varilla, tubo, pieza, par, caja, cubeta, quintal, pie², pulgada, viaje y global.',
  'Agregar y eliminar líneas antes del envío.',
  'Guardar como borrador o enviar a aprobación.',
  'Edición de borradores y de casos en espera que todavía no tengan flujo, traducción o movimiento asociado.'
]);
add(h2('5.3 Revisión por líneas'));
bullets([
  'Aprobación o rechazo total y aprobación o rechazo individual.',
  'Motivo obligatorio cuando una línea se rechaza.',
  'Estados de aprobación pendiente, aprobada, rechazada, descartada o no requiere.',
  'Los aprobadores ven la necesidad, cantidades y destino antes de decidir.',
  'Los saldos pendientes pueden rechazarse posteriormente por roles autorizados sin eliminar el historial previo.'
]);
add(h2('5.4 Traducción al catálogo y disponibilidad'));
bullets([
  'Búsqueda del catálogo SAP por código o descripción.',
  'Asignación del código y descripción normalizada a una línea, con opción de limpiar la traducción.',
  'El tipo del artículo SAP ayuda a separar bienes de servicios.',
  'Consulta de disponibilidad global, por proyecto, bodega y ubicación física.',
  'Las cantidades de inventario pueden ocultarse a ciertos solicitantes para evitar exponer existencias fuera de su responsabilidad.'
]);
add(h2('5.5 Asignación del flujo de atención'));
add(table(['Flujo', 'Qué produce', 'Uso funcional'], [
  ['warehouse_dispatch', 'Salida de inventario', 'Atiende desde existencias disponibles y continúa en Salidas de inventario.'],
  ['direct_purchase', 'Solicitud de compra directa', 'Compra para una necesidad concreta con tratamiento simplificado.'],
  ['project_transfer', 'Solicitud de traslado', 'Busca existencias en otro proyecto o en bodega central.'],
  ['purchase_request', 'Solicitud de compra local o extranjera', 'Inicia el ciclo formal de cotización, aprobación y orden.']
], [2100, 3000, 4260], { band: true }));
bullets([
  'La asignación puede cubrir toda la línea o solo una cantidad.',
  'Una línea no puede reasignarse mientras tenga un flujo activo incompatible.',
  'Los servicios se canalizan por compra directa o solicitud de compra; no generan despacho de inventario.',
  'Es posible devolver cantidades en cola, despacho o traslado a la requisición cuando la operación no continuará.',
  'La actualización de cantidades entregadas mantiene el estado global de la requisición: pendiente, parcial, atendida o cerrada.'
]);
add(h2('5.6 Adjuntos y salida a SAP'));
bullets([
  'Panel de archivos asociados a la requisición.',
  'Preparación o envío de información a SAP mediante la operación disponible en el servidor.',
  'Conservación de la relación entre requisición, líneas, flujos, compras, traslados, salidas y recepciones.'
]);

chapter('6. Flujos de abastecimiento');
add(p('El módulo Flujos es la bandeja de trabajo que transforma cantidades aprobadas de requisiciones en documentos operativos.'));
add(h2('6.1 Bandejas y control'));
bullets([
  'Cola de pendientes y consulta histórica.',
  'Filtros por tipo y estado.',
  'Agrupación de líneas compatibles para procesamiento masivo.',
  'Selección de cantidades y validación de que no superen el saldo disponible.',
  'Estados pendiente, en proceso, completado o cancelado.',
  'Consulta por requisición y detalle de asignaciones ya realizadas.'
]);
add(h2('6.2 Procesamiento por tipo'));
bullets([
  'Despacho de bodega: elige bodega, proyecto y ubicación de origen, verifica existencia y crea el borrador de salida.',
  'Compra directa: agrupa líneas y crea una solicitud de compra clasificada como compra directa.',
  'Traslado entre proyectos: identifica el origen y genera una solicitud de traslado; puede procesarse por lote.',
  'Solicitud de compra: selecciona compra local o extranjera y crea el documento con sus líneas.',
  'Conversión posterior de una solicitud de compra aprobada a orden de compra.',
  'Confirmación de recepción de bienes cuando el flujo requiere cerrar la entrega.'
]);
add(h2('6.3 Ayudas para decidir'));
bullets([
  'Mapa de códigos SAP de las líneas.',
  'Existencias por proyecto, bodega y ubicación.',
  'Precio mínimo o último precio conocido de proveedor cuando existe historial.',
  'Reglas distintas para Administración Central, Bodega Central, Administración Proyecto y Bodega Proyecto.'
]);

chapter('7. Solicitudes de compra (SC)');
add(h2('7.1 Consulta y documento'));
bullets([
  'Listado paginado, búsqueda y filtro por compra directa, local o extranjera.',
  'Filtro por estado y vista desplegable de artículos.',
  'Exportación del listado a CSV.',
  'Detalle con proyecto, solicitante, destino de impresión, tipo de compra, notas, correlativo SAP y relaciones de origen.',
  'Documento imprimible y diálogo para preparar destinatario, asunto y cuerpo de correo.',
  'Adjuntos, incluidas cotizaciones y respaldos.'
]);
add(h2('7.2 Líneas y cantidades'));
bullets([
  'Código SAP actual y original, descripción, unidad, marca, responsable del costo y destino a subproyecto o activo fijo.',
  'Cantidades solicitada, aprobada, pendiente y convertida.',
  'Actualización de cantidades pendientes por usuarios autorizados.',
  'Selección parcial de líneas y cantidades al crear una orden.',
  'Conversión unificada de varias solicitudes compatibles a una sola orden de compra.'
]);
add(h2('7.3 Aprobación configurable'));
bullets([
  'Cuando la aprobación está deshabilitada, los documentos elegibles continúan sin una etapa formal de aprobador.',
  'Cuando está habilitada, la solicitud se envía, queda pendiente y es revisada por Superintendente aprobador, Gerente o administrador autorizado.',
  'La decisión puede hacerse por línea.',
  'Si hay rechazo, el comentario debe tener entre 5 y 1,000 caracteres.',
  'Las líneas rechazadas pueden corregirse y reenviarse o descartarse definitivamente con motivo.',
  'Una solicitud rechazada puede reabrirse bajo las condiciones permitidas.',
  'El historial conserva decisiones y responsables.'
]);
add(h2('7.4 Estados'));
add(table(['Estado', 'Significado'], [
  ['pendiente', 'Documento creado y todavía no sometido o procesado.'],
  ['en_revision', 'En revisión operativa o de aprobación.'],
  ['aprobada', 'Autorizada para convertir cantidades a orden.'],
  ['rechazada', 'No aprobada; puede requerir corrección o descarte.'],
  ['parcialmente_convertida', 'Parte de las cantidades ya está en órdenes.'],
  ['convertida', 'Todo el saldo convertible fue llevado a orden.'],
  ['anulada', 'Documento sin vigencia operativa.']
], [2600, 6760], { band: true }));

chapter('8. Órdenes de compra (OC) y contratos');
add(h2('8.1 Listado y búsqueda'));
bullets([
  'Búsqueda general, filtros por tipo, estado y rango de fecha de emisión.',
  'Paginación y detalle desplegable de líneas.',
  'Reporte interno en Excel para Administración Central, Administración Proyecto y Contabilidad.',
  'Clasificación OC o CD y tipos local, extranjera o compra directa.'
]);
add(h2('8.2 Creación desde solicitudes'));
bullets([
  'Selección de una solicitud elegible o unificación de varias solicitudes compatibles.',
  'Selección parcial de artículos y cantidades pendientes.',
  'Proveedor y contacto del proveedor.',
  'Método de pago: línea de crédito, fondo de proyecto, caja chica o contado.',
  'Moneda HNL o USD; para USD se exige tasa positiva, fecha de tasa y precisión controlada.',
  'Indicación de si los precios incluyen impuesto.',
  'Carga de archivos de respaldo.',
  'Validación de que exista proveedor, al menos una línea y datos económicos consistentes.'
]);
add(h2('8.3 Edición económica y de líneas'));
bullets([
  'Cantidad, precio unitario, subtotal, impuesto base, impuestos adicionales y exenciones.',
  'Cálculos monetarios con precisión de hasta cuatro decimales en líneas y totales.',
  'Marca, responsable del costo y destino contable.',
  'Sustitución de un artículo SAP por otro sin perder la trazabilidad del origen.',
  'Consulta del último precio o precios recientes del proveedor.',
  'Eliminación de líneas aún editables.',
  'Movimiento del saldo pendiente de una línea de vuelta a solicitud de compra.',
  'Cierre manual del saldo de recepción cuando existe justificación.',
  'Captura preliminar de datos de activo fijo para líneas aplicables.'
]);
add(h2('8.4 Contratos'));
bullets([
  'Marcación de la orden como contrato.',
  'Frecuencia semanal, quincenal, mensual, trimestral, semestral o anual.',
  'Primera fecha de pago, fecha final y notas contractuales.',
  'Actualización de precios de ítems del contrato.',
  'Alertas de vigencia o vencimiento.',
  'Bitácora de cambios y acciones relevantes.'
]);
add(h2('8.5 Aprobación, emisión y proveedor'));
bullets([
  'Envío a aprobación cuando la regla está habilitada y el monto supera el umbral configurado.',
  'Umbrales independientes para HNL y USD.',
  'Revisión por Superintendente aprobador, Gerente o administrador, con historial de aprobación.',
  'Reapertura de una orden rechazada para corrección.',
  'Emisión, envío al proveedor y seguimiento de recepción parcial o completa.',
  'Anulación y reapertura de borradores según las restricciones del estado.',
  'Documento PDF oficial o de vista previa generado por el sistema.'
]);
add(h2('8.6 Sello digital de la orden'));
bullets([
  'Registro de sellos digitales, firmante, rol, tipo de sello, fecha y hash del documento.',
  'Enlace o código QR público para verificar autenticidad.',
  'Bitácora de auditoría de órdenes y sellos.',
  'El sello es un mecanismo de trazabilidad y verificación de hash; no se presenta como una firma PAdES certificada.'
]);
add(h2('8.7 Estados'));
add(table(['Estado', 'Interpretación'], [
  ['borrador', 'Editable y aún no formalizado.'],
  ['pendiente_aprobacion', 'Esperando decisión del flujo configurado.'],
  ['aprobada', 'Autorizada para emisión.'],
  ['rechazada', 'Devuelta o no autorizada.'],
  ['emitida', 'Documento formal emitido.'],
  ['enviada', 'Marcada como enviada al proveedor.'],
  ['parcialmente_recibida', 'Tiene recepciones, pero conserva saldo.'],
  ['recibida', 'Cantidad completa recibida o cerrada.'],
  ['anulada', 'Sin vigencia.']
], [2800, 6560], { band: true }));

chapter('9. Anticipos de órdenes de compra');
bullets([
  'Consulta de permisos y de órdenes elegibles.',
  'Solo se admiten anticipos para órdenes cuyo método de pago es contado.',
  'Selección de la orden, monto, fecha y notas.',
  'El monto no puede superar el disponible de la orden.',
  'Adjuntos PDF o imagen de respaldo.',
  'Listado y detalle de anticipos.',
  'Cancelación mientras el anticipo no haya sido aplicado o pagado en un proceso incompatible.',
  'Los anticipos pasan a Tesorería en lotes exclusivos de tipo anticipo y luego se aplican contra facturas o saldos permitidos.'
]);

chapter('10. Solicitudes de traslado y traslados');
add(h2('10.1 Solicitudes de traslado'));
bullets([
  'Se generan desde el flujo de una requisición; la creación manual está deshabilitada en la interfaz actual.',
  'Listado paginado, búsqueda, filtros y detalle por líneas.',
  'Origen por proyecto, bodega y ubicación; destino a otro proyecto o a bodega central.',
  'Cantidad solicitada, unidad, fecha requerida y notas provenientes del flujo.',
  'Bodega destino actualizable antes de convertir cuando la regla lo permite.',
  'Bodega Central y Bodega Proyecto pueden convertir; el administrador global también.',
  'Bodega Proyecto no ve cantidades de existencias de origen en la misma forma que los roles centrales.',
  'El administrador y Bodega Central pueden cancelar; existen también rechazo y anulación controlados por estado.',
  'Adjuntos asociados a la solicitud.'
]);
add(h2('10.2 Conversión y traslado'));
bullets([
  'Selección de cantidades y ubicación de origen sin exceder existencias ni saldo solicitado.',
  'Creación del traslado y de la guía de remisión relacionada.',
  'Consulta por número, guía, proyecto o estado.',
  'Detalle de origen, destino, líneas, cantidades y responsables.',
  'Campos de impresión “Elaborado por” y “Entregado a” configurables en el documento.',
  'Documento imprimible en tamaño carta con datos de guía y espacios de firmas.',
  'Estados pendiente, confirmado, en tránsito, recibido parcial, recibido, cerrado incompleto o anulado.'
]);

chapter('11. Recepciones');
add(h2('11.1 Origen y selección'));
bullets([
  'Recepción desde una orden emitida/enviada/parcial o desde un traslado pendiente/en tránsito/parcial.',
  'Listado paginado, búsqueda por origen, artículo, proveedor, proyecto y filtros por fuente o estado.',
  'Exportación del listado a CSV.',
  'Selección del proyecto y bodega física de destino.',
  'Visualización de moneda, tipo de cambio, proveedor, contrato, fecha requerida y saldos del documento origen.'
]);
add(h2('11.2 Captura de líneas'));
bullets([
  'Recepción parcial o total por artículo.',
  'Cantidad recibida, unidad, precio, impuestos, ubicación de almacenamiento y destino contable.',
  'Para traslado, selección y seguimiento de la ubicación de origen.',
  'Adición de líneas manuales cuando el caso está permitido.',
  'Sustitución del artículo recibido por otro código SAP, conservando referencia, marca o número de parte.',
  'Otros cargos del documento de recepción.',
  'Identificación de activos fijos: código, serial, condición, marca, modelo, color, placa/código, chasis, motor, leasing y observaciones.'
]);
add(h2('11.3 Datos fiscales y fechas'));
bullets([
  'Indicación de si la recepción incluye documento fiscal.',
  'Número de factura, CAI, rango autorizado inicial/final, fecha del documento, fecha de vencimiento, fecha contable, fecha de recepción y fecha límite de emisión.',
  'Consulta automática del rango fiscal vigente del proveedor.',
  'Notas y adjuntos.',
  'Guardado como borrador antes del registro definitivo.'
]);
add(h2('11.4 Registro, cierre y corrección'));
bullets([
  'El registro definitivo actualiza inventario y relaciones de requisición, orden o traslado.',
  'Cuando corresponde, genera o alimenta la factura para revisión posterior.',
  'Permite cerrar saldos incompletos con motivo y nota; en traslados, el remanente puede volver al origen y a la requisición.',
  'Puede cerrar manualmente una línea de orden que ya no se recibirá.',
  'La corrección de recepción está disponible para administrador, Administración Central o Administración Proyecto si la factura vinculada todavía no fue registrada contablemente.',
  'La corrección anula el registro anterior y crea un reemplazo trazable con motivo.',
  'Documento de recepción imprimible.'
]);
add(h2('11.5 Estados'));
add(table(['Estado', 'Significado'], [
  ['borrador', 'Captura en preparación.'],
  ['pendiente', 'Pendiente de completar o registrar.'],
  ['parcial', 'Solo parte del saldo fue recibido.'],
  ['completa', 'Recepción total.'],
  ['cerrada_incompleta', 'Saldo restante cerrado con justificación.'],
  ['anulada', 'Recepción reemplazada o invalidada.']
], [2800, 6560], { band: true }));

chapter('12. Bodegas e inventario');
add(h2('12.1 Catálogo de bodegas'));
bullets([
  'Listado, detalle y búsqueda de bodegas.',
  'Creación y edición de código, nombre, descripción y estado.',
  'Marcación de bodega central y de bodega compartida/multiproyecto.',
  'Desactivación y reactivación sin borrar el historial.',
  'Asignación y retiro de proyectos.',
  'Definición de bodega principal por proyecto.',
  'Asignación de usuarios, responsable y usuarios elegibles.',
  'Pestañas de inventario, proyectos y usuarios.',
  'Exportación a Excel del detalle de inventario visible.'
]);
add(h2('12.2 Consulta de existencias'));
bullets([
  'Búsqueda por código SAP, nombre, marca, número de parte, proyecto, bodega o ubicación.',
  'Filtros por proyecto, bodega física y registros sin clasificar.',
  'Filtro de existencias positivas y exportación a Excel.',
  'Desglose por proyecto, bodega y ubicación física.',
  'Disponibilidad global y disponibilidad visible para un conjunto de artículos.',
  'Cantidades pendientes relacionadas con requisiciones y procesos abiertos.',
  'Vista de trazabilidad de un artículo y Kardex de movimientos.'
]);
add(h2('12.3 Administración de inventario'));
bullets([
  'Creación de un registro con código SAP, nombre, unidad, stock actual, mínimo, categoría, ubicación, proyecto y bodega.',
  'Edición de datos permitidos sin alterar indebidamente movimientos históricos.',
  'Asignación masiva de seleccionados a proyecto o bodega física.',
  'Asignación masiva de todos los resultados filtrados que todavía no estén clasificados.',
  'Validación de permisos y de visibilidad de almacenes antes de mostrar o modificar existencias.'
]);

chapter('13. Saldos iniciales');
bullets([
  'Listado y detalle de documentos de apertura.',
  'Creación por administrador, Administración Central o Bodega Central.',
  'Selección de bodega física, fecha de apertura y notas.',
  'Búsqueda o consulta de artículos SAP para agregar líneas.',
  'Captura de código, descripción, cantidad, unidad y nota por línea.',
  'Adición posterior de líneas a un documento existente cuando corresponde.',
  'Creación de movimientos de inventario con trazabilidad hacia el saldo inicial.'
]);

chapter('14. Salidas de inventario');
add(h2('14.1 Preparación y emisión'));
bullets([
  'Listado paginado, búsqueda y filtros por borrador, emitida o anulada.',
  'Creación desde cantidades de requisición asignadas a despacho.',
  'Selección de proyecto, bodega y ubicación de origen por línea.',
  'Validación de stock disponible.',
  'Destino de proyecto/bodega, receptor, subproyecto o activo fijo y notas.',
  'Guardado o actualización del borrador.',
  'Emisión definitiva para descontar existencias y actualizar cantidades entregadas.',
  'Cancelación de borradores que no deben continuar.'
]);
add(h2('14.2 Documento y devoluciones'));
bullets([
  'Comprobante imprimible de salida con correlativo, artículos, origen, destino y espacios de firma.',
  'Desde una salida emitida, administrador o Bodega Central puede iniciar una devolución por logística inversa.',
  'La devolución conserva la referencia de la línea despachada y limita la cantidad a lo realmente entregado y aún no devuelto.'
]);

chapter('15. Logística inversa y devoluciones');
add(h2('15.1 Tipos y motivos'));
add(table(['Dimensión', 'Valores soportados'], [
  ['Tipo', 'A bodega central, a bodega de proyecto, entre proyectos o a proveedor.'],
  ['Motivo', 'Defectuoso, exceso, error de pedido, cambio de especificación u otro.'],
  ['Condición del artículo', 'Nuevo, usado en buen estado, defectuoso o dañado.'],
  ['Estado', 'Pendiente, aprobada, en tránsito, recibida o rechazada.']
], [2600, 6760], { band: true }));
add(h2('15.2 Operación'));
bullets([
  'Listado con búsqueda, filtros, detalle e impresión.',
  'Creación por administrador o Bodega Central.',
  'Origen de proyecto, bodega y ubicación; destino según el tipo.',
  'Nombre de quien recibe, motivo, notas y líneas con código, descripción, cantidad, unidad y condición.',
  'Vinculación opcional con una salida o recepción para validar la cantidad máxima retornable.',
  'Para devoluciones a proveedor se exige una recepción compatible.',
  'Generación de nota de crédito asociada al caso de proveedor.',
  'Generación de una solicitud/operación de traslado a bodega central cuando el retorno requiere movimiento físico.',
  'Actualización de estado con conservación de relaciones y movimientos.'
]);

chapter('16. Artículos, servicios, activos fijos y grupos financieros');
add(h2('16.1 Catálogo de artículos'));
bullets([
  'Tipos: artículo, servicio y activo fijo.',
  'Búsqueda y filtros por tipo, estado, condición de retención y activo fijo pendiente o resuelto.',
  'Exportación a Excel.',
  'Código, grupo, grupo financiero, descripción, marca, número de parte o referencia, tipo, estado y permiso de retención.',
  'Proyecto asociado cuando se trata de un activo fijo.',
  'Creación y edición por roles de catálogo; otros roles cuentan con lectura para consultar códigos.',
  'El cambio de código se bloquea si el artículo ya se utilizó históricamente.',
  'Registro de creación y última actualización.'
]);
add(h2('16.2 Resolución de activos fijos'));
bullets([
  'Bandeja específica de activos pendientes para administrador y Contabilidad.',
  'Asignación o resolución del código definitivo.',
  'Datos de leasing, serie, condición, color, modelo, marca, placa/código, chasis, motor y observación.',
  'Los datos pueden capturarse desde recepción, orden o factura y consolidarse en el catálogo.',
  'Administrador, Bodega Central y Contabilidad participan según la acción.'
]);
add(h2('16.3 Grupos financieros'));
bullets([
  'Listado, búsqueda y filtro activo/inactivo.',
  'Campos código, descripción, CodN2 y Nivel2.',
  'Creación, edición y retiro por administrador o Administración Central.',
  'Solo las opciones activas se presentan al clasificar artículos.'
]);

chapter('17. Proveedores, contactos y documentos');
add(h2('17.1 Maestro de proveedores'));
bullets([
  'Búsqueda por código, nombre o correo y filtro de activos.',
  'Código manual o automático, nombre, correo, RTN, domicilio fiscal y estado.',
  'Indicadores “permite retención” y “sujeto a pagos a cuenta”.',
  'Creación por administrador o Administración Central; edición operativa adicional para Bodega Central según el campo.',
  'Importación masiva desde Excel con análisis previo de errores, nuevos registros y actualizaciones.'
]);
add(h2('17.2 Contactos'));
bullets([
  'Contactos por ventas, compras, cobros, logística, administración u otro.',
  'Nombre, teléfono, correo, dirección, sucursal, proyecto y estado.',
  'Creación y edición sin sobrescribir la ficha fiscal principal.',
  'Uso de contactos al preparar órdenes y comunicaciones al proveedor.'
]);
add(h2('17.3 Expediente documental'));
bullets([
  'Catálogo administrable de tipos de documento.',
  'Política de vencimiento requerida, opcional o sin vencimiento.',
  'Carga, actualización, descarga y eliminación de documentos.',
  'Fecha del documento, fecha de vencimiento, descripción, archivo y estado derivado.',
  'Desactivación de tipos sin borrar expedientes previos.'
]);
add(h2('17.4 Constancia de pagos a cuenta y retención'));
bullets([
  'La vigencia de la constancia influye en las opciones de retención permitidas.',
  'Con constancia válida y proveedor sujeto a pagos a cuenta, el sistema restringe la política a la retención del 15% cuando corresponde.',
  'Sin constancia válida, una factura fiscal con base sujeta puede requerir la retención del 1% si se usa tratamiento manual.',
  'Las reglas se vuelven a validar al revisar o contabilizar la factura.'
]);

chapter('18. Facturas y control fiscal');
add(h2('18.1 Listado, alertas y búsqueda'));
bullets([
  'Búsqueda por factura, orden, recepción, requisición, artículo, solicitante, creador, proveedor o proyecto.',
  'Filtros por proyecto, estado y fechas; paginación y detalle de líneas.',
  'Alerta cuando la fecha del documento excede la fecha límite de emisión.',
  'Reporte interno en Excel para Administración Central, Administración Proyecto y Contabilidad.'
]);
add(h2('18.2 Información fiscal'));
bullets([
  'Documento fiscal o no fiscal.',
  'Número, CAI, rango inicial/final, fecha de documento, vencimiento, contabilización, recepción y límite de emisión.',
  'Consulta del rango fiscal configurado para el proveedor.',
  'Formato validado de CAI y de número de factura, control de pertenencia al rango y prevención de duplicados.',
  'Exoneración OCE con número, resolución, fecha y montos exentos al 15% o 18%.',
  'DMC: compra extranjera local, FYDUCA o importación; identificación extranjera, número FYDUCA y DUA, incluido tratamiento fuera de Centroamérica.',
  'Datos de constancia de retención: CAI, rango, fecha límite y fecha de emisión.'
]);
add(h2('18.3 Líneas, impuestos y retenciones'));
bullets([
  'Clasificación DMC por costo, gasto o no deducible y observación por línea.',
  'Revisión de subtotal, base imponible, impuestos y totales provenientes de la recepción u orden.',
  'Hasta dos retenciones por producto, seleccionadas del catálogo activo.',
  'Base retenida no superior a la base o subtotal permitido; tasa y monto positivos.',
  'Validación de la política del proveedor, constancia de pagos a cuenta y retención fiscal aplicable.',
  'Edición o resolución de datos de activos fijos desde la factura.'
]);
add(h2('18.4 Ajustes del documento y neto pagable'));
add(table(['Ajuste', 'Efecto'], [
  ['Retención de calidad', 'Reserva parte del pago y habilita posteriormente una solicitud de liberación.'],
  ['Amortización de anticipo', 'Aplica anticipos disponibles de la orden contra el documento.'],
  ['Descuento por pronto pago', 'Reduce el pago; el tratamiento TC contempla un 8% de la base ISV cuando aplica la regla configurada.']
], [3100, 6260], { band: true }));
add(p('El sistema resume total del documento, retenciones, ajustes, anticipos aplicados, saldo y neto pagable.'));
add(h2('18.5 Flujo contable'));
bullets([
  'Administrador, Administración Central o Administración Proyecto preparan y envían la factura a revisión.',
  'Contabilidad o administrador registra/contabiliza o rechaza con comentario.',
  'Una factura registrada solo puede volver a revisión por el administrador de sistema designado y si no existen bloqueos de tesorería o anticipos.',
  'La corrección de una recepción vinculada está disponible mientras el estado contable lo permita.',
  'Estados: borrador, en revisión, rechazada, registrada o anulada.',
  'Impresión del detalle de factura y de las constancias de retención.',
  'Los adjuntos de factura se manejan como expediente efectivo único: una nueva carga sustituye los adjuntos vigentes de esa factura.'
]);

chapter('19. Impuestos y retenciones');
add(h2('19.1 Catálogo de impuestos'));
bullets([
  'Consulta por administrador, Administración Central, Bodega Central, Administración Proyecto, Bodega Proyecto y Contabilidad.',
  'Administración por administrador, Administración Central o Contabilidad.',
  'Código, etiqueta corta, porcentaje, descripción, tipo base o adicional y estado.',
  'Categoría fiscal exento, exonerado o gravado.',
  'Orden de presentación, códigos base aplicables, código ERP y nota.',
  'Creación, edición, eliminación o desactivación según uso histórico.',
  'Opciones activas utilizadas en órdenes, recepciones y facturas.'
]);
add(h2('19.2 Catálogo de retenciones'));
bullets([
  'Consulta por administrador, Administración Central, Administración Proyecto y Contabilidad.',
  'Administración por administrador o Contabilidad.',
  'Código, tasa, código ERP, descripción, nota y estado.',
  'Búsqueda, filtro, creación y edición.',
  'Opciones activas aplicadas a líneas de factura y reportes SAR.'
]);

chapter('20. Tesorería, pagos y liberaciones de calidad');
add(h2('20.1 Activación y tipos de pago'));
bullets([
  'El módulo completo puede habilitarse o deshabilitarse desde Configuración.',
  'Acceso para administrador, Administración Central, Administración Proyecto, Contabilidad y Financiero.',
  'Lotes separados para facturas, anticipos de orden y liberaciones de retención de calidad.',
  'Solo se muestran documentos elegibles con saldo y estado compatibles.'
]);
add(h2('20.2 Creación y revisión de lotes'));
bullets([
  'Filtro por proyecto, moneda y búsqueda de documentos.',
  'Selección de documentos y monto solicitado parcial o total.',
  'Fecha y notas del lote.',
  'Edición de borrador antes de enviarlo.',
  'Revisión central para ajustar montos o excluir partidas con motivo.',
  'Consolidación de lotes compatibles de igual moneda y tipo.',
  'Si las aprobaciones están deshabilitadas, el envío puede llevar directamente a preparación bancaria.',
  'Si están habilitadas, el flujo pasa por revisión central y aprobación financiera.'
]);
add(h2('20.3 Aprobación y banco'));
bullets([
  'Aprobación por usuarios financieros autorizados; todos los usuarios con rol Financiero son aprobadores disponibles.',
  'Rechazo o devolución del lote con observaciones.',
  'Retorno a borrador antes de la exportación bancaria cuando el estado lo permite.',
  'Exportación del archivo Excel para banco.',
  'Registro de respuesta bancaria, referencia, fecha y evidencia adjunta.',
  'Conciliación de diferencias: aceptación, rechazo o resolución individual.',
  'Contabilización de partidas pagadas por Contabilidad.',
  'Reapertura de lotes rechazados o cerrados bajo reglas específicas.',
  'Cancelación con conservación de eventos de auditoría.'
]);
add(h2('20.4 Estados de lote y partida'));
add(table(['Objeto', 'Estados soportados'], [
  ['Lote', 'Borrador; enviado a revisión; pendiente de aprobación; aprobado; enviado al banco; conciliación; pendiente contable; cerrado; devuelto; rechazado; anulado; consolidado.'],
  ['Partida', 'Incluida; excluida; aprobada; pagada; rechazada por banco; con diferencia; contabilizada.']
], [1900, 7460], { band: true }));
add(h2('20.5 Reportes de tesorería'));
bullets([
  'Resumen de pagos de facturas con estados pagado, pendiente o parcial, filtros, vista previa, Excel y PDF.',
  'Listado de lotes por búsqueda, estado y fecha con exportación.',
  'Detalle imprimible de un lote y su historial de eventos.',
  'Reporte detallado de pagos efectuados.',
  'Adjuntos en lotes y evidencias de respuesta bancaria.'
]);
add(h2('20.6 Liberación de retención de calidad'));
bullets([
  'Después de registrar una factura con retención de calidad y saldo disponible, administrador o Administración Proyecto puede solicitar una liberación.',
  'La solicitud incluye monto y justificación y no puede exceder el disponible.',
  'No se permite crear otra solicitud incompatible mientras exista una pendiente.',
  'Tesorería aprueba o rechaza; una solicitud aprobada pasa a lote de pago de liberación.',
  'Estados: pendiente de aprobación, aprobada, parcialmente pagada, pagada, rechazada o cancelada.',
  'Consulta por factura y listado general, con resumen de retenido, liberado y disponible.'
]);

chapter('21. Reportes y exportaciones');
add(h2('21.1 Reportes regulatorios SAR'));
add(table(['Reporte', 'Contenido'], [
  ['DMC SAR 527', 'Compras del período con clasificación fiscal y validaciones de datos requeridos.'],
  ['Retención 1% — código 135', 'Operaciones con la retención del uno por ciento.'],
  ['Retención 12.5% — código 112', 'Operaciones sujetas a doce punto cinco por ciento.'],
  ['Retención 15% — código 217', 'Operaciones sujetas a quince por ciento.']
], [3000, 6360], { band: true }));
bullets([
  'Rango de fechas obligatorio y modo de estado: no anuladas, registradas o todas.',
  'Vista previa del último resultado con registros e incidencias.',
  'Bloqueo de exportación si los datos no superan las validaciones.',
  'Enlaces desde incidencias hacia la factura que necesita corrección.',
  'Archivos Excel descargables.',
  'Acceso funcional para Administración Central, Administración Proyecto y Contabilidad.'
]);
add(h2('21.2 Exportaciones internas'));
bullets([
  'Dashboard financiero en Excel.',
  'Solicitudes y recepciones en CSV.',
  'Órdenes, facturas, inventario, artículos, bodegas, usuarios y tesorería en Excel.',
  'Reportes PDF donde el formato oficial o imprimible es relevante.',
  'Los filtros aplicados determinan el universo exportado cuando la pantalla lo especifica.'
]);

chapter('22. Proyectos, subproyectos y asignaciones');
add(h2('22.1 Proyectos'));
bullets([
  'Listado con búsqueda y filtro por activo, inactivo o completado.',
  'Código, nombre, descripción, ubicación, código SAP, fecha de inicio y final, y estado.',
  'Creación por administrador o Administración Central.',
  'Edición integral reservada al administrador global.',
  'Detalle con bodegas asignadas y definición de bodega principal.'
]);
add(h2('22.2 Subproyectos y destinos'));
bullets([
  'Listado de subproyectos por proyecto.',
  'Creación por administrador o Administración Central.',
  'Actualización por administrador, Administración Central o Administración Proyecto según el caso.',
  'Uso de subproyectos y activos fijos como destinos contables de requisiciones, compras, salidas y recepciones.'
]);
add(h2('22.3 Libro de asignaciones'));
bullets([
  'Consulta de destinos disponibles para asignación.',
  'Libro de movimientos que muestra cómo las cantidades se imputaron a subproyectos o activos.',
  'Exportación del libro para conciliación y auditoría.'
]);

chapter('23. Usuarios e invitaciones');
add(h2('23.1 Administración de usuarios'));
bullets([
  'Listado, búsqueda, filtros y exportación a Excel.',
  'Creación directa con nombre, correo, rol, proyectos y contraseña temporal.',
  'Cambio de rol funcional y de asignaciones de proyecto.',
  'Actualización administrativa del perfil.',
  'Restablecimiento de contraseña por administrador y obligación de cambio en el siguiente acceso.',
  'Administración Central no puede modificar cuentas con rol global admin.',
  'Las reglas de proyecto exigen asignaciones para roles que no pueden trabajar globalmente.'
]);
add(h2('23.2 Invitaciones'));
bullets([
  'Creación por administrador con correo, rol y proyectos.',
  'Estados pendiente, aceptada, expirada o cancelada.',
  'Reenvío y cancelación.',
  'Vista previa del correo y opción de copiar el contenido o enlace.',
  'Asignaciones de proyecto guardadas junto con la invitación.'
]);

chapter('24. Notificaciones');
bullets([
  'Bandeja personal de notificaciones.',
  'Conteo de no leídas y badge en la navegación.',
  'Marcar una notificación o todas como leídas.',
  'Tipos relacionados con nueva requisición, cambio de estado, solicitud de compra, orden, traslado, recepción, devolución, tesorería y mensajes del sistema.',
  'Acceso disponible para todos los usuarios autenticados, incluidos roles especializados.',
  'Actualización periódica del conteo sin necesidad de recargar manualmente la página.'
]);

chapter('25. Configuración administrativa');
add(p('La pantalla Configuración está reservada al administrador global. Los parámetros cambian el flujo real de los documentos nuevos y pendientes.'));
add(h2('25.1 Aprobaciones de compras'));
bullets([
  'Activar o desactivar aprobación de solicitudes de compra.',
  'Activar o desactivar aprobación de órdenes de compra.',
  'Umbral mínimo independiente para órdenes en HNL y USD.',
  'Valores no negativos y control de decimales.',
  'Antes de aprobación, la orden valida proveedor, moneda, tasa si es USD, método de pago, contrato completo si aplica y líneas con importes positivos.'
]);
add(h2('25.2 Tesorería'));
bullets([
  'Activar o desactivar el módulo.',
  'Activar o desactivar la aprobación formal de lotes.',
  'Con aprobación desactivada, los lotes enviados pueden avanzar directamente a banco.',
  'Con aprobación activada, se exige revisión central y aprobación financiera.'
]);

chapter('26. Datos de demostración e importaciones');
bullets([
  'Pantalla exclusiva de administrador.',
  'Pegado de datos tabulados desde Excel para proyectos, artículos e inventario.',
  'Importación asíncrona con indicador de avance y resultado.',
  'Resumen del último proceso y conteos por entidad.',
  'Limpieza controlada únicamente de datos identificados como demo; no elimina registros manuales ajenos al lote.',
  'Análisis e importación Excel de proveedores con validación antes de afectar el catálogo real.'
]);

chapter('27. Verificación pública de órdenes');
bullets([
  'Ruta pública mediante token, sin exigir inicio de sesión.',
  'Muestra si el sello es válido o fue anulado.',
  'Presenta orden, total, firmante, rol, tipo de sello y fechas en la zona horaria de Honduras.',
  'Permite al visitante seleccionar un PDF local.',
  'Calcula SHA-256 en el navegador; el archivo no se carga al servidor para la comparación.',
  'Compara el hash con el documento oficial y comunica coincidencia o diferencia.',
  'Sirve como verificación auditable del documento emitido y de su sello digital.'
]);

chapter('28. Archivos adjuntos y documentos generados');
add(h2('28.1 Adjuntos'));
bullets([
  'Consulta por entidad, carga, obtención de URL de descarga y eliminación con permisos.',
  'Entidades soportadas: requisición, flujo, devolución, solicitud y orden de compra, solicitud y documento de traslado, recepción, factura, anticipo, liberación de calidad, proveedor y lote de tesorería.',
  'Categorías: factura, orden, comprobante de entrega, foto de material, documento de proveedor, archivo bancario, comprobante de pago u otro.',
  'PDF de hasta 10 MB.',
  'Imágenes JPG, PNG o WebP: compresión y reducción hasta 2,000 píxeles; objetivo aproximado de 3 MB y máximo de 5 MB.',
  'Los archivos se almacenan mediante la capa de almacenamiento S3 configurada en el servidor.'
]);
add(h2('28.2 Documentos y salida'));
bullets([
  'PDF o impresión de solicitudes, órdenes, salidas, traslados, recepciones, facturas y pagos según el módulo.',
  'Excel y CSV para análisis y obligaciones regulatorias.',
  'Fechas, montos y textos se formatean para lectura humana sin perder los valores de origen.',
  'Los documentos oficiales conservan correlativos y relaciones con sus fuentes.'
]);

chapter('29. Reglas transversales y validaciones');
add(h2('29.1 Cantidades y estados'));
bullets([
  'Las cantidades deben ser positivas y no pueden superar el saldo o existencia aplicable.',
  'El avance parcial se refleja en línea y en cabecera.',
  'Cerrar incompleto requiere motivo y evita perder el rastro del saldo.',
  'Anular no equivale a borrar: los documentos conservan relaciones históricas.',
  'La transición de estado se valida en el servidor para impedir saltos inválidos.'
]);
add(h2('29.2 Fechas y moneda'));
bullets([
  'Las fechas requeridas se comparan en calendario para alertas de vencimiento.',
  'El plazo normal de requisición es cinco días calendario.',
  'Los rangos de reporte deben tener fecha inicial no posterior a la final.',
  'USD exige tasa de cambio y fecha; HNL opera como moneda base.',
  'Los cálculos de compra soportan precisión ampliada y redondeo consistente.'
]);
add(h2('29.3 Fiscal'));
bullets([
  'CAI, número de factura y rangos autorizados se validan antes del registro.',
  'Los rangos de proveedor y de constancias de retención se consultan automáticamente.',
  'Exoneraciones, importaciones y FYDUCA activan campos específicos.',
  'Las retenciones se limitan por línea y por la política fiscal del proveedor.',
  'Los reportes SAR bloquean exportaciones con datos incompletos y señalan la factura afectada.'
]);
add(h2('29.4 Auditoría y consistencia'));
bullets([
  'Números de documento únicos y referencias de origen.',
  'Historial de aprobaciones, sellos y eventos de tesorería.',
  'Trazabilidad de movimientos de inventario mediante Kardex.',
  'Usuarios y fechas de creación, actualización, aprobación o contabilización.',
  'Protecciones ante cambios de códigos maestros que ya tienen uso histórico.',
  'Sincronización de estados globales a partir del progreso real de las líneas.'
]);

chapter('30. Arquitectura funcional e integraciones');
add(table(['Capa', 'Tecnología/capacidad', 'Responsabilidad'], [
  ['Interfaz', 'React, Vite, Wouter, TanStack Query y componentes UI', 'Pantallas, formularios, filtros, navegación, estados de carga e impresión.'],
  ['API', 'tRPC sobre Express', 'Procedimientos tipados, validación, autorización y orquestación de procesos.'],
  ['Datos', 'PostgreSQL con Drizzle ORM', 'Persistencia transaccional, relaciones, catálogos y auditoría.'],
  ['Identidad', 'Supabase Auth', 'Sesiones, recuperación y cambio de contraseña.'],
  ['Archivos', 'Almacenamiento compatible con S3', 'Adjuntos y URLs de descarga.'],
  ['Intercambio', 'Excel XLSX, CSV, PDF e impresión HTML', 'Reportes, banco, documentos oficiales y análisis.'],
  ['ERP', 'Catálogo/códigos SAP y registros de sincronización', 'Preparación de datos y correlativos para SAP Business One según la instalación.']
], [1700, 3100, 4560], { band: true }));
add(callout('ALCANCE DE INTEGRACIÓN', 'La presencia de procedimientos, campos o bitácoras SAP demuestra preparación funcional. La operación en línea depende de credenciales, conectividad y configuración del entorno; por eso este manual no afirma una sincronización automática universal.', PALE_AMBER));

chapter('31. Anexo A — Rutas de la aplicación');
add(table(['Ruta', 'Pantalla o función'], [
  ['/', 'Dashboard'],
  ['/solicitudes', 'Listado de requisiciones'],
  ['/solicitudes/nueva', 'Nueva requisición'],
  ['/solicitudes/:id/editar', 'Edición de requisición'],
  ['/solicitudes/:id', 'Detalle y procesamiento de requisición'],
  ['/flujos', 'Flujos de abastecimiento'],
  ['/devoluciones', 'Logística inversa'],
  ['/devoluciones/nueva', 'Nueva devolución'],
  ['/inventario', 'Inventario'],
  ['/articulos', 'Catálogo de artículos'],
  ['/activos-fijos-pendientes', 'Activos fijos por resolver'],
  ['/grupos-financieros', 'Grupos financieros'],
  ['/proveedores', 'Proveedores'],
  ['/almacenes', 'Bodegas'],
  ['/solicitudes-compra', 'Solicitudes de compra'],
  ['/ordenes-compra', 'Órdenes de compra'],
  ['/solicitudes-traslado', 'Solicitudes de traslado'],
  ['/traslados', 'Traslados y guías'],
  ['/recepciones', 'Recepciones'],
  ['/facturas', 'Facturas'],
  ['/tesoreria', 'Tesorería'],
  ['/reportes', 'Reportes SAR'],
  ['/impuestos', 'Catálogo de impuestos'],
  ['/retenciones', 'Catálogo de retenciones'],
  ['/salidas-inventario', 'Salidas de inventario'],
  ['/salidas-bodega', 'Alias heredado de Salidas de inventario'],
  ['/saldos-iniciales', 'Saldos iniciales'],
  ['/proyectos', 'Proyectos y subproyectos'],
  ['/usuarios', 'Usuarios e invitaciones'],
  ['/configuracion', 'Configuración administrativa'],
  ['/datos-demo', 'Datos de demostración e importación'],
  ['/notificaciones', 'Bandeja de notificaciones'],
  ['/verificar/oc/:token', 'Verificación pública de una orden'],
  ['/actualizar-contrasena', 'Actualización/recuperación de contraseña'],
  ['/404', 'Página no encontrada']
], [3500, 5860], { band: true }));

chapter('32. Anexo B — Catálogo de estados');
add(h2('32.1 Requisiciones y aprobación'));
add(table(['Objeto', 'Estados'], [
  ['Requisición', 'Borrador; pendiente de aprobación; en espera; en proceso; parcialmente atendida; flujo completado; cerrada; cerrada incompleta; anulada.'],
  ['Etapa', 'Bodega proyecto; Administración Proyecto; oficina central; compra local; compra internacional; traslado; recepción; cerrada; rechazada.'],
  ['Aprobación', 'Pendiente; aprobada; rechazada; descartada; no requiere.'],
  ['Línea/flujo', 'Pendiente; parcial; completa / pendiente; en proceso; completado; cancelado.']
], [2200, 7160], { band: true }));
add(h2('32.2 Compras, logística y fiscal'));
add(table(['Objeto', 'Estados'], [
  ['Solicitud de compra', 'Pendiente; en revisión; aprobada; rechazada; parcialmente convertida; convertida; anulada.'],
  ['Orden', 'Borrador; pendiente aprobación; aprobada; rechazada; emitida; enviada; parcialmente recibida; recibida; anulada.'],
  ['Solicitud de traslado', 'Pendiente; aprobada; rechazada; convertida; anulada.'],
  ['Traslado', 'Pendiente; confirmado; en tránsito; parcialmente recibido; recibido; cerrado incompleto; anulado.'],
  ['Recepción', 'Borrador; pendiente; parcial; completa; cerrada incompleta; anulada.'],
  ['Salida', 'Borrador; emitida; anulada.'],
  ['Devolución', 'Pendiente; aprobada; en tránsito; recibida; rechazada.'],
  ['Factura', 'Borrador; en revisión; rechazada; registrada; anulada.']
], [2600, 6760], { band: true }));
add(h2('32.3 Tesorería y soporte'));
add(table(['Objeto', 'Estados'], [
  ['Lote de pago', 'Borrador; enviado a revisión; pendiente aprobación; aprobado; enviado banco; conciliación; pendiente contable; cerrado; devuelto; rechazado; anulado; consolidado.'],
  ['Partida', 'Incluida; excluida; aprobada; pagada; rechazada por banco; diferencia; contabilizada.'],
  ['Liberación de calidad', 'Pendiente aprobación; aprobada; parcialmente pagada; pagada; rechazada; cancelada.'],
  ['Proyecto', 'Activo; inactivo; completado.'],
  ['Invitación', 'Pendiente; aceptada; expirada; cancelada.']
], [2600, 6760], { band: true }));

chapter('33. Anexo C — Procedimientos funcionales del servidor');
add(p('Este inventario enumera las operaciones expuestas por la API tipada. Es útil para soporte, pruebas de aceptación y cobertura funcional. Los nombres se conservan para que puedan rastrearse en el código.'));
const endpoints = [
  ['articles', 'list, update, create, resolveFixedAssetCode, updateFixedAssetDetails'],
  ['attachments', 'getByEntity, getDownloadUrl, upload, delete'],
  ['dashboard', 'stats, financialReport, sidebarCounts'],
  ['demoData', 'status, latestImport, import, clear'],
  ['financialGroups', 'list, activeOptions, create, update, remove'],
  ['inventory', 'projectStockForItems, visibleWarehouseStockForItems, list, pendingQuantities, globalAvailability, tracking, kardex, create, update, bulkAssignProject, bulkAssignProjectByFilters'],
  ['invitations', 'list, create, cancel, resend'],
  ['invoices', 'listPage, list, getById, lookupFiscalDocumentRange, lookupRetentionFiscalDocumentRange, update, review, account, returnToReview, reject, correctReceipt, replaceRetentions, replaceDocumentAdjustments, updateItemAssetDetails'],
  ['materialRequests', 'targetOptions, list, listPage, getById, itemsPreview, create, update, reviewItems, updateStatus, approve, reject, assignFlow, sendToSap'],
  ['notifications', 'list, unreadCount, markAsRead, markAllAsRead'],
  ['openingBalances', 'list, getById, create, addItems'],
  ['projects', 'list, getById, getByCode, create, update, listSubprojects, listAssignmentTargets, getAssignmentLedger, exportAssignmentLedger, createSubproject, updateSubproject'],
  ['purchaseOrderAdvances', 'permissions, eligiblePurchaseOrders, list, getById, create, cancel'],
  ['purchaseOrders', 'verifySeal, listPage, list, getById, getDocument, latestSupplierPrices, createFromPurchaseRequest, createUnifiedFromPurchaseRequests, submitForApproval, reviewApproval, reopenRejected, updatePaymentMethod, update, updateContractTerms, updatePricesIncludeTax, replaceItem, updateItemPricing, updateItemLine, saveFixedAssetDraftLine, updateContractItemPrice, closeReceiptLine, movePendingToPurchaseRequest, deleteItem, cancelOrder, reopenDraft, sendToSupplier'],
  ['purchaseRequests', 'listPage, list, getById, getDocument, create, update, submitForApproval, resubmitRejectedItems, discardRejectedItems, reviewApproval, updatePendingQuantities, reopenRejected, reject, attachQuote'],
  ['qualityRetentionReleases', 'byInvoice, list, request, decide, approve, reject, cancel'],
  ['receipts', 'listPage, list, getById, lookupFiscalDocumentRange, saveDraft, register'],
  ['reports', 'systemWorkbook, systemPurchaseOrders, systemInvoices, dmcPurchases, dmcSarPurchases, retentionSar'],
  ['requestItems', 'getByRequestId, searchSapCatalog, lookupSapItem, listSapCatalog, searchSuppliers, supplierOptions, listSuppliers, translateToSap, clearSapTranslation, assignFlow, returnQueuedToRequisition, updateDelivered, recordWarehouseExit, recordWarehouseExitBatch, returnDispatchToRequisition, returnTransferToRequisition, rejectPendingQuantity, rejectApproved'],
  ['retentions', 'list, activeOptions, create, update'],
  ['reverseLogistics', 'list, getById, create, generateCreditNote, createCentralWarehouseTransfer, updateStatus'],
  ['suppliers', 'list, analyzeExcelImport, importExcel, create, update, listDocumentTypes, createDocumentType, updateDocumentType, deactivateDocumentType, listDocuments, createDocument, updateDocument, deleteDocument, listContacts, createContact, updateContact'],
  ['supplyFlows', 'listPage, list, pendingQueue, getByRequestId, availableFlows, sapMapping, createDirectPurchase, createDirectPurchaseBatch, confirmGoodsReceipt, createWarehouseDispatch, createProjectTransfer, createProjectTransferBatch, createPurchaseRequest, createPurchaseRequestBatch, convertToPurchaseOrder, updateStatus'],
  ['systemSettings', 'updatePurchaseRequestApprovals, updatePurchaseOrderApprovals'],
  ['taxes', 'list, activeOptions, create, update, remove'],
  ['transferRequests', 'listPage, list, getById, create, reject, cancel, updateDestinationWarehouse, convertToTransfer'],
  ['transfers', 'listPage, list, getById, updatePrintFields'],
  ['treasury', 'settings, updateSettings, approvers, eligibleInvoices, eligibleAdvances, eligibleQualityRetentionReleases, invoiceSummaryReport, invoiceSummaryReportPdf, list, paymentsReport, getById, paymentDetailReport, create, updateDraft, submit, saveReview, consolidateForApproval, approve, reject, returnBatch, returnToDraft, exportBankWorkbook, recordBankResponse, importBankWorkbook, resolveDifference, accountItems, reopenRejected, reopenClosed, cancel'],
  ['userManagement', 'list, createDirect, updateRole, updateUserAdmin, resetPasswordAdmin, updateProfileName, markPasswordChanged, me'],
  ['warehouseExits', 'list, listPage, getById, getDocument, emit, updateDraft, cancelDraft'],
  ['warehouses', 'list, getById, create, update, assignProject, setProjectPrimary, unassignProject, deactivate, reactivate, assignableUsers, assignUser, unassignUser, setResponsible']
];
add(table(
  ['Router', 'Procedimientos'],
  endpoints.map(([router, procedures]) => [breakableCode(router), breakableCode(procedures)]),
  [2200, 7160],
  { band: true }
));

chapter('34. Anexo D — Entidades principales de datos');
add(p('La persistencia está distribuida en tablas que separan maestros, documentos, líneas, relaciones y auditoría.'));
add(table(['Dominio', 'Entidades'], [
  ['Identidad y configuración', 'users, systemSettings, invitations, invitationProjectAssignments, notifications'],
  ['Proyectos y almacenes', 'projects, userProjectAssignments, projectSubprojects, warehouses, projectWarehouseAssignments, warehouseUserAssignments'],
  ['Requisiciones y abastecimiento', 'materialRequests, requestItems, supplyFlowRecords'],
  ['Compras', 'purchaseRequests, purchaseRequestItems, purchaseOrders, purchaseOrderItems, procurementApprovalHistory, purchaseOrderDigitalSeals, purchaseOrderAuditLogs, purchaseOrderAdvances'],
  ['Traslados y recepción', 'transferRequests, transferRequestItems, transfers, remissionGuides, receipts, receiptItems, receiptOtherCharges'],
  ['Inventario', 'inventoryItems, warehouseExits, warehouseExitItems, openingBalances, openingBalanceItems, reverseLogistics, reverseLogisticsItems'],
  ['Facturación', 'invoices, invoiceItems, invoiceOtherCharges, invoiceRetentions, invoiceDocumentAdjustments, purchaseOrderAdvanceApplications, qualityRetentionReleases'],
  ['Tesorería', 'treasuryApproverAssignments, treasuryPaymentBatches, treasuryPaymentItems, treasuryPaymentEvents'],
  ['Catálogos fiscales y maestros', 'sapCatalog, financialGroups, salesTaxes, taxRetentions, suppliers, supplierFiscalDocumentRanges, retentionFiscalDocumentRanges, supplierContacts, supplierDocumentTypes, supplierDocuments'],
  ['Soporte e integración', 'attachments, sapSyncLog']
].map(([domain, entities]) => [domain, breakableCode(entities)]), [2600, 6760], { band: true }));

chapter('35. Anexo E — Glosario');
add(table(['Término', 'Definición funcional'], [
  ['REQ', 'Requisición de materiales o servicios.'],
  ['SC', 'Solicitud de compra que agrupa cantidades listas para adquirir.'],
  ['OC', 'Orden de compra formal emitida a un proveedor.'],
  ['CD', 'Clasificación de compra directa.'],
  ['Flujo', 'Ruta de atención asignada a una cantidad de la requisición.'],
  ['Saldo pendiente', 'Cantidad todavía no convertida, despachada, recibida, pagada o cerrada.'],
  ['CAI', 'Código de Autorización de Impresión usado en documentos fiscales de Honduras.'],
  ['SAR', 'Servicio de Administración de Rentas.'],
  ['DMC', 'Declaración Mensual de Compras.'],
  ['FYDUCA', 'Factura y Declaración Única Centroamericana.'],
  ['DUA', 'Declaración Única Aduanera.'],
  ['OCE', 'Orden de Compra Exenta o referencia de exoneración utilizada por el documento.'],
  ['Kardex', 'Historial de entradas, salidas y saldos de inventario.'],
  ['Activo fijo pendiente', 'Artículo recibido o registrado que necesita completar identificación patrimonial.'],
  ['Lote de pago', 'Agrupación de obligaciones que atraviesa revisión, banco, conciliación y contabilización.'],
  ['Retención de calidad', 'Ajuste que reserva una parte del pago hasta que se apruebe su liberación.'],
  ['Sello digital', 'Registro auditable de hash, firmante y documento para verificación pública.']
], [2600, 6760], { band: true }));
add(p('', null, { spaceAfter: 240 }));
add(callout('FIN DEL MANUAL', 'Este documento cubre la funcionalidad visible y las operaciones del servidor encontradas en la implementación actual de BuildReq. Para una prueba de aceptación, se recomienda recorrer cada capítulo con usuarios de los roles correspondientes y datos de un proyecto controlado.', PALE_TEAL));

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="es-HN"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="222222"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240" w:line="320" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="180"/></w:pPr><w:rPr><w:b/><w:color w:val="${BLUE}"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="140"/></w:pPr><w:rPr><w:b/><w:color w:val="${BLUE}"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="${DARK_BLUE}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="280" w:lineRule="auto"/><w:ind w:left="540" w:hanging="270"/></w:pPr></w:style>
  <w:style w:type="table" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:qFormat/></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="270"/></w:tabs><w:ind w:left="540" w:hanging="270"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="–"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="630"/></w:tabs><w:ind w:left="900" w:hanging="270"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="270"/></w:tabs><w:ind w:left="540" w:hanging="270"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr>${run('BuildReq  |  Manual funcional completo', { color: GRAY, size: 18 })}</w:p></w:hdr>`;
const firstHeaderXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:hdr>`;
const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="80" w:after="0"/></w:pPr>${run('Página ', { color: GRAY, size: 18 })}<w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:color w:val="${GRAY}"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>${run(' de ', { color: GRAY, size: 18 })}<w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:color w:val="${GRAY}"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body.join('')}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId3"/>
      <w:headerReference w:type="first" r:id="rId4"/>
      <w:footerReference w:type="default" r:id="rId5"/>
      <w:titlePg/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440" w:header="540" w:footer="540" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:updateFields w:val="true"/></w:settings>`;
const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Manual Funcional Completo BuildReq</dc:title><dc:subject>Funcionalidades, permisos y reglas de negocio</dc:subject><dc:creator>OpenAI Codex</dc:creator><cp:keywords>BuildReq; requisiciones; compras; inventario; tesorería</cp:keywords><dc:description>Referencia funcional exhaustiva basada en la implementación de BuildReq.</dc:description><cp:lastModifiedBy>OpenAI Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-08-18T12:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-18T12:00:00Z</dcterms:modified></cp:coreProperties>`;
const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><Company>BuildReq</Company><AppVersion>16.0000</AppVersion></Properties>`;

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'buildreq_manual_'));
function write(rel, content) {
  const target = path.join(stage, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

write('[Content_Types].xml', contentTypes);
write('_rels/.rels', packageRels);
write('word/document.xml', documentXml);
write('word/_rels/document.xml.rels', documentRels);
write('word/styles.xml', stylesXml);
write('word/numbering.xml', numberingXml);
write('word/settings.xml', settingsXml);
write('word/header1.xml', headerXml);
write('word/header2.xml', firstHeaderXml);
write('word/footer1.xml', footerXml);
write('docProps/core.xml', coreXml);
write('docProps/app.xml', appXml);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const zipPath = `${stage}.zip`;
const psScript = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:DOCX_STAGE, $env:DOCX_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $false)`;
const packed = spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
  env: { ...process.env, DOCX_STAGE: stage, DOCX_ZIP: zipPath },
  encoding: 'utf8'
});
if (packed.status !== 0 || !fs.existsSync(zipPath)) {
  throw new Error(`No fue posible empaquetar el DOCX. ${packed.stderr || packed.stdout}`);
}
fs.copyFileSync(zipPath, OUTPUT_DOCX);
console.log(JSON.stringify({ output: OUTPUT_DOCX, bytes: fs.statSync(OUTPUT_DOCX).size, paragraphs: body.length, endpointGroups: endpoints.length }, null, 2));
