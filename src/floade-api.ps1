param(
  [string]$Method = 'api.describe',
  [string]$Path,
  [string]$Repo,
  [string]$Owner,
  [int]$Limit,
  [switch]$Replace,
  [string]$PipeName = 'floade-local-data-control'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$floadePipe = $null
$floadeReader = $null
$floadeWriter = $null
try {
  $floadeParams = @{}
  foreach ($floadeKey in @('Path', 'Repo', 'Owner', 'Limit')) {
    $floadeParameterName = $floadeKey.ToLowerInvariant()
    if ($PSBoundParameters.ContainsKey($floadeKey)) { $floadeParams[$floadeParameterName] = $PSBoundParameters[$floadeKey] }
  }
  if ($Replace) { $floadeParams.replace = $true }
  $floadeRequest = @{ method = $Method; params = $floadeParams } | ConvertTo-Json -Compress
  $floadePipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
  try { $floadePipe.Connect(1500) } catch {
    $floadeExe = Join-Path $PSScriptRoot 'Floade.exe'
    if (-not (Test-Path -LiteralPath $floadeExe)) { throw 'Floade is not running. Start Floade and retry.' }
    Start-Process -FilePath $floadeExe -WindowStyle Hidden
    $floadePipe.Connect(8000)
  }
  $floadeEncoding = [System.Text.UTF8Encoding]::new($false)
  $floadeWriter = [System.IO.StreamWriter]::new($floadePipe, $floadeEncoding, 1024, $true)
  $floadeReader = [System.IO.StreamReader]::new($floadePipe, $floadeEncoding, $false, 1024, $true)
  $floadeWriter.AutoFlush = $true
  $floadeWriter.WriteLine($floadeRequest)
  $floadeReadTask = $floadeReader.ReadLineAsync()
  if (-not $floadeReadTask.Wait(80000)) { throw 'Floade API request timed out.' }
  $floadeResponse = $floadeReadTask.Result
  if (-not $floadeResponse) { throw 'Floade closed without an API response. Update Floade to 0.1.10 or later.' }
  $floadeResult = $floadeResponse | ConvertFrom-Json
  Write-Output $floadeResponse
  if (-not $floadeResult.ok) { exit 1 }
} catch {
  Write-Output (@{ ok = $false; error = @{ code = 'CONNECTION_FAILED'; message = $_.Exception.Message } } | ConvertTo-Json -Compress)
  exit 1
} finally {
  if ($floadeWriter) { $floadeWriter.Dispose() }
  if ($floadeReader) { $floadeReader.Dispose() }
  if ($floadePipe) { $floadePipe.Dispose() }
}
