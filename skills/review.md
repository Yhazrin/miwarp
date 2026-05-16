---
name: review
description: Complete a review of the pending changes on the current branch
category: code-review
icon: 🔍
trigger:
  - review
  - code review
  - pr
  - pull request
---

# Pull Request Review

Review the pending changes on the current branch and provide actionable feedback.

## Review Scope

- **Branch**: Current working branch
- **Working Directory**: {{cwd}}
- **Target**: Main/master branch comparison

## Review Areas

### 1. Security Review
Check for:
- SQL injection vulnerabilities
- XSS attack vectors
- CSRF vulnerabilities
- Insecure deserialization
- Hardcoded secrets or credentials
- Insecure dependency usage

### 2. Performance Review
Check for:
- N+1 query problems
- Memory leaks
- Unbounded loops
- Missing indexes
- Inefficient algorithms
- Large data handling

### 3. Code Quality
Check for:
- Code style violations
- Missing error handling
- Incomplete type coverage
- Lack of documentation
- Unused code/dead code
- Complex functions that need refactoring

### 4. Best Practices
Check for:
- Proper error boundaries
- Input validation
- Logging and monitoring
- Testing coverage
- API design consistency
- Error message quality

## Output Format

### Summary
Brief overview of what changed and overall health.

### Critical Issues (if any)
Issues that need immediate attention:
```
[SEVERITY] File:Line - Issue description
```

### Recommendations
Actionable suggestions for improvement.

### Risks
Potential concerns that don't block but should be addressed.

### Praise (if any)
Positive patterns worth noting.

---

## Review Process

### Phase 1 — Scan
1. List all changed files
2. Identify file types and languages
3. Note the scope of changes

### Phase 2 — Analyze
1. Run automated checks (lint, type-check, tests)
2. Review each file manually
3. Document findings

### Phase 3 — Report
1. Group issues by severity
2. Provide specific file:line references
3. Suggest concrete fixes

---

## Ground Rules

- **Be specific**: Reference exact lines and files
- **Be constructive**: Offer solutions, not just criticism
- **Be proportionate**: Consider context and trade-offs
- **Be actionable**: Every issue should have a suggested fix

---

## Examples

**Output Example:**
```
## Review Summary

**Files changed**: 12
**Lines added**: 450
**Lines removed**: 120
**Health**: ⚠️ Needs attention

### Critical Issues

- [HIGH] `src/api/users.ts:45` - SQL injection via unsanitized input
- [HIGH] `src/utils/auth.ts:78` - Hardcoded API key in source

### Recommendations

1. Use parameterized queries in `src/api/users.ts`
2. Move secrets to environment variables
3. Add input validation middleware

### Risks

- No rate limiting on auth endpoints
- Missing request timeout configuration

### Praise

- Good test coverage on core functions
- Consistent error handling patterns
```

---

**Run this skill on your current branch to see the review results.**