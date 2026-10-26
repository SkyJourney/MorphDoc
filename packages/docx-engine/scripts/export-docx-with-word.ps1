param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
if (-not [System.IO.Directory]::Exists($outputDirectory)) {
  [System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
}
if ([System.IO.File]::Exists($resolvedOutput)) {
  throw "Word PDF 输出已存在：$resolvedOutput"
}

$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $word.Options.SaveNormalPrompt = $false
  $document = $word.Documents.OpenNoRepairDialog(
    $resolvedInput,
    $false,
    $true,
    $false,
    '',
    '',
    $false,
    '',
    '',
    0,
    0,
    $false,
    $false,
    0,
    $true
  )
  $pageCount = $document.ComputeStatistics(2)
  $document.ExportAsFixedFormat($resolvedOutput, 17)
  [pscustomobject]@{
    input = $resolvedInput
    output = $resolvedOutput
    pages = $pageCount
    bytes = (Get-Item -LiteralPath $resolvedOutput).Length
  } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $document) {
    $document.Close($false)
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject(
      $document
    ) | Out-Null
  }
  if ($null -ne $word) {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject(
      $word
    ) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
