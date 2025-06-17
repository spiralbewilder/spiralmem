# Spiralmem One-Step Installer Design

*Simple, Reliable, Cross-Platform Installation*

## Overview

The Spiralmem installer provides a seamless, one-command installation experience across all major platforms while ensuring all dependencies are properly configured and the system is ready for immediate use.

## Installation Goals

### User Experience Goals
- **One Command**: Single command installs everything
- **No Prerequisites**: User doesn't need to install anything first
- **Platform Detection**: Automatically detects OS and architecture
- **Dependency Management**: Handles all system and language dependencies
- **Verification**: Tests installation and provides feedback
- **Rollback**: Can cleanly uninstall if something goes wrong

### Technical Goals
- **Idempotent**: Safe to run multiple times
- **Incremental**: Only installs missing components
- **Offline Capable**: Can work without internet (with cached packages)
- **Permission Aware**: Handles sudo/admin requirements gracefully
- **Error Recovery**: Robust error handling and reporting

## Installation Approaches

### Approach 1: Universal Shell Script (Recommended)

**Installation Command**:
```bash
curl -fsSL https://install.spiralmem.com | sh
```

**Features**:
- Works on Linux, macOS, Windows (WSL/Git Bash)
- Downloads platform-specific installer
- Handles dependency detection and installation
- Provides immediate verification

