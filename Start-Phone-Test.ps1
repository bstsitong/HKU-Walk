param(
    [string]$LanAddress = '',
    [ValidateRange(1024,65535)][int]$BackendPort = 8000,
    [ValidateRange(1024,65535)][int]$ExpoPort = 8081,
    [string]$ApiUrl = '',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$serverPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $serverPython)) { throw 'Install the Python dependencies first. See README.md.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\expo\bin\cli'))) { throw 'Run npm ci first.' }
$installedAndroidSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (-not $env:ANDROID_HOME -and (Test-Path -LiteralPath $installedAndroidSdk)) { $env:ANDROID_HOME = $installedAndroidSdk }
if ($env:ANDROID_HOME) {
    $env:PATH = (Join-Path $env:ANDROID_HOME 'emulator') + ';' + (Join-Path $env:ANDROID_HOME 'platform-tools') + ';' + $env:PATH
}

$candidates = @()
foreach ($adapter in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($adapter.OperationalStatus -ne 'Up' -or $adapter.NetworkInterfaceType -eq 'Loopback') { continue }
    $properties = $adapter.GetIPProperties()
    if (-not @($properties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' }).Count) { continue }
    foreach ($address in $properties.UnicastAddresses) {
        $text = $address.Address.ToString()
        if ($address.Address.AddressFamily -eq 'InterNetwork' -and $text -notmatch '^169\.254\.') {
            $candidates += [pscustomobject]@{ Name = $adapter.Name; Address = $text }
        }
    }
}
if (-not $LanAddress) {
    if ($candidates.Count -ne 1) {
        $candidates | Format-Table
        throw 'Choose the trusted Wi-Fi address and run .\Start-Phone-Test.ps1 -LanAddress <address>.'
    }
    $LanAddress = $candidates[0].Address
}
$candidateAddresses = @($candidates | ForEach-Object { $_.Address })
if ($LanAddress -notin $candidateAddresses) { throw 'LanAddress must be an active local IPv4 address with a gateway.' }
if ($ApiUrl) {
    $parsedApi = [Uri]$ApiUrl
    if ($parsedApi.Scheme -ne 'https' -or -not $parsedApi.Host -or $parsedApi.UserInfo -or $parsedApi.Query -or $parsedApi.Fragment -or $parsedApi.AbsolutePath -ne '/') {
        throw 'ApiUrl must be an HTTPS origin without a path, password or query.'
    }
    $ApiUrl = $ApiUrl.TrimEnd('/')
} else { $ApiUrl = "http://${LanAddress}:$BackendPort" }
$plan = [ordered]@{ api = $ApiUrl; health = "$ApiUrl/api/health/"; expo = "exp://${LanAddress}:$ExpoPort"; realDeviceVerified = $false }
New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '.local') -Force | Out-Null
$plan | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.local\phone-test.json') -Encoding UTF8
Write-Output "Phone browser check: $($plan.health)"
Write-Output "Expo Go address: $($plan.expo)"
Write-Output 'Use the same trusted Wi-Fi. Do not share the development server on public Wi-Fi.'
if ($CheckOnly) { return }

$backendJob = $null
try {
    if ($ApiUrl.StartsWith('http://')) {
        $env:DJANGO_DEBUG = '1'
        $env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1,10.0.2.2,$LanAddress"
        foreach ($command in @(@('migrate','--noinput'), @('seed_guide'), @('init_admin'))) {
            & $serverPython server\manage.py @command
            if ($LASTEXITCODE -ne 0) { throw 'Backend initialization failed.' }
        }
        $healthy = $false
        try { $healthy = (Invoke-RestMethod -Uri $plan.health -TimeoutSec 3).status -eq 'ok' } catch {}
        if (-not $healthy) {
            $backendJob = Start-Process -FilePath $serverPython -ArgumentList @('server/manage.py','runserver',"${LanAddress}:$BackendPort",'--noreload') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot ".local\phone-backend-$BackendPort.log") -RedirectStandardError (Join-Path $PSScriptRoot ".local\phone-backend-$BackendPort-error.log")
            for ($attempt = 0; $attempt -lt 20; $attempt++) {
                try { $healthy = (Invoke-RestMethod -Uri $plan.health -TimeoutSec 2).status -eq 'ok' } catch {}
                if ($healthy) { break }
                if ($backendJob.HasExited) { throw 'Backend stopped. See .local/phone-backend-*-error.log.' }
                Start-Sleep -Milliseconds 500
            }
            if (-not $healthy) { throw 'Backend did not become reachable. Check the local address and port.' }
        }
    } else {
        if ((Invoke-RestMethod -Uri $plan.health -TimeoutSec 80).status -ne 'ok') { throw 'Online backend health check failed.' }
    }
    $env:EXPO_PUBLIC_API_URL = $ApiUrl
    $env:REACT_NATIVE_PACKAGER_HOSTNAME = $LanAddress
    & node (Join-Path $PSScriptRoot 'node_modules\expo\bin\cli') start --go --lan --port $ExpoPort
} finally {
    if ($null -ne $backendJob -and -not $backendJob.HasExited) {
        & taskkill.exe /PID $backendJob.Id /T /F 2>$null | Out-Null
    }
}
