export const PRODUCT_TYPES = ['CLOTHING', 'SHOES', 'BAGS', 'WATCHES', 'ACCESSORIES', 'PERFUME'] as const;
export type ProductTypeCode = (typeof PRODUCT_TYPES)[number];

export type CatalogSort = 'newest' | 'price_asc' | 'price_desc' | 'name_asc';

export interface BrandDto {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  logo_path: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryDto {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ImageDto {
  id: number;
  product_id: number;
  variant_id: number | null;
  asset_path: string;
  alt_text: string;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
}

export interface OptionDto {
  attribute_id: number;
  code: string;
  label: string;
  value_id: number;
  value_code: string;
  value_label: string;
}

export interface VariantDto {
  id: number;
  product_id: number;
  sku: string;
  options: OptionDto[];
  price: string;
  list_price: string | null;
  stock_quantity: number;
  is_active: boolean;
  images: ImageDto[];
  color?: string;
  size?: string;
}

export interface ProductCardDto {
  id: number;
  name: string;
  slug: string;
  brand: { id: number; name: string; slug: string };
  category: { id: number; name: string; slug: string };
  product_type_code: ProductTypeCode;
  base_image_url: string | null;
  price_min: string;
  price_max: string;
  in_stock: boolean;
}

export interface OptionSchemaAttributeDto {
  attribute_id: number;
  code: string;
  label: string;
  required: boolean;
  values: Array<{ id: number; code: string; label: string }>;
}

export interface ProductDetailDto extends ProductCardDto {
  description: string | null;
  images: ImageDto[];
  variants: VariantDto[];
  option_schema: OptionSchemaAttributeDto[];
}

export interface AdminProductCardDto extends ProductCardDto {
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminProductDetailDto extends ProductDetailDto {
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductTypeDto {
  code: ProductTypeCode;
  name: string;
  attributes: Array<{
    id: number;
    code: string;
    name: string;
    unit: string | null;
    is_required: boolean;
    values: Array<{ id: number; code: string; label: string }>;
  }>;
}

export interface BannerDto {
  id: number;
  title: string;
  desktop_path: string;
  mobile_path: string | null;
  alt_text: string;
  placement: 'HERO' | 'PROMO';
  target_type: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'BRAND';
  product_id: number | null;
  category_id: number | null;
  brand_id: number | null;
  starts_at: string;
  ends_at: string;
  sort_order: number;
  is_active: boolean;
  target_path: string | null;
}
