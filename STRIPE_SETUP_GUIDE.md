# Hướng dẫn Setup Stripe Payment Flow

## Bước 1: Tạo Products & Prices trong Stripe Dashboard

1. Đăng nhập vào [Stripe Dashboard](https://dashboard.stripe.com/test/products)
2. Vào **Products** → Click **Add product**
3. Tạo 2 products:

### Product 1: Monthly Plan
- **Name**: Shadow Link - Monthly
- **Description**: One-Month Access
- **Pricing**: 
  - Type: **One time**
  - Price: **$40.00 USD**
- Click **Save product**
- Copy **Price ID** (bắt đầu với `price_...`)

### Product 2: Lifetime Plan
- **Name**: Shadow Link - Lifetime
- **Description**: Lifetime Access
- **Pricing**:
  - Type: **One time**
  - Price: **$120.00 USD**
- Click **Save product**
- Copy **Price ID** (bắt đầu với `price_...`)

## Bước 2: Setup Webhook

1. Vào **Developers** → **Webhooks** → Click **Add endpoint**
2. **Endpoint URL**: 
   - Production: `https://your-domain.com/webhook/stripe`
   - Local testing: Dùng ngrok: `https://your-ngrok-url.ngrok.io/webhook/stripe`
3. **Events to send**: Chọn `checkout.session.completed`
4. Click **Add endpoint**
5. Copy **Signing secret** (bắt đầu với `whsec_...`)

## Bước 3: Cấu hình Environment Variables

Thêm vào file `.env`:

```env
# Stripe Keys (đã có)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx

# Stripe Price IDs (cần thêm)
STRIPE_PRICE_MONTHLY=price_xxx  # Price ID của Monthly plan
STRIPE_PRICE_LIFETIME=price_xxx # Price ID của Lifetime plan

# Stripe Webhook Secret (cần thêm)
STRIPE_WEBHOOK_SECRET=whsec_xxx # Webhook signing secret
```

## Bước 4: Test Local với ngrok (nếu test local)

1. Cài đặt ngrok: https://ngrok.com/download
2. Chạy ngrok:
   ```bash
   ngrok http 3333
   ```
3. Copy HTTPS URL (ví dụ: `https://abc123.ngrok.io`)
4. Update webhook URL trong Stripe Dashboard:
   - URL: `https://abc123.ngrok.io/webhook/stripe`
5. Restart server để load env variables mới

## Bước 5: Test Payment Flow

1. Mở website: `http://localhost:3333/payment`
2. Điền email và chọn plan
3. Click "Complete Purchase"
4. Sẽ redirect đến Stripe Checkout
5. Dùng test card:
   - **Card number**: `4242 4242 4242 4242`
   - **Expiry**: Bất kỳ date tương lai (ví dụ: `12/25`)
   - **CVC**: Bất kỳ 3 số (ví dụ: `123`)
   - **ZIP**: Bất kỳ 5 số (ví dụ: `12345`)
6. Click **Pay**
7. Sau khi thanh toán thành công:
   - Redirect về `/payment/success`
   - Stripe gửi webhook đến server
   - Server tạo activation code
   - Server gửi email với activation code
   - Success page hiển thị activation code (nếu webhook đã xử lý)

## Flow hoàn chỉnh:

```
User clicks Checkout
    ↓
POST /api/checkout-session
    ↓
Create Stripe Checkout Session
    ↓
Redirect to Stripe Checkout
    ↓
User pays with test card
    ↓
Stripe processes payment
    ↓
Stripe sends webhook → /webhook/stripe
    ↓
Server processes webhook:
  - Create activation code
  - Save transaction
  - Send email
    ↓
User redirects to /payment/success
    ↓
Success page checks activation status
    ↓
Display activation code (if ready)
```

## Troubleshooting

### Webhook không nhận được
- Kiểm tra ngrok URL đã đúng chưa
- Kiểm tra webhook endpoint trong Stripe Dashboard
- Xem logs: `console.log` trong webhook handler

### Activation code không được tạo
- Kiểm tra webhook secret đúng chưa
- Kiểm tra metadata (email, planId) có trong session không
- Xem logs server để debug

### Email không được gửi
- Kiểm tra SMTP config trong `.env`
- Xem logs email service

## Test Cards

Stripe cung cấp các test cards:
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0027 6000 3184`

Xem thêm: https://stripe.com/docs/testing

