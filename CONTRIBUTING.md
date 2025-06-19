# Contributing to Spiralmem

Thank you for your interest in contributing to Spiralmem! This guide will help you get started.

## Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Install dependencies**: `npm install`
4. **Run tests**: `npm test`
5. **Make your changes**
6. **Test thoroughly**
7. **Submit a pull request**

## Development Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/spiralmem.git
cd spiralmem

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Check code style
npm run lint
```

## Project Structure

```
src/
├── cli/           # Command-line interface
├── core/          # Core video processing logic
├── database/      # Database models and repositories
├── utils/         # Utility functions
└── mcp/           # MCP server integration
```

## Making Changes

### Code Style
- Use TypeScript
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Keep functions focused and small

### Testing
- Add tests for new features
- Ensure all tests pass: `npm test`
- Test on multiple platforms if possible

### Documentation
- Update README.md if needed
- Add JSDoc comments
- Update CHANGELOG.md

## Pull Request Process

1. **Create feature branch**: `git checkout -b feature/your-feature`
2. **Make changes** with clear, atomic commits
3. **Write/update tests** for your changes
4. **Update documentation** as needed
5. **Run full test suite**: `npm test`
6. **Submit pull request** with clear description

### Pull Request Guidelines

- **Clear title**: Describe what your PR does
- **Detailed description**: Explain the problem and solution
- **Reference issues**: Link to related GitHub issues
- **Test results**: Confirm all tests pass
- **Breaking changes**: Clearly document any breaking changes

## Reporting Issues

When reporting bugs:

1. **Check existing issues** first
2. **Use issue templates** when available
3. **Provide clear reproduction steps**
4. **Include system information** (OS, Node.js version, etc.)
5. **Add relevant logs** if applicable

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Follow GitHub's community guidelines

## Getting Help

- **Questions**: Open a GitHub discussion
- **Bugs**: Create a GitHub issue
- **Features**: Open a feature request issue
- **Security**: Email security issues privately

Thank you for contributing to Spiralmem!