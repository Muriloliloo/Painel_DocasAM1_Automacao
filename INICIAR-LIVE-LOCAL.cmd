@echo off
setlocal
cd /d "%~dp0gateway"

echo.
echo ==========================================
echo   PAINEL DOCAS AM1 - LIVE BIGQUERY LOCAL
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao foi encontrado neste computador.
  echo Instale/autorize o Node.js antes de continuar.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm nao foi encontrado neste computador.
  pause
  exit /b 1
)

if not exist "node_modules\@google-cloud\bigquery" (
  echo Preparando dependencias do gateway...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)

where gcloud >nul 2>&1
if errorlevel 1 (
  echo.
  echo Google Cloud CLI nao foi encontrado.
  echo O modo LIVE local precisa de ADC autorizado neste computador.
  echo Solicite/instale o Google Cloud CLI conforme a politica da empresa.
  echo Depois execute:
  echo   gcloud auth application-default login
  echo.
  pause
  exit /b 2
)

gcloud auth application-default print-access-token >nul 2>&1
if errorlevel 1 (
  echo.
  echo Nenhuma credencial ADC ativa foi encontrada.
  echo Abrindo o login Google para uma conta corporativa autorizada...
  call gcloud auth application-default login
  if errorlevel 1 (
    echo.
    echo O login ADC nao foi concluido.
    pause
    exit /b 2
  )
)

echo.
echo Iniciando o painel LIVE...
call npm run live:local
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo O modo LIVE terminou com erro %EXITCODE%.
  pause
)

exit /b %EXITCODE%
