param([int]$Port=18081)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot '..\..\WeAgent-Node\scripts\test-integration.ps1') -Port $Port -FrontendOnly
