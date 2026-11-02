param(
  [Parameter(Mandatory = $true)][string]$DocumentPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [int]$FromPage = 1,
  [int]$ToPage = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$resolvedDocument = (Resolve-Path $DocumentPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($resolvedDocument, $false, $true)
  $document.Repaginate()
  $pageCount = $document.ComputeStatistics(2)
  if ($ToPage -le 0 -or $ToPage -gt $pageCount) { $ToPage = $pageCount }
  if ($FromPage -lt 1) { $FromPage = 1 }

  $rendered = 0
  for ($pageNumber = $FromPage; $pageNumber -le $ToPage; $pageNumber++) {
    $word.Selection.GoTo(1, 1, $pageNumber) | Out-Null
    $pageRange = $word.Selection.Bookmarks.Item('\Page').Range
    $target = Join-Path $resolvedOutput ('page-{0:D3}.png' -f $pageNumber)
    $emfTarget = Join-Path $resolvedOutput ('page-{0:D3}.emf' -f $pageNumber)
    $emfBits = $pageRange.EnhMetaFileBits
    if ($null -eq $emfBits -or $emfBits.Length -eq 0) {
      throw "Word no produjo un metarchivo para la página $pageNumber."
    }
    [System.IO.File]::WriteAllBytes($emfTarget, [byte[]]$emfBits)
    $image = [System.Drawing.Image]::FromFile($emfTarget)
    try {
      $bitmap = New-Object System.Drawing.Bitmap($image.Width, $image.Height)
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.Clear([System.Drawing.Color]::White)
          $graphics.DrawImage($image, 0, 0, $image.Width, $image.Height)
        }
        finally {
          $graphics.Dispose()
        }
        $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
      }
      finally {
        $bitmap.Dispose()
      }
    }
    finally {
      $image.Dispose()
    }
    $rendered++
  }
  [pscustomobject]@{ Pages = $pageCount; Rendered = $rendered; Output = $resolvedOutput }
}
finally {
  if ($document -ne $null) { $document.Close(0) }
  if ($word -ne $null) { $word.Quit() }
  if ($document -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($word -ne $null) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
