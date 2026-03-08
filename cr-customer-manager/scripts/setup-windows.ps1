# C&R CRM Windows Setup Script
# Run as Administrator in PowerShell: .\scripts\setup-windows.ps1

Write-Host "C&R Carpet Manager — Windows Setup" -ForegroundColor Cyan

# Check Node version
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
  Write-Host "Installing Node.js..." -ForegroundColor Yellow
  winget install OpenJS.NodeJS.LTS
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
