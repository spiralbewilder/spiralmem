#!/bin/bash
# Spiralmem Universal Installer
# Cross-platform installation script for Spiralmem Video Memory System

set -e  # Exit on any error

# Configuration
SPIRALMEM_VERSION="${SPIRALMEM_VERSION:-1.0.0}"
SPIRALMEM_REPO="${SPIRALMEM_REPO:-https://github.com/spiralbewilder/spiralmem-local}"
INSTALL_DIR="${SPIRALMEM_INSTALL_DIR:-$HOME/.spiralmem}"
BIN_DIR="${SPIRALMEM_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${SPIRALMEM_CONFIG_DIR:-$HOME/.config/spiralmem}"
DATA_DIR="${SPIRALMEM_DATA_DIR:-$HOME/.local/share/spiralmem}"

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

# Installation flags
SILENT_MODE=false
SYSTEM_WIDE=false
DEV_MODE=false
SKIP_DEPS=false
FORCE_INSTALL=false

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --silent)
                SILENT_MODE=true
                shift
                ;;
            --system-wide)
                SYSTEM_WIDE=true
                INSTALL_DIR="/opt/spiralmem"
                BIN_DIR="/usr/local/bin"
                CONFIG_DIR="/etc/spiralmem"
                DATA_DIR="/var/lib/spiralmem"
                shift
                ;;
            --dev)
                DEV_MODE=true
                shift
                ;;
            --skip-deps)
                SKIP_DEPS=true
                shift
                ;;
            --force)
                FORCE_INSTALL=true
                shift
                ;;
            --install-dir=*)
                INSTALL_DIR="${1#*=}"
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Show help message
show_help() {
    cat << EOF
Spiralmem Universal Installer

Usage: $0 [OPTIONS]

OPTIONS:
    --silent            Run in silent mode (no prompts)
    --system-wide       Install system-wide (requires sudo)
    --dev              Development installation with source
    --skip-deps        Skip dependency installation
    --force            Force installation even if already installed
    --install-dir=DIR  Custom installation directory
    --help             Show this help message

EXAMPLES:
    # Standard installation
    curl -fsSL https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.sh | sh

    # Silent installation
    curl -fsSL https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.sh | sh -s -- --silent

    # System-wide installation
    curl -fsSL https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.sh | sudo sh -s -- --system-wide

    # Development installation
    curl -fsSL https://raw.githubusercontent.com/spiralbewilder/spiralmem/master/install.sh | sh -s -- --dev

EOF
}

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

