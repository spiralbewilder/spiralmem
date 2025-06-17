#!/bin/bash
# Test installation script for Spiralmem
# Verifies that all components are working correctly

set -e

echo "🧪 Testing Spiralmem Installation"
echo "================================="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0

# Test functions
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -n "Testing $test_name... "
    
    if eval "$test_command" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ PASS${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}❌ FAIL${NC}"
        echo "  Command: $test_command"
    fi
}

run_test_with_output() {
    local test_name="$1"
    local test_command="$2"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    echo "Testing $test_name..."
    
    if output=$(eval "$test_command" 2>&1); then
        echo -e "${GREEN}✅ PASS${NC}"
        echo "  Output: $output"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}❌ FAIL${NC}"
        echo "  Command: $test_command"
        echo "  Error: $output"
    fi
    echo
}

echo "🔍 Testing System Dependencies"
echo "------------------------------"

# Test Node.js
run_test "Node.js installation" "node --version"

# Test Node.js version
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version | sed 's/v//')
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d. -f1)
    if [ "$MAJOR_VERSION" -ge 18 ]; then
        echo -e "Node.js version: ${GREEN}$NODE_VERSION (✅ Compatible)${NC}"
    else
        echo -e "Node.js version: ${RED}$NODE_VERSION (❌ Requires 18+)${NC}"
    fi
fi

# Test Python
run_test "Python installation" "python3 --version"

# Test pip
run_test "pip installation" "pip3 --version"

# Test FFmpeg
run_test "FFmpeg installation" "ffmpeg -version"

# Test faster_whisper
run_test "faster_whisper package" "python3 -c 'import faster_whisper'"

echo
echo "🏗️  Testing Spiralmem Build"
echo "---------------------------"

# Test npm dependencies
run_test "NPM dependencies" "npm list --depth=0"

# Test TypeScript compilation
run_test "TypeScript build" "npm run build"

# Test CLI availability
if [ -f "bin/spiralmem" ]; then
    run_test "CLI executable exists" "test -x bin/spiralmem"
else
    run_test "CLI script via npm" "npm run cli -- --help"
fi

echo
echo "🎬 Testing Spiralmem Functionality"
echo "-----------------------------------"

# Test system check
run_test_with_output "System health check" "npm run cli -- check"

# Test initialization
run_test_with_output "System initialization" "npm run cli -- init"

# Test configuration validation
run_test_with_output "Configuration validation" "npm run cli -- config --validate"

# Test stats (should work after init)
run_test "System statistics" "npm run cli -- stats --json"

# Test space creation
run_test "Space creation" "npm run cli -- create-space test-space --description 'Test space'"

# Test space listing
run_test_with_output "Space listing" "npm run cli -- spaces"

echo
echo "📊 Test Results"
echo "==============="
echo -e "Tests run: ${BLUE}$TESTS_RUN${NC}"
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$((TESTS_RUN - TESTS_PASSED))${NC}"

if [ $TESTS_PASSED -eq $TESTS_RUN ]; then
    echo
    echo -e "${GREEN}🎉 All tests passed! Spiralmem is ready to use.${NC}"
    echo
    echo "Quick start:"
    echo "  npm run cli -- add-video /path/to/video.mp4"
    echo "  npm run cli -- search 'your query'"
    echo "  npm run cli -- serve-mcp"
    exit 0
else
    echo
    echo -e "${RED}❌ Some tests failed. Please check the errors above.${NC}"
    exit 1
fi