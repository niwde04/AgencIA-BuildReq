import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'documentacion');
const ASSET_DIR = path.join(OUTPUT_DIR, '_architecture_assets');
const OUTPUT_DOCX = path.join(OUTPUT_DIR, 'Arquitectura_Funcional_y_Relacion_de_Modulos_BuildReq.docx');
const CONCEPT_IMAGE = path.join(ASSET_DIR, 'vista-conceptual-buildreq.png');
const CYCLE_IMAGE = path.join(ASSET_DIR, 'ciclo-operativo-buildreq.png');

const BLUE = '2E74B5';
const DARK_BLUE = '1F4E79';
const NAVY = '17365D';
const GRAY = '5B6573';
const LIGHT_GRAY = 'F2F4F7';
const PALE_BLUE = 'E8EEF5';
const PALE_GREEN = 'E2F0D9';
const PALE_AMBER = 'FFF2CC';
const PALE_RED = 'FCE4D6';
// Named layout override: Word's rendering of four-column matrices needs a small
// right-side safety allowance while retaining the preset's 120 DXA indent.
const TABLE_SAFE_WIDTH_DXA = 9000;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

function paragraph(content = '', style = null, options = {}) {
  const pPr = [];
  if (style) pPr.push(`<w:pStyle w:val="${style}"/>`);
  if (options.align) pPr.push(`<w:jc w:val="${options.align}"/>`);
  if (options.pageBreakBefore) pPr.push('<w:pageBreakBefore/>');
  if (options.keepNext) pPr.push('<w:keepNext/>');
  if (options.keepLines) pPr.push('<w:keepLines/>');
  if (options.indentLeft || options.indentRight || options.firstLine || options.hanging) {
    pPr.push(`<w:ind${options.indentLeft ? ` w:left="${options.indentLeft}"` : ''}${options.indentRight ? ` w:right="${options.indentRight}"` : ''}${options.firstLine ? ` w:firstLine="${options.firstLine}"` : ''}${options.hanging ? ` w:hanging="${options.hanging}"` : ''}/>`);
  }
  if (options.spaceBefore !== undefined || options.spaceAfter !== undefined || options.line) {
    pPr.push(`<w:spacing${options.spaceBefore !== undefined ? ` w:before="${options.spaceBefore}"` : ''}${options.spaceAfter !== undefined ? ` w:after="${options.spaceAfter}"` : ''}${options.line ? ` w:line="${options.line}" w:lineRule="auto"` : ''}/>`);
  }
  if (options.shading) pPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shading}"/>`);
  const body = Array.isArray(content) ? content.join('') : run(String(content));
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${body}</w:p>`;
}

function h1(text, pageBreakBefore = false) {
  return paragraph(text, 'Heading1', { pageBreakBefore });
}
function h2(text, pageBreakBefore = false) { return paragraph(text, 'Heading2', { pageBreakBefore }); }
function h3(text) { return paragraph(text, 'Heading3'); }
function pageBreak() { return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }

function bullet(text, level = 0) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`;
}

function numberItem(text) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${run(text)}</w:p>`;
}

function cellParagraph(text, options = {}) {
  return paragraph(
    [run(text, { bold: options.bold, color: options.color, size: options.size ?? 18 })],
    null,
    { spaceBefore: 0, spaceAfter: options.spaceAfter ?? 40, line: options.line ?? 240 }
  );
}

function cell(text, width, options = {}) {
  const props = [
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    '<w:vAlign w:val="top"/>'
  ];
  if (options.shading) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${options.shading}"/>`);
  const contents = Array.isArray(text)
    ? text.map((item) => (typeof item === 'string' && item.startsWith('<w:p') ? item : cellParagraph(item, options))).join('')
    : (typeof text === 'string' && text.startsWith('<w:p') ? text : cellParagraph(text, options));
  return `<w:tc><w:tcPr>${props.join('')}</w:tcPr>${contents}</w:tc>`;
}

