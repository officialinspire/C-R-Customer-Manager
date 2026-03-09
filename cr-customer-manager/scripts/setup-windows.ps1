# C&R CRM Windows Setup Script
# Run as Administrator in PowerShell: .\scripts\setup-windows.ps1

Write-Host "C&R Carpet Manager — Windows Setup" -ForegroundColor Cyan

# Check Node version
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
  Write-Host "Installing Node.js..." -ForegroundColor Yellow
  winget install OpenJS.NodeJS.LTS
}

# Auto-fetch credentials if not present
$envFile = Join-Path (Get-Location) ".env"
$credFile = Join-Path (Get-Location) "oauth-credentials.json"

if (-not (Test-Path $envFile) -or -not (Test-Path $credFile)) {
  Write-Host "Fetching credentials from private config..." -ForegroundColor Yellow
  
  # Replace YOUR_PAT with the personal access token you just created
  git clone https://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@github.com/officialinspire/cr-crm-config.git temp-config 2>$null
  
  if (Test-Path "temp-config") {
    if (Test-Path "temp-config\.env") { Copy-Item "temp-config\.env" ".env" }
    if (Test-Path "temp-config\oauth-credentials.json") {
      Copy-Item "temp-config\oauth-credentials.json" "oauth-credentials.json"
    }
    Remove-Item -Recurse -Force "temp-config"
    Write-Host "Credentials installed successfully." -ForegroundColor Green
  } else {
    Write-Host "WARNING: Could not fetch credentials. You may need to add .env manually." -ForegroundColor Red
  }
} else {
  Write-Host "Credentials already present, skipping fetch." -ForegroundColor Cyan
}

# Install dependencies
npm install

# Create desktop shortcut
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$Home\Desktop\C&R Carpet Manager.lnk")
$Shortcut.TargetPath = (Get-Location).Path + "\START-CR-CRM.bat"
$Shortcut.WorkingDirectory = (Get-Location).Path
$Shortcut.IconLocation = (Get-Location).Path + "\public\icons\icon-192.png"
$Shortcut.Save()

Write-Host "Done! Double-click 'C&R Carpet Manager' on your desktop to launch." -ForegroundColor Green
