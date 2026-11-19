import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface PgErrorShape {
  code?: string;
  constraint?: string;
  detail?: string;
  message?: string;
}

const ALLOWED_STATUS_TARGETS: Readonly<Record<string, readonly string[]>> = {
  PENDING: ['CONFIRMED'],
  CONFIRMED: ['SHIPPING'],
  SHIPPING: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

function parseOutOfStockDetail(detail?: string): Record<string, unknown> {
  if (!detail) return {};
  const m = /^variant_id=(\d+),available=(\d+)$/.exec(detail);
  if (!m) return {};
  return { variant_id: Number(m[1]), available: Number(m[2]) };
}

export function mapDatabaseError(error: unknown): ApiError | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const pgError = error as PgErrorShape;
  switch (pgError.code) {
    case 'P1001':
      return new ApiError(409, 'OUT_OF_STOCK', 'Sản phẩm không đủ tồn kho.', parseOutOfStockDetail(pgError.detail));
    case 'P1002':
      return new ApiError(
        409,
        'VOUCHER_INVALID',
        'Mã giảm giá không hợp lệ hoặc không đủ điều kiện áp dụng.',
        pgError.detail ? { reason: pgError.detail } : {},
      );
    case 'P1003':
      return new ApiError(409, 'VOUCHER_EXHAUSTED', 'Mã giảm giá đã hết lượt sử dụng.');
    case 'P1004':
      return new ApiError(409, 'VOUCHER_ALREADY_USED', 'Bạn đã sử dụng mã giảm giá này cho một đơn hàng khác.');
    case 'P1005':
      return new ApiError(409, 'CART_EMPTY', 'Giỏ hàng đang trống.');
    case 'P1006':
      return new ApiError(
        409,
        'CART_CHANGED',
        'Giỏ hàng đã thay đổi. Vui lòng kiểm tra lại giỏ hàng.',
        pgError.detail ? { current_version: pgError.detail } : {},
      );
    case 'P1007':
      return new ApiError(409, 'PRICE_CHANGED', 'Giá sản phẩm đã thay đổi. Vui lòng kiểm tra lại giỏ hàng.');
    case 'P1008':
      return new ApiError(409, 'ITEM_UNAVAILABLE', 'Sản phẩm trong giỏ hiện không còn khả dụng.');
    case 'P1009':
      return new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Khóa idempotency đã được dùng cho yêu cầu khác.');
    case 'P1010':
      return new ApiError(
        409,
        'ORDER_NOT_CANCELLABLE',
        'Đơn hàng không thể hủy ở trạng thái hiện tại.',
        pgError.detail ? { current_status: pgError.detail } : {},
      );
    case 'P1011': {
      const isStale = Boolean(pgError.message && pgError.message.includes('Stale order status'));
      const currentStatus = pgError.detail;
      const details: Record<string, unknown> = {};
      if (currentStatus) {
        details.current_status = currentStatus;
        details.allowed_targets = ALLOWED_STATUS_TARGETS[currentStatus] ?? [];
      }
      return new ApiError(
        409,
        isStale ? 'STALE_ORDER_STATUS' : 'INVALID_STATUS_TRANSITION',
        isStale
          ? 'Trạng thái đơn hàng đã thay đổi bởi thao tác khác.'
          : 'Trạng thái đơn hàng không hợp lệ để chuyển tiếp.',
        details,
      );
    }
    case 'P1012':
      return new ApiError(409, 'VOUCHER_TERMS_LOCKED', 'Không thể thay đổi điều khoản voucher đã có lượt sử dụng.');
    case 'P1013':
      return new ApiError(409, 'LAST_ADMIN_PROTECTED', 'Không thể hạ quyền hoặc vô hiệu hóa quản trị viên hoạt động cuối cùng.');
    case 'P1014':
      if (pgError.constraint === 'last_product_image') {
        return new ApiError(409, 'LAST_PRODUCT_IMAGE', 'Không thể xóa ảnh cuối cùng của sản phẩm đang hoạt động.');
      }
      return new ApiError(409, 'PRODUCT_NOT_PUBLISHABLE', 'Sản phẩm cần ít nhất một biến thể hoạt động và một hình ảnh.');
    case 'P2001':
      if (pgError.constraint === 'variant_options_invalid') {
        return new ApiError(400, 'VARIANT_OPTIONS_INVALID', 'Thuộc tính biến thể không hợp lệ.');
      }
      return new ApiError(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.');
    case 'P2002':
      return new ApiError(400, 'AMOUNT_OUT_OF_RANGE', 'Giá trị tiền hoặc số lượng vượt giới hạn cho phép.');
    case 'P3001':
      return new ApiError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
    case 'P4001':
      if (pgError.constraint === 'cart_item_not_found') {
        return new ApiError(404, 'CART_ITEM_NOT_FOUND', 'Không tìm thấy sản phẩm trong giỏ hàng.');
      }
      return new ApiError(404, 'NOT_FOUND', 'Không tìm thấy tài nguyên.');
    case '23505':
      if (pgError.constraint === 'users_email_key') {
        return new ApiError(409, 'EMAIL_EXISTS', 'Email đã được sử dụng.', { field: 'email' });
      }
      if (pgError.constraint === 'product_variants_sku_key' || pgError.constraint === 'variants_product_combo_key') {
        return new ApiError(409, 'DUPLICATE_VARIANT', 'SKU hoặc tổ hợp thuộc tính đã tồn tại.');
      }
      if (
        pgError.constraint === 'brands_name_key' ||
        pgError.constraint === 'brands_slug_key' ||
        pgError.constraint === 'categories_name_key' ||
        pgError.constraint === 'categories_slug_key' ||
        pgError.constraint === 'products_slug_key' ||
        pgError.constraint === 'vouchers_code_key' ||
        pgError.constraint === 'images_primary_product' ||
        pgError.constraint === 'images_primary_variant'
      ) {
        return new ApiError(409, 'DUPLICATE_CODE', 'Tên, slug hoặc khóa định danh đã tồn tại.');
      }
      return null;
    case '23503':
      return new ApiError(400, 'INVALID_REFERENCE', 'Tham chiếu dữ liệu không hợp lệ.');
    case '23514':
      if (pgError.constraint === 'product_publishable') {
        return new ApiError(409, 'PRODUCT_NOT_PUBLISHABLE', 'Sản phẩm đang hoạt động cần ít nhất một biến thể hoạt động và một hình ảnh.');
      }
      if (pgError.constraint === 'variant_required_attributes' || pgError.constraint === 'variant_type_attributes') {
        return new ApiError(400, 'VARIANT_OPTIONS_INVALID', 'Thuộc tính biến thể không hợp lệ.');
      }
      return new ApiError(400, 'VALIDATION_ERROR', 'Dữ liệu vi phạm ràng buộc hợp lệ.');
    case '40P01':
    case '40001':
      return new ApiError(503, 'RETRYABLE_TRANSACTION', 'Hệ thống đang bận, vui lòng thử lại.');
    case '55P03':
    case '57014':
      return new ApiError(503, 'RESOURCE_BUSY', 'Hệ thống đang bận, vui lòng thử lại.');
    default:
      return null;
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Đã xảy ra lỗi hệ thống.';
  let details: Record<string, unknown> = {};
  const mappedDbError = error instanceof ApiError ? null : mapDatabaseError(error);
  if (error instanceof ApiError) {
    ({ status, code, message, details } = error);
  } else if (mappedDbError) {
    ({ status, code, message, details } = mappedDbError);
  } else if (error instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Dữ liệu không hợp lệ.';
    details = { fields: error.issues.map((issue) => ({ field: issue.path.join('.'), reason: issue.message })) };
  } else if (error instanceof Error && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
      message = 'JSON không hợp lệ.';
    } else if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Dữ liệu vượt giới hạn cho phép.';
    }
  }
  if (status === 503 && (code === 'RETRYABLE_TRANSACTION' || code === 'RESOURCE_BUSY')) {
    res.setHeader('Retry-After', '1');
  }
  if (status >= 500) {
    console.error(JSON.stringify({ event: 'request_failed', request_id: res.locals.requestId, code }));
  }
  res.status(status).json({
    success: false,
    message,
    error: { code, details },
    meta: { request_id: res.locals.requestId },
  });
};