# Version comparison function
version_ge() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# System requirements check
check_system_requirements() {
    log_info "Checking system requirements..."
    
    local errors=()
    
    # Check OS version
    case $PLATFORM in
        linux)
            if command_exists lsb_release; then
                local version=$(lsb_release -rs | cut -d. -f1)
                if [[ $version -lt 18 ]]; then
                    errors+=("Ubuntu 18.04+ or equivalent required")
                fi
            fi
            ;;
        macos)
            local version=$(sw_vers -productVersion | cut -d. -f1)
            if [[ $version -lt 11 ]]; then
                errors+=("macOS 11.0+ required")
            fi
            ;;
        windows)
            # Basic Windows check - most WSL environments will work
            if [[ ! -f /proc/version ]] || ! grep -q Microsoft /proc/version; then
                log_warning "Windows detected - WSL environment recommended"
            fi
            ;;
    esac
    
    # Check available disk space (minimum 2GB)
    local available_space=$(df -BG "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//' || echo "999")
    if [[ $available_space -lt 2 ]]; then
        errors+=("At least 2GB free disk space required")
    fi
    
    # Check available memory (minimum 1GB)
    if command_exists free; then
        local total_memory=$(free -g | awk 'NR==2 {print $2}')
        if [[ $total_memory -lt 1 ]]; then
            errors+=("At least 1GB RAM recommended")
        fi
    fi
    
    if [[ ${#errors[@]} -gt 0 ]]; then
        log_error "System requirements not met:"
        printf '%s\n' "${errors[@]}"
        if [[ $FORCE_INSTALL != true ]]; then
            exit 1
        else
            log_warning "Continuing installation despite requirements (--force specified)"
        fi
    fi
    
    log_success "System requirements check passed"
}

# Dependency checking
check_dependencies() {
    if [[ $SKIP_DEPS == true ]]; then
        log_info "Skipping dependency check (--skip-deps specified)"
        return 0
    fi
    
    log_info "Checking system dependencies..."
    
    local missing_deps=()
    
    # Check Node.js
    if ! command_exists node; then
        missing_deps+=("nodejs")
    else
        local node_version=$(node --version | sed 's/v//')
        if ! version_ge "$node_version" "18.0.0"; then
            missing_deps+=("nodejs-update")
        fi
    fi
    
    # Check Python
    if ! command_exists python3; then
        missing_deps+=("python3")
    fi
    
    # Check pip
    if ! command_exists pip3; then
        missing_deps+=("python3-pip")
    fi
    
    # Check FFmpeg
    if ! command_exists ffmpeg; then
        missing_deps+=("ffmpeg")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_warning "Missing dependencies: ${missing_deps[*]}"
        
        if [[ $SILENT_MODE == false ]]; then
            echo
            read -p "Install missing dependencies? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_error "Dependencies required for installation. Exiting."
                exit 1
            fi
        fi
        
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

# Linux dependency installation
install_linux_dependencies() {
    log_info "Installing dependencies on Linux..."
    
    # Detect package manager
    if command_exists apt; then
        sudo apt update
        for dep in "$@"; do
            case $dep in
                nodejs) sudo apt install -y nodejs npm ;;
                nodejs-update) 
                    # Install latest Node.js from NodeSource
                    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                    ;;
                python3) sudo apt install -y python3 ;;
                python3-pip) sudo apt install -y python3-pip ;;
                ffmpeg) sudo apt install -y ffmpeg ;;
            esac
        done
    elif command_exists yum; then
        for dep in "$@"; do
            case $dep in
                nodejs) sudo yum install -y nodejs npm ;;
                nodejs-update)
                    # Install latest Node.js
                    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
                    sudo yum install -y nodejs
                    ;;
                python3) sudo yum install -y python3 ;;
                python3-pip) sudo yum install -y python3-pip ;;
                ffmpeg) sudo yum install -y ffmpeg ;;
            esac
        done
    elif command_exists dnf; then
        for dep in "$@"; do
            case $dep in
                nodejs) sudo dnf install -y nodejs npm ;;
                nodejs-update)
                    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
                    sudo dnf install -y nodejs
                    ;;
                python3) sudo dnf install -y python3 ;;
                python3-pip) sudo dnf install -y python3-pip ;;
                ffmpeg) sudo dnf install -y ffmpeg ;;
            esac
        done
    else
        log_error "Unsupported Linux distribution"
        log_error "Please install manually: nodejs, python3, python3-pip, ffmpeg"
        exit 1
    fi
}

# macOS dependency installation
install_macos_dependencies() {
    log_info "Installing dependencies on macOS..."
    
    # Check if Homebrew is installed
    if ! command_exists brew; then
        log_info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        # Add Homebrew to PATH for current session
        if [[ -f /opt/homebrew/bin/brew ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [[ -f /usr/local/bin/brew ]]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    fi
    
    for dep in "$@"; do
        case $dep in
            nodejs|nodejs-update) brew install node ;;
            python3) brew install python ;;
            python3-pip) 
                # pip comes with Python on macOS via Homebrew
                log_info "pip3 comes with Python installation"
                ;;
            ffmpeg) brew install ffmpeg ;;
        esac
    done
}

