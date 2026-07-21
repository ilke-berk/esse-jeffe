# ============================================================
# deploy-ef.ps1 - Esse Jeffe edge-functions/ deploy (tek fonksiyon)
# deploy-chat.ps1 ile AYNI desen (Management API multipart + curl.exe),
# farki: bu fonksiyonlar ../_shared/*.ts import eder -> multipart'ta
# DIZIN YAPISI korunmak zorunda.
#
# KULLANIM:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
#   powershell -ExecutionPolicy Bypass -File deploy-ef.ps1 -Slug log-error -VerifyJwt false
#
# NOTLAR (deploy-chat.ps1'den devralinan tuzaklar):
#  - curl.exe Turkce karakterli ("Masaustu") yoldan dosya okuyamiyor
#    -> dosyalar once ASCII yola (C:\temp\ej-ef-deploy) kopyalanir.
#  - Script tamamen ASCII (PS 5.1 BOM'suz UTF-8 bozuyor).
#  - metadata JSON'u tirnak bozulmasin diye dosyadan verilir.
#
# BU DOSYAYA OZEL TUZAK:
#  - curl -F "file=@x.ts" varsayilan olarak SADECE basename gonderir.
#    "_shared/util.ts" -> "util.ts" olur ve bundle "Module not found" der.
#    Bu yuzden her dosyada ";filename=<goreceli yol>" ACIKCA verilir.
#  - *_test.ts YUKLENMEZ (jsr:@std/assert import eder, bundle'da gereksiz).
# ============================================================

param(
  [Parameter(Mandatory=$true)][string]$Slug,
  [Parameter(Mandatory=$true)][ValidateSet("true","false")][string]$VerifyJwt
)

$ErrorActionPreference = "Stop"

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  Write-Host "HATA: SUPABASE_ACCESS_TOKEN bos." -ForegroundColor Red
  exit 1
}

$projectRef = "grdinhjtsmoograktgge"
$root = (Get-Item "C:\Users\ilkeb\OneDrive\Masa*\esse\backend\edge-functions").FullName
$work = "C:\temp\ej-ef-deploy"

$fnDir = Join-Path $root $Slug
if (-not (Test-Path (Join-Path $fnDir "index.ts"))) {
  Write-Host "HATA: $Slug/index.ts bulunamadi." -ForegroundColor Red
  exit 1
}

# 1) ASCII calisma klasoru + dizin yapisi
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force $work | Out-Null
New-Item -ItemType Directory -Force (Join-Path $work $Slug) | Out-Null
New-Item -ItemType Directory -Force (Join-Path $work "_shared") | Out-Null

# goreceli yol listesi -F icin tek kaynak (deploy-chat.ps1 dersi:
# ikinci bir elle yazilmis liste tutulursa yeni dosyada kayar)
$rel = @()

Copy-Item (Join-Path $fnDir "index.ts") (Join-Path $work "$Slug\index.ts")
$rel += "$Slug/index.ts"

Get-ChildItem (Join-Path $root "_shared") -Filter *.ts |
  Where-Object { $_.Name -notlike "*_test.ts" } |
  ForEach-Object {
    Copy-Item $_.FullName (Join-Path $work "_shared\$($_.Name)")
    $script:rel += "_shared/$($_.Name)"
  }

Copy-Item (Join-Path $root "deno.json") (Join-Path $work "deno.json")
$rel += "deno.json"

# 2) metadata (BOM'suz)
$meta = '{"name":"' + $Slug + '","entrypoint_path":"' + $Slug + '/index.ts","import_map_path":"deno.json","verify_jwt":' + $VerifyJwt + '}'
[System.IO.File]::WriteAllText((Join-Path $work "meta.json"), $meta, (New-Object System.Text.UTF8Encoding($false)))

# 3) Management API multipart deploy
Set-Location $work
$url = "https://api.supabase.com/v1/projects/$projectRef/functions/deploy?slug=$Slug"

$curlArgs = @(
  "-sS", "--ssl-no-revoke", "-X", "POST", $url,
  "-H", "Authorization: Bearer $env:SUPABASE_ACCESS_TOKEN",
  "-F", "metadata=<meta.json;type=application/json"
)
# filename ACIKCA verilir -> dizin yapisi korunur (yukaridaki tuzak)
foreach ($f in $rel) { $curlArgs += @("-F", "file=@$f;filename=$f") }
$curlArgs += @("-o", "response.json", "-w", "HTTP %{http_code}`n")

Write-Host "Yuklenen dosyalar: $($rel -join ', ')"
& curl.exe @curlArgs

Write-Host "--- API yaniti ---"
Get-Content (Join-Path $work "response.json") | Write-Host
Write-Host ""

# cwd'yi $work DISINA al: aksi halde ardisik cagrilarda (dongu) klasor
# "in use" oldugu icin Remove-Item patlar ve ikinci fonksiyon deploy olmaz.
Set-Location "C:\"
