✅ FLOW HOÀN CHỈNH – KHÔNG CẦN ĐĂNG KÝ TÀI KHOẢN
1. User chọn gói trên website

User mở landing page → chuyển đến payment page.

Chọn:

Gói 1 tháng, hoặc

Gói trọn đời

Nhập email để nhận activation code.

Nhấn "Pay" → gửi request đến backend để tạo Stripe Checkout Session.

2. Backend tạo Stripe Checkout Session

Backend nhận request từ frontend:

Input:

{
  "plan": "1-month",
  "email": "user@example.com"
}


Backend:

Chọn đúng Stripe Price ID theo gói.

Tạo Checkout Session qua Stripe API bằng Secret Key.

Trả về URL hoặc sessionId để frontend redirect tới Stripe Checkout.

3. User thanh toán qua Stripe Checkout

User nhập thẻ → thanh toán.

Stripe xử lý toàn bộ giao dịch.

Sau khi thanh toán thành công, Stripe không đưa code ngay mà:
→ Gửi một webhook đến backend.

4. Stripe gửi webhook checkout.session.completed

Backend phải có endpoint như:

POST /webhook


Stripe gửi JSON vào endpoint này, bao gồm:

Email của người mua

Price ID / plan

Payment status

Backend sẽ:

(a) Sinh Activation Code

Tạo chuỗi code duy nhất (ví dụ: 8 ký tự ngẫu nhiên)

Tính ngày hết hạn:

gói 1 tháng → +30 ngày

gói trọn đời → không có expiry

(b) Lưu vào MongoDB

Ví dụ document:

{
  "code": "AB12CD34",
  "email": "user@example.com",
  "plan": "1-month",
  "status": "active",
  "createdAt": "2025-11-25T10:00:00Z",
  "expiresAt": "2025-12-25T10:00:00Z"
}

(c) Gửi email đến user

Nội dung email:

Activation Code

Gói

Ngày hết hạn

Hướng dẫn sử dụng

5. User mở app macOS và nhập Activation Code

App macOS sẽ hiển thị màn hình:

Nhập code

Nhấn “Activate”

App gọi API:

POST /api/validate


Payload:

{
  "code": "AB12CD34",
  "secret": "API_SECRET"
}


(secret giúp bảo vệ API không bị spam)

6. Backend kiểm tra code

Backend:

Tìm code trong MongoDB

Kiểm tra:

code có tồn tại không

có hết hạn không

trạng thái active/expired

Trả về JSON:

Nếu hợp lệ:

{
  "plan": "1-month",
  "expiresAt": "2025-12-25T10:00:00Z",
  "status": "active"
}


Nếu không hợp lệ:

{ "error": "Code expired" }


hoặc

{ "error": "Code not found" }

7. App macOS mở khóa ứng dụng

Nếu status = “active”, app sẽ unlock tính năng.

Nếu code hết hạn hoặc invalid, app hiển thị lỗi yêu cầu người dùng nhập lại hoặc mua mới.