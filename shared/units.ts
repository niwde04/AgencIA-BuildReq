export type UnitOption = {
  value: string;
  label: string;
};

/** Standard construction industry units of measure */
export const UNITS: UnitOption[] = [
  { value: "und", label: "Unidades (und)" },
  { value: "m", label: "Metros (m)" },
  { value: "ft", label: "Pies (ft)" },
  { value: "m2", label: "Metros cuadrados (m²)" },
  { value: "m3", label: "Metros cúbicos (m³)" },
  { value: "ml", label: "Metros lineales (ml)" },
  { value: "kg", label: "Kilogramos (kg)" },
  { value: "ton", label: "Toneladas (ton)" },
  { value: "lb", label: "Libras (lb)" },
  { value: "gal", label: "Galones (gal)" },
  { value: "lt", label: "Litros (lt)" },
  { value: "saco", label: "Sacos" },
  { value: "bolsa", label: "Bolsas" },
  { value: "rollo", label: "Rollos" },
  { value: "lamina", label: "Láminas" },
  { value: "varilla", label: "Varillas" },
  { value: "tubo", label: "Tubos" },
  { value: "pieza", label: "Piezas" },
  { value: "par", label: "Pares" },
  { value: "caja", label: "Cajas" },
  { value: "cubeta", label: "Cubetas" },
  { value: "juego", label: "Juegos" },
  { value: "kit", label: "Kits" },
  { value: "paquete", label: "Paquetes" },
  { value: "resma", label: "Resmas" },
  { value: "cuarto", label: "Cuartos" },
  { value: "barril", label: "Barriles" },
  { value: "yarda", label: "Yardas" },
  { value: "quintal", label: "Quintales (qq)" },
  { value: "pie2", label: "Pies cuadrados (ft²)" },
  { value: "plg", label: "Pulgadas (plg)" },
  { value: "viaje", label: "Viajes" },
  { value: "global", label: "Global" },
];

const UNIT_ALIASES: Record<string, string> = {
  unidad: "und",
  unidades: "und",
  galon: "gal",
  galón: "gal",
  galones: "gal",
  libra: "lb",
  libras: "lb",
  litro: "lt",
  litros: "lt",
  metro: "m",
  metros: "m",
  pie: "ft",
  pies: "ft",
  kilogramo: "kg",
  kilogramos: "kg",
  tonelada: "ton",
  toneladas: "ton",
};

export function normalizeUnitValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("es-HN");
  if (!normalized) return null;
  return UNIT_ALIASES[normalized] ?? normalized;
}
