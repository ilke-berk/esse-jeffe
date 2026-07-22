# ============================================================
# deploy-chat.ps1 - Esse Jeffe "chat" edge function deploy
# Supabase Management API (multipart) uzerinden; MCP tek-cagri
# cikti limitine sigmayan 6 dosyali fonksiyon icin.
#
# KULLANIM:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # Supabase hesap access token
#   powershell -ExecutionPolicy Bypass -File deploy-chat.ps1
#
# NOTLAR (onceki oturumun tuzaklari):
#  - curl.exe Turkce karakterli ("Masaustu") yoldan dosya okuyamiyor
#    -> dosyalar once ASCII yola (C:\temp\ej-chat-deploy) kopyalanir.
#  - Script tamamen ASCII (PS 5.1 BOM'suz UTF-8 bozuyor).
#  - metadata JSON'u tirnak bozulmasin diye dosyadan verilir (-F "metadata=<meta.json").
# ============================================================

$ErrorActionPreference = "Stop"

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "HATA: SUPABASE_ACCESS_TOKEN ortam degiskeni bos. Once token'i ayarlayin." -ForegroundColor Red
  exit 1
}

$projectRef = "grdinhjtsmoograktgge"
# NOT: "Masaustu" yolunda Turkce karakter var; script BOM'suz kaydedilirse
# PS 5.1 literali bozar -> yol joker ile cozulur (tamamen ASCII kalir).
$src = (Get-Item "C:\Users\ilkeb\OneDrive\Masa*\esse\backend\functions\chat").FullName
$work = "C:\temp\ej-chat-deploy"

# 1) ASCII calisma klasoru
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force $work | Out-Null

$files = @("index.ts","order-email.ts","guards.ts","exchange.ts","order-info.ts","discount.ts","cod-risk.ts","outcomes.ts")
foreach ($f in $files) {
  Copy-Item (Join-Path $src $f) (Join-Path $work $f)
}

# 2) metadata dosyasi (BOM'suz ASCII/UTF8)
$meta = '{"name":"chat","entrypoint_path":"index.ts","verify_jwt":false}'
[System.IO.File]::WriteAllText((Join-Path $work "meta.json"), $meta, (New-Object System.Text.UTF8Encoding($false)))

# 3) Management API multipart deploy
Set-Location $work
$url = "https://api.supabase.com/v1/projects/$projectRef/functions/deploy?slug=chat"

# -F listesi $files dizisinden TURETILIR. Elle yazilan ikinci bir liste
# tutulursa yeni dosya eklendiginde kayar (cod-risk.ts eklenirken oldu:
# dosya kopyalandi ama yuklenmedi -> "Module not found" bundle hatasi).
$curlArgs = @(
  "-sS", "--ssl-no-revoke", "-X", "POST", $url,
  "-H", "Authorization: Bearer $env:SUPABASE_ACCESS_TOKEN",
  "-F", "metadata=<meta.json;type=application/json"
)
foreach ($f in $files) { $curlArgs += @("-F", "file=@$f") }
$curlArgs += @("-o", "response.json", "-w", "HTTP %{http_code}`n")

& curl.exe @curlArgs

Write-Host "--- API yaniti (response.json) ---"
Get-Content (Join-Path $work "response.json") | Write-Host
Write-Host ""
Write-Host "Yanitta 'version' alanini kontrol edin (v20 sonrasi v21 beklenir)."
Write-Host "IS BITINCE token'i Supabase dashboard'dan REVOKE etmeyi unutmayin."