# Windows dependency installation
install_windows_dependencies() {
    log_info "Installing dependencies on Windows..."
    
    # Check if Chocolatey is installed
    if ! command_exists choco; then
        log_error "Chocolatey not found. Please install dependencies manually:"
        log_error "1. Node.js: https://nodejs.org/"
        log_error "2. Python: https://python.org/"
        log_error "3. FFmpeg: https://ffmpeg.org/"
        log_error "Or install Chocolatey: https://chocolatey.org/install"
        exit 1
    fi
    
    for dep in "$@"; do
        case $dep in
            nodejs|nodejs-update) choco install nodejs -y ;;
            python3) choco install python -y ;;
            python3-pip)
                # pip comes with Python on Windows
                log_info "pip comes with Python installation"
                ;;
            ffmpeg) choco install ffmpeg -y ;;
        esac
    done
}

# Install Python packages
install_python_packages() {
    log_info "Installing Python packages..."
    
    # Install faster_whisper
    if ! python3 -c "import faster_whisper" 2>/dev/null; then
        log_info "Installing faster_whisper..."
        pip3 install faster_whisper
    else
        log_info "faster_whisper already installed"
    fi
}

# Download and install Spiralmem
install_spiralmem() {
    log_info "Installing Spiralmem..."
    
    # Create installation directories
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$BIN_DIR"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$DATA_DIR"/{data,logs,temp}
    
    if [[ $DEV_MODE == true ]]; then
        install_spiralmem_dev
    else
        install_spiralmem_release
    fi
}

# Development installation (clone source)
install_spiralmem_dev() {
    log_info "Installing Spiralmem in development mode..."
    
    # Clone repository
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "Updating existing repository..."
        cd "$INSTALL_DIR"
        git pull
    else
        log_info "Cloning repository..."
        git clone "$SPIRALMEM_REPO" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    
    # Install Node.js dependencies
    log_info "Installing Node.js dependencies..."
    npm install
    
    # Build project
    log_info "Building project..."
    npm run build
    
    # Install Python dependencies
    install_python_packages
    
    # Create executable script
    create_executable_script
}

# Release installation (download prebuilt)
install_spiralmem_release() {
    log_info "Installing Spiralmem from GitHub source..."
    
    # Clone from GitHub since we don't have packaged releases yet
    log_info "Installing from source (recommended for latest features)"
    install_spiralmem_dev
}

# Create executable script
create_executable_script() {
    log_info "Creating executable script..."
    
    cat > "$BIN_DIR/spiralmem" << EOF
#!/bin/bash
# Spiralmem executable wrapper

# Set environment variables
export SPIRALMEM_INSTALL_DIR="$INSTALL_DIR"
export SPIRALMEM_CONFIG_DIR="$CONFIG_DIR"
export SPIRALMEM_DATA_DIR="$DATA_DIR"

# Change to installation directory
cd "$INSTALL_DIR"

# Execute with Node.js
exec node dist/cli/spiralmem.js "\$@"
EOF
    
    chmod +x "$BIN_DIR/spiralmem"
    
    log_success "Executable created at $BIN_DIR/spiralmem"
}

# Add directory to PATH
add_to_path() {
    local bin_dir="$1"
    local shell_rc=""
    
    # Detect shell
    case $SHELL in
        */bash) shell_rc="$HOME/.bashrc" ;;
        */zsh) shell_rc="$HOME/.zshrc" ;;
        */fish) 
            shell_rc="$HOME/.config/fish/config.fish"
            # Fish uses different syntax
            if [[ ! -f "$shell_rc" ]] || ! grep -q "set -gx PATH.*$bin_dir" "$shell_rc"; then
                mkdir -p "$(dirname "$shell_rc")"
                echo "set -gx PATH $bin_dir \$PATH" >> "$shell_rc"
                log_info "Added $bin_dir to PATH in $shell_rc"
            fi
            return
            ;;
        *) shell_rc="$HOME/.profile" ;;
    esac
    
    # Check if already in PATH
    if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
        echo "export PATH=\"$bin_dir:\$PATH\"" >> "$shell_rc"
        log_info "Added $bin_dir to PATH in $shell_rc"
        log_warning "Please restart your shell or run: source $shell_rc"
    fi
}

