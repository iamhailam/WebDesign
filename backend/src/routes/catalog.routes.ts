import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/rbac.js';
import { ApiError } from '../http/error.js';
import { validateBody } from '../middlewares/validate.js';
import type { CatalogService } from '../services/catalog.service.js';
import { PRODUCT_TYPES } from '../types/catalog.js';

const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const skuRegex = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const assetPathRegex = /^\/(images|media)\/[A-Za-z0-9/_-]+\.(png|jpg|jpeg|webp|avif|svg)$/;
const moneyRegex = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;

const assetPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(assetPathRegex, 'Đường dẫn tài sản nội bộ không hợp lệ.')
  .refine((v) => !v.includes('//'), 'Đường dẫn không hợp lệ.');

const moneySchema = z
  .string()
  .trim()
  .regex(moneyRegex, 'Số tiền phải là chuỗi số hợp lệ (tối đa 2 số lẻ).')
  .transform((v) => {
    const [whole, frac = ''] = v.split('.');
    return `${whole}.${frac.padEnd(2, '0')}`;
  });

const optionalBooleanQuery = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}, z.boolean().optional());

const optionalPositiveIntQuery = z.preprocess(
  (value) => (value === undefined || value === '' ? undefined : value),
  z.coerce.number().int().min(1).max(2147483647).optional(),
);

const optionalMoneyQuery = z.preprocess(
  (value) => (value === undefined || value === '' ? undefined : value),
  moneySchema.optional(),
);

const paginationQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const publicBrandQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).max(100).optional()),
});

const publicProductsQuery = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    category_id: optionalPositiveIntQuery,
    brand_id: optionalPositiveIntQuery,
    product_type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PRODUCT_TYPES).optional()),
    search: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).max(100).optional()),
    min_price: optionalMoneyQuery,
    max_price: optionalMoneyQuery,
    in_stock: optionalBooleanQuery,
    sort: z.enum(['newest', 'price_asc', 'price_desc', 'name_asc']).default('newest'),
  })
  .refine(
    (q) => q.min_price === undefined || q.max_price === undefined || Number(q.min_price) <= Number(q.max_price),
    { message: 'min_price không được lớn hơn max_price.', path: ['min_price'] },
  );

const publicBannersQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  placement: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['HERO', 'PROMO']).optional()),
});

const adminEntityListQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).max(100).optional()),
  is_active: optionalBooleanQuery,
});

const adminProductsQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).max(100).optional()),
  brand_id: optionalPositiveIntQuery,
  category_id: optionalPositiveIntQuery,
  product_type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PRODUCT_TYPES).optional()),
  is_active: optionalBooleanQuery,
});

const adminBannersQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  placement: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['HERO', 'PROMO']).optional()),
  is_active: optionalBooleanQuery,
});

const nullableDescription = (max: number) =>
  z.preprocess((v) => (v === undefined ? null : v), z.string().trim().max(max).nullable());

const brandCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(160).regex(slugRegex),
  description: nullableDescription(10000),
  logo_path: z.preprocess((v) => (v === undefined ? null : v), assetPathSchema.nullable()),
  is_active: z.boolean().default(true),
});

const brandUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: nullableDescription(10000),
  logo_path: assetPathSchema.nullable(),
  is_active: z.boolean(),
});

const categoryCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(160).regex(slugRegex),
  description: nullableDescription(10000),
  is_active: z.boolean().default(true),
});

const categoryUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: nullableDescription(10000),
  is_active: z.boolean(),
});

const productCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(220).regex(slugRegex),
  category_id: z.number().int().min(1).max(2147483647),
  brand_id: z.number().int().min(1).max(2147483647),
  product_type_code: z.enum(PRODUCT_TYPES),
  description: nullableDescription(20000),
  is_active: z.literal(false).default(false),
});

const productUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  category_id: z.number().int().min(1).max(2147483647),
  brand_id: z.number().int().min(1).max(2147483647),
  description: nullableDescription(20000),
  is_active: z.boolean(),
});

const variantCreateSchema = z
  .strictObject({
    sku: z.string().trim().toUpperCase().min(1).max(64).regex(skuRegex),
    price: moneySchema,
    list_price: z.preprocess((v) => (v === undefined ? null : v), moneySchema.nullable()),
    options: z.array(
      z.strictObject({
        attribute_id: z.number().int().min(1).max(2147483647),
        value_id: z.number().int().min(1).max(2147483647),
      }),
    ),
    is_active: z.boolean().default(true),
  })
  .refine((v) => v.list_price === null || Number(v.list_price) >= Number(v.price), {
    message: 'list_price phải lớn hơn hoặc bằng price.',
    path: ['list_price'],
  });

