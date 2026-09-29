$ErrorActionPreference = "Stop"

$env:PORT = "8787"
$env:NODE_ENV = "development"
$env:PANEL_ALLOWED_ORIGIN = "http://localhost:8000"
$env:GATEWAY_MODE = "mock"
$env:AUTH_MODE = "unconfigured"
$env:MOCK_SCENARIO = "normal"
$env:YMS_MODE = "mock"

Write-Host "Painel Docas AM1 - ambiente local seguro"
Write-Host "Gateway: http://127.0.0.1:8787"
Write-Host "YMS: mock"
Write-Host "Nenhuma credencial corporativa sera usada."
Write-Host ""
Write-Host "Para testar em outra janela do PowerShell:"
Write-Host 'Invoke-RestMethod "http://127.0.0.1:8787/yms?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&waves=1,2,3,4,5&timezone=America%2FSao_Paulo"'
Write-Host ""

npm start
