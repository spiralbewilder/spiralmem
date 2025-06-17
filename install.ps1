# Spiralmem Windows Installer
# PowerShell script for Windows installation

param(
    [switch]$Silent,
    [switch]$SystemWide,
    [switch]$Dev,
    [switch]$SkipDeps,
    [switch]$Force,
    [string]$InstallDir,
    [switch]$Help
)

# Configuration
$SPIRALMEM_VERSION = if ($env:SPIRALMEM_VERSION) { $env:SPIRALMEM_VERSION } else { "1.0.0" }
$SPIRALMEM_REPO = if ($env:SPIRALMEM_REPO) { $env:SPIRALMEM_REPO } else { "https://github.com/spiralbewilder/spiralmem" }

if ($SystemWide) {
    $INSTALL_DIR = if ($InstallDir) { $InstallDir } else { "C:\Program Files\Spiralmem" }
    $BIN_DIR = "C:\Program Files\Spiralmem\bin"
    $CONFIG_DIR = "C:\ProgramData\Spiralmem"
    $DATA_DIR = "C:\ProgramData\Spiralmem\data"
} else {
    $INSTALL_DIR = if ($InstallDir) { $InstallDir } else { "$env:USERPROFILE\.spiralmem" }
    $BIN_DIR = "$env:USERPROFILE\.local\bin"
    $CONFIG_DIR = "$env:APPDATA\Spiralmem"
    $DATA_DIR = "$env:LOCALAPPDATA\Spiralmem"
}

# Colors for output
function Write-Info($message) {
    Write-Host "[INFO] $message" -ForegroundColor Blue
}

function Write-Success($message) {
    Write-Host "[SUCCESS] $message" -ForegroundColor Green
}

function Write-Warning($message) {
    Write-Host "[WARNING] $message" -ForegroundColor Yellow
}

function Write-Error($message) {
    Write-Host "[ERROR] $message" -ForegroundColor Red
}

function Show-Help {
    Write-Host @"
Spiralmem Windows Installer

Usage: .\install.ps1 [OPTIONS]

OPTIONS:
    -Silent            Run in silent mode (no prompts)
    -SystemWide        Install system-wide (requires admin)
    -Dev               Development installation with source
    -SkipDeps          Skip dependency installation
    -Force             Force installation even if already installed
    -InstallDir DIR    Custom installation directory
    -Help              Show this help message

EXAMPLES:
    # Standard installation
    .\install.ps1

    # Silent installation
    .\install.ps1 -Silent

    # System-wide installation (run as Administrator)
    .\install.ps1 -SystemWide

    # Development installation
    .\install.ps1 -Dev

"@
}

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-SystemRequirements {
    Write-Info "Checking system requirements..."
    
    $errors = @()
    
    # Check Windows version (Windows 10+)
    $version = [System.Environment]::OSVersion.Version
    if ($version.Major -lt 10) {
        $errors += "Windows 10 or later required"
    }
    
    # Check available disk space (minimum 2GB)
    $drive = (Get-Location).Drive
    $freeSpace = (Get-WmiObject -Class Win32_LogicalDisk -Filter "DeviceID='$($drive.Name)'").FreeSpace
    $freeSpaceGB = [math]::Round($freeSpace / 1GB, 2)
    
    if ($freeSpaceGB -lt 2) {
        $errors += "At least 2GB free disk space required (current: $freeSpaceGB GB)"
    }
    
    # Check available memory (minimum 2GB)
    $totalMemory = (Get-WmiObject -Class Win32_ComputerSystem).TotalPhysicalMemory
    $totalMemoryGB = [math]::Round($totalMemory / 1GB, 2)
    
    if ($totalMemoryGB -lt 2) {
        $errors += "At least 2GB RAM recommended (current: $totalMemoryGB GB)"
    }
    
    if ($errors.Count -gt 0) {
        Write-Error "System requirements not met:"
        $errors | ForEach-Object { Write-Error "  $_" }
        if (-not $Force) {
            exit 1
        } else {
            Write-Warning "Continuing installation despite requirements (-Force specified)"
        }
    }
    
    Write-Success "System requirements check passed"
}