**Implementation**:
```bash
#!/bin/bash
# install.sh - Universal Spiralmem Installer

set -e  # Exit on any error

# Configuration
SPIRALMEM_VERSION="1.0.0"
SPIRALMEM_REPO="https://github.com/spiralbewilder/spiralmem"
INSTALL_DIR="${SPIRALMEM_INSTALL_DIR:-$HOME/.spiralmem}"
BIN_DIR="${SPIRALMEM_BIN_DIR:-$HOME/.local/bin}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Platform detection
detect_platform() {
    local os=$(uname -s | tr '[:upper:]' '[:lower:]')
    local arch=$(uname -m)
    
    case $os in
        linux*) PLATFORM="linux" ;;
        darwin*) PLATFORM="macos" ;;
        mingw*|cygwin*|msys*) PLATFORM="windows" ;;
        *) log_error "Unsupported operating system: $os"; exit 1 ;;
    esac
    
    case $arch in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) log_error "Unsupported architecture: $arch"; exit 1 ;;
    esac
    
    log_info "Detected platform: $PLATFORM-$ARCH"
}

# Dependency checking and installation
check_dependencies() {
    log_info "Checking system dependencies..."
    
    local missing_deps=()
    
    # Check Node.js
    if ! command -v node >/dev/null 2>&1; then
        missing_deps+=("nodejs")
    else
        local node_version=$(node --version | sed 's/v//')
        local required_version="18.0.0"
        if ! version_ge "$node_version" "$required_version"; then
            missing_deps+=("nodejs-update")
        fi
    fi
    
    # Check Python
    if ! command -v python3 >/dev/null 2>&1; then
        missing_deps+=("python3")
    fi
    
    # Check FFmpeg
    if ! command -v ffmpeg >/dev/null 2>&1; then
        missing_deps+=("ffmpeg")
    fi
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_warning "Missing dependencies: ${missing_deps[*]}"
        install_dependencies "${missing_deps[@]}"
    else
        log_success "All dependencies are available"
    fi
}

# Platform-specific dependency installation
install_dependencies() {
    local deps=("$@")
    
    case $PLATFORM in
        linux)
            install_linux_dependencies "${deps[@]}"
            ;;
        macos)
            install_macos_dependencies "${deps[@]}"
            ;;
        windows)
            install_windows_dependencies "${deps[@]}"
            ;;
    esac
}

install_linux_dependencies() {
    log_info "Installing dependencies on Linux..."
    
    # Detect package manager
    if command -v apt >/dev/null 2>&1; then
        sudo apt update
        for dep in "$@"; do
            case $dep in
                nodejs) sudo apt install -y nodejs npm ;;
                python3) sudo apt install -y python3 python3-pip ;;
                ffmpeg) sudo apt install -y ffmpeg ;;
            esac
        done
    elif command -v yum >/dev/null 2>&1; then
        for dep in "$@"; do
            case $dep in
                nodejs) sudo yum install -y nodejs npm ;;
                python3) sudo yum install -y python3 python3-pip ;;
                ffmpeg) sudo yum install -y ffmpeg ;;
            esac
        done
    else
        log_error "Unsupported Linux distribution"
        exit 1
    fi
}

install_macos_dependencies() {
    log_info "Installing dependencies on macOS..."
    
    # Check if Homebrew is installed
    if ! command -v brew >/dev/null 2>&1; then
        log_info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    
    for dep in "$@"; do
        case $dep in
            nodejs) brew install node ;;
            python3) brew install python ;;
            ffmpeg) brew install ffmpeg ;;
        esac
    done
}

install_windows_dependencies() {
    log_info "Installing dependencies on Windows..."
    
    # Check if Chocolatey is installed
    if ! command -v choco >/dev/null 2>&1; then
        log_warning "Chocolatey not found. Please install dependencies manually:"
        log_warning "1. Node.js: https://nodejs.org/"
        log_warning "2. Python: https://python.org/"
        log_warning "3. FFmpeg: https://ffmpeg.org/"
        exit 1
    fi
    
    for dep in "$@"; do
        case $dep in
            nodejs) choco install nodejs -y ;;
            python3) choco install python -y ;;
            ffmpeg) choco install ffmpeg -y ;;
        esac
    done
}

# Download and install Spiralmem
install_spiralmem() {
    log_info "Installing Spiralmem..."
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$BIN_DIR"
    
    # Download release
    local download_url="$SPIRALMEM_REPO/releases/download/v$SPIRALMEM_VERSION/spiralmem-$PLATFORM-$ARCH.tar.gz"
    local temp_file="/tmp/spiralmem.tar.gz"
    
    log_info "Downloading from: $download_url"
    curl -fsSL "$download_url" -o "$temp_file"
    
    # Extract to installation directory
    tar -xzf "$temp_file" -C "$INSTALL_DIR" --strip-components=1
    rm "$temp_file"
    
    # Install Node.js dependencies
    cd "$INSTALL_DIR"
    npm ci --only=production
    
    # Install Python dependencies
    pip3 install -r requirements.txt
    
    # Create executable symlink
    ln -sf "$INSTALL_DIR/bin/spiralmem" "$BIN_DIR/spiralmem"
    
    # Add to PATH if needed
    add_to_path "$BIN_DIR"
    
    log_success "Spiralmem installed to $INSTALL_DIR"
}

# Add directory to PATH
add_to_path() {
    local bin_dir="$1"
    local shell_rc=""
    
    # Detect shell
    case $SHELL in
        */bash) shell_rc="$HOME/.bashrc" ;;
        */zsh) shell_rc="$HOME/.zshrc" ;;
        */fish) shell_rc="$HOME/.config/fish/config.fish" ;;
        *) shell_rc="$HOME/.profile" ;;
    esac
    
    # Check if already in PATH
    if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
        echo "export PATH=\"$bin_dir:\$PATH\"" >> "$shell_rc"
        log_info "Added $bin_dir to PATH in $shell_rc"
        log_warning "Please restart your shell or run: source $shell_rc"
    fi
}

# Verify installation
verify_installation() {
    log_info "Verifying installation..."
    
    # Check if spiralmem command is available
    if command -v spiralmem >/dev/null 2>&1; then
        local version=$(spiralmem --version)
        log_success "Spiralmem $version installed successfully"
    else
        log_error "Spiralmem command not found. Installation may have failed."
        return 1
    fi
    
    # Test basic functionality
    log_info "Testing basic functionality..."
    if spiralmem --help >/dev/null 2>&1; then
        log_success "Spiralmem is working correctly"
    else
        log_error "Spiralmem test failed"
        return 1
    fi
    
    # Initialize default configuration
    spiralmem init --quiet
    
    log_success "Installation completed successfully!"
    echo
    echo "Quick start:"
    echo "  spiralmem add-video /path/to/video.mp4"
    echo "  spiralmem search 'your query'"
    echo "  spiralmem --help"
}

# Utility functions
version_ge() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# Main installation flow
main() {
    echo "🎬 Spiralmem Video Memory System Installer"
    echo "=========================================="
    echo
    
    detect_platform
    check_dependencies
    install_spiralmem
    verify_installation
    
    echo
    log_success "Welcome to Spiralmem! Your local video memory system is ready."
}

# Error handling
trap 'log_error "Installation failed. Please check the error messages above."' ERR

# Run installer
main "$@"
```

