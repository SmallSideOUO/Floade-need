$ErrorActionPreference = 'Stop'
$mapRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$mapElectron = Join-Path $mapRepo 'node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $mapElectron)) {
  $mapElectron = Join-Path $mapRepo 'node_modules\electron-runtime\dist\electron.exe'
}
if (!(Test-Path -LiteralPath $mapElectron)) { throw '請先在 need 專案執行 npm ci。' }
Start-Process -FilePath $mapElectron -ArgumentList ('"' + (Join-Path $PSScriptRoot 'main.cjs') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Normal