function Test-Dependencies {
    if ($SkipDeps) {
        Write-Info "Skipping dependency check (-SkipDeps specified)"
        return
    }
    
    Write-Info "Checking system dependencies..."
    
    $missingDeps = @()
    
    # Check Node.js
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            $versionNumber = $nodeVersion.Substring(1)
            $majorVersion = [int]($versionNumber.Split('.')[0])
            if ($majorVersion -lt 18) {
                $missingDeps += "nodejs-update"
            }
        } else {
            $missingDeps += "nodejs"
        }
    } catch {
        $missingDeps += "nodejs"
    }
    
    # Check Python
    try {
        $pythonVersion = python --version 2>$null
        if (-not $pythonVersion) {
            $missingDeps += "python"
        }
    } catch {
        $missingDeps += "python"
    }
    
    # Check pip
    try {
        pip --version 2>$null | Out-Null
    } catch {
        $missingDeps += "pip"
    }
    
    # Check FFmpeg
    try {
        ffmpeg -version 2>$null | Out-Null
    } catch {
        $missingDeps += "ffmpeg"
    }
    
    if ($missingDeps.Count -gt 0) {
        Write-Warning "Missing dependencies: $($missingDeps -join ', ')"
        
        if (-not $Silent) {
            $response = Read-Host "Install missing dependencies? (y/N)"
            if ($response -ne 'y' -and $response -ne 'Y') {
                Write-Error "Dependencies required for installation. Exiting."
                exit 1
            }
        }
        
        Install-Dependencies $missingDeps
    } else {
        Write-Success "All dependencies are available"
    }
}