### Approach 2: Platform-Specific Installers

**Linux (Debian/Ubuntu) - APT Package**:
```bash
# Add repository
curl -fsSL https://packages.spiralmem.com/gpg | sudo apt-key add -
echo "deb https://packages.spiralmem.com/apt stable main" | sudo tee /etc/apt/sources.list.d/spiralmem.list

# Install
sudo apt update
sudo apt install spiralmem
```

**macOS - Homebrew Formula**:
```bash
# Add tap
brew tap spiralmem/spiralmem

# Install
brew install spiralmem
```

**Windows - Installer Executable**:
```powershell
# Download and run installer
Invoke-WebRequest -Uri "https://releases.spiralmem.com/spiralmem-installer.exe" -OutFile "spiralmem-installer.exe"
.\spiralmem-installer.exe
```

### Approach 3: Language-Specific Package Managers

**Node.js (NPM)**:
```bash
npm install -g spiralmem
```

**Python (pip)**:
```bash
pip install spiralmem
```

**Go (go install)**:
```bash
go install github.com/spiralmem/spiralmem@latest
```

## Installer Architecture

### Component Structure

```
spiralmem-installer/
├── scripts/
│   ├── install.sh              # Universal installer
│   ├── install.ps1             # Windows PowerShell
│   └── uninstall.sh            # Removal script
├── packages/
│   ├── debian/                 # Debian/Ubuntu packages
│   ├── rpm/                    # RedHat/CentOS packages
│   ├── homebrew/               # macOS Homebrew formula
│   └── chocolatey/             # Windows Chocolatey package
├── binaries/
│   ├── linux-x64/             # Platform-specific binaries
│   ├── linux-arm64/
│   ├── macos-x64/
│   ├── macos-arm64/
│   └── windows-x64/
└── verification/
    ├── test-suite.sh           # Installation verification
    └── health-check.sh         # System health validation
```

### Pre-Installation Checks

**System Requirements Validation**:
```bash
check_system_requirements() {
    local errors=()
    
    # Check OS version
    case $PLATFORM in
        linux)
            if [[ $(lsb_release -rs | cut -d. -f1) -lt 18 ]]; then
                errors+=("Ubuntu 18.04+ or equivalent required")
            fi
            ;;
        macos)
            if [[ $(sw_vers -productVersion | cut -d. -f1) -lt 11 ]]; then
                errors+=("macOS 11.0+ required")
            fi
            ;;
        windows)
            # Check Windows version via PowerShell
            local win_version=$(powershell -Command "(Get-CimInstance Win32_OperatingSystem).Version")
            if [[ ${win_version%%.*} -lt 10 ]]; then
                errors+=("Windows 10+ required")
            fi
            ;;
    esac
    
    # Check available disk space (minimum 2GB)
    local available_space=$(df -BG "$HOME" | awk 'NR==2 {print $4}' | sed 's/G//')
    if [[ $available_space -lt 2 ]]; then
        errors+=("At least 2GB free disk space required")
    fi
    
    # Check available memory (minimum 2GB)
    local total_memory=$(free -g | awk 'NR==2 {print $2}')
    if [[ $total_memory -lt 2 ]]; then
        errors+=("At least 2GB RAM required")
    fi
    
    if [[ ${#errors[@]} -gt 0 ]]; then
        log_error "System requirements not met:"
        printf '%s\n' "${errors[@]}"
        exit 1
    fi
    
    log_success "System requirements check passed"
}
```

### Dependency Management

