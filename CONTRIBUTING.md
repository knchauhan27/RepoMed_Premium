# Contributing to RepoMed

Thank you for your interest in contributing to RepoMed! This document outlines our contribution guidelines and development process.

## 📋 Code of Conduct

Please be respectful and constructive in all interactions. We're committed to making RepoMed an inclusive and welcoming community for all contributors.

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ or Deno 1.40+
- Git
- A Supabase account (for testing backend changes)
- A Razorpay sandbox account (for payment testing)

### Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/pyqrepo2.git
   cd pyqrepo2
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your test credentials
   ```

## 📝 Development Guidelines

### Code Style

- **JavaScript/TypeScript**: Use ES6+ syntax
  - Use const/let (never var)
  - Use arrow functions where appropriate
  - Use template literals for strings
  - Add JSDoc comments to functions

- **Example**:
  ```javascript
  /**
   * Fetch user data from API
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User object
   */
  async function getUser(userId) {
    const response = await fetch(`/api/users/${userId}`);
    return response.json();
  }
  ```

### File Organization

```
├── /supabase/functions/
│   ├── _shared/           # Shared utilities and middleware
│   ├── endpoint-name/     # One function per folder
│   │   └── index.ts       # Function implementation
│   └── ...
├── /*.html                # Frontend pages
├── /*.js                  # Frontend logic
├── /*.css                 # Frontend styles
└── /tests                 # Test files
```

### Commit Messages

Use clear, descriptive commit messages following this format:

```
<type>: <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `docs`: Documentation
- `test`: Test additions/modifications
- `perf`: Performance improvements
- `security`: Security fixes
- `chore`: Maintenance tasks

**Example**:
```
feat: add referral discount validation

- Implement referral code validation in checkout
- Add discount calculation logic
- Update payment order creation flow

Closes #123
```

## 🐛 Bug Reports

When reporting bugs, include:

1. **Description**: Clear, concise description of the issue
2. **Steps to Reproduce**: Exact steps to reproduce the bug
3. **Expected Behavior**: What should happen
4. **Actual Behavior**: What actually happens
5. **Environment**: Browser/OS/versions
6. **Screenshots/Logs**: Relevant error messages or screenshots

**Example Issue Template**:
```markdown
# Payment Verification Failing

## Description
Payment verification fails with 500 error after successful Razorpay payment.

## Steps to Reproduce
1. Click "Proceed to payment" in checkout
2. Complete payment in Razorpay modal
3. Verify payment with valid signature

## Expected Behavior
Premium access should be activated

## Actual Behavior
Error: "Unable to verify payment"

## Environment
- Browser: Chrome 120
- OS: macOS 14.1
- App Version: v1.0

## Error Log
```
POST /functions/v1/verify-razorpay-payment 500
Error: Connection timeout
```
```

## ✨ Feature Requests

Suggest features by opening an issue with:

1. **Use Case**: Why this feature is needed
2. **Proposed Solution**: How to implement it
3. **Alternatives**: Other approaches considered
4. **Additional Context**: Any other relevant information

## 🔄 Pull Request Process

1. **Update Documentation**: Modify README.md, API_DOCS.md, or other docs as needed
2. **Add Tests**: Include tests for new functionality
3. **Run Tests**: Ensure all tests pass locally
4. **Keep PR Focused**: One feature/fix per PR
5. **Write Clear Description**: Explain changes and link related issues

**Pull Request Template**:
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Fixes #123

## Changes Made
- Change 1
- Change 2

## Testing Done
- Test 1
- Test 2

## Screenshots (if applicable)
[Add screenshots]

## Checklist
- [ ] Code follows project style
- [ ] Self-review completed
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No console errors/warnings
```

## 🧪 Testing

### Frontend Testing

```bash
# No automated tests currently - manual testing required
# Test coverage needed:
# - Authentication flows
# - Payment checkout
# - Question filtering and export
# - Responsive design
```

### Backend Testing

```bash
# Run existing tests
node tests/question-access.test.mjs
node tests/razorpay-payment.test.mjs

# Add new tests
# Place in /tests directory with .test.mjs extension
```

### Test Guidelines

- Test edge cases and error scenarios
- Use descriptive test names
- Mock external APIs
- Ensure tests are deterministic

## 📚 Documentation

### Updating Docs

- **README.md**: General project information and setup
- **API_DOCS.md**: API endpoint documentation
- **SUPABASE_SETUP.md**: Authentication and Supabase setup
- **.env.example**: Environment variables
- **Code Comments**: Inline comments explaining complex logic

### Doc Standards

- Use clear, concise language
- Include code examples where helpful
- Keep docs up-to-date with code changes
- Use markdown formatting consistently

## 🔒 Security Considerations

### When Contributing

1. **Never commit credentials**: Secrets stay in .env files
2. **Validate inputs**: Always validate user inputs
3. **Sanitize outputs**: Prevent XSS attacks
4. **Use HTTPS**: All external requests should use HTTPS
5. **Check dependencies**: Review dependencies for vulnerabilities

### Security Best Practices

- Use parameterized queries
- Implement rate limiting
- Add CORS headers properly
- Validate JWTs on backend
- Hash sensitive data
- Use secure random generators

## 📦 Dependencies

### Adding Dependencies

1. Evaluate necessity
2. Check for security vulnerabilities
3. Verify active maintenance
4. Document the reason for adding

### Removing Dependencies

- Reduce bundle size
- Minimize security surface
- Remove unused packages regularly

## 🎯 Areas for Contribution

### High Priority

- [ ] Implement error notification UI (replace alerts)
- [ ] Add loading states to async operations
- [ ] Create proper error boundaries
- [ ] Add TypeScript support to frontend
- [ ] Implement rate limiting on backend

### Medium Priority

- [ ] Add unit test suite
- [ ] Improve accessibility (a11y)
- [ ] Add dark mode support
- [ ] Create admin dashboard
- [ ] Implement analytics

### Low Priority

- [ ] Performance optimizations
- [ ] UI/UX improvements
- [ ] Internationalization (i18n)
- [ ] Additional export formats

## 📞 Questions?

- **GitHub Issues**: Ask questions in GitHub discussions
- **Email**: Contact maintainers for sensitive topics
- **Documentation**: Check docs and existing issues first

## 🎉 Recognition

Contributors will be:
- Added to contributors list in README
- Credited in release notes
- Recognized for significant contributions

## Legal

By contributing, you agree that your contributions will be licensed under the project's license (Proprietary).

---

**Thank you for contributing to RepoMed!** 🚀

We appreciate your help in making this a better platform for medical students.
