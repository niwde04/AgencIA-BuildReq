import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await mysql.createConnection(DATABASE_URL);

// SAP Catalog items from the Excel file
const sapItems = [
  { itemCode: "MAT-CEM-001", description: "Cemento Portland Tipo I (42.5 kg)", itemGroup: "Materiales de Construcción" },
  { itemCode: "MAT-CEM-002", description: "Cemento Portland Tipo II", itemGroup: "Materiales de Construcción" },
  { itemCode: "MAT-ACE-001", description: "Acero de Refuerzo #3 (3/8\")", itemGroup: "Acero y Metales" },
  { itemCode: "MAT-ACE-002", description: "Acero de Refuerzo #4 (1/2\")", itemGroup: "Acero y Metales" },
  { itemCode: "MAT-ACE-003", description: "Acero de Refuerzo #5 (5/8\")", itemGroup: "Acero y Metales" },
  { itemCode: "MAT-AGR-001", description: "Arena de Río Lavada", itemGroup: "Agregados" },
  { itemCode: "MAT-AGR-002", description: "Piedra Triturada 3/4\"", itemGroup: "Agregados" },
  { itemCode: "MAT-AGR-003", description: "Grava para Concreto", itemGroup: "Agregados" },
  { itemCode: "MAT-BLQ-001", description: "Bloque de Concreto 6\" (15x20x40 cm)", itemGroup: "Bloques y Ladrillos" },
  { itemCode: "MAT-BLQ-002", description: "Bloque de Concreto 8\" (20x20x40 cm)", itemGroup: "Bloques y Ladrillos" },
  { itemCode: "MAT-MAD-001", description: "Madera de Pino 2x4x8 pies", itemGroup: "Madera" },
  { itemCode: "MAT-MAD-002", description: "Plywood Fenólico 4x8 pies (18mm)", itemGroup: "Madera" },
  { itemCode: "MAT-TUB-001", description: "Tubería PVC 4\" SDR-41", itemGroup: "Plomería" },
  { itemCode: "MAT-TUB-002", description: "Tubería PVC 2\" SDR-26", itemGroup: "Plomería" },
  { itemCode: "MAT-ELE-001", description: "Cable THHN #12 AWG (Rojo)", itemGroup: "Eléctrico" },
  { itemCode: "MAT-ELE-002", description: "Cable THHN #10 AWG (Negro)", itemGroup: "Eléctrico" },
  { itemCode: "MAT-PIN-001", description: "Pintura Latex Interior (Galón)", itemGroup: "Acabados" },
  { itemCode: "MAT-PIN-002", description: "Pintura Anticorrosiva (Galón)", itemGroup: "Acabados" },
  { itemCode: "MAT-IMP-001", description: "Impermeabilizante Asfáltico (5 Gal)", itemGroup: "Impermeabilización" },
  { itemCode: "MAT-CLA-001", description: "Clavos de Acero 2.5\" (Libra)", itemGroup: "Ferretería" },
  { itemCode: "MAT-ALA-001", description: "Alambre de Amarre #18 (Rollo)", itemGroup: "Ferretería" },
  { itemCode: "MAT-CON-001", description: "Concreto Premezclado 3000 PSI (m³)", itemGroup: "Concreto" },
];

// Suppliers from the Excel file
const suppliers = [
  { supplierCode: "PROV-001", name: "Cementos del Norte S.A." },
  { supplierCode: "PROV-002", name: "Aceros Industriales Centroamericanos" },
  { supplierCode: "PROV-003", name: "Agregados y Materiales del Pacífico" },
  { supplierCode: "PROV-004", name: "Bloques y Prefabricados S.A." },
  { supplierCode: "PROV-005", name: "Maderas Tropicales de Honduras" },
  { supplierCode: "PROV-006", name: "Distribuidora de Plomería Nacional" },
  { supplierCode: "PROV-007", name: "Electro Materiales S.A. de C.V." },
  { supplierCode: "PROV-008", name: "Pinturas y Acabados Centroamericanos" },
  { supplierCode: "PROV-009", name: "Impermeabilizantes del Istmo" },
  { supplierCode: "PROV-010", name: "Ferretería Industrial El Constructor" },
  { supplierCode: "PROV-011", name: "Concretos Premezclados del Sur" },
  { supplierCode: "PROV-012", name: "Hierro y Acero de Centroamérica" },
  { supplierCode: "PROV-013", name: "Materiales de Construcción La Ceiba" },
  { supplierCode: "PROV-014", name: "Distribuidora Eléctrica del Valle" },
  { supplierCode: "PROV-015", name: "Tubos y Conexiones del Caribe" },
  { supplierCode: "PROV-016", name: "Maderas y Derivados del Atlántico" },
  { supplierCode: "PROV-017", name: "Químicos y Aditivos para Construcción" },
  { supplierCode: "PROV-018", name: "Ferretería y Herramientas El Profesional" },
  { supplierCode: "PROV-019", name: "Suministros Generales de Construcción" },
  { supplierCode: "PROV-020", name: "Importadora de Materiales Técnicos" },
];

// Insert SAP Catalog items
for (const item of sapItems) {
  try {
    await conn.execute(
      "INSERT INTO sapCatalog (itemCode, description, itemGroup, isActive) VALUES (?, ?, ?, true) ON DUPLICATE KEY UPDATE description = VALUES(description), itemGroup = VALUES(itemGroup)",
      [item.itemCode, item.description, item.itemGroup]
    );
    console.log(`✓ SAP Item: ${item.itemCode} - ${item.description}`);
  } catch (e) {
    console.error(`✗ SAP Item ${item.itemCode}:`, e.message);
  }
}

// Insert Suppliers
for (const sup of suppliers) {
  try {
    await conn.execute(
      "INSERT INTO suppliers (supplierCode, name, isActive) VALUES (?, ?, true) ON DUPLICATE KEY UPDATE name = VALUES(name)",
      [sup.supplierCode, sup.name]
    );
    console.log(`✓ Supplier: ${sup.supplierCode} - ${sup.name}`);
  } catch (e) {
    console.error(`✗ Supplier ${sup.supplierCode}:`, e.message);
  }
}

// Also insert into inventoryItems for stock tracking
for (const item of sapItems) {
  try {
    await conn.execute(
      `INSERT INTO inventoryItems (sapItemCode, name, description, unit, category, currentStock, minimumStock, isActive) 
       VALUES (?, ?, ?, ?, ?, ?, ?, true) 
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), category = VALUES(category)`,
      [
        item.itemCode,
        item.description,
        item.description,
        item.itemGroup === "Agregados" ? "m³" :
        item.itemGroup === "Concreto" ? "m³" :
        item.itemGroup === "Acero y Metales" ? "quintal" :
        item.itemGroup === "Eléctrico" ? "rollo" :
        item.itemGroup === "Acabados" || item.itemGroup === "Impermeabilización" ? "galón" :
        item.itemGroup === "Ferretería" ? "libra" :
        "unidad",
        item.itemGroup,
        Math.floor(Math.random() * 200) + 10, // Random stock for demo
        10, // Minimum stock
      ]
    );
  } catch (e) {
    console.error(`✗ Inventory ${item.itemCode}:`, e.message);
  }
}

console.log("\n✓ Seed completed successfully!");
await conn.end();
