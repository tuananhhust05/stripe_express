# macOS App API Integration Guide

This document describes how to integrate the Shadow Link backend API into your macOS application.

## Base URL

```
Production: https://your-domain.com
Development: http://localhost:3333
```

## Authentication

All macOS app endpoints require authentication via the `API_SECRET` configured in the backend environment.

### Method 1: Header (Recommended)
```swift
request.setValue("your-api-secret", forHTTPHeaderField: "X-API-Secret")
```

### Method 2: Query Parameter
```
GET /api/status/ABC123?secret=your-api-secret
```

## Endpoints

### 1. Validate Activation Code

**Endpoint:** `POST /api/validate`

**Headers:**
- `Content-Type: application/json`
- `X-API-Secret: your-api-secret`

**Request Body:**
```json
{
  "activationCode": "ABC123DEF456GHIJ"
}
```

**Success Response (200):**
```json
{
  "valid": true,
  "plan": "monthly",
  "expiryDate": "2024-02-15T00:00:00.000Z",
  "status": "active",
  "email": "user@example.com"
}
```

**Error Responses:**

Invalid code (404):
```json
{
  "valid": false,
  "reason": "not_found",
  "plan": null,
  "expiryDate": null,
  "status": "not_found"
}
```

Expired code (404):
```json
{
  "valid": false,
  "reason": "expired",
  "plan": null,
  "expiryDate": null,
  "status": "expired"
}
```

Revoked code (404):
```json
{
  "valid": false,
  "reason": "revoked",
  "plan": null,
  "expiryDate": null,
  "status": "revoked"
}
```

**Swift Example:**
```swift
func validateActivation(code: String) async throws -> ValidationResponse {
    let url = URL(string: "https://your-domain.com/api/validate")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(apiSecret, forHTTPHeaderField: "X-API-Secret")
    
    let body = ["activationCode": code]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(ValidationResponse.self, from: data)
}
```

### 2. Get Activation Status

**Endpoint:** `GET /api/status/:code`

**Headers:**
- `X-API-Secret: your-api-secret`

**Success Response (200):**
```json
{
  "activationCode": "ABC123DEF456GHIJ",
  "email": "user@example.com",
  "plan": "monthly",
  "status": "active",
  "expiresAt": "2024-02-15T00:00:00.000Z",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "stripeSessionId": "cs_test_..."
}
```

**Error Response (404):**
```json
{
  "error": "Activation code not found"
}
```

**Swift Example:**
```swift
func getActivationStatus(code: String) async throws -> ActivationStatus {
    let url = URL(string: "https://your-domain.com/api/status/\(code)")!
    var request = URLRequest(url: url)
    request.setValue(apiSecret, forHTTPHeaderField: "X-API-Secret")
    
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(ActivationStatus.self, from: data)
}
```

## Plan Types

- `monthly`: 1-month subscription (expires after 30 days)
- `lifetime`: Lifetime access (no expiration)

## Status Values

- `active`: Code is valid and active
- `expired`: Code has passed its expiration date
- `revoked`: Code has been manually revoked
- `pending`: Code is pending activation (should not appear in normal flow)

## Recommended Implementation

1. **On App Launch:**
   - Read stored activation code from Keychain/UserDefaults
   - Call `/api/validate` to verify code is still valid
   - If invalid/expired, prompt user to enter new code

2. **On Activation:**
   - User enters activation code from email
   - Call `/api/validate` to verify
   - If valid, store code securely (Keychain recommended)
   - Show success message and unlock features

3. **Periodic Checks:**
   - Optionally validate code every 24 hours or on app launch
   - Handle expired codes gracefully (show upgrade prompt)

## Error Handling

Always handle these cases:
- Network errors (no internet, timeout)
- Invalid API secret (401)
- Code not found (404)
- Expired codes (404 with reason: "expired")
- Revoked codes (404 with reason: "revoked")

## Security Notes

- Never hardcode the API secret in your app binary
- Consider using environment-specific secrets
- Store activation codes securely (Keychain, not UserDefaults)
- Use HTTPS in production (required for security)

