# Conciliación por entorno y casos pendientes

GEO fue regularizado únicamente en Cloud el 30/09/2026 a las 19:51:21 UTC, después del despliegue confirmado por el usuario y de volver a validar los tres TES, deducciones, notas, reservas y calidad. SSH permanece sin regularizar porque contiene solo dos TES. No se copiaron pagos entre bases ni se generó nuevamente el anticipo.

| Concepto actual | Cloud, L | SSH, L |
|---|---:|---:|
| Anticipo solicitado | 1,163,051.75 | 1,163,051.75 |
| TES-2026-000140 | 809,456.56 | 809,456.56 |
| TES-2026-000392 | 223,104.80 | 223,104.80 |
| TES-2026-000501, compensación | 130,490.39 | No existe |
| Total cubierto y contabilizado | 1,163,051.75 | 1,032,561.36 |
| Pendiente de cubrir | 0.00 | 130,490.39 |
| Aplicación directa actual | 0.00 | 1,032,561.36 |
| Aplicación contractual actual | 515,343.12 | 0.00 |
| Pendiente de amortizar | 647,708.63 | 0.00 |
| Neto documental | 1,442,960.73 | 1,442,960.73 |
| Disponible de factura | 1,442,960.73 | 410,399.37 |

Resultado comprobado en Cloud: por pagar de factura L1,442,960.73 (antes L279,908.98); anticipo por entregar L0.00; amortizado L515,343.12; pendiente de amortizar L647,708.63; calidad retenida L103,068.62. La factura, TES, deducciones y adjuntos permanecen intactos. Hay una sola aplicación contractual vinculada y un único evento de auditoría `contractual-geo-897-1953-v1`. Comparación de 16 tablas sin cambios fuera de los registros autorizados. Respaldo y evidencia: `output/contractual-advances/geo-cloud-20260930T195054Z/`.

## Otras facturas para revisión individual

La revisión del 30/09/2026 identificó seis casos adicionales en Cloud, cinco también en SSH. El casoICA 621 fue regularizado el 22/10/2026; los demás conservan su revisión individual pendiente de esta entrega. La presencia de amortización sin vínculo es una señal de conciliación, no prueba suficiente para recalcular un saldo. Deben revisarse su contrato, cobertura, pagos, reservas, notas y liberaciones antes de proponer ajustes.

| Factura | Proveedor | Orden | Amortización documental, L | Aplicación actual Cloud, L | Entornos detectados |
|---|---|---|---:|---:|---|
| FT-007-00000001 | JOSUE FERNANDO OSORIO ORTIZ | CD-007-00000001 | 55,734.70 | 0.00 | Cloud y SSH |
| FT-018-00000169 | ZAVALA ELVIR NOEL | CD-018-00000196 | 10,000.00 | 0.00 | Cloud y SSH |
| FT-018-00000183 | AC/DC INGENERIA INTEGRAL S DE RL DE CV | OC-018-00000226 | 71,705.15 | 0.00 | Cloud y SSH |
| FT-017-00000445 | INGENIEROS CIVILES ASOCIADOS INVERSIONES SA DE CV | CD-017-00000406 | 530,519.21 | 0.00 | Cloud y SSH |
| FT-010-00000235 | GEO STRUCTURES SA DE CV | CD-010-00000271 | 103,332.97 | 0.00 | Cloud y SSH |
| FT-017-00000621 | INGENIEROS CIVILES ASOCIADOS INVERSIONES SA DE CV | OC-017-00000233 | 549,468.03 | 0.00 directa; 549,468.03 contractual | Cloud: regularizada 22/10/2026 |

FT-017-00000621 ya tiene control contractual enlazado, aplicación L549,468.03 y saldo de factura L3,113,652.15; conserva el anticipo pagado L753,987.00 con L204,518.97 pendientes de amortizar. Auditoría única 20; evidencia y recuperación en [correccion-anticipo-ica.md](correccion-anticipo-ica.md). Los demás registros requieren identificar el anticipo o explicar documentalmente su tratamiento. FT-010-00000235 conserva un neto histórico de L0.0025: no se redondeó ni reescribió.

Fuentes: consultas de solo lectura del sistema del 30/09/2026. Los JSON conservan la precisión original. No se utilizó el PDF del cliente para sustituir importes de la base.