function table(headers, rows, widths, options = {}) {
  const totalWidth = widths.reduce((sum, value) => sum + value, 0);
  if (totalWidth !== TABLE_SAFE_WIDTH_DXA) {
    throw new Error(`La geometría compacta segura de tabla debe sumar exactamente ${TABLE_SAFE_WIDTH_DXA} DXA: ${widths.join(', ')}`);
  }
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const borders = options.quiet
    ? '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9E2EC"/><w:left w:val="single" w:sz="4" w:color="D9E2EC"/><w:bottom w:val="single" w:sz="4" w:color="D9E2EC"/><w:right w:val="single" w:sz="4" w:color="D9E2EC"/><w:insideH w:val="single" w:sz="4" w:color="E7ECF2"/><w:insideV w:val="single" w:sz="4" w:color="E7ECF2"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="single" w:sz="6" w:color="9DB7D5"/><w:left w:val="single" w:sz="6" w:color="9DB7D5"/><w:bottom w:val="single" w:sz="6" w:color="9DB7D5"/><w:right w:val="single" w:sz="6" w:color="9DB7D5"/><w:insideH w:val="single" w:sz="4" w:color="D9E2EC"/><w:insideV w:val="single" w:sz="4" w:color="D9E2EC"/></w:tblBorders>';
  const margins = '<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar>';
  const headerRow = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${headers.map((header, index) => cell(header, widths[index], { shading: options.headerFill ?? LIGHT_GRAY, bold: true, color: NAVY, size: 18, line: 230 })).join('')}</w:tr>`;
  const bodyRows = rows.map((row, rowIndex) => {
    const shading = options.band && rowIndex % 2 === 1 ? 'F8FAFC' : null;
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((value, index) => cell(
      index === 0 ? cellParagraph(value, { bold: true, color: DARK_BLUE, size: 18, line: 235 }) : value,
      widths[index],
      { shading, size: 18, line: 235 }
    )).join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}${margins}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headerRow}${bodyRows}</w:tbl>${paragraph('', null, { spaceAfter: 80 })}`;
}

function callout(label, text, fill = PALE_BLUE) {
  const title = cellParagraph(label, { bold: true, color: NAVY, size: 18, spaceAfter: 20, line: 230 });
  const body = cellParagraph(text, { color: '263238', size: 19, spaceAfter: 0, line: 250 });
  const contents = `${title}${body}`;
  const borders = '<w:tblBorders><w:top w:val="single" w:sz="5" w:color="9DB7D5"/><w:left w:val="single" w:sz="12" w:color="2E74B5"/><w:bottom w:val="single" w:sz="5" w:color="9DB7D5"/><w:right w:val="single" w:sz="5" w:color="9DB7D5"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="${TABLE_SAFE_WIDTH_DXA}" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}<w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${TABLE_SAFE_WIDTH_DXA}"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${TABLE_SAFE_WIDTH_DXA}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>${contents}</w:tc></w:tr></w:tbl>${paragraph('', null, { spaceAfter: 80 })}`;
}