function Install-Dependencies($deps) {
    Write-Info "Installing dependencies on Windows..."
    
    # Check if Chocolatey is installed
    try {
        choco --version | Out-Null
        $chocoAvailable = $true
    } catch {
        $chocoAvailable = $false
    }
    
    # Check if winget is available
    try {
        winget --version | Out-Null
        $wingetAvailable = $true
    } catch {
        $wingetAvailable = $false
    }
    
    if (-not $chocoAvailable -and -not $wingetAvailable) {
        Write-Error "Package manager not found. Please install dependencies manually:"
        Write-Error "1. Node.js: https://nodejs.org/"
        Write-Error "2. Python: https://python.org/"
        Write-Error "3. FFmpeg: https://ffmpeg.org/"
        Write-Error ""
        Write-Error "Or install Chocolatey: https://chocolatey.org/install"
        Write-Error "Or use winget (Windows 10 1709+)"
        exit 1
    }
    
    foreach ($dep in $deps) {
        switch ($dep) {
            "nodejs" { 
                if ($wingetAvailable) {
                    winget install OpenJS.NodeJS
                } elseif ($chocoAvailable) {
                    choco install nodejs -y
                }
            }
            "nodejs-update" {
                if ($wingetAvailable) {
                    winget upgrade OpenJS.NodeJS
                } elseif ($chocoAvailable) {
                    choco upgrade nodejs -y
                }
            }
            "python" { 
                if ($wingetAvailable) {
                    winget install Python.Python.3
                } elseif ($chocoAvailable) {
                    choco install python -y
                }
            }
            "pip" {
                Write-Info "pip comes with Python installation"
            }
            "ffmpeg" { 
                if ($wingetAvailable) {
                    winget install Gyan.FFmpeg
                } elseif ($chocoAvailable) {
                    choco install ffmpeg -y
                }
            }
        }
    }
    
    # Refresh environment variables
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Install-PythonPackages {
    Write-Info "Installing Python packages..."
    
    # Install faster_whisper
    try {
        python -c "import faster_whisper" 2>$null
        Write-Info "faster_whisper already installed"
    } catch {
        Write-Info "Installing faster_whisper..."
        pip install faster_whisper
    }
}

function Install-Spiralmem {
    Write-Info "Installing Spiralmem..."
    
    # Create installation directories
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
    New-Item -ItemType Directory -Path $BIN_DIR -Force | Out-Null
    New-Item -ItemType Directory -Path $CONFIG_DIR -Force | Out-Null
    New-Item -ItemType Directory -Path "$DATA_DIR\data" -Force | Out-Null
    New-Item -ItemType Directory -Path "$DATA_DIR\logs" -Force | Out-Null
    New-Item -ItemType Directory -Path "$DATA_DIR\temp" -Force | Out-Null
    
    if ($Dev) {
        Install-SpiralmemDev
    } else {
        Install-SpiralmemRelease
    }
}

function Install-SpiralmemDev {
    Write-Info "Installing Spiralmem in development mode..."
    
    # Check if git is available
    try {
        git --version | Out-Null
    } catch {
        Write-Error "Git is required for development installation"
        Write-Error "Install Git from: https://git-scm.com/download/win"
        exit 1
    }
    
    # Clone repository
    if (Test-Path "$INSTALL_DIR\.git") {
        Write-Info "Updating existing repository..."
        Set-Location $INSTALL_DIR
        git pull
    } else {
        Write-Info "Cloning repository..."
        git clone $SPIRALMEM_REPO $INSTALL_DIR
        Set-Location $INSTALL_DIR
    }
    
    # Install Node.js dependencies
    Write-Info "Installing Node.js dependencies..."
    npm install
    
    # Build project
    Write-Info "Building project..."
    npm run build
    
    # Install Python dependencies
    Install-PythonPackages
    
    # Create executable script
    Create-ExecutableScript
}

function Install-SpiralmemRelease {
    Write-Info "Installing Spiralmem from GitHub source..."
    
    # For now, use development installation since we don't have releases yet
    Write-Info "Installing from source (recommended for latest features)"
    Install-SpiralmemDev
}

function Create-ExecutableScript {
    Write-Info "Creating executable script..."
    
    # Create batch file for Windows
    $batchContent = @"
@echo off
set SPIRALMEM_INSTALL_DIR=$INSTALL_DIR
set SPIRALMEM_CONFIG_DIR=$CONFIG_DIR
set SPIRALMEM_DATA_DIR=$DATA_DIR

cd /d "$INSTALL_DIR"
node dist\cli\spiralmem.js %*
"@
    
    $batchFile = "$BIN_DIR\spiralmem.bat"
    Set-Content -Path $batchFile -Value $batchContent
    
    Write-Success "Executable created at $batchFile"
}

function Add-ToPath {
    param($binDir)
    
    # Get current user PATH
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    
    if ($currentPath -notlike "*$binDir*") {
        $newPath = "$currentPath;$binDir"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Info "Added $binDir to PATH"
        Write-Warning "Please restart your PowerShell session or reload environment variables"
    }
}

function Set-Configuration {
    Write-Info "Setting up configuration..."
    
    $configFile = "$CONFIG_DIR\config.yaml"
    
    if (-not (Test-Path $configFile) -or $Force) {
        $configContent = @"
# Spiralmem Configuration
# Generated by installer on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

database:
  path: "$($DATA_DIR.Replace('\', '/'))/data/spiralmem.db"
  backup:
    enabled: true
    interval: "24h"

video:
  processing:
    tempDirectory: "$($DATA_DIR.Replace('\', '/'))/temp"
    maxFileSize: "5GB"
  transcription:
    model: "base"
    language: "auto"

logging:
  level: "info"
  file: "$($DATA_DIR.Replace('\', '/'))/logs/spiralmem.log"
  maxSize: "10MB"
  maxFiles: 5

performance:
  processing:
    maxConcurrentJobs: 2
    jobTimeout: 300000

server:
  mcp:
    enabled: true
    port: 8080
"@
        
        Set-Content -Path $configFile -Value $configContent
        Write-Success "Configuration created at $configFile"
    } else {
        Write-Info "Configuration already exists at $configFile"
    }
}

function Test-Installation {
    Write-Info "Verifying installation..."
    
    $testResults = @()
    
    # Test 1: Command availability
    try {
        & "$BIN_DIR\spiralmem.bat" --version 2>$null | Out-Null
        $testResults += "command:PASS"
    } catch {
        $testResults += "command:FAIL"
        return $false
    }
    
    # Test 2: Configuration validation
    if (Test-Path "$CONFIG_DIR\config.yaml") {
        $testResults += "config:PASS"
    } else {
        $testResults += "config:FAIL"
    }
    
    # Test 3: Dependencies check
    $depsOk = $true
    $commands = @("node", "python", "ffmpeg")
    foreach ($cmd in $commands) {
        try {
            & $cmd --version 2>$null | Out-Null
        } catch {
            $depsOk = $false
            break
        }
    }
    
    if ($depsOk) {
        $testResults += "dependencies:PASS"
    } else {
        $testResults += "dependencies:FAIL"
    }
    
    # Test 4: Python packages
    try {
        python -c "import faster_whisper" 2>$null
        $testResults += "python-packages:PASS"
    } catch {
        $testResults += "python-packages:FAIL"
    }
    
    # Report results
    Write-Info "Installation verification results:"
    $allPassed = $true
    foreach ($result in $testResults) {
        $testName, $testStatus = $result -split ':'
        
        if ($testStatus -like "PASS*") {
            Write-Success "  $testName : $testStatus"
        } else {
            Write-Error "  $testName : $testStatus"
            $allPassed = $false
        }
    }
    
    return $allPassed
}

# Main installation flow
function Main {
    if ($Help) {
        Show-Help
        return
    }
    
    Write-Host "🎬 Spiralmem Video Memory System Installer (Windows)" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host ""
    
    if ($SystemWide -and -not (Test-Administrator)) {
        Write-Error "System-wide installation requires administrator privileges"
        Write-Error "Please run PowerShell as Administrator and try again"
        exit 1
    }
    
    if (-not $Silent) {
        Write-Host "This installer will:"
        Write-Host "  • Install system dependencies (Node.js, Python, FFmpeg)"
        Write-Host "  • Install Spiralmem video memory system"
        Write-Host "  • Set up configuration and data directories"
        Write-Host "  • Create command-line tools"
        Write-Host ""
        
        if ($SystemWide) {
            Write-Host "⚠️  System-wide installation selected" -ForegroundColor Yellow
            Write-Host ""
        }
        
        $response = Read-Host "Continue with installation? (y/N)"
        if ($response -ne 'y' -and $response -ne 'Y') {
            Write-Info "Installation cancelled by user"
            exit 0
        }
        Write-Host ""
    }
    
    try {
        Test-SystemRequirements
        Test-Dependencies
        Install-Spiralmem
        Set-Configuration
        Add-ToPath $BIN_DIR
        
        if (Test-Installation) {
            Write-Host ""
            Write-Success "🎉 Spiralmem installation completed successfully!"
            Write-Host ""
            Write-Host "Quick start:"
            Write-Host "  spiralmem --help                    # Show available commands"
            Write-Host "  spiralmem add-video video.mp4       # Process a video file"
            Write-Host "  spiralmem search 'your query'       # Search your content"
            Write-Host "  spiralmem serve-mcp                 # Start MCP server for AI assistants"
            Write-Host ""
            Write-Host "Configuration: $CONFIG_DIR\config.yaml"
            Write-Host "Data directory: $DATA_DIR"
            Write-Host ""
            Write-Warning "⚠️  Please restart your PowerShell session to use the 'spiralmem' command"
        } else {
            Write-Host ""
            Write-Error "Installation completed with errors. Please check the output above."
            exit 1
        }
    } catch {
        Write-Error "Installation failed: $($_.Exception.Message)"
        exit 1
    }
}

# Run installer
Main