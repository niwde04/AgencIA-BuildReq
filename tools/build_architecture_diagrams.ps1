param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

function New-Canvas([int]$Width, [int]$Height) {
  $bitmap = [System.Drawing.Bitmap]::new($Width, $Height)
  $bitmap.SetResolution(144, 144)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $graphics.Clear([System.Drawing.Color]::White)
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function New-RoundedPath([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-Box {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [string]$Text,
    [string]$Fill = 'F8FAFC',
    [string]$Border = '9DB7D5',
    [float]$FontSize = 23,
    [bool]$Bold = $true,
    [float]$Radius = 16
  )
  $fillColor = [System.Drawing.ColorTranslator]::FromHtml("#$Fill")
  $borderColor = [System.Drawing.ColorTranslator]::FromHtml("#$Border")
  $textColor = [System.Drawing.ColorTranslator]::FromHtml('#17365D')
  $path = New-RoundedPath $X $Y $Width $Height $Radius
  $brush = [System.Drawing.SolidBrush]::new($fillColor)
  $pen = [System.Drawing.Pen]::new($borderColor, 3)
  $Graphics.FillPath($brush, $path)
  $Graphics.DrawPath($pen, $path)
  $fontStyle = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = [System.Drawing.Font]::new('Segoe UI', $FontSize, $fontStyle, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
  $rect = [System.Drawing.RectangleF]::new($X + 12, $Y + 8, $Width - 24, $Height - 16)
  $textBrush = [System.Drawing.SolidBrush]::new($textColor)
  $Graphics.DrawString($Text, $font, $textBrush, $rect, $format)
  $textBrush.Dispose(); $format.Dispose(); $font.Dispose(); $pen.Dispose(); $brush.Dispose(); $path.Dispose()
}

function Draw-Label {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [string]$Text,
    [float]$FontSize = 20,
    [string]$Color = '5B6573',
    [bool]$Bold = $false
  )
  $fontStyle = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = [System.Drawing.Font]::new('Segoe UI', $FontSize, $fontStyle, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#$Color"))
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $Graphics.DrawString($Text, $font, $brush, [System.Drawing.RectangleF]::new($X, $Y, $Width, $Height), $format)
  $format.Dispose(); $brush.Dispose(); $font.Dispose()
}

function Draw-Arrow {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X1,
    [float]$Y1,
    [float]$X2,
    [float]$Y2,
    [string]$Color = '607D9C',
    [float]$Width = 4
  )
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#$Color"), $Width)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.CustomEndCap = [System.Drawing.Drawing2D.AdjustableArrowCap]::new(6, 7, $true)
  $Graphics.DrawLine($pen, $X1, $Y1, $X2, $Y2)
  $pen.CustomEndCap.Dispose(); $pen.Dispose()
}

function Draw-Line {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X1,
    [float]$Y1,
    [float]$X2,
    [float]$Y2,
    [string]$Color = 'B4C6D7',
    [float]$Width = 3
  )
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#$Color"), $Width)
  $Graphics.DrawLine($pen, $X1, $Y1, $X2, $Y2)
  $pen.Dispose()
}

function Save-Canvas($Canvas, [string]$Path) {
  $Canvas.Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $Canvas.Graphics.Dispose()
  $Canvas.Bitmap.Dispose()
}

# Diagrama 1: vista conceptual.
$canvas = New-Canvas 1800 1120
$g = $canvas.Graphics
Draw-Label $g 80 25 1640 55 'VISTA CONCEPTUAL DE BUILDREQ' 29 '17365D' $true
Draw-Box $g 650 95 500 92 'Organización / Empresa' 'FFF2CC' 'D6B656' 25 $true
Draw-Arrow $g 900 187 900 235
Draw-Box $g 610 240 580 105 'Proyectos, subproyectos, usuarios y roles' 'E8EEF5' '5B9BD5' 24 $true
Draw-Arrow $g 900 345 900 405
Draw-Box $g 545 410 710 115 'Requisiciones y flujos de abastecimiento' 'DDEBF7' '2E74B5' 27 $true

$domainXs = @(45, 395, 745, 1095, 1445)
$domainTitles = @('DEMANDA','COMPRAS','LOGÍSTICA','FINANZAS','GOBIERNO')
$domainFills = @('EAF3F8','FFF2CC','E2F0D9','FCE4D6','EDE7F6')
$domainBorders = @('5B9BD5','D6B656','70AD47','C65911','8064A2')
$domainItems = @(
  "Aprobaciones`nTraducción SAP`nAsignación de flujo",
  "Solicitudes de compra`nÓrdenes y contratos`nAnticipos",
  "Bodegas e inventario`nSalidas y traslados`nRecepciones y devoluciones",
  "Facturas e impuestos`nRetenciones`nTesorería y pagos",
  "Catálogos y proveedores`nConfiguración`nNotificaciones y reportes"
)

for ($i = 0; $i -lt $domainXs.Count; $i++) {
  $x = $domainXs[$i]
  Draw-Line $g 900 525 ($x + 145) 595 '9DB7D5' 3
  Draw-Box $g $x 595 290 64 $domainTitles[$i] $domainFills[$i] $domainBorders[$i] 21 $true 12
  Draw-Box $g $x 680 290 245 $domainItems[$i] 'FFFFFF' $domainBorders[$i] 20 $false 12
  Draw-Arrow $g ($x + 145) 659 ($x + 145) 680 $domainBorders[$i] 3
}

Draw-Box $g 365 985 1070 82 'Control integrado: trazabilidad documental, Kardex, auditoría, adjuntos y seguridad por rol/proyecto' 'F2F4F7' '7F8C9A' 22 $true
for ($i = 0; $i -lt $domainXs.Count; $i++) {
  Draw-Arrow $g ($domainXs[$i] + 145) 925 900 985 'A7B2BE' 3
}
Save-Canvas $canvas (Join-Path $resolvedOutput 'vista-conceptual-buildreq.png')

# Diagrama 2: ciclo operativo.
$canvas = New-Canvas 1800 1160
$g = $canvas.Graphics
Draw-Label $g 60 20 1680 55 'RELACIÓN ENTRE MÓDULOS A LO LARGO DEL CICLO OPERATIVO' 28 '17365D' $true

$topY = 115
$topXs = @(35, 330, 625, 920)
$topLabels = @('Necesidad del proyecto','Requisición','Revisión, aprobación y traducción SAP','Definición del flujo')
$topWidths = @(245, 235, 255, 245)
for ($i = 0; $i -lt 4; $i++) {
  Draw-Box $g $topXs[$i] $topY $topWidths[$i] 100 $topLabels[$i] 'E8EEF5' '5B9BD5' 20 $true
  if ($i -lt 3) { Draw-Arrow $g ($topXs[$i] + $topWidths[$i]) ($topY + 50) $topXs[$i + 1] ($topY + 50) }
}

Draw-Arrow $g 1042 215 1042 285
Draw-Box $g 885 290 315 115 '¿Cómo se atenderá la cantidad aprobada?' 'FFF2CC' 'D6B656' 22 $true 28

$branchY = 475
$branchXs = @(80, 595, 1110)
$branchTitles = @('EXISTENCIA LOCAL','OTRA BODEGA','COMPRA A PROVEEDOR')
$branchColors = @('E2F0D9','DDEBF7','FFF2CC')
$branchBorders = @('70AD47','5B9BD5','D6B656')
$branchSteps = @(
  @('Despacho / salida','Movimiento de inventario','Kardex y entrega'),
  @('Solicitud de traslado','Traslado y guía','Recepción en destino'),
  @('Solicitud de compra','Orden / contrato','Recepción de bienes')
)
for ($b = 0; $b -lt 3; $b++) {
  $x = $branchXs[$b]
  Draw-Line $g 1042 405 ($x + 245) 445 '9DB7D5' 3
  Draw-Box $g $x $branchY 490 62 $branchTitles[$b] $branchColors[$b] $branchBorders[$b] 20 $true 12
  $y = 565
  foreach ($step in $branchSteps[$b]) {
    Draw-Box $g ($x + 45) $y 400 68 $step 'FFFFFF' $branchBorders[$b] 19 $false 10
    if ($y -gt 565) { Draw-Arrow $g ($x + 245) ($y - 28) ($x + 245) $y $branchBorders[$b] 3 }
    $y += 96
  }
}

Draw-Arrow $g 1325 825 1325 880 'C65911' 3
Draw-Box $g 1125 885 400 68 'Factura y revisión contable' 'FCE4D6' 'C65911' 19 $false 10
Draw-Arrow $g 1325 953 1325 985 'C65911' 3
Draw-Box $g 1125 990 400 68 'Tesorería, banco y contabilización' 'FCE4D6' 'C65911' 18 $false 10

Draw-Box $g 385 1065 1030 72 'Control integrado y reportes: progreso, pendientes, costos, inventario, pagos y auditoría' 'F2F4F7' '7F8C9A' 20 $true
Draw-Arrow $g 325 825 620 1065 '70AD47' 3
Draw-Arrow $g 840 825 840 1065 '5B9BD5' 3
Draw-Arrow $g 1325 1058 1325 1065 'C65911' 3
Save-Canvas $canvas (Join-Path $resolvedOutput 'ciclo-operativo-buildreq.png')

Get-ChildItem -LiteralPath $resolvedOutput -Filter '*.png' | Select-Object FullName, Length
