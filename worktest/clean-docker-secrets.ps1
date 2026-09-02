$sid = 'S-1-5-21-119810386-2691155765-2341523195-1001'
$key = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid"
$profile = (Get-ItemProperty -LiteralPath $key).ProfileImagePath
$target = Join-Path $profile 'AppData\Local\docker-secrets-engine'
$result = "profile=$profile`n"
try {
    if (Test-Path -LiteralPath $target) {
        Rename-Item -LiteralPath $target -NewName 'docker-secrets-engine-stale-0902' -Force -ErrorAction Stop
    }
    if (Test-Path -LiteralPath $target) {
        $result += 'RENAME_FAILED'
    } else {
        $result += 'RENAME_OK'
    }
} catch {
    $result += 'ERROR: ' + $_.Exception.Message
}
Set-Content -LiteralPath 'C:\Windows\Temp\clean-docker-secrets-result.txt' -Value $result -Encoding ASCII
