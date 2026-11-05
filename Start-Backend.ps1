$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$serverPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $serverPython)) {
    throw 'Run python -m venv .venv, then .\.venv\Scripts\python.exe -m pip install -r server\requirements.txt.'
}
& $serverPython server\manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $serverPython server\manage.py seed_guide
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $serverPython server\manage.py init_admin
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $serverPython server\manage.py runserver 127.0.0.1:8000 --noreload
