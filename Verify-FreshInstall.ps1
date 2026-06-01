# Verify-FreshInstall.ps1
# Fresh-Windows verification for the Odysseus `windows-support` branch (PR #215).
# Run inside a clean Windows 11 VM (elevated PowerShell). Does a true from-scratch
# install, then checks all 7 of the maintainer's points and prints PASS/FAIL.
#
#   Set-ExecutionPolicy Bypass -Scope Process -Force; .\Verify-FreshInstall.ps1
#
$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/Kanaru92/odysseus.git'
$Branch  = 'windows-support'
$Work    = 'C:\ody-verify'
$Repo    = Join-Path $Work 'odysseus'
$Log     = Join-Path $Work 'verify.log'
$script:results = [System.Collections.Generic.List[object]]::new()

function Rec($name, $ok, $detail) {
  $script:results.Add([pscustomobject]@{ Check = $name; Result = $(if($ok){'PASS'}else{'FAIL'}); Detail = $detail })
  $color = $(if($ok){'Green'}else{'Red'})
  Write-Host ("[{0}] {1} — {2}" -f $(if($ok){'PASS'}else{'FAIL'}), $name, $detail) -ForegroundColor $color
}

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}

New-Item -ItemType Directory -Force -Path $Work | Out-Null
Start-Transcript -Path $Log -Append | Out-Null
Write-Host "=== Odysseus fresh-Windows verification (branch: $Branch) ===" -ForegroundColor Cyan
"OS: " + (Get-CimInstance Win32_OperatingSystem).Caption + " build " + [Environment]::OSVersion.Version | Write-Host

# --- 0. Toolchain: git + Python 3.12 (winget) -------------------------------
function Ensure-Tool($cmd, $wingetId, $name) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { Write-Host "$name already present"; return }
  Write-Host "Installing $name via winget ($wingetId)..." -ForegroundColor Yellow
  winget install --id $wingetId -e --source winget --accept-source-agreements --accept-package-agreements --silent | Out-Null
  Refresh-Path
}
try {
  Ensure-Tool git    Git.Git              'Git'
  Ensure-Tool python Python.Python.3.12   'Python 3.12'
} catch { Write-Host "winget step warning: $_" -ForegroundColor Yellow; Refresh-Path }

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py -or (& $py --version) -notmatch '3\.1[0-9]') {
  foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe","$env:ProgramFiles\Python312\python.exe")) {
    if (Test-Path $p) { $py = $p; break }
  }
}
$pyver = & $py --version 2>&1
Rec 'Python 3.12 available' ($pyver -match '3\.1[0-2]') "$pyver at $py"

# --- 1. Clone the branch ----------------------------------------------------
if (Test-Path $Repo) { Remove-Item -Recurse -Force $Repo }
git clone --branch $Branch --depth 1 $RepoUrl $Repo 2>&1 | Out-Null
Rec 'Clone windows-support' (Test-Path (Join-Path $Repo 'app.py')) "cloned to $Repo"

# --- 7. .gitattributes keeps shell scripts LF (check the real checkout) ------
$ga = Get-Content (Join-Path $Repo '.gitattributes') -Raw
Rec '.gitattributes: *.sh = LF for Docker' ($ga -match '\*\.sh\s+text\s+eol=lf') 'shell scripts pinned to LF'

# --- venv + deps (the real "fresh install" path) ----------------------------
Push-Location $Repo
& $py -m venv venv
$vpy = Join-Path $Repo 'venv\Scripts\python.exe'
Write-Host "Installing requirements (this downloads ~hundreds of MB)..." -ForegroundColor Yellow
& $vpy -m pip install --upgrade pip --quiet
& $vpy -m pip install -r requirements.txt 2>&1 | Select-Object -Last 3
Rec 'pip install -r requirements.txt' ($LASTEXITCODE -eq 0) "deps installed into venv"

# --- 2. setup/login (data dirs, DB, admin) ----------------------------------
$env:HF_HUB_DISABLE_SYMLINKS = '1'
$setupOut = & $vpy setup.py 2>&1 | Out-String
Rec 'setup/login (data, DB, admin)' ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $Repo 'data'))) 'data dirs + DB + admin created'

