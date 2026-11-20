$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Start-Process 'http://localhost:4173'
node .\server.mjs