**Intelligent Dependency Detection**:
```bash
detect_and_install_dependencies() {
    local deps_status=()
    
    # Node.js detection and installation
    if ! check_nodejs; then
        install_nodejs
        deps_status+=("nodejs:installed")
    else
        deps_status+=("nodejs:existing")
    fi
    
    # Python detection and installation
    if ! check_python; then
        install_python
        deps_status+=("python:installed")
    else
        deps_status+=("python:existing")
    fi
    
    # FFmpeg detection and installation
    if ! check_ffmpeg; then
        install_ffmpeg
        deps_status+=("ffmpeg:installed")
    else
        deps_status+=("ffmpeg:existing")
    fi
    
    # Python packages
    install_python_packages
    deps_status+=("python-packages:installed")
    
    log_info "Dependency installation summary:"
    printf '  %s\n' "${deps_status[@]}"
}

check_nodejs() {
    if command -v node >/dev/null 2>&1; then
        local version=$(node --version | sed 's/v//')
        version_ge "$version" "18.0.0"
    else
        return 1
    fi
}

install_nodejs() {
    log_info "Installing Node.js..."
    
    case $PLATFORM in
        linux)
            # Use NodeSource repository for latest LTS
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        macos)
            if command -v brew >/dev/null 2>&1; then
                brew install node
            else
                # Download and install directly
                local node_pkg="node-v18.19.0.pkg"
                curl -fsSL "https://nodejs.org/dist/v18.19.0/$node_pkg" -o "/tmp/$node_pkg"
                sudo installer -pkg "/tmp/$node_pkg" -target /
                rm "/tmp/$node_pkg"
            fi
            ;;
        windows)
            if command -v choco >/dev/null 2>&1; then
                choco install nodejs -y
            else
                log_error "Please install Node.js manually from https://nodejs.org/"
                exit 1
            fi
            ;;
    esac
}
```

### Configuration Setup

**Automatic Configuration Generation**:
```bash
setup_configuration() {
    log_info "Setting up configuration..."
    
    local config_dir="$HOME/.config/spiralmem"
    local data_dir="$HOME/.local/share/spiralmem"
    
    # Create directories
    mkdir -p "$config_dir"
    mkdir -p "$data_dir"/{data,logs,temp}
    
    # Generate configuration file
    cat > "$config_dir/config.yaml" <<EOF
# Spiralmem Configuration
# Generated by installer on $(date)

database:
  path: "$data_dir/data/spiralmem.db"
  backup:
    enabled: true
    interval: "24h"

video:
  processing:
    tempDirectory: "$data_dir/temp"
    maxFileSize: "5GB"
  transcription:
    model: "base"
    language: "auto"

logging:
  level: "info"
  file: "$data_dir/logs/spiralmem.log"
  maxSize: "10MB"
  maxFiles: 5

performance:
  processing:
    maxConcurrentJobs: 2
    jobTimeout: 300000
EOF
    
    # Set appropriate permissions
    chmod 600 "$config_dir/config.yaml"
    chmod 700 "$config_dir" "$data_dir"
    
    log_success "Configuration created at $config_dir/config.yaml"
}
```

### Installation Verification

**Comprehensive Testing**:
```bash
verify_installation() {
    log_info "Verifying installation..."
    
    local test_results=()
    
    # Test 1: Command availability
    if command -v spiralmem >/dev/null 2>&1; then
        test_results+=("command:PASS")
    else
        test_results+=("command:FAIL")
        return 1
    fi
    
    # Test 2: Version check
    local version=$(spiralmem --version 2>/dev/null)
    if [[ $? -eq 0 ]] && [[ -n "$version" ]]; then
        test_results+=("version:PASS($version)")
    else
        test_results+=("version:FAIL")
    fi
    
    # Test 3: Configuration validation
    if spiralmem config validate >/dev/null 2>&1; then
        test_results+=("config:PASS")
    else
        test_results+=("config:FAIL")
    fi
    
    # Test 4: Database initialization
    if spiralmem init --test-mode >/dev/null 2>&1; then
        test_results+=("database:PASS")
    else
        test_results+=("database:FAIL")
    fi
    
    # Test 5: Dependencies check
    if spiralmem system check >/dev/null 2>&1; then
        test_results+=("dependencies:PASS")
    else
        test_results+=("dependencies:FAIL")
    fi
    
    # Report results
    log_info "Installation verification results:"
    local all_passed=true
    for result in "${test_results[@]}"; do
        local test_name=${result%%:*}
        local test_status=${result##*:}
        
        if [[ $test_status == PASS* ]]; then
            log_success "  $test_name: $test_status"
        else
            log_error "  $test_name: $test_status"
            all_passed=false
        fi
    done
    
    if $all_passed; then
        log_success "All verification tests passed!"
        return 0
    else
        log_error "Some verification tests failed"
        return 1
    fi
}
```

## Error Handling & Recovery

