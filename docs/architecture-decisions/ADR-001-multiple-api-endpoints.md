# ADR-001: Multiple API Endpoints for Mark Homework

## Status
Accepted

## Context
We need to handle different scenarios for homework processing:
1. **Initial image upload** (new session creation)
2. **Follow-up text messages** (existing session updates)
3. **Admin bulk uploads** (no AI processing)
4. **Unified processing** (external integrations)
5. **Test scenarios** (validation and testing)

Each scenario has different:
- Input validation requirements
- Error handling strategies
- Response formats
- Authentication requirements
- Business logic

## Decision
Use separate, specialized endpoints instead of one complex endpoint:

### Primary Endpoints (High Usage)
- **`/api/mark-homework/process-single`** - Initial image uploads and AI processing
  - **Used by**: Frontend main workflow (simpleSessionService.js:263)
  - **Purpose**: Create new session with AI response
  - **Frequency**: High (primary user interaction)

- **`/api/mark-homework/process`** - Follow-up messages in existing sessions
  - **Used by**: Frontend chat input (simpleSessionService.js:423)
  - **Purpose**: Add messages to existing session
  - **Frequency**: Medium (follow-up interactions)

### Secondary Endpoints (Specialized Use Cases)
- **`/api/mark-homework/upload`** - Admin and test uploads
  - **Used by**: Admin panel, test files
  - **Purpose**: Upload images without AI processing
  - **Frequency**: Low (admin/test use cases)

- **`/api/process`** - Unified processing
  - **Used by**: External integrations
  - **Purpose**: Generic image processing
  - **Frequency**: Low (external use)

## Consequences

### Positive
- ✅ **Clear separation of concerns** - Each endpoint has a single responsibility
- ✅ **Easier to maintain and debug** - Issues are isolated to specific endpoints
- ✅ **Different error handling** - Each endpoint can handle errors appropriately
- ✅ **Optimized for use case** - Each endpoint is tailored for its specific scenario
- ✅ **Better testing** - Each endpoint can be tested independently
- ✅ **Easier to monitor** - Usage patterns are clear per endpoint

### Negative
- ❌ **More endpoints to document** - Increased documentation overhead
- ❌ **Potential code duplication** - Similar logic across endpoints
- ❌ **More complex routing** - Multiple routes to manage
- ❌ **Higher maintenance** - More code to maintain

## Rationale

### Why Not One Endpoint?
A single endpoint would require:
- Complex conditional logic based on request parameters
- Multiple validation strategies in one place
- Different error handling for different scenarios
- Harder to optimize for specific use cases
- More difficult to test and debug

### Why Not Consolidate?
Consolidation would:
- Break existing frontend integrations
- Require complex refactoring
- Reduce clarity of purpose
- Make debugging more difficult
- Reduce optimization opportunities

## Implementation Details

### Frontend Integration
```javascript
// Initial upload (simpleSessionService.js:263)
const response = await fetch('/api/mark-homework/process-single', {
  method: 'POST',
  body: JSON.stringify({ imageData, model: 'auto' })
});

// Follow-up message (simpleSessionService.js:423)
const response = await fetch('/api/mark-homework/process', {
  method: 'POST',
  body: JSON.stringify({ imageData, model: 'auto', sessionId })
});
```

### Usage Monitoring
Each endpoint logs usage for monitoring:
```javascript
console.log(`[USAGE] /api/mark-homework/process-single called by: ${userAgent}`);
```

### Documentation
Each endpoint has comprehensive JSDoc with:
- Purpose and usage patterns
- Frontend integration examples
- Parameter documentation
- Response format examples

## Related Decisions
- ADR-002: Session Management Strategy
- ADR-003: Error Handling Patterns
- ADR-004: Authentication Requirements

## Review Date
2025-12-21 (3 months from creation)

---

*This ADR documents why we have multiple API endpoints for mark homework functionality and why consolidation would be counterproductive.*