const variantUpdateSchema = z
  .strictObject({
    price: moneySchema,
    list_price: moneySchema.nullable(),
    is_active: z.boolean(),
  })
  .refine((v) => v.list_price === null || Number(v.list_price) >= Number(v.price), {
    message: 'list_price phải lớn hơn hoặc bằng price.',
    path: ['list_price'],
  });

const imageCreateSchema = z.strictObject({
  variant_id: z.preprocess((v) => (v === undefined ? null : v), z.number().int().min(1).max(2147483647).nullable()),
  asset_path: assetPathSchema,
  alt_text: z.string().trim().min(1).max(200),
  sort_order: z.number().int().min(0).max(2147483647).default(0),
  is_primary: z.boolean().default(false),
});

const imageUpdateSchema = z.strictObject({
  asset_path: assetPathSchema,
  alt_text: z.string().trim().min(1).max(200),
  sort_order: z.number().int().min(0).max(2147483647),
  is_primary: z.boolean(),
});

const isoDateTime = z.string().datetime({ offset: true });

function validateBannerTarget<T extends {
  target_type: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'BRAND';
  product_id: number | null;
  category_id: number | null;
  brand_id: number | null;
  starts_at: string;
  ends_at: string;
}>(schema: z.ZodType<T>) {
  return schema.superRefine((b, ctx) => {
    if (new Date(b.ends_at).getTime() <= new Date(b.starts_at).getTime()) {
      ctx.addIssue({ code: 'custom', message: 'ends_at phải sau starts_at.', path: ['ends_at'] });
    }
    const validTarget =
      (b.target_type === 'NONE' && b.product_id === null && b.category_id === null && b.brand_id === null) ||
      (b.target_type === 'PRODUCT' && b.product_id !== null && b.category_id === null && b.brand_id === null) ||
      (b.target_type === 'CATEGORY' && b.category_id !== null && b.product_id === null && b.brand_id === null) ||
      (b.target_type === 'BRAND' && b.brand_id !== null && b.product_id === null && b.category_id === null);
    if (!validTarget) {
      ctx.addIssue({ code: 'custom', message: 'target_type không khớp các khóa đích.', path: ['target_type'] });
    }
  });
}

const bannerCreateSchema = validateBannerTarget(
  z.strictObject({
    title: z.string().trim().min(1).max(160),
    desktop_path: assetPathSchema,
    mobile_path: z.preprocess((v) => (v === undefined ? null : v), assetPathSchema.nullable()),
    alt_text: z.string().trim().min(1).max(200),
    placement: z.enum(['HERO', 'PROMO']),
    target_type: z.enum(['NONE', 'PRODUCT', 'CATEGORY', 'BRAND']),
    product_id: z.preprocess((v) => (v === undefined ? null : v), z.number().int().min(1).max(2147483647).nullable()),
    category_id: z.preprocess((v) => (v === undefined ? null : v), z.number().int().min(1).max(2147483647).nullable()),
    brand_id: z.preprocess((v) => (v === undefined ? null : v), z.number().int().min(1).max(2147483647).nullable()),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    sort_order: z.number().int().min(0).max(2147483647).default(0),
    is_active: z.boolean().default(false),
  }),
);

const bannerUpdateSchema = validateBannerTarget(
  z.strictObject({
    title: z.string().trim().min(1).max(160),
    desktop_path: assetPathSchema,
    mobile_path: assetPathSchema.nullable(),
    alt_text: z.string().trim().min(1).max(200),
    placement: z.enum(['HERO', 'PROMO']),
    target_type: z.enum(['NONE', 'PRODUCT', 'CATEGORY', 'BRAND']),
    product_id: z.number().int().min(1).max(2147483647).nullable(),
    category_id: z.number().int().min(1).max(2147483647).nullable(),
    brand_id: z.number().int().min(1).max(2147483647).nullable(),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    sort_order: z.number().int().min(0).max(2147483647),
    is_active: z.boolean(),
  }),
);

function parsePositiveId(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'ID không hợp lệ.', {
      fields: [{ field: 'id', reason: 'ID phải là số nguyên dương.' }],
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 2147483647) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'ID không hợp lệ.', {
      fields: [{ field: 'id', reason: 'ID vượt giới hạn.' }],
    });
  }
  return value;
}

function parseSlug(raw: string | string[] | undefined): string {
  if (typeof raw !== 'string' || raw.length > 220 || !slugRegex.test(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Slug không hợp lệ.', {
      fields: [{ field: 'slug', reason: 'Slug chỉ gồm ký tự chữ thường, số và dấu gạch nối.' }],
    });
  }
  return raw;
}

function actorIdFrom(res: { locals: Record<string, unknown> }): number {
  return (res.locals.auth as { id: number }).id;
}