### Rollback Mechanism

**Clean Uninstallation**:
```bash
rollback_installation() {
    log_warning "Rolling back installation..."
    
    # Remove binary
    rm -f "$BIN_DIR/spiralmem"
    
    # Remove installation directory
    rm -rf "$INSTALL_DIR"
    
    # Remove configuration (with user confirmation)
    read -p "Remove configuration and data? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$HOME/.config/spiralmem"
        rm -rf "$HOME/.local/share/spiralmem"
    fi
    
    # Remove from PATH
    remove_from_path "$BIN_DIR"
    
    log_info "Rollback completed"
}
```

### Error Recovery Strategies

**Common Issue Resolution**:
```bash
diagnose_and_fix() {
    local issue="$1"
    
    case $issue in
        "permission_denied")
            log_info "Fixing permission issues..."
            sudo chown -R $USER:$USER "$INSTALL_DIR"
            chmod +x "$INSTALL_DIR/bin/spiralmem"
            ;;
        "missing_dependencies")
            log_info "Reinstalling dependencies..."
            install_dependencies
            ;;
        "corrupt_download")
            log_info "Re-downloading installation files..."
            rm -f "/tmp/spiralmem.tar.gz"
            install_spiralmem
            ;;
        "config_error")
            log_info "Regenerating configuration..."
            setup_configuration
            ;;
    esac
}
```

## Advanced Installation Options

### Silent Installation

**Unattended Installation**:
```bash
# Silent install with all defaults
curl -fsSL https://install.spiralmem.com | sh -s -- --silent

# Silent install with custom options
curl -fsSL https://install.spiralmem.com | sh -s -- \
  --silent \
  --install-dir="/opt/spiralmem" \
  --no-path-modification
```

### Enterprise Installation

**Multi-User System Installation**:
```bash
# System-wide installation
sudo curl -fsSL https://install.spiralmem.com | sh -s -- \
  --system-wide \
  --install-dir="/opt/spiralmem" \
  --config-dir="/etc/spiralmem"
```

### Development Installation

**Developer Setup**:
```bash
# Development installation with source
curl -fsSL https://install.spiralmem.com | sh -s -- \
  --dev \
  --source \
  --enable-debug
```

## Packaging & Distribution

### Release Packaging

**Build Pipeline**:
```yaml
# .github/workflows/build-release.yml
name: Build Release Packages

on:
  release:
    types: [published]

jobs:
  build-binaries:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        arch: [x64, arm64]
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build binary
        run: npm run build:binary
      
      - name: Package binary
        run: npm run package:${{ matrix.os }}-${{ matrix.arch }}
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: spiralmem-${{ matrix.os }}-${{ matrix.arch }}
          path: dist/
  
  build-packages:
    needs: build-binaries
    runs-on: ubuntu-latest
    
    steps:
      - name: Build Debian package
        run: scripts/build-deb.sh
      
      - name: Build RPM package
        run: scripts/build-rpm.sh
      
      - name: Build Homebrew formula
        run: scripts/build-homebrew.sh
```

### Update Mechanism

**Automatic Updates**:
```bash
spiralmem_update() {
    local current_version=$(spiralmem --version | cut -d' ' -f2)
    local latest_version=$(curl -s https://api.github.com/repos/spiralmem/spiralmem/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
    
    if version_gt "$latest_version" "$current_version"; then
        log_info "Update available: $current_version → $latest_version"
        read -p "Update now? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            curl -fsSL https://install.spiralmem.com | sh -s -- --upgrade
        fi
    else
        log_success "Spiralmem is up to date ($current_version)"
    fi
}
```

## Conclusion

The one-step installer design ensures that users can quickly and reliably install Spiralmem regardless of their technical expertise or platform. Key features:

**✅ User-Friendly**: Single command installation  
**✅ Cross-Platform**: Works on Linux, macOS, Windows  
**✅ Dependency Management**: Handles all requirements automatically  
**✅ Error Recovery**: Robust error handling and rollback  
**✅ Verification**: Tests installation completeness  
**✅ Maintenance**: Update and uninstall capabilities

**Next Implementation Steps**:
1. Create universal installer script
2. Build platform-specific packages
3. Set up distribution infrastructure
4. Test across all target platforms
5. Create documentation and support resources