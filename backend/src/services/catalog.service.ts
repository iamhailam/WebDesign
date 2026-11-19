import type pg from 'pg';
import { withTransaction } from '../config/database.js';
import { ApiError } from '../http/error.js';
import type {
  AdminProductCardDto,
  AdminProductDetailDto,
  BannerDto,
  BrandDto,
  CatalogSort,
  CategoryDto,
  ImageDto,
  OptionDto,
  OptionSchemaAttributeDto,
  ProductCardDto,
  ProductDetailDto,
  ProductTypeCode,
  ProductTypeDto,
  VariantDto,
} from '../types/catalog.js';

function escapeLike(input: string): string {
  return `%${input.replace(/[\\%_]/g, '\\$&')}%`;
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function formatMoney(value: string | number | null): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.includes('.') ? `${str}00`.slice(0, str.indexOf('.') + 3) : `${str}.00`;
}

function buildPagination(page: number, pageSize: number, total: number) {
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function attachVariantAliases(variant: Omit<VariantDto, 'color' | 'size'>): VariantDto {
  const colorOpt = variant.options.find((o) => o.code === 'color');
  const sizeOpt = variant.options.find((o) => o.code === 'clothing_size' || o.code === 'shoe_size');
  const result: VariantDto = { ...variant };
  if (colorOpt) result.color = colorOpt.value_label;
  if (sizeOpt) result.size = sizeOpt.value_label;
  return result;
}

const PUBLIC_PRODUCT_SORT_SQL: Record<CatalogSort, string> = {
  newest: 'm.created_at DESC, m.id DESC',
  price_asc: 'm.price_min ASC, m.id ASC',
  price_desc: 'm.price_max DESC, m.id DESC',
  name_asc: 'm.name ASC, m.id ASC',
};

export interface PublicProductListQuery {
  page: number;
  page_size: number;
  category_id?: number | undefined;
  brand_id?: number | undefined;
  product_type?: ProductTypeCode | undefined;
  search?: string | undefined;
  min_price?: string | undefined;
  max_price?: string | undefined;
  in_stock?: boolean | undefined;
  sort: CatalogSort;
}

export function createCatalogService(pool: pg.Pool) {
  async function listPublicCategories(page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const result = await pool.query<{
      id: number;
      name: string;
      slug: string;
      description: string | null;
      total_count: string;
    }>(
      `WITH counted AS (SELECT count(*)::bigint AS total_count FROM app.vw_public_categories)
       SELECT c.id, c.name, c.slug, c.description, cnt.total_count
       FROM app.vw_public_categories c
       CROSS JOIN counted cnt
       ORDER BY c.id ASC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    return {
      items: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        is_active: true,
        created_at: '',
      })),
      pagination: buildPagination(page, pageSize, total),
    };
  }

  async function getPublicCategoryBySlug(slug: string) {
    const result = await pool.query<{ id: number; name: string; slug: string; description: string | null }>(
      'SELECT id, name, slug, description FROM app.vw_public_categories WHERE slug = $1',
      [slug],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy danh mục.');
    return { ...row, is_active: true };
  }

  async function listPublicBrands(page: number, pageSize: number, search?: string) {
    const offset = (page - 1) * pageSize;
    const pattern = search ? escapeLike(search) : null;
    const result = await pool.query<{
      id: number;
      name: string;
      slug: string;
      description: string | null;
      logo_path: string | null;
      total_count: string;
    }>(
      `WITH filtered AS (
         SELECT id, name, slug, description, logo_path::text AS logo_path
         FROM app.vw_public_brands
         WHERE ($1::text IS NULL OR name ILIKE $1 ESCAPE '\\')
       ), counted AS (SELECT count(*)::bigint AS total_count FROM filtered)
       SELECT f.*, cnt.total_count
       FROM filtered f CROSS JOIN counted cnt
       ORDER BY f.id ASC
       LIMIT $2 OFFSET $3`,
      [pattern, pageSize, offset],
    );
    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    return {
      items: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        logo_path: r.logo_path,
        is_active: true,
      })),
      pagination: buildPagination(page, pageSize, total),
    };
  }

  async function getPublicBrandBySlug(slug: string) {
    const result = await pool.query<{
      id: number;
      name: string;
      slug: string;
      description: string | null;
      logo_path: string | null;
    }>(
      'SELECT id, name, slug, description, logo_path::text AS logo_path FROM app.vw_public_brands WHERE slug = $1',
      [slug],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy thương hiệu.');
    return { ...row, is_active: true };
  }

  async function listProductTypes(): Promise<{ items: ProductTypeDto[] }> {
    const result = await pool.query<{
      product_type_code: ProductTypeCode;
      product_type_name: string;
      attribute_id: number;
      attribute_code: string;
      attribute_name: string;
      unit: string | null;
      is_required: boolean;
      sort_order: number;
      value_id: number;
      value_code: string;
      value_label: string;
      value_sort_order: number;
    }>(
      `SELECT product_type_code, product_type_name, attribute_id, attribute_code, attribute_name,
              unit, is_required, sort_order, value_id, value_code, value_label, value_sort_order
       FROM app.vw_product_type_options
       ORDER BY product_type_code ASC, sort_order ASC, attribute_id ASC, value_sort_order ASC, value_id ASC`,
    );

    const typeMap = new Map<ProductTypeCode, {
      code: ProductTypeCode;
      name: string;
      attrMap: Map<number, {
        id: number;
        code: string;
        name: string;
        unit: string | null;
        is_required: boolean;
        values: Array<{ id: number; code: string; label: string }>;
      }>;
    }>();

    for (const row of result.rows) {
      let pt = typeMap.get(row.product_type_code);
      if (!pt) {
        pt = { code: row.product_type_code, name: row.product_type_name, attrMap: new Map() };
        typeMap.set(row.product_type_code, pt);
      }
      let attr = pt.attrMap.get(row.attribute_id);
      if (!attr) {
        attr = {
          id: row.attribute_id,
          code: row.attribute_code,
          name: row.attribute_name,
          unit: row.unit,
          is_required: row.is_required,
          values: [],
        };
        pt.attrMap.set(row.attribute_id, attr);
      }
      attr.values.push({ id: row.value_id, code: row.value_code, label: row.value_label });
    }

    return {
      items: [...typeMap.values()].map((pt) => ({
        code: pt.code,
        name: pt.name,
        attributes: [...pt.attrMap.values()],
      })),
    };
  }

  async function listPublicProducts(query: PublicProductListQuery) {
    const offset = (query.page - 1) * query.page_size;
    const pattern = query.search ? escapeLike(query.search) : null;
    const orderSql = PUBLIC_PRODUCT_SORT_SQL[query.sort];

    const result = await pool.query<{
      id: number;
      name: string;
      slug: string;
      brand_id: number;
      brand_name: string;
      brand_slug: string;
      category_id: number;
      category_name: string;
      category_slug: string;
      product_type_code: ProductTypeCode;
      base_image_url: string | null;
      price_min: string;
      price_max: string;
      in_stock: boolean;
      total_count: string;
    }>(
      `WITH matched AS (
         SELECT p.id, p.name, p.slug, p.category_id, p.brand_id, p.product_type_code,
                p.created_at, p.price_min, p.price_max, p.in_stock
         FROM app.vw_catalog_products p
         WHERE ($1::int IS NULL OR p.category_id = $1)
           AND ($2::int IS NULL OR p.brand_id = $2)
           AND ($3::text IS NULL OR p.product_type_code = $3)
           AND ($4::text IS NULL OR p.name ILIKE $4 ESCAPE '\\')
           AND (
             ($5::numeric IS NULL AND $6::numeric IS NULL AND $7::boolean IS NULL)
             OR (
               $7::boolean IS FALSE AND NOT p.in_stock
               AND EXISTS (
                 SELECT 1 FROM app.vw_catalog_variants v
                 WHERE v.product_id = p.id
                   AND ($5::numeric IS NULL OR v.price >= $5)
                   AND ($6::numeric IS NULL OR v.price <= $6)
               )
             )
             OR (
               ($7::boolean IS NULL OR $7::boolean IS TRUE)
               AND EXISTS (
                 SELECT 1 FROM app.vw_catalog_variants v
                 WHERE v.product_id = p.id
                   AND ($5::numeric IS NULL OR v.price >= $5)
                   AND ($6::numeric IS NULL OR v.price <= $6)
                   AND ($7::boolean IS NULL OR v.stock_quantity > 0)
               )
             )
           )
       ), counted AS (SELECT count(*)::bigint AS total_count FROM matched)
       SELECT m.id, m.name, m.slug,
              b.id AS brand_id, b.name AS brand_name, b.slug AS brand_slug,
              c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
              m.product_type_code,
              img.asset_path AS base_image_url,
              m.price_min::text, m.price_max::text, m.in_stock,
              cnt.total_count
       FROM matched m
       JOIN app.vw_public_brands b ON b.id = m.brand_id
       JOIN app.vw_public_categories c ON c.id = m.category_id
       LEFT JOIN LATERAL (
         SELECT i.asset_path::text AS asset_path
         FROM app.vw_catalog_images i
         WHERE i.product_id = m.id
         ORDER BY (i.variant_id IS NULL AND i.is_primary) DESC, i.sort_order ASC, i.id ASC
         LIMIT 1
       ) img ON TRUE
       CROSS JOIN counted cnt
       ORDER BY ${orderSql}
       LIMIT $8 OFFSET $9`,
      [
        query.category_id ?? null,
        query.brand_id ?? null,
        query.product_type ?? null,
        pattern,
        query.min_price ?? null,
        query.max_price ?? null,
        query.in_stock ?? null,
        query.page_size,
        offset,
      ],
    );

    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const items: ProductCardDto[] = result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      brand: { id: r.brand_id, name: r.brand_name, slug: r.brand_slug },
      category: { id: r.category_id, name: r.category_name, slug: r.category_slug },
      product_type_code: r.product_type_code,
      base_image_url: r.base_image_url,
      price_min: formatMoney(r.price_min) ?? '0.00',
      price_max: formatMoney(r.price_max) ?? '0.00',
      in_stock: r.in_stock,
    }));
    return {
      items,
      pagination: buildPagination(query.page, query.page_size, total),
    };
  }

  async function buildOptionSchema(productTypeCode: ProductTypeCode): Promise<OptionSchemaAttributeDto[]> {
    const result = await pool.query<{
      attribute_id: number;
      attribute_code: string;
      attribute_name: string;
      unit: string | null;
      is_required: boolean;
      value_id: number;
      value_code: string;
      value_label: string;
    }>(
      `SELECT attribute_id, attribute_code, attribute_name, unit, is_required,
              value_id, value_code, value_label
       FROM app.vw_product_type_options
       WHERE product_type_code = $1
       ORDER BY sort_order ASC, attribute_id ASC, value_sort_order ASC, value_id ASC`,
      [productTypeCode],
    );

    const map = new Map<number, OptionSchemaAttributeDto>();
    for (const r of result.rows) {
      let entry = map.get(r.attribute_id);
      if (!entry) {
        entry = {
          attribute_id: r.attribute_id,
          code: r.attribute_code,
          label: r.unit ? `${r.attribute_name} (${r.unit})` : r.attribute_name,
          required: r.is_required,
          values: [],
        };
        map.set(r.attribute_id, entry);
      }
      entry.values.push({ id: r.value_id, code: r.value_code, label: r.value_label });
    }
    return [...map.values()];
  }

  async function getPublicProductDetail(lookup: { id: number } | { slug: string }): Promise<ProductDetailDto> {
    const whereClause = 'id' in lookup ? 'p.id = $1' : 'p.slug = $1';
    const param = 'id' in lookup ? lookup.id : lookup.slug;

    const prodResult = await pool.query<{
      id: number;
      name: string;
      slug: string;
      description: string | null;
      brand_id: number;
      brand_name: string;
      brand_slug: string;
      category_id: number;
      category_name: string;
      category_slug: string;
      product_type_code: ProductTypeCode;
      price_min: string;
      price_max: string;
      in_stock: boolean;
    }>(
      `SELECT p.id, p.name, p.slug, p.description,
              b.id AS brand_id, b.name AS brand_name, b.slug AS brand_slug,
              c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
              p.product_type_code, p.price_min::text, p.price_max::text, p.in_stock
       FROM app.vw_catalog_products p
       JOIN app.vw_public_brands b ON b.id = p.brand_id
       JOIN app.vw_public_categories c ON c.id = p.category_id
       WHERE ${whereClause}`,
      [param],
    );
    const prod = prodResult.rows[0];
    if (!prod) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sản phẩm.');

    // Batch queries (no N+1): images, variants, options, and option_schema
    const [imagesRes, variantsRes, optionsRes, optionSchema] = await Promise.all([
      pool.query<{
        id: number;
        product_id: number;
        variant_id: number | null;
        asset_path: string;
        alt_text: string;
        sort_order: number;
        is_primary: boolean;
        created_at: Date | string;
      }>(
        `SELECT id, product_id, variant_id, asset_path::text AS asset_path, alt_text, sort_order, is_primary, created_at
         FROM app.vw_catalog_images
         WHERE product_id = $1
         ORDER BY sort_order ASC, id ASC`,
        [prod.id],
      ),
      pool.query<{
        id: number;
        product_id: number;
        sku: string;
        price: string;
        list_price: string | null;
        stock_quantity: number;
      }>(
        `SELECT id, product_id, sku, price::text, list_price::text, stock_quantity
         FROM app.vw_catalog_variants
         WHERE product_id = $1
         ORDER BY id ASC`,
        [prod.id],
      ),
      pool.query<OptionDto & { variant_id: number }>(
        `SELECT o.variant_id, o.attribute_id, o.code, o.label, o.value_id, o.value_code, o.value_label
         FROM app.vw_catalog_variant_options o
         JOIN app.vw_catalog_variants v ON v.id = o.variant_id
         WHERE v.product_id = $1
         ORDER BY o.variant_id ASC, o.attribute_id ASC`,
        [prod.id],
      ),
      buildOptionSchema(prod.product_type_code),
    ]);

    const images: ImageDto[] = imagesRes.rows.map((img) => ({
      ...img,
      created_at: toIso(img.created_at),
    }));

    const optionsByVariant = new Map<number, OptionDto[]>();
    for (const opt of optionsRes.rows) {
      const list = optionsByVariant.get(opt.variant_id) ?? [];
      list.push({
        attribute_id: opt.attribute_id,
        code: opt.code,
        label: opt.label,
        value_id: opt.value_id,
        value_code: opt.value_code,
        value_label: opt.value_label,
      });
      optionsByVariant.set(opt.variant_id, list);
    }

    const imagesByVariant = new Map<number, ImageDto[]>();
    for (const img of images) {
      if (img.variant_id !== null) {
        const list = imagesByVariant.get(img.variant_id) ?? [];
        list.push(img);
        imagesByVariant.set(img.variant_id, list);
      }
    }

    const primaryProductImg = images.find((i) => i.variant_id === null && i.is_primary) ?? images[0] ?? null;

    const variants: VariantDto[] = variantsRes.rows.map((v) =>
      attachVariantAliases({
        id: v.id,
        product_id: v.product_id,
        sku: v.sku,
        options: optionsByVariant.get(v.id) ?? [],
        price: formatMoney(v.price) ?? '0.00',
        list_price: formatMoney(v.list_price),
        stock_quantity: v.stock_quantity,
        is_active: true,
        images: imagesByVariant.get(v.id) ?? [],
      }),
    );

    return {
      id: prod.id,
      name: prod.name,
      slug: prod.slug,
      description: prod.description,
      brand: { id: prod.brand_id, name: prod.brand_name, slug: prod.brand_slug },
      category: { id: prod.category_id, name: prod.category_name, slug: prod.category_slug },
      product_type_code: prod.product_type_code,
      base_image_url: primaryProductImg?.asset_path ?? null,
      price_min: formatMoney(prod.price_min) ?? '0.00',
      price_max: formatMoney(prod.price_max) ?? '0.00',
      in_stock: prod.in_stock,
      images,
      variants,
      option_schema: optionSchema,
    };
  }

  async function listPublicBanners(page: number, pageSize: number, placement?: 'HERO' | 'PROMO') {
    const offset = (page - 1) * pageSize;
    const result = await pool.query<{
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
      starts_at: Date | string;
      ends_at: Date | string;
      sort_order: number;
      is_active: boolean;
      target_path: string | null;
      total_count: string;
    }>(
      `WITH filtered AS (
         SELECT b.id, b.title, b.desktop_path::text AS desktop_path, b.mobile_path::text AS mobile_path,
                b.alt_text, b.placement, b.target_type, b.product_id, b.category_id, b.brand_id,
                b.starts_at, b.ends_at, b.sort_order, b.is_active,
                CASE
                  WHEN b.target_type = 'PRODUCT' THEN '/products/' || p.slug
                  WHEN b.target_type = 'CATEGORY' THEN '/categories/' || c.slug
                  WHEN b.target_type = 'BRAND' THEN '/brands/' || br.slug
                  ELSE NULL
                END AS target_path
         FROM app.vw_public_banners b
         LEFT JOIN app.vw_catalog_products p ON p.id = b.product_id
         LEFT JOIN app.vw_public_categories c ON c.id = b.category_id
         LEFT JOIN app.vw_public_brands br ON br.id = b.brand_id
         WHERE ($1::text IS NULL OR b.placement = $1)
       ), counted AS (SELECT count(*)::bigint AS total_count FROM filtered)
       SELECT f.*, cnt.total_count
       FROM filtered f CROSS JOIN counted cnt
       ORDER BY f.sort_order ASC, f.id ASC
       LIMIT $2 OFFSET $3`,
      [placement ?? null, pageSize, offset],
    );
    const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    const items: BannerDto[] = result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      desktop_path: r.desktop_path,
      mobile_path: r.mobile_path,
      alt_text: r.alt_text,
      placement: r.placement,
      target_type: r.target_type,
      product_id: r.product_id,
      category_id: r.category_id,
      brand_id: r.brand_id,
      starts_at: toIso(r.starts_at),
      ends_at: toIso(r.ends_at),
      sort_order: r.sort_order,
      is_active: r.is_active,
      target_path: r.target_path,
    }));
    return {
      items,
      pagination: buildPagination(page, pageSize, total),
    };
  }

  // Admin Methods
  async function listAdminBrands(
    actorId: number,
    query: { page: number; page_size: number; search?: string | undefined; is_active?: boolean | undefined },
  ) {
    const res = await pool.query<BrandDto & { total_count: string }>(
      'SELECT * FROM app.fn_read_admin_brands($1, $2, $3, $4, $5)',
      [actorId, query.page, query.page_size, query.search ?? null, query.is_active ?? null],
    );
    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map(({ total_count: _t, ...b }) => ({
        ...b,
        created_at: toIso(b.created_at),
        updated_at: toIso(b.updated_at),
      })),
      pagination: buildPagination(query.page, query.page_size, total),
    };
  }

  async function getAdminBrand(actorId: number, id: number): Promise<BrandDto> {
    const res = await pool.query<BrandDto>('SELECT * FROM app.fn_read_admin_brand($1, $2)', [actorId, id]);
    const row = res.rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy thương hiệu.');
    return { ...row, created_at: toIso(row.created_at), updated_at: toIso(row.updated_at) };
  }

  async function upsertBrand(
    actorId: number,
    id: number | null,
    input: { name: string; slug: string; description: string | null; logo_path: string | null; is_active: boolean },
    requestId: string,
  ): Promise<BrandDto> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<BrandDto>(
        'SELECT * FROM app.fn_upsert_brand($1, $2, $3, $4, $5, $6, $7, $8::uuid)',
        [actorId, id, input.name, input.slug, input.description, input.logo_path, input.is_active, requestId],
      );
      const row = res.rows[0]!;
      return { ...row, created_at: toIso(row.created_at), updated_at: toIso(row.updated_at) };
    });
  }

  async function listAdminCategories(
    actorId: number,
    query: { page: number; page_size: number; search?: string | undefined; is_active?: boolean | undefined },
  ) {
    const res = await pool.query<CategoryDto & { total_count: string }>(
      'SELECT * FROM app.fn_read_admin_categories($1, $2, $3, $4, $5)',
      [actorId, query.page, query.page_size, query.search ?? null, query.is_active ?? null],
    );
    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map(({ total_count: _t, ...c }) => ({
        ...c,
        created_at: toIso(c.created_at),
      })),
      pagination: buildPagination(query.page, query.page_size, total),
    };
  }

  async function getAdminCategory(actorId: number, id: number): Promise<CategoryDto> {
    const res = await pool.query<CategoryDto>('SELECT * FROM app.fn_read_admin_category($1, $2)', [actorId, id]);
    const row = res.rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy danh mục.');
    return { ...row, created_at: toIso(row.created_at) };
  }

  async function upsertCategory(
    actorId: number,
    id: number | null,
    input: { name: string; slug: string; description: string | null; is_active: boolean },
    requestId: string,
  ): Promise<CategoryDto> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<CategoryDto>(
        'SELECT * FROM app.fn_upsert_category($1, $2, $3, $4, $5, $6, $7::uuid)',
        [actorId, id, input.name, input.slug, input.description, input.is_active, requestId],
      );
      const row = res.rows[0]!;
      return { ...row, created_at: toIso(row.created_at) };
    });
  }

  async function listAdminProducts(
    actorId: number,
    query: {
      page: number;
      page_size: number;
      search?: string | undefined;
      brand_id?: number | undefined;
      category_id?: number | undefined;
      product_type?: ProductTypeCode | undefined;
      is_active?: boolean | undefined;
    },
  ) {
    const res = await pool.query<{
      id: number;
      name: string;
      slug: string;
      brand_id: number;
      brand_name: string;
      brand_slug: string;
      category_id: number;
      category_name: string;
      category_slug: string;
      product_type_code: ProductTypeCode;
      base_image_url: string | null;
      price_min: string;
      price_max: string;
      in_stock: boolean;
      is_active: boolean;
      created_at: Date | string;
      updated_at: Date | string;
      total_count: string;
    }>(
      'SELECT * FROM app.fn_read_admin_products($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        actorId,
        query.page,
        query.page_size,
        query.search ?? null,
        query.brand_id ?? null,
        query.category_id ?? null,
        query.product_type ?? null,
        query.is_active ?? null,
      ],
    );
    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    const items: AdminProductCardDto[] = res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      brand: { id: r.brand_id, name: r.brand_name, slug: r.brand_slug },
      category: { id: r.category_id, name: r.category_name, slug: r.category_slug },
      product_type_code: r.product_type_code,
      base_image_url: r.base_image_url,
      price_min: formatMoney(r.price_min) ?? '0.00',
      price_max: formatMoney(r.price_max) ?? '0.00',
      in_stock: r.in_stock,
      is_active: r.is_active,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
    }));
    return { items, pagination: buildPagination(query.page, query.page_size, total) };
  }

  async function getAdminProduct(actorId: number, productId: number): Promise<AdminProductDetailDto> {
    const res = await pool.query<{ fn_read_admin_product: AdminProductDetailDto }>(
      'SELECT app.fn_read_admin_product($1, $2)',
      [actorId, productId],
    );
    const raw = res.rows[0]?.fn_read_admin_product;
    if (!raw) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy sản phẩm.');
    const optionSchema = await buildOptionSchema(raw.product_type_code);
    return {
      ...raw,
      created_at: toIso(raw.created_at),
      updated_at: toIso(raw.updated_at),
      images: raw.images.map((i) => ({ ...i, created_at: toIso(i.created_at) })),
      variants: raw.variants.map((v) =>
        attachVariantAliases({
          ...v,
          images: v.images.map((i) => ({ ...i, created_at: toIso(i.created_at) })),
        }),
      ),
      option_schema: optionSchema,
    };
  }

  async function upsertProduct(
    actorId: number,
    id: number | null,
    input: {
      name: string;
      slug: string;
      category_id: number;
      brand_id: number;
      product_type_code: string;
      description: string | null;
      is_active: boolean;
    },
    requestId: string,
  ) {
    return withTransaction(pool, async (client) => {
      const res = await client.query<{
        id: number;
        category_id: number;
        brand_id: number;
        product_type_code: ProductTypeCode;
        name: string;
        slug: string;
        description: string | null;
        is_active: boolean;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        'SELECT * FROM app.fn_upsert_product($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)',
        [
          actorId,
          id,
          input.name,
          input.slug,
          input.category_id,
          input.brand_id,
          input.product_type_code,
          input.description,
          input.is_active,
          requestId,
        ],
      );
      const row = res.rows[0]!;
      return {
        ...row,
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
      };
    });
  }

  async function createVariant(
    actorId: number,
    productId: number,
    input: {
      sku: string;
      price: string;
      list_price: string | null;
      options: Array<{ attribute_id: number; value_id: number }>;
      is_active: boolean;
    },
    requestId: string,
  ): Promise<VariantDto> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<{ fn_create_variant: Omit<VariantDto, 'color' | 'size'> }>(
        'SELECT app.fn_create_variant($1, $2, $3, $4::numeric, $5::numeric, $6::jsonb, $7, $8::uuid)',
        [
          actorId,
          productId,
          input.sku,
          input.price,
          input.list_price,
          JSON.stringify(input.options),
          input.is_active,
          requestId,
        ],
      );
      return attachVariantAliases(res.rows[0]!.fn_create_variant);
    });
  }

  async function updateVariant(
    actorId: number,
    variantId: number,
    input: { price: string; list_price: string | null; is_active: boolean },
    requestId: string,
  ): Promise<VariantDto> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<{ fn_update_variant: Omit<VariantDto, 'color' | 'size'> }>(
        'SELECT app.fn_update_variant($1, $2, $3::numeric, $4::numeric, $5, $6::uuid)',
        [actorId, variantId, input.price, input.list_price, input.is_active, requestId],
      );
      const raw = res.rows[0]!.fn_update_variant;
      return attachVariantAliases({
        ...raw,
        images: raw.images.map((i) => ({ ...i, created_at: toIso(i.created_at) })),
      });
    });
  }

  async function addProductImage(
    actorId: number,
    productId: number,
    input: {
      variant_id: number | null;
      asset_path: string;
      alt_text: string;
      sort_order: number;
      is_primary: boolean;
    },
    requestId: string,
  ): Promise<ImageDto> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<ImageDto>(
        'SELECT * FROM app.fn_add_product_image($1, $2, $3, $4, $5, $6, $7, $8::uuid)',
        [
          actorId,
          productId,
          input.variant_id,
          input.asset_path,
          input.alt_text,
          input.sort_order,
          input.is_primary,
          requestId,
        ],
      );
      const row = res.rows[0]!;
      return { ...row, created_at: toIso(row.created_at) };
    });
  }

  async function updateProductImage(
    actorId: number,
    imageId: number,
    input: { asset_path: string; alt_text: string; sort_order: number; is_primary: boolean },
    requestId: string,
  ): Promise<ImageDto> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<ImageDto>(
        'SELECT * FROM app.fn_update_product_image($1, $2, $3, $4, $5, $6, $7::uuid)',
        [actorId, imageId, input.asset_path, input.alt_text, input.sort_order, input.is_primary, requestId],
      );
      const row = res.rows[0]!;
      return { ...row, created_at: toIso(row.created_at) };
    });
  }

  async function deleteProductImage(actorId: number, imageId: number, requestId: string) {
    return withTransaction(pool, async (client) => {
      await client.query('SELECT app.fn_delete_product_image($1, $2, $3::uuid)', [actorId, imageId, requestId]);
      return { removed: true };
    });
  }

  async function listAdminBanners(
    actorId: number,
    query: { page: number; page_size: number; placement?: 'HERO' | 'PROMO' | undefined; is_active?: boolean | undefined },
  ) {
    const res = await pool.query<BannerDto & { total_count: string }>(
      'SELECT * FROM app.fn_read_admin_banners($1, $2, $3, $4, $5)',
      [actorId, query.page, query.page_size, query.placement ?? null, query.is_active ?? null],
    );
    const total = res.rows[0] ? Number(res.rows[0].total_count) : 0;
    return {
      items: res.rows.map(({ total_count: _t, ...b }) => ({
        ...b,
        starts_at: toIso(b.starts_at),
        ends_at: toIso(b.ends_at),
      })),
      pagination: buildPagination(query.page, query.page_size, total),
    };
  }

  async function getAdminBanner(actorId: number, id: number): Promise<BannerDto> {
    const res = await pool.query<BannerDto>('SELECT * FROM app.fn_read_admin_banner($1, $2)', [actorId, id]);
    const row = res.rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy banner.');
    return { ...row, starts_at: toIso(row.starts_at), ends_at: toIso(row.ends_at) };
  }

  async function manageBanner(
    actorId: number,
    id: number | null,
    input: {
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
    },
    requestId: string,
  ): Promise<BannerDto> {
    return withTransaction(pool, async (client) => {
      const res = await client.query<BannerDto>(
        'SELECT * FROM app.fn_manage_banner($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13::timestamptz, $14, $15, $16::uuid)',
        [
          actorId,
          id,
          input.title,
          input.desktop_path,
          input.mobile_path,
          input.alt_text,
          input.placement,
          input.target_type,
          input.product_id,
          input.category_id,
          input.brand_id,
          input.starts_at,
          input.ends_at,
          input.sort_order,
          input.is_active,
          requestId,
        ],
      );
      const row = res.rows[0]!;
      return { ...row, starts_at: toIso(row.starts_at), ends_at: toIso(row.ends_at) };
    });
  }

  return {
    listPublicCategories,
    getPublicCategoryBySlug,
    listPublicBrands,
    getPublicBrandBySlug,
    listProductTypes,
    listPublicProducts,
    getPublicProductDetail,
    listPublicBanners,
    listAdminBrands,
    getAdminBrand,
    upsertBrand,
    listAdminCategories,
    getAdminCategory,
    upsertCategory,
    listAdminProducts,
    getAdminProduct,
    upsertProduct,
    createVariant,
    updateVariant,
    addProductImage,
    updateProductImage,
    deleteProductImage,
    listAdminBanners,
    getAdminBanner,
    manageBanner,
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