function requestIdFrom(res: { locals: Record<string, unknown> }): string {
  return res.locals.requestId as string;
}

export function createCatalogRouter(
  catalogService: CatalogService,
  requireAuth?: RequestHandler,
): Router {
  const router = Router();

  // Public Catalog & Banner Routes
  router.get('/categories', async (req, res) => {
    const q = paginationQuery.parse(req.query);
    const data = await catalogService.listPublicCategories(q.page, q.page_size);
    res.json({
      success: true,
      data: { items: data.items },
      meta: { request_id: requestIdFrom(res), pagination: data.pagination },
    });
  });

  router.get('/categories/by-slug/:slug', async (req, res) => {
    const slug = parseSlug(req.params.slug);
    const data = await catalogService.getPublicCategoryBySlug(slug);
    res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
  });

  router.get('/brands', async (req, res) => {
    const q = publicBrandQuery.parse(req.query);
    const data = await catalogService.listPublicBrands(q.page, q.page_size, q.search);
    res.json({
      success: true,
      data: { items: data.items },
      meta: { request_id: requestIdFrom(res), pagination: data.pagination },
    });
  });

  router.get('/brands/by-slug/:slug', async (req, res) => {
    const slug = parseSlug(req.params.slug);
    const data = await catalogService.getPublicBrandBySlug(slug);
    res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
  });

  router.get('/product-types', async (_req, res) => {
    const data = await catalogService.listProductTypes();
    res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
  });

  router.get('/products', async (req, res) => {
    const q = publicProductsQuery.parse(req.query);
    const data = await catalogService.listPublicProducts(q);
    res.json({
      success: true,
      data: { items: data.items },
      meta: { request_id: requestIdFrom(res), pagination: data.pagination },
    });
  });

  // Static route registered before /products/:id per API_CONTRACT §1
  router.get('/products/by-slug/:slug', async (req, res) => {
    const slug = parseSlug(req.params.slug);
    const data = await catalogService.getPublicProductDetail({ slug });
    res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
  });

  router.get('/products/:id', async (req, res) => {
    const id = parsePositiveId(req.params.id);
    const data = await catalogService.getPublicProductDetail({ id });
    res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
  });

  router.get('/banners', async (req, res) => {
    const q = publicBannersQuery.parse(req.query);
    const data = await catalogService.listPublicBanners(q.page, q.page_size, q.placement);
    res.json({
      success: true,
      data: { items: data.items },
      meta: { request_id: requestIdFrom(res), pagination: data.pagination },
    });
  });

  if (requireAuth) {
    const adminOnly: RequestHandler[] = [requireAuth, requireRole(['ADMIN'])];

    // Admin read endpoints
    router.get('/admin/brands', ...adminOnly, async (req, res) => {
      const q = adminEntityListQuery.parse(req.query);
      const data = await catalogService.listAdminBrands(actorIdFrom(res), q);
      res.json({
        success: true,
        data: { items: data.items },
        meta: { request_id: requestIdFrom(res), pagination: data.pagination },
      });
    });

    router.get('/admin/brands/:id', ...adminOnly, async (req, res) => {
      const id = parsePositiveId(req.params.id);
      const data = await catalogService.getAdminBrand(actorIdFrom(res), id);
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.get('/admin/categories', ...adminOnly, async (req, res) => {
      const q = adminEntityListQuery.parse(req.query);
      const data = await catalogService.listAdminCategories(actorIdFrom(res), q);
      res.json({
        success: true,
        data: { items: data.items },
        meta: { request_id: requestIdFrom(res), pagination: data.pagination },
      });
    });

    router.get('/admin/categories/:id', ...adminOnly, async (req, res) => {
      const id = parsePositiveId(req.params.id);
      const data = await catalogService.getAdminCategory(actorIdFrom(res), id);
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.get('/admin/products', ...adminOnly, async (req, res) => {
      const q = adminProductsQuery.parse(req.query);
      const data = await catalogService.listAdminProducts(actorIdFrom(res), q);
      res.json({
        success: true,
        data: { items: data.items },
        meta: { request_id: requestIdFrom(res), pagination: data.pagination },
      });
    });

    router.get('/admin/products/:id', ...adminOnly, async (req, res) => {
      const id = parsePositiveId(req.params.id);
      const data = await catalogService.getAdminProduct(actorIdFrom(res), id);
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.get('/admin/banners', ...adminOnly, async (req, res) => {
      const q = adminBannersQuery.parse(req.query);
      const data = await catalogService.listAdminBanners(actorIdFrom(res), q);
      res.json({
        success: true,
        data: { items: data.items },
        meta: { request_id: requestIdFrom(res), pagination: data.pagination },
      });
    });

    router.get('/admin/banners/:id', ...adminOnly, async (req, res) => {
      const id = parsePositiveId(req.params.id);
      const data = await catalogService.getAdminBanner(actorIdFrom(res), id);
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    // Admin write endpoints
    router.post('/brands', ...adminOnly, validateBody(brandCreateSchema), async (req, res) => {
      const body = req.body as z.infer<typeof brandCreateSchema>;
      const data = await catalogService.upsertBrand(actorIdFrom(res), null, body, requestIdFrom(res));
      res.status(201).json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.put('/brands/:id', ...adminOnly, validateBody(brandUpdateSchema), async (req, res) => {
      const id = parsePositiveId(req.params.id);
      const body = req.body as z.infer<typeof brandUpdateSchema>;
      const data = await catalogService.upsertBrand(
        actorIdFrom(res),
        id,
        { ...body, slug: '' },
        requestIdFrom(res),
      );
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.post('/categories', ...adminOnly, validateBody(categoryCreateSchema), async (req, res) => {
      const body = req.body as z.infer<typeof categoryCreateSchema>;
      const data = await catalogService.upsertCategory(actorIdFrom(res), null, body, requestIdFrom(res));
      res.status(201).json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.put('/categories/:id', ...adminOnly, validateBody(categoryUpdateSchema), async (req, res) => {
      const id = parsePositiveId(req.params.id);
      const body = req.body as z.infer<typeof categoryUpdateSchema>;
      const data = await catalogService.upsertCategory(
        actorIdFrom(res),
        id,
        { ...body, slug: '' },
        requestIdFrom(res),
      );
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.post('/products', ...adminOnly, validateBody(productCreateSchema), async (req, res) => {
      const body = req.body as z.infer<typeof productCreateSchema>;
      const data = await catalogService.upsertProduct(actorIdFrom(res), null, body, requestIdFrom(res));
      res.status(201).json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.put('/products/:id', ...adminOnly, validateBody(productUpdateSchema), async (req, res) => {
      const id = parsePositiveId(req.params.id);
      const body = req.body as z.infer<typeof productUpdateSchema>;
      const data = await catalogService.upsertProduct(
        actorIdFrom(res),
        id,
        { ...body, slug: '', product_type_code: 'CLOTHING' },
        requestIdFrom(res),
      );
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.post('/products/:id/variants', ...adminOnly, validateBody(variantCreateSchema), async (req, res) => {
      const productId = parsePositiveId(req.params.id);
      const body = req.body as z.infer<typeof variantCreateSchema>;
      const data = await catalogService.createVariant(actorIdFrom(res), productId, body, requestIdFrom(res));
      res.status(201).json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.put('/variants/:id', ...adminOnly, validateBody(variantUpdateSchema), async (req, res) => {
      const variantId = parsePositiveId(req.params.id);
      const body = req.body as z.infer<typeof variantUpdateSchema>;
      const data = await catalogService.updateVariant(actorIdFrom(res), variantId, body, requestIdFrom(res));
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.post('/products/:id/images', ...adminOnly, validateBody(imageCreateSchema), async (req, res) => {
      const productId = parsePositiveId(req.params.id);
      const body = req.body as z.infer<typeof imageCreateSchema>;
      const data = await catalogService.addProductImage(actorIdFrom(res), productId, body, requestIdFrom(res));
      res.status(201).json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.put('/product-images/:id', ...adminOnly, validateBody(imageUpdateSchema), async (req, res) => {
      const imageId = parsePositiveId(req.params.id);
      const body = req.body as z.infer<typeof imageUpdateSchema>;
      const data = await catalogService.updateProductImage(actorIdFrom(res), imageId, body, requestIdFrom(res));
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.delete('/product-images/:id', ...adminOnly, async (req, res) => {
      const imageId = parsePositiveId(req.params.id);
      const data = await catalogService.deleteProductImage(actorIdFrom(res), imageId, requestIdFrom(res));
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.post('/admin/banners', ...adminOnly, validateBody(bannerCreateSchema), async (req, res) => {
      const body = req.body as z.infer<typeof bannerCreateSchema>;
      const data = await catalogService.manageBanner(actorIdFrom(res), null, body, requestIdFrom(res));
      res.status(201).json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });

    router.put('/admin/banners/:id', ...adminOnly, validateBody(bannerUpdateSchema), async (req, res) => {
      const bannerId = parsePositiveId(req.params.id);
      const body = req.body as z.infer<typeof bannerUpdateSchema>;
      const data = await catalogService.manageBanner(actorIdFrom(res), bannerId, body, requestIdFrom(res));
      res.json({ success: true, data, meta: { request_id: requestIdFrom(res) } });
    });
  }

  return router;
}
