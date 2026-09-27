#Requires -Version 5.1
<#
  Copia os .env / .env.local salvos em um backup (ex: pendrive, SSD externo)
  para dentro de cada repositorio ja clonado no Windows, no lugar certo
  para cada projeto (alguns sao apps unicos, outros tem backend separado).

  Uso:
    .\copy-envs-windows.ps1
    .\copy-envs-windows.ps1 -BackupRoot "D:\segredos sistemas" -DestinationRoot "$HOME\dev"

  Pre-requisito: os repositorios ja devem estar clonados em -DestinationRoot
  (rode o setup-windows.ps1 ou 'git clone' antes deste script).
#>

[CmdletBinding()]
param(
    [string]$BackupRoot = "D:\segredos sistemas",
    [string]$DestinationRoot = "$HOME\dev"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Ok($msg)   { Write-Host "OK: $msg" -ForegroundColor Green }

# Pasta de backup (nome exato da pasta) -> pasta relativa DENTRO do repo clonado
# onde o .env / .env.local daquele projeto deve ficar.
$map = @(
    @{ BackupFolder = "agenda ZAP";      Repo = "agenda-zap";            RelativeEnvDir = "." },
    @{ BackupFolder = "Sistema gestão";  Repo = "sistema-gestao-obras";  RelativeEnvDir = "." },
    @{ BackupFolder = "CRM reis";        Repo = "crm-reis-engenharia";   RelativeEnvDir = "crm-backend" },
    @{ BackupFolder = "whats inbox";     Repo = "whatsapp-inbox";        RelativeEnvDir = "." }
)

if (-not (Test-Path $BackupRoot)) {
    Write-Warn "Pasta de backup nao encontrada: $BackupRoot"
    exit 1
}

foreach ($item in $map) {
    $srcDir = Join-Path $BackupRoot $item.BackupFolder
    $repoDir = Join-Path $DestinationRoot $item.Repo
    $destDir = Join-Path $repoDir $item.RelativeEnvDir

    Write-Step "Projeto: $($item.Repo)"

    if (-not (Test-Path $srcDir)) {
        Write-Warn "Pasta de backup nao encontrada: $srcDir (pulando)"
        continue
    }
    if (-not (Test-Path $repoDir)) {
        Write-Warn "Repositorio ainda nao clonado em $repoDir (clone primeiro e rode este script de novo) - pulando"
        continue
    }

    New-Item -ItemType Directory -Force -Path $destDir | Out-Null

    $copied = $false
    foreach ($fileName in @(".env", ".env.local")) {
        $src = Join-Path $srcDir $fileName
        if (Test-Path $src) {
            $dest = Join-Path $destDir $fileName
            Copy-Item $src $dest -Force
            Write-Ok "$fileName -> $dest"
            $copied = $true
        }
    }
    if (-not $copied) {
        Write-Warn "Nenhum .env/.env.local encontrado em $srcDir"
    }
}

# -----------------------------------------------------------------------
# Caso especial: reisengenhariars-site NAO usa .env — usa um JSON de
# credenciais FTP fora da pasta do projeto (deploy.py le de
# ~/.reis-site-deploy/ftp_credentials.json). So copiamos se existir.
# -----------------------------------------------------------------------
Write-Step "Projeto: reisengenhariars-site (caso especial - FTP, nao usa .env)"
$siteBackup = Join-Path $BackupRoot "site reis"
$ftpCredsCandidate = Get-ChildItem $siteBackup -Filter "*ftp*credentials*.json" -ErrorAction SilentlyContinue | Select-Object -First 1

if ($ftpCredsCandidate) {
    $ftpDestDir = Join-Path $HOME ".reis-site-deploy"
    New-Item -ItemType Directory -Force -Path $ftpDestDir | Out-Null
    $ftpDest = Join-Path $ftpDestDir "ftp_credentials.json"
    Copy-Item $ftpCredsCandidate.FullName $ftpDest -Force
    Write-Ok "ftp_credentials.json -> $ftpDest"
} else {
    Write-Warn "Nao encontrei um arquivo tipo 'ftp_credentials.json' em '$siteBackup'."
    Write-Warn "Esse projeto (reisengenhariars-site) nao usa .env — se so tiver .env/.env.local la, confirme com o usuario antes de usar, pois o deploy.py nao le esses arquivos."
}

Write-Step "Concluido"
Write-Host "Lembre-se: o erp-loja-ferragem ainda precisa ser configurado a parte (backend\.env e frontend\.env)." -ForegroundColor White