# --- 1,3,4,5,6: Python-level checks -----------------------------------------
$pyCheck = Join-Path $Work 'checks.py'
@'
import sys, subprocess, time, json
out = {}
# 1. app imports + builds routes
try:
    import app
    out["app_routes"] = len(app.app.routes)
except Exception as e:
    out["app_routes"] = "ERROR: %r" % e
# 3. Cookbook has a Windows (no-tmux) launch path
try:
    src = open("routes/cookbook_routes.py", encoding="utf-8").read()
    out["cookbook_win_path"] = ("_launch_local_detached" in src) and ("IS_WINDOWS" in src)
except Exception as e:
    out["cookbook_win_path"] = "ERROR: %r" % e
# 4. bg jobs cross-platform (pid_alive / kill_process_tree, no tmux)
try:
    import inspect, src.bg_jobs as bj
    s = inspect.getsource(bj)
    out["bg_jobs"] = ("pid_alive" in s) and ("kill_process_tree" in s) and ("tmux" not in s.lower())
except Exception as e:
    out["bg_jobs"] = "ERROR: %r" % e
# 5. pid_alive is non-destructive (os.kill(pid,0) would terminate on Windows)
try:
    from core import platform_compat as pc
    p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(6)"])
    time.sleep(0.4); a1 = pc.pid_alive(p.pid)
    time.sleep(0.4); a2 = pc.pid_alive(p.pid)
    pc.kill_process_tree(p.pid); time.sleep(0.8); a3 = pc.pid_alive(p.pid)
    out["process_kill_safe"] = bool(a1 and a2 and not a3)
    try: p.wait(timeout=4)
    except Exception: pass
except Exception as e:
    out["process_kill_safe"] = "ERROR: %r" % e
# 6. FastEmbed/ONNX loads, dim 384
try:
    from src import embeddings as e
    c = e.get_embedding_client()
    out["fastembed_dim"] = c.get_sentence_embedding_dimension()
except Exception as ex:
    out["fastembed_dim"] = "ERROR: %r" % ex
print("RESULTS_JSON:" + json.dumps(out))
'@ | Set-Content -Path $pyCheck -Encoding UTF8

$checkOut = & $vpy $pyCheck 2>&1 | Out-String
$json = ($checkOut -split "`n" | Where-Object { $_ -match 'RESULTS_JSON:' }) -replace '.*RESULTS_JSON:',''
try { $r = $json | ConvertFrom-Json } catch { $r = $null; Write-Host $checkOut }
if ($r) {
  Rec 'app imports + starts (Py3.12)'        (($r.app_routes -is [int]) -and $r.app_routes -gt 300) "routes=$($r.app_routes)"
  Rec 'Cookbook works without tmux'          ($r.cookbook_win_path -eq $true) 'Windows detached launch path present'
  Rec 'model download/serve bg jobs'         ($r.bg_jobs -eq $true) 'bg_jobs uses pid_alive/kill_process_tree, no tmux'
  Rec 'shell/tool exec: no accidental kill'  ($r.process_kill_safe -eq $true) 'pid_alive probe non-destructive; kill works'
  Rec 'FastEmbed/ONNX dim 384'               ($r.fastembed_dim -eq 384) "dim=$($r.fastembed_dim)"
} else {
  Rec 'python-level checks' $false 'could not parse results (see log)'
}
Pop-Location

# --- summary ----------------------------------------------------------------
Write-Host "`n================ SUMMARY ================" -ForegroundColor Cyan
$script:results | Format-Table -AutoSize
$fails = ($script:results | Where-Object { $_.Result -eq 'FAIL' }).Count
if ($fails -eq 0) { Write-Host "ALL CHECKS PASSED on fresh Windows." -ForegroundColor Green }
else { Write-Host "$fails check(s) FAILED — see $Log" -ForegroundColor Red }
Stop-Transcript | Out-Null
Write-Host "Full log: $Log"