# Setup configuration
setup_configuration() {
    log_info "Setting up configuration..."
    
    local config_file="$CONFIG_DIR/config.yaml"
    
    if [[ ! -f "$config_file" ]] || [[ $FORCE_INSTALL == true ]]; then
        cat > "$config_file" << EOF
# Spiralmem Configuration
# Generated by installer on $(date)

database:
  path: "$DATA_DIR/data/spiralmem.db"
  backup:
    enabled: true
    interval: "24h"

video:
  processing:
    tempDirectory: "$DATA_DIR/temp"
    maxFileSize: "5GB"
  transcription:
    model: "base"
    language: "auto"

logging:
  level: "info"
  file: "$DATA_DIR/logs/spiralmem.log"
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
EOF
        
        # Set appropriate permissions
        chmod 600 "$config_file"
        
        log_success "Configuration created at $config_file"
    else
        log_info "Configuration already exists at $config_file"
    fi
    
    # Set directory permissions
    chmod 700 "$CONFIG_DIR" "$DATA_DIR"
}

# Verify installation
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
    local version=$(spiralmem --version 2>/dev/null || echo "")
    if [[ -n "$version" ]]; then
        test_results+=("version:PASS($version)")
    else
        test_results+=("version:FAIL")
    fi
    
    # Test 3: Configuration validation
    if [[ -f "$CONFIG_DIR/config.yaml" ]]; then
        test_results+=("config:PASS")
    else
        test_results+=("config:FAIL")
    fi
    
    # Test 4: Dependencies check
    local deps_ok=true
    for cmd in node python3 ffmpeg; do
        if ! command_exists "$cmd"; then
            deps_ok=false
            break
        fi
    done
    
    if $deps_ok; then
        test_results+=("dependencies:PASS")
    else
        test_results+=("dependencies:FAIL")
    fi
    
    # Test 5: Python packages
    if python3 -c "import faster_whisper" 2>/dev/null; then
        test_results+=("python-packages:PASS")
    else
        test_results+=("python-packages:FAIL")
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

# Main installation flow
main() {
    echo "🎬 Spiralmem Video Memory System Installer"
    echo "=========================================="
    echo
    
    parse_args "$@"
    
    if [[ $SILENT_MODE == false ]]; then
        echo "This installer will:"
        echo "  • Install system dependencies (Node.js, Python, FFmpeg)"
        echo "  • Install Spiralmem video memory system"
        echo "  • Set up configuration and data directories"
        echo "  • Create command-line tools"
        echo
        
        if [[ $SYSTEM_WIDE == true ]]; then
            echo "⚠️  System-wide installation requires sudo privileges"
            echo
        fi
        
        read -p "Continue with installation? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Installation cancelled by user"
            exit 0
        fi
        echo
    fi
    
    detect_platform
    check_system_requirements
    check_dependencies
    install_spiralmem
    setup_configuration
    add_to_path "$BIN_DIR"
    
    if verify_installation; then
        echo
        log_success "🎉 Spiralmem installation completed successfully!"
        echo
        echo "Quick start:"
        echo "  spiralmem --help                    # Show available commands"
        echo "  spiralmem add-video video.mp4       # Process a video file"
        echo "  spiralmem search 'your query'       # Search your content"
        echo "  spiralmem serve-mcp                 # Start MCP server for AI assistants"
        echo
        echo "Configuration: $CONFIG_DIR/config.yaml"
        echo "Data directory: $DATA_DIR"
        echo
        if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
            echo "⚠️  Please restart your shell or run: source ~/.bashrc"
        fi
    else
        echo
        log_error "Installation completed with errors. Please check the output above."
        exit 1
    fi
}

# Error handling
trap 'log_error "Installation failed. Please check the error messages above."' ERR

# Run installer
main "$@"