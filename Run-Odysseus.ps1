# Run-Odysseus.ps1 — launch the cloned Odysseus in the VM with a KNOWN admin login.
# Run in the same VM after Verify-FreshInstall.ps1 has cloned + installed it.
$ErrorActionPreference = 'Continue'
$Repo = 'C:\ody-verify\odysseus'
$vpy  = Join-Path $Repo 'venv\Scripts\python.exe'
$User = 'admin'
$Pass = 'OdysseyVerify-2026'

if (-not (Test-Path $vpy)) {
  Write-Host "Repo/venv not found at $Repo — run Verify-FreshInstall.ps1 first." -ForegroundColor Red
  return
}
Set-Location $Repo
$env:HF_HUB_DISABLE_SYMLINKS = '1'
$env:ODYSSEUS_ADMIN_USER     = $User
$env:ODYSSEUS_ADMIN_PASSWORD = $Pass

# Fresh state so the known admin password takes (setup skips if auth.json exists).
Write-Host "Resetting to a known admin login..." -ForegroundColor Yellow
Remove-Item (Join-Path $Repo 'data') -Recurse -Force -ErrorAction SilentlyContinue
& $vpy setup.py 2>&1 | Select-String -Pattern 'admin|password|\[ok\]|\[warn\]' | ForEach-Object { $_.Line }

Write-Host ""
Write-Host "================ LOGIN ================" -ForegroundColor Cyan
Write-Host "  URL:      http://127.0.0.1:7000"      -ForegroundColor Green
Write-Host "  Username: $User"                      -ForegroundColor Green
Write-Host "  Password: $Pass"                      -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Note: to actually CHAT you'll need an LLM endpoint (Settings -> add an API"
Write-Host "key, or a local model). Login + UI + navigation work without one." -ForegroundColor DarkGray
Write-Host ""

Start-Process "http://127.0.0.1:7000"
Write-Host "Starting server — leave this window open; Ctrl+C to stop." -ForegroundColor Yellow
& $vpy -m uvicorn app:app --host 127.0.0.1 --port 7000
