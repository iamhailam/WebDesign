import type { Role } from '@/lib/api';

export const ORDER_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  SHIPPING: 'Đang giao hàng',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã hủy',
};

export function orderStatusBadgeVariant(
  status: string,
): 'neutral' | 'success' | 'warning' | 'red-soft' {
  if (status === 'DELIVERED') return 'success';
  if (status === 'CANCELLED') return 'red-soft';
  if (status === 'SHIPPING' || status === 'CONFIRMED') return 'warning';
  return 'neutral';
}

export interface AdminNavItem {
  id: string;
  label: string;
  to: string;
  group: 'overview' | 'operations' | 'catalog' | 'system';
  allowedRoles: readonly Role[];
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    id: 'dashboard',
    label: 'Tổng quan doanh thu',
    to: '/admin/dashboard',
    group: 'overview',
    allowedRoles: ['MARKETING', 'ADMIN'],
  },
  {
    id: 'orders',
    label: 'Đơn hàng',
    to: '/admin/orders',
    group: 'operations',
    allowedRoles: ['SALES', 'ADMIN'],
  },
  {
    id: 'inventory',
    label: 'Tồn kho SKU',
    to: '/admin/inventory',
    group: 'operations',
    allowedRoles: ['WAREHOUSE', 'ADMIN'],
  },
  {
    id: 'inventory-transactions',
    label: 'Sổ kho (Ledger)',
    to: '/admin/inventory/transactions',
    group: 'operations',
    allowedRoles: ['WAREHOUSE', 'ADMIN'],
  },
  {
    id: 'products',
    label: 'Sản phẩm',
    to: '/admin/products',
    group: 'catalog',
    allowedRoles: ['ADMIN'],
  },
  {
    id: 'categories',
    label: 'Danh mục',
    to: '/admin/categories',
    group: 'catalog',
    allowedRoles: ['ADMIN'],
  },
  {
    id: 'brands',
    label: 'Thương hiệu',
    to: '/admin/brands',
    group: 'catalog',
    allowedRoles: ['ADMIN'],
  },
  {
    id: 'vouchers',
    label: 'Voucher khuyến mãi',
    to: '/admin/vouchers',
    group: 'catalog',
    allowedRoles: ['MARKETING', 'ADMIN'],
  },
  {
    id: 'banners',
    label: 'Banner trang chủ',
    to: '/admin/banners',
    group: 'catalog',
    allowedRoles: ['ADMIN'],
  },
  {
    id: 'users',
    label: 'Người dùng & Vai trò',
    to: '/admin/users',
    group: 'system',
    allowedRoles: ['ADMIN'],
  },
  {
    id: 'audit',
    label: 'Nhật ký kiểm toán',
    to: '/admin/audit-events',
    group: 'system',
    allowedRoles: ['ADMIN'],
  },
];

export const ADMIN_GROUP_LABELS: Record<AdminNavItem['group'], string> = {
  overview: 'Báo cáo',
  operations: 'Vận hành',
  catalog: 'Danh mục & Tiếp thị',
  system: 'Hệ thống',
};

export function getAdminNavItemsForRole(role: Role): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => item.allowedRoles.includes(role));
}

export function getAdminHomeForRole(role: Role): string {
  switch (role) {
    case 'SALES':
      return '/admin/orders';
    case 'WAREHOUSE':
      return '/admin/inventory';
    case 'MARKETING':
    case 'ADMIN':
      return '/admin/dashboard';
    default:
      return '/403';
  }
}

export function formatAdminDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('vi-VN');
}

export function toDateTimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localDateTimeToIso(localValue: string): string {
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return localValue;
  return parsed.toISOString();
}

export function formatDateRangeDefaults(days = 30): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - (days - 1) * 86_400_000);
  const from = start.toISOString().slice(0, 10);
  return { from, to };
}

export function formatOptionsSummary(options: readonly Record<string, unknown>[]): string {
  if (options.length === 0) return 'Mặc định';
  return options
    .map((opt) => {
      const label = typeof opt.label === 'string' ? opt.label : typeof opt.code === 'string' ? opt.code : '';
      const val =
        typeof opt.value_label === 'string'
          ? opt.value_label
          : typeof opt.value_code === 'string'
            ? opt.value_code
            : '';
      return label && val ? `${label}: ${val}` : val || label;
    })
    .filter(Boolean)
    .join(' · ');
}
