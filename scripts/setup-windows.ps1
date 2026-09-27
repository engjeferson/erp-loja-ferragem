#Requires -Version 5.1
<#
  Configura o ambiente de desenvolvimento do erp-loja-ferragem em um Windows novo:
  instala Git/Node/Docker Desktop via winget, clona o(s) repositório(s), roda
  npm install nos workspaces, sobe o Postgres via Docker e prepara o Prisma.

  Uso (PowerShell, como Administrador na primeira vez por causa da instalação
  do Docker Desktop):

    .\setup-windows.ps1
    .\setup-windows.ps1 -DestinationPath "D:\dev" -Repos "erp-loja-ferragem","agenda-zap"

  Depois de rodar, ainda falta preencher os arquivos .env manualmente (o script
  só copia os .env.example) — veja o aviso impresso no final.
#>

[CmdletBinding()]
param(
    [string]$GithubUser = "engjeferson",
    [string]$DestinationPath = "$HOME\dev",
    [string[]]$Repos = @("erp-loja-ferragem"),
    [switch]$SkipDockerInstall,
    [switch]$SkipDockerUp
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Ok($msg)   { Write-Host "OK: $msg" -ForegroundColor Green }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-WithWinget($id, $friendlyName) {
    Write-Step "Verificando $friendlyName"
    $already = winget list --id $id --accept-source-agreements 2>$null | Select-String $id
    if ($already) {
        Write-Ok "$friendlyName ja instalado"
        return
    }
    Write-Host "Instalando $friendlyName..."
    winget install --id $id -e --accept-source-agreements --accept-package-agreements
}

# ---------------------------------------------------------------------------
# 1. Pre-requisitos
# ---------------------------------------------------------------------------
if (-not (Test-Command "winget")) {
    Write-Warn "winget nao encontrado. Instale o 'App Installer' pela Microsoft Store e rode este script novamente."
    exit 1
}

Install-WithWinget "Git.Git" "Git"
Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
if (-not $SkipDockerInstall) {
    Install-WithWinget "Docker.DockerDesktop" "Docker Desktop"
}

Write-Warn "Se Git/Node/Docker acabaram de ser instalados agora, feche e reabra o PowerShell antes de continuar (para o PATH atualizar) e rode o script de novo."

foreach ($cmd in @("git", "node", "npm")) {
    if (-not (Test-Command $cmd)) {
        Write-Warn "'$cmd' ainda nao esta disponivel neste terminal. Abra um novo PowerShell e rode o script novamente."
        exit 1
    }
}

# ---------------------------------------------------------------------------
# 2. Clonar repositorios
# ---------------------------------------------------------------------------
Write-Step "Preparando pasta de projetos em $DestinationPath"
New-Item -ItemType Directory -Force -Path $DestinationPath | Out-Null

foreach ($repo in $Repos) {
    $repoPath = Join-Path $DestinationPath $repo
    if (Test-Path $repoPath) {
        Write-Step "Repositorio '$repo' ja existe, atualizando (git pull)"
        Push-Location $repoPath
        git pull
        Pop-Location
    } else {
        Write-Step "Clonando $repo"
        git clone "https://github.com/$GithubUser/$repo.git" $repoPath
    }
}

# ---------------------------------------------------------------------------
# 3. Setup especifico do erp-loja-ferragem (npm workspaces + docker + prisma)
# ---------------------------------------------------------------------------
$erpPath = Join-Path $DestinationPath "erp-loja-ferragem"
if (Test-Path $erpPath) {
    Push-Location $erpPath

    Write-Step "Instalando dependencias (npm install na raiz, workspaces backend/frontend)"
    npm install

    Write-Step "Preparando arquivos .env a partir dos .env.example"
    $envPairs = @(
        @{ Example = "backend\.env.example";  Target = "backend\.env" },
        @{ Example = "frontend\.env.example"; Target = "frontend\.env" }
    )
    foreach ($pair in $envPairs) {
        if ((Test-Path $pair.Example) -and (-not (Test-Path $pair.Target))) {
            Copy-Item $pair.Example $pair.Target
            Write-Warn "Criado $($pair.Target) com valores de EXEMPLO. Edite-o com os valores reais (DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, etc.) antes de rodar o backend."
        } elseif (Test-Path $pair.Target) {
            Write-Ok "$($pair.Target) ja existe, nao foi sobrescrito"
        }
    }

    if (-not $SkipDockerUp) {
        Write-Step "Subindo Postgres via Docker Compose"
        try {
            docker compose up -d
            Write-Ok "Container do Postgres no ar (porta 5432)"
        } catch {
            Write-Warn "Nao foi possivel subir o Docker agora. Abra o Docker Desktop manualmente (primeira execucao pede reinicio do Windows) e rode 'docker compose up -d' na pasta do projeto depois."
        }
    }

    Write-Step "Gerando client do Prisma"
    npm run prisma:generate --workspace=backend

    Pop-Location
}

# ---------------------------------------------------------------------------
# 4. Resumo final
# ---------------------------------------------------------------------------
Write-Step "Setup concluido"
Write-Host @"

Proximos passos manuais (nao automatizaveis com seguranca por script):

1. Edite backend\.env e frontend\.env com os valores reais.
   - ENCRYPTION_KEY: se voce quer continuar usando o MESMO banco (com
     certificados A1 ja criptografados), essa chave tem que ser IDENTICA
     a que esta na outra maquina. Leve-a por um cofre de senhas ou pendrive,
     nunca por e-mail/chat comum.
   - Se for comecar com banco novo/local, pode gerar uma chave nova com:
       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

2. Rodar as migrations do banco (dentro da pasta erp-loja-ferragem):
     npm run prisma:migrate --workspace=backend

3. (Opcional) Popular dados de exemplo:
     npm run prisma:seed --workspace=backend

4. Subir o projeto:
     npm run dev:backend
     npm run dev:frontend

5. Configurar autenticacao de push no GitHub (se ainda nao apareceu):
   o Git Credential Manager (instalado junto com o Git) abre o navegador
   na primeira vez que voce der 'git push'.

"@ -ForegroundColor White