function imageParagraph(relId, name, description, widthInches, heightInches, docPrId) {
  const cx = Math.round(widthInches * 914400);
  const cy = Math.round(heightInches * 914400);
  return `<w:p><w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="80" w:after="80"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="${esc(name)}" descr="${esc(description)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${esc(name)}" descr="${esc(description)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function caption(text) {
  return paragraph([run(text, { italic: true, color: GRAY, size: 18 })], null, { align: 'center', spaceAfter: 160, keepNext: true });
}

const scopeGroups = [
  {
    title: '3.1 Gobierno, acceso y estructura organizacional',
    rows: [
      ['Acceso, cuenta y perfil', 'Autentica usuarios, recupera o actualiza contraseñas y mantiene el nombre visible del perfil. Obliga a cambiar contraseñas temporales cuando corresponde.', 'Correo, contraseña, sesión de Supabase y datos básicos del usuario.', 'Entrega una sesión validada al servidor; determina si el usuario entra al sistema, actualiza credenciales o queda a la espera de un rol válido.'],
      ['Dashboard', 'Concentra indicadores, pendientes y accesos rápidos según el rol y los proyectos visibles.', 'Requisiciones, proyectos, devoluciones, flujos, estados financieros y conteos de bandeja.', 'Lleva al usuario a los listados operativos filtrados y presenta gráficos de estado para seguimiento ejecutivo.'],
      ['Proyectos y subproyectos', 'Administra la estructura donde se originan las necesidades, se asignan responsables y se controla el ámbito de trabajo.', 'Código, nombre, estado, subproyectos, asignaciones de usuario y almacenes principales.', 'Alimenta requisiciones, inventario, compras, reportes y todos los controles de visibilidad por proyecto.'],
      ['Usuarios, roles e invitaciones', 'Crea cuentas, invita usuarios, asigna roles BuildReq, proyectos y privilegios administrativos.', 'Identidad, correo, rol, proyectos, estado de invitación y políticas de contraseña.', 'Gobierna menú, consultas y acciones; conserva el estado de invitaciones y permite restablecer credenciales.'],
      ['Almacenes y responsables', 'Define bodegas, responsables, usuarios asignados, proyecto principal y disponibilidad operativa.', 'Código, nombre, ubicación, tipo, responsables, usuarios y asignaciones de proyecto.', 'Determina el origen y destino de existencias, despachos, traslados, recepciones y saldos iniciales.'],
      ['Configuración del sistema', 'Activa o desactiva reglas de aprobación de solicitudes, órdenes y tesorería.', 'Parámetros administrativos y políticas de aprobación.', 'Modifica las rutas que siguen los documentos sin alterar su información de origen; acceso reservado al administrador.']
    ]
  },
  {
    title: '3.2 Maestros y soporte de abastecimiento',
    rows: [
      ['Artículos y catálogo SAP', 'Mantiene los artículos operativos y sus equivalencias o atributos usados para traducir necesidades al catálogo empresarial.', 'Código, descripción, unidad, grupo financiero, tipo, códigos SAP y atributos patrimoniales.', 'Se utiliza en requisiciones, inventario, compras, recepciones, reportes y preparación de integración con SAP Business One.'],
      ['Activos fijos pendientes', 'Completa la identificación patrimonial de artículos que requieren código, placa u otros datos de activo fijo.', 'Líneas de recepción o factura marcadas como activo, código patrimonial y detalles del bien.', 'Actualiza artículos y documentos relacionados; deja la línea lista para control contable y reportes.'],
      ['Grupos financieros', 'Clasifica artículos y operaciones para análisis, contabilización y agrupación financiera.', 'Código, nombre, estado y asociación con artículos.', 'Alimenta catálogos, compras, facturación y reportes; protege códigos que ya tienen uso histórico.'],
      ['Proveedores, contactos y documentos', 'Administra datos comerciales, fiscales y documentales de proveedores, incluyendo contactos y vigencias.', 'RTN, razón social, contactos, métodos de pago, documentos, rangos fiscales y archivos.', 'Alimenta solicitudes, órdenes, facturas, anticipos, retenciones y tesorería; alerta sobre datos o documentos incompletos.'],
      ['Impuestos', 'Mantiene las tasas y categorías de impuesto que pueden aplicarse a artículos, compras y facturas.', 'Nombre, tasa, vigencia, código y condición activa.', 'Interviene en cálculos de orden y factura, validaciones fiscales y reportes regulatorios.'],
      ['Retenciones', 'Define tipos, porcentajes y condiciones de retención aplicables a proveedores y documentos.', 'Código, nombre, porcentaje, base, vigencia y reglas fiscales.', 'Calcula y documenta retenciones en facturas, constancias, lotes de pago y reportes SAR.']
    ]
  },
  {
    title: '3.3 Demanda y decisión de abastecimiento',
    rows: [
      ['Requisiciones', 'Registra necesidades de materiales o servicios por proyecto, fecha requerida y línea solicitada. Permite borrador, edición, seguimiento y cierre.', 'Proyecto, solicitante, artículos, descripciones, unidades, cantidades, prioridad, justificación y fecha requerida.', 'Origina la aprobación, traducción SAP y asignación de cantidades a despacho, traslado, compra directa o solicitud de compra.'],
      ['Revisión y aprobación de requisiciones', 'Aprueba, rechaza, pone en espera o procesa cada línea y cantidad conforme al rol y etapa.', 'Requisición, estado, comentarios, disponibilidad y decisión del aprobador.', 'Actualiza estados por línea y cabecera; habilita o bloquea la asignación de flujo y conserva la trazabilidad de decisiones.'],
      ['Traducción al catálogo SAP', 'Relaciona una descripción solicitada con el artículo o código oficial que se utilizará en el proceso.', 'Texto libre, resultados de búsqueda, artículo SAP seleccionado y unidad.', 'Estandariza la línea para inventario, compra y reportes; puede limpiarse o modificarse antes del procesamiento.'],
      ['Flujos de abastecimiento', 'Administra la cola de cantidades aprobadas y decide cómo será atendida cada una.', 'Línea aprobada, cantidad pendiente, existencias, almacenes, proveedor y ruta seleccionada.', 'Genera despacho, compra directa, solicitud de traslado, solicitud de compra u orden; sincroniza el progreso real con la requisición.'],
      ['Asignación y seguimiento por cantidad', 'Permite dividir una línea entre varias rutas y controlar atención parcial, completa, cancelada o devuelta.', 'Cantidad aprobada, asignada, despachada, convertida, recibida y rechazada.', 'Evita sobreprocesamiento, conserva saldos pendientes y actualiza estados globales a partir de las líneas.']
    ]
  },
  {
    title: '3.4 Compras y compromisos con proveedores',
    rows: [
      ['Solicitudes de compra', 'Agrupa líneas listas para cotizar o adquirir, adjunta ofertas y somete el documento al circuito de aprobación configurado.', 'Cantidades del flujo, proyecto, proveedor propuesto, precios, moneda, cotizaciones y comentarios.', 'Puede aprobarse, rechazarse, reabrirse o convertirse parcial o totalmente en una o varias órdenes de compra.'],
      ['Órdenes de compra', 'Formaliza el compromiso con el proveedor y controla precios, impuestos, moneda, condiciones y progreso de recepción.', 'Solicitud de compra o creación unificada, proveedor, líneas, precios, impuestos, pago, moneda y tasa de cambio.', 'Emite o envía el documento, genera sellos, anticipos y recepciones; actualiza cantidades recibidas y estado contractual.'],
      ['Contratos y términos', 'Extiende la orden con condiciones contractuales, vigencias, precios y ajustes de líneas cuando la adquisición lo requiere.', 'Orden, cláusulas, fechas, modalidad, precios, líneas y reglas de cierre.', 'Conserva condiciones comerciales junto a la orden y alimenta recepción, factura, auditoría y seguimiento de saldos.'],
      ['Aprobaciones de compras', 'Revisa solicitudes y órdenes cuando la política del sistema exige aprobación formal.', 'Documento enviado, rol aprobador, comentario y decisión.', 'Registra historial, aprueba, rechaza o devuelve; con la política desactivada permite avanzar directamente según el flujo configurado.'],
      ['Anticipos de compra', 'Registra anticipos asociados a órdenes elegibles antes de la facturación final.', 'Orden, proveedor, monto, moneda, fecha y soporte.', 'Se aplica posteriormente a facturas y puede formar parte de lotes de tesorería; conserva saldo aplicado y disponible.'],
      ['Sellos y verificación de órdenes', 'Genera evidencia auditable de la orden emitida mediante firmante, hash, tipo de sello y token público.', 'Orden emitida, documento PDF, firmante, rol, fecha y hash SHA-256.', 'Habilita la verificación pública del documento y permite detectar sellos válidos, anulados o archivos diferentes.']
    ]
  },
  {
    title: '3.5 Logística, almacenes e inventario',
    rows: [
      ['Inventario', 'Consulta y administra existencias por artículo, almacén y proyecto, con disponibilidad global y cantidades pendientes.', 'Artículos, almacenes, proyectos, entradas, salidas, asignaciones y saldos.', 'Alimenta decisiones de flujo, despacho y traslado; expone existencias, disponibilidad y seguimiento por proyecto.'],
      ['Kardex y trazabilidad de movimientos', 'Presenta el historial cronológico de entradas, salidas y saldos para auditoría de inventario.', 'Movimientos de saldos iniciales, salidas, traslados, recepciones, devoluciones y ajustes.', 'Entrega evidencia de origen, documento, fecha, cantidad y saldo resultante por artículo y almacén.'],
      ['Saldos iniciales', 'Carga existencias de apertura para iniciar el control formal de un almacén o proyecto.', 'Almacén, fecha, responsable, artículos, cantidades y costos de apertura.', 'Crea movimientos de entrada e impacta inventario y Kardex sin requerir una orden de compra.'],
      ['Salidas y despachos', 'Prepara, emite o anula entregas de inventario destinadas a requisiciones y proyectos.', 'Almacén de origen, requisición, artículos, cantidades disponibles, receptor y observaciones.', 'Descuenta existencias al emitir, actualiza flujo y requisición, genera documento de salida y registra Kardex.'],
      ['Solicitudes de traslado', 'Representa la necesidad autorizada de mover materiales entre almacenes. En la interfaz actual nace principalmente del flujo.', 'Cantidad aprobada, almacén origen, almacén destino, proyecto y líneas.', 'Puede aprobarse, rechazarse, cancelarse o convertirse en traslado; conserva cantidades convertidas y pendientes.'],
      ['Traslados y guías de remisión', 'Ejecuta el movimiento físico entre almacenes y genera los datos de transporte y remisión.', 'Solicitud aprobada, líneas, cantidades, origen, destino, transportista, vehículo y observaciones.', 'Pasa por confirmación, tránsito y recepción; actualiza inventario de origen y destino y produce guía imprimible.'],
      ['Recepciones', 'Registra entregas parciales o totales provenientes de órdenes o traslados y controla discrepancias.', 'Documento de origen, cantidades recibidas, fechas, almacén, cargas, datos fiscales y observaciones.', 'Actualiza orden o traslado, existencias y Kardex; prepara información para factura y activos fijos.'],
      ['Logística inversa y devoluciones', 'Gestiona materiales devueltos, rechazados o retornados y su destino posterior.', 'Documento de origen, artículos, cantidades, motivo, evidencia y decisión.', 'Puede generar nota de crédito o traslado a bodega central; actualiza estados e inventario sin perder trazabilidad.']
    ]
  },
  {
    title: '3.6 Facturación, pagos y control financiero',
    rows: [
      ['Facturas', 'Captura, revisa y contabiliza obligaciones de proveedor vinculadas a compras y recepciones.', 'Proveedor, orden, recepción, número fiscal, CAI, fechas, líneas, cargos, impuestos, retenciones y ajustes.', 'Valida rangos fiscales, calcula totales, aplica anticipos, crea obligaciones elegibles para tesorería y soporta rechazo o corrección.'],
      ['Control fiscal hondureño', 'Valida documentos y datos requeridos para CAI, rangos autorizados, exoneraciones, importaciones, FYDUCA y DUA.', 'RTN, CAI, rango, fecha límite, número de factura y atributos fiscales.', 'Bloquea registros o exportaciones incompletas y alimenta libros, DMC, constancias y reportes SAR.'],
      ['Liberaciones de retención de calidad', 'Administra la solicitud y aprobación de montos retenidos hasta cumplir condiciones de calidad.', 'Factura, retención, monto solicitado, evidencia, decisión y fechas.', 'Crea una obligación pagable aprobada, parcial o total; puede rechazarse, cancelarse o entrar a tesorería.'],
      ['Tesorería y lotes de pago', 'Agrupa facturas, anticipos y liberaciones para revisión, aprobación, banco, conciliación y contabilización.', 'Obligaciones elegibles, cuentas, moneda, beneficiario, archivo bancario, respuesta del banco y diferencias.', 'Produce lotes, archivos bancarios, comprobantes, eventos y partidas contabilizadas; permite devolver, reabrir o cancelar bajo reglas.'],
      ['Reportes financieros y SAR', 'Genera información operativa, contable y regulatoria en Excel, CSV, PDF o impresión.', 'Rangos de fecha, proyectos, proveedores, compras, facturas, retenciones, pagos y catálogos.', 'Entrega libros y reportes DMC/SAR, resúmenes de órdenes, facturas y pagos; señala datos faltantes antes de exportar.']
    ]
  },
  {
    title: '3.7 Capacidades transversales',
    rows: [
      ['Notificaciones', 'Informa asignaciones, decisiones, pendientes y cambios relevantes mediante una bandeja por usuario.', 'Eventos de aprobación, rechazo, asignación, documento listo y cambio de estado.', 'Muestra conteo no leído, permite marcar individualmente o en bloque y lleva al registro relacionado.'],
      ['Archivos adjuntos', 'Carga, consulta, descarga y elimina evidencia asociada a documentos operativos y maestros.', 'PDF, JPG, PNG o WebP, categoría, entidad relacionada y permisos del usuario.', 'Conserva soportes de requisición, compra, traslado, recepción, factura, proveedor y tesorería mediante almacenamiento compatible con S3.'],
      ['Documentos generados y exportaciones', 'Produce representaciones imprimibles o descargables de solicitudes, órdenes, salidas, traslados, recepciones, facturas y pagos.', 'Datos aprobados, correlativos, formatos, filtros y selección de salida.', 'Entrega PDF, impresión HTML, Excel o CSV manteniendo número de documento y relación con el origen.'],
      ['Verificación pública de órdenes', 'Permite comprobar una orden sellada sin iniciar sesión y comparar un PDF local con el hash oficial.', 'Token público y archivo PDF seleccionado por el visitante.', 'Muestra datos del sello y calcula SHA-256 en el navegador; el archivo no se carga al servidor.'],
      ['Datos demo e importaciones', 'Carga proyectos, artículos, inventario o proveedores desde datos tabulados y permite limpiar únicamente registros demo.', 'Excel o datos pegados, validaciones previas, lote de importación y usuario administrador.', 'Crea maestros de forma controlada, presenta avance y resumen y conserva separados los datos reales de los demostrativos.'],
      ['Auditoría e integración', 'Registra correlativos, usuarios, fechas, aprobaciones, movimientos, sellos y bitácoras de sincronización.', 'Eventos de documentos, cambios de estado, movimientos de inventario y estructuras SAP.', 'Entrega trazabilidad de extremo a extremo y preparación para SAP Business One; la conexión en línea depende de la configuración del entorno.']
    ]
  }
];

const body = [];
const add = (...parts) => body.push(...parts.flat());

// Portada: patrón editorial_cover + preset standard_business_brief.
add(
  paragraph('BUILDREQ', null, { align: 'right', spaceAfter: 900 }),
  paragraph([run('ARQUITECTURA FUNCIONAL', { bold: true, color: BLUE, size: 22 })], null, { spaceAfter: 100 }),
  paragraph([run('Y RELACIÓN DE MÓDULOS', { bold: true, color: BLUE, size: 22 })], null, { spaceAfter: 260 }),
  paragraph([run('Cómo se organiza la plataforma, cómo fluye la operación y qué cubre cada módulo', { bold: true, color: NAVY, size: 34 })], null, { spaceAfter: 260 }),
  paragraph('Documento ejecutivo-funcional basado en la implementación vigente de BuildReq.', 'Subtitle', { spaceAfter: 520 }),
  table(['EDICIÓN', 'FECHA DE CORTE', 'ENFOQUE'], [[
    '2.0',
    '19 de agosto de 2026',
    'Vista conceptual, ciclo operativo y alcance completo por módulo'
  ]], [1450, 2200, 5350], { band: false, headerFill: PALE_BLUE }),
  paragraph('', null, { spaceAfter: 780 }),
  paragraph([run('Documento de arquitectura funcional', { bold: true, color: GRAY, size: 19 })], null, { align: 'right', spaceAfter: 20 }),
  paragraph('BuildReq · Honduras', null, { align: 'right', spaceAfter: 0 }),
  pageBreak()
);

add(
  h1('Propósito y guía de lectura'),
  paragraph('Este documento explica BuildReq desde una perspectiva funcional y de proceso. No presenta las pantallas como elementos aislados: muestra la estructura general de la plataforma, la forma en que los módulos se entregan información y el alcance de cada dominio.'),
  callout('IDEA CENTRAL', 'BuildReq transforma una necesidad de proyecto en un proceso controlado de abastecimiento. La misma trazabilidad conecta requisición, inventario, compras, logística, facturación, pago y reportes.', PALE_AMBER),
  table(['Sección', 'Pregunta que responde', 'Resultado esperado'], [
    ['1. Vista conceptual', '¿Qué componentes forman la plataforma y cómo se agrupan?', 'Un mapa de los dominios funcionales y de las capacidades transversales.'],
    ['2. Ciclo operativo', '¿Cómo se relacionan los módulos desde la necesidad hasta el cierre?', 'Un flujo de punta a punta con sus rutas de bodega, traslado y compra.'],
    ['3. Alcance por módulo', '¿Qué hace cada módulo, qué recibe y qué produce?', 'Una matriz integral de propósito, entradas, relaciones y salidas.']
  ], [1800, 3350, 3850], { band: true }),
  paragraph('Alcance de la revisión: interfaz web, procedimientos del servidor, reglas de autorización, entidades principales, documentos, reportes e integraciones observadas en el código vigente. La visibilidad real de una función depende del rol, el proyecto, el estado del documento y la configuración administrativa.')
);

add(
  h1('1. Vista conceptual de la plataforma', true),
  paragraph('BuildReq se organiza alrededor de la empresa, sus proyectos y sus usuarios. La requisición y el flujo de abastecimiento forman el núcleo que conecta cinco dominios: demanda, compras, logística, finanzas y gobierno.'),
  imageParagraph('rId6', 'Vista conceptual de BuildReq', 'Mapa de la organización, proyectos, núcleo de requisiciones y dominios funcionales de BuildReq.', 6.3, 3.92, 1),
  caption('Figura 1. Vista conceptual de la plataforma BuildReq.'),
  h2('1.1 Lectura del mapa'),
  h3('Estructura organizacional'),
  paragraph('La empresa se descompone en proyectos y subproyectos. Los usuarios reciben roles, proyectos y almacenes que delimitan qué información pueden consultar y qué acciones pueden ejecutar.'),
  h3('Núcleo transaccional'),
  paragraph('La requisición captura la necesidad. El flujo de abastecimiento toma las cantidades aprobadas y las distribuye entre existencia local, traslado entre bodegas o adquisición a proveedor.'),
  h3('Dominios especializados'),
  paragraph('Compras formaliza compromisos; Logística mueve y recibe materiales; Finanzas valida la obligación y ejecuta el pago; Gobierno mantiene catálogos, configuración, notificaciones y análisis.'),
  h3('Control integrado'),
  paragraph('Cada documento mantiene su relación con el origen. Los movimientos actualizan inventario y Kardex; las decisiones generan historial; los adjuntos conservan evidencia y los reportes reúnen la operación.'),
  h2('1.2 Principios que atraviesan toda la plataforma')
);
[
  'Seguridad por rol y proyecto: el acceso al menú no sustituye la validación del servidor.',
  'Control por línea y cantidad: una necesidad puede atenderse parcialmente mediante rutas diferentes.',
  'Trazabilidad documental: números, estados, relaciones, responsables, fechas, adjuntos y eventos permanecen vinculados.',
  'Separación entre preparación y emisión: borradores y aprobaciones anteceden los movimientos definitivos.',
  'Configuración de aprobaciones: solicitudes, órdenes y tesorería pueden seguir rutas distintas según la política activa.',
  'Orientación fiscal hondureña: CAI, rangos autorizados, impuestos, retenciones y reportes SAR forman parte del modelo.',
  'Preparación para SAP Business One: se manejan códigos y bitácoras; una sincronización en línea depende del entorno.'
].forEach((item) => add(bullet(item)));

add(
  h1('2. Relación entre módulos a lo largo del ciclo operativo', true),
  paragraph('El ciclo comienza con una necesidad y termina cuando la cantidad queda atendida y sus efectos físicos, documentales y financieros han sido registrados. El punto decisivo es la definición del flujo de abastecimiento.'),
  imageParagraph('rId7', 'Ciclo operativo de BuildReq', 'Flujo desde la necesidad y requisición hasta despacho, traslado o compra, con recepción, factura, tesorería y control integrado.', 6.3, 4.06, 2),
  caption('Figura 2. Relación principal entre módulos durante el ciclo operativo.'),
  h2('2.1 Secuencia de punta a punta')
);
[
  'Necesidad. Un usuario de proyecto identifica el material o servicio requerido, su cantidad, prioridad y fecha requerida.',
  'Requisición. La necesidad se documenta por proyecto y líneas; puede permanecer en borrador hasta completar su información.',
  'Revisión. Los responsables aprueban, rechazan o ponen en espera cada línea y traducen la descripción al catálogo oficial cuando aplica.',
  'Definición del flujo. La cantidad aprobada se asigna a existencia local, otra bodega, compra directa, solicitud de compra u orden.',
  'Ejecución logística o comercial. El sistema genera salida, solicitud de traslado, traslado, solicitud de compra u orden, conservando el vínculo con la requisición.',
  'Recepción. Los bienes comprados o trasladados se reciben parcial o totalmente; diferencias y pendientes se mantienen visibles.',
  'Actualización de inventario. Entradas, salidas y traslados afectan existencias y producen movimientos de Kardex.',
  'Factura y control fiscal. La obligación se revisa contra proveedor, orden, recepción, CAI, impuestos, retenciones, anticipos y ajustes.',
  'Tesorería y cierre. Las obligaciones elegibles pasan por lote, aprobación, banco, conciliación y contabilización; los reportes consolidan el resultado.'
].forEach((item) => add(numberItem(item)));

add(
  h2('2.2 Rutas alternativas de atención'),
  table(['Ruta', 'Cuándo se utiliza', 'Módulos conectados', 'Resultado'], [
    ['Existencia local', 'La bodega visible dispone de la cantidad aprobada.', 'Flujo → salida/despacho → inventario → Kardex.', 'Entrega al proyecto y reducción de existencia en origen.'],
    ['Traslado', 'Otra bodega dispone del material requerido.', 'Flujo → solicitud de traslado → traslado/guía → recepción → inventario.', 'Salida de origen, tránsito y entrada controlada en destino.'],
    ['Compra directa', 'La política y el caso permiten crear el compromiso sin una solicitud intermedia.', 'Flujo → orden de compra → recepción → factura → tesorería.', 'Adquisición formal y pago con trazabilidad al origen.'],
    ['Solicitud de compra', 'Se requiere cotización, consolidación o aprobación antes de ordenar.', 'Flujo → solicitud de compra → aprobación → orden → recepción → factura → tesorería.', 'Proceso de compra controlado con saldo parcial y decisiones documentadas.'],
    ['Devolución', 'El material debe regresar, corregirse o generar un efecto comercial inverso.', 'Recepción/inventario → logística inversa → traslado central o nota de crédito.', 'Reversión documentada sin borrar el historial del movimiento original.']
  ], [1450, 2300, 2900, 2350], { band: true }),
  h2('2.3 Controles que gobiernan el avance')
);
[
  'Las cantidades deben ser positivas y no pueden superar el saldo pendiente o la existencia aplicable.',
  'Los estados de cabecera se calculan a partir del progreso real de las líneas: pendiente, parcial, completa, cerrada o anulada.',
  'Cerrar un documento con saldo requiere motivo; anular no elimina la evidencia ni las relaciones históricas.',
  'USD exige tasa de cambio y fecha; HNL funciona como moneda base.',
  'La factura no debe avanzar si faltan datos fiscales indispensables o si los rangos autorizados no son válidos.',
  'Los lotes de pago siguen revisión, aprobación, banco, conciliación y contabilización según la configuración vigente.',
  'La solicitud manual de traslado está deshabilitada en la interfaz actual; normalmente se genera desde el flujo de abastecimiento.'
].forEach((item) => add(bullet(item)));

add(
  h1('3. Alcance de cada módulo', true),
  paragraph('La siguiente matriz utiliza el mismo criterio para todos los módulos: propósito y alcance, información que recibe, y relaciones o salidas que produce. De esta manera puede utilizarse como mapa de alcance, base para pruebas de aceptación o referencia para capacitación.'),
  callout('CÓMO INTERPRETAR LA MATRIZ', 'Una función puede estar disponible en el producto y no aparecer para un usuario concreto. El rol, el proyecto asignado, el almacén visible, el estado del documento y los parámetros administrativos controlan su uso.', PALE_BLUE)
);

for (const [groupIndex, group] of scopeGroups.entries()) {
  add(
    h2(group.title, groupIndex > 0),
    table(
      ['Módulo', 'Propósito y alcance', 'Entradas principales', 'Relaciones y salidas'],
      group.rows,
      [1450, 2750, 2100, 2700],
      { band: true, quiet: true, headerFill: PALE_BLUE }
    )
  );
}

add(
  h2('3.8 Síntesis del alcance'),
  callout('RESULTADO FUNCIONAL', 'BuildReq cubre el ciclo completo desde la solicitud hasta el pago, con rutas de bodega, traslado y compra; además mantiene catálogos, documentos, control fiscal, inventario, seguridad, notificaciones, reportes y auditoría.', PALE_GREEN),
  paragraph('Este esquema no sustituye el manual detallado de operación. Su finalidad es explicar la arquitectura funcional, las dependencias entre módulos y los límites de responsabilidad de cada uno en una sola lectura coherente.'),
  paragraph([run('Fin del documento', { bold: true, color: GRAY, size: 18 })], null, { align: 'center', spaceBefore: 320, spaceAfter: 0 })
);

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="es-HN"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="222222"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="${NAVY}"/><w:sz w:val="60"/><w:szCs w:val="60"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="240" w:line="290" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:color w:val="${GRAY}"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="${BLUE}"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="${BLUE}"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="${DARK_BLUE}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="160" w:line="280" w:lineRule="auto"/><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>
  <w:style w:type="table" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:qFormat/></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:spacing w:after="160" w:line="280" w:lineRule="auto"/><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="–"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:spacing w:after="160" w:line="280" w:lineRule="auto"/><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:spacing w:after="160" w:line="280" w:lineRule="auto"/><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr>${run('BuildReq  |  Arquitectura funcional', { color: GRAY, size: 18 })}</w:p></w:hdr>`;
const firstHeaderXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:hdr>`;
const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="80" w:after="0"/></w:pPr>${run('Página ', { color: GRAY, size: 18 })}<w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:color w:val="${GRAY}"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>${run(' de ', { color: GRAY, size: 18 })}<w:fldSimple w:instr="NUMPAGES"><w:r><w:rPr><w:color w:val="${GRAY}"/><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>${body.join('')}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId3"/>
      <w:headerReference w:type="first" r:id="rId4"/>
      <w:footerReference w:type="default" r:id="rId5"/>
      <w:titlePg/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
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
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/vista-conceptual-buildreq.png"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/ciclo-operativo-buildreq.png"/>
</Relationships>`;

const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:updateFields w:val="true"/></w:settings>`;
const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Arquitectura Funcional y Relación de Módulos BuildReq</dc:title><dc:subject>Vista conceptual, ciclo operativo y alcance por módulo</dc:subject><dc:creator>OpenAI Codex</dc:creator><cp:keywords>BuildReq; arquitectura funcional; módulos; ciclo operativo; abastecimiento</cp:keywords><dc:description>Documento funcional basado en la implementación vigente de BuildReq.</dc:description><cp:lastModifiedBy>OpenAI Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-08-19T12:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-19T12:00:00Z</dcterms:modified></cp:coreProperties>`;
const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><Company>BuildReq</Company><AppVersion>16.0000</AppVersion></Properties>`;

if (!fs.existsSync(CONCEPT_IMAGE) || !fs.existsSync(CYCLE_IMAGE)) {
  throw new Error('Faltan los diagramas PNG. Ejecute primero tools/build_architecture_diagrams.ps1.');
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'buildreq_architecture_'));
function writeText(relativePath, content) {
  const target = path.join(stage, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}
function writeBinary(relativePath, content) {
  const target = path.join(stage, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

writeText('[Content_Types].xml', contentTypes);
writeText('_rels/.rels', packageRels);
writeText('word/document.xml', documentXml);
writeText('word/_rels/document.xml.rels', documentRels);
writeText('word/styles.xml', stylesXml);
writeText('word/numbering.xml', numberingXml);
writeText('word/settings.xml', settingsXml);
writeText('word/header1.xml', headerXml);
writeText('word/header2.xml', firstHeaderXml);
writeText('word/footer1.xml', footerXml);
writeText('docProps/core.xml', coreXml);
writeText('docProps/app.xml', appXml);
writeBinary('word/media/vista-conceptual-buildreq.png', fs.readFileSync(CONCEPT_IMAGE));
writeBinary('word/media/ciclo-operativo-buildreq.png', fs.readFileSync(CYCLE_IMAGE));

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

const moduleCount = scopeGroups.reduce((total, group) => total + group.rows.length, 0);
console.log(JSON.stringify({
  output: OUTPUT_DOCX,
  bytes: fs.statSync(OUTPUT_DOCX).size,
  diagrams: 2,
  moduleCount,
  sections: 3
}, null, 2));
