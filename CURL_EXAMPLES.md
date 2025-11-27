# CURL Examples - Check Activation Code

## 1. Verify Activation Code (Public - No Auth Required)

```bash
# Local
curl -X POST http://localhost:3333/api/activations/verify \
  -H "Content-Type: application/json" \
  -d '{"activationCode": "YOUR_CODE_HERE"}'

# Production
curl -X POST https://vtoobe.shop/api/activations/verify \
  -H "Content-Type: application/json" \
  -d '{"activationCode": "YOUR_CODE_HERE"}'
```

**Example with actual code:**
```bash
curl -X POST http://localhost:3333/api/activations/verify \
  -H "Content-Type: application/json" \
  -d '{"activationCode": "ABC123DEF456GHIJ"}'
```

**Success Response (200):**
```json
{
  "ok": true,
  "data": {
    "activationCode": "ABC123DEF456GHIJ",
    "email": "user@example.com",
    "plan": "monthly",
    "status": "active",
    "expiresAt": "2024-02-15T00:00:00.000Z",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Error Response (404):**
```json
{
  "ok": false,
  "reason": "not_found" // or "expired", "revoked"
}
```

---

## 2. Validate Activation Code (Protected - Requires API_SECRET)

```bash
# Local
curl -X POST http://localhost:3333/api/validate \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: YOUR_API_SECRET" \
  -d '{"activationCode": "YOUR_CODE_HERE"}'

# Production
curl -X POST https://vtoobe.shop/api/validate \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: YOUR_API_SECRET" \
  -d '{"activationCode": "YOUR_CODE_HERE"}'
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

**Error Response (404):**
```json
{
  "valid": false,
  "reason": "not_found",
  "plan": null,
  "expiryDate": null,
  "status": "not_found"
}
```

---

## 3. Get Activation Status (Protected - Requires API_SECRET)

```bash
# Local
curl -X GET "http://localhost:3333/api/status/YOUR_CODE_HERE" \
  -H "X-API-Secret: YOUR_API_SECRET"

# Production
curl -X GET "https://vtoobe.shop/api/status/YOUR_CODE_HERE" \
  -H "X-API-Secret: YOUR_API_SECRET"
```

**Example:**
```bash
curl -X GET "http://localhost:3333/api/status/ABC123DEF456GHIJ" \
  -H "X-API-Secret: your-secret-key"
```

**Success Response (200):**
```json
{
  "_id": "...",
  "activationCode": "ABC123DEF456GHIJ",
  "email": "user@example.com",
  "plan": "monthly",
  "status": "active",
  "expiresAt": "2024-02-15T00:00:00.000Z",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Error Response (404):**
```json
{
  "error": "Activation code not found"
}
```

---

## Quick Test Commands

### Test với mã code giả (sẽ trả về 404):
```bash
curl -X POST http://localhost:3333/api/activations/verify \
  -H "Content-Type: application/json" \
  -d '{"activationCode": "TEST123"}'
```

### Test với format đẹp (sử dụng jq nếu có):
```bash
curl -X POST http://localhost:3333/api/activations/verify \
  -H "Content-Type: application/json" \
  -d '{"activationCode": "YOUR_CODE"}' | jq
```

### Windows PowerShell:
```powershell
Invoke-RestMethod -Uri "http://localhost:3333/api/activations/verify" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"activationCode":"YOUR_CODE_HERE"}'
```



