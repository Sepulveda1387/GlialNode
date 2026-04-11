$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$dbPath = Join-Path $root ".glialnode\\demo.sqlite"
$exportPath = Join-Path $root ".glialnode\\demo-export.json"

if (Test-Path $dbPath) {
  Remove-Item $dbPath -Force
}

if (Test-Path $exportPath) {
  Remove-Item $exportPath -Force
}

Write-Host "== Building GlialNode =="
npm.cmd run build | Out-Null

Write-Host "== Creating Space =="
$spaceOutput = node dist/cli/index.js space create --name "Demo Space" --db $dbPath
$spaceId = (($spaceOutput | Select-String '^id=').Line -replace '^id=','')
$spaceOutput

Write-Host "== Configuring Policy =="
node dist/cli/index.js space configure --id $spaceId --retention-short-days 0 --db $dbPath

Write-Host "== Adding Scope =="
$scopeOutput = node dist/cli/index.js scope add --space-id $spaceId --type agent --label planner --db $dbPath
$scopeId = (($scopeOutput | Select-String '^id=').Line -replace '^id=','')
$scopeOutput

Write-Host "== Writing Records =="
node dist/cli/index.js memory add --space-id $spaceId --scope-id $scopeId --scope-type agent --tier short --kind task --content "Promote this note." --summary "Promote me" --importance 0.95 --confidence 0.9 --freshness 0.8 --db $dbPath
node dist/cli/index.js memory add --space-id $spaceId --scope-id $scopeId --scope-type agent --tier short --kind task --content "Expire this note." --summary "Expire me" --db $dbPath

Write-Host "== Running Maintenance =="
node dist/cli/index.js space maintain --id $spaceId --apply --db $dbPath

Write-Host "== Reporting =="
node dist/cli/index.js space report --id $spaceId --db $dbPath

Write-Host "== Exporting =="
node dist/cli/index.js export --space-id $spaceId --output $exportPath --db $dbPath

Write-Host ""
Write-Host "Demo completed."
Write-Host "Database: $dbPath"
Write-Host "Export:   $exportPath"
