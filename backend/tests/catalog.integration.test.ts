import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';

function loadDbSettings() {
  let local: Record<string, string> = {};
  try {
    local = parse(readFileSync(new URL('../../.env', import.meta.url)));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const env = { ...local, ...process.env };
  const host = env.DB_HOST || '127.0.0.1';
  const port = Number(env.DB_PORT || 5432);
  const adminConfig: pg.ClientConfig = env.MIGRATION_DATABASE_URL
    ? { connectionString: env.MIGRATION_DATABASE_URL }
    : {
        host,
        port,
        database: env.DB_NAME || 'fashion_dev',
        user: 'db_admin',
        password: env.POSTGRES_PASSWORD,
        connectionTimeoutMillis: 3000,
      };
  return { env, host, port, adminConfig };
}

describe('Catalog Backend API + Multi-Brand Demo Seed (Express + PostgreSQL 17.9)', () => {
  const { env, host, port, adminConfig } = loadDbSettings();
  const dbName = `catalog_test_${randomBytes(6).toString('hex')}`;
  const jwtSettings = {
    secret: randomBytes(32).toString('hex'),
    issuer: 'fashion-api',
    audience: 'fashion-web',
  };

  let adminClient: pg.Client;
  let testAdminClient: pg.Client;
  let appPool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    adminClient = new pg.Client(adminConfig);
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`);

    const targetAdminConfig: pg.ClientConfig = adminConfig.connectionString
      ? {
          connectionString: (() => {
            const url = new URL(adminConfig.connectionString);
            url.pathname = `/${dbName}`;
            return url.href;
          })(),
        }
      : { ...adminConfig, database: dbName };

    await runner({
      databaseUrl: targetAdminConfig,
      dir: fileURLToPath(new URL('../../database/migrations/', import.meta.url)),
      migrationsTable: 'pgmigrations',
      direction: 'up',
      checkOrder: true,
      log: () => undefined,
    });

    await adminClient.query(`GRANT CONNECT ON DATABASE "${dbName}" TO app_rw_user`);

    testAdminClient = new pg.Client(targetAdminConfig);
    await testAdminClient.connect();

    // Run both demo seeds (001 base fixture + 002 multi-brand catalog)
    await testAdminClient.query('BEGIN');
    await testAdminClient.query(readFileSync(new URL('../../database/seeds/001_demo.sql', import.meta.url), 'utf8'));
    await testAdminClient.query(readFileSync(new URL('../../database/seeds/002_multibrand_demo.sql', import.meta.url), 'utf8'));
    await testAdminClient.query('COMMIT');

    const pwHash = await hashPassword('CatalogAdmin!123');
    await testAdminClient.query(
      "INSERT INTO app.users(full_name, email, password_hash, role, is_active) VALUES('Catalog Admin', 'admin@catalog-test.invalid', $1, 'ADMIN', TRUE)",
      [pwHash],
    );
    await testAdminClient.query(
      "INSERT INTO app.users(full_name, email, password_hash, role, is_active) VALUES('Catalog Customer', 'customer@catalog-test.invalid', $1, 'CUSTOMER', TRUE)",
      [pwHash],
    );

    if (env.DB_PASSWORD) {
      appPool = new pg.Pool({
        host,
        port,
        database: dbName,
        user: 'app_rw_user',
        password: env.DB_PASSWORD,
        max: 10,
      });
    } else {
      appPool = new pg.Pool({ ...targetAdminConfig, max: 10 });
      appPool.on('connect', (client) => {
        void client.query('SET ROLE app_rw_user');
      });
    }

    app = createApp({
      checkDatabase: async () => { await appPool.query('SELECT 1'); },
      frontendOrigin: 'http://localhost:5173',
      pool: appPool,
      jwt: jwtSettings,
    });

    adminToken = (await request(app).post('/api/auth/login').send({
      email: 'admin@catalog-test.invalid',
      password: 'CatalogAdmin!123',
    })).body.data.access_token as string;

    customerToken = (await request(app).post('/api/auth/login').send({
      email: 'customer@catalog-test.invalid',
      password: 'CatalogAdmin!123',
    })).body.data.access_token as string;
  }, 30_000);

  afterAll(async () => {
    await appPool?.end().catch(() => undefined);
    await testAdminClient?.end().catch(() => undefined);
    if (adminClient) {
      await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
      await adminClient.end().catch(() => undefined);
    }
  });

  it('serves multi-brand demo categories, brands, 6 product types, and scheduled banners', async () => {
    const cats = await request(app).get('/api/categories?page=1&page_size=20');
    expect(cats.status).toBe(200);
    const catSlugs = (cats.body.data.items as Array<{ slug: string }>).map((c) => c.slug);
    for (const slug of ['fashion', 'shoes', 'bags', 'watches', 'accessories', 'perfumes']) {
      expect(catSlugs).toContain(slug);
    }

    const catBySlug = await request(app).get('/api/categories/by-slug/perfumes');
    expect(catBySlug.status).toBe(200);
    expect(catBySlug.body.data.name).toBe('Perfumes');

    const brands = await request(app).get('/api/brands?search=Essence');
    expect(brands.status).toBe(200);
    expect(brands.body.data.items).toHaveLength(1);
    expect(brands.body.data.items[0].slug).toBe('essence-lab');

    const brandBySlug = await request(app).get('/api/brands/by-slug/nordic-peak');
    expect(brandBySlug.status).toBe(200);
    expect(brandBySlug.body.data.name).toBe('Nordic Peak');

    const types = await request(app).get('/api/product-types');
    expect(types.status).toBe(200);
    expect(types.body.data.items.map((t: { code: string }) => t.code).sort()).toEqual([
      'ACCESSORIES', 'BAGS', 'CLOTHING', 'PERFUME', 'SHOES', 'WATCHES',
    ]);

    const banners = await request(app).get('/api/banners?placement=HERO');
    expect(banners.status).toBe(200);
    expect(banners.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(banners.body.data.items[0].target_path).toBe('/categories/fashion');
  });

  it('filters, searches, sorts, paginates GET /api/products and enforces same-SKU price+in_stock', async () => {
    const all = await request(app).get('/api/products?page=1&page_size=5&sort=price_asc');
    expect(all.status).toBe(200);
    expect(all.body.data.items).toHaveLength(5);
    expect(all.body.meta.pagination.total).toBeGreaterThanOrEqual(8);

    const prices = (all.body.data.items as Array<{ price_min: string }>).map((p) => Number(p.price_min));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    // Search + brand filter
    const searchRes = await request(app).get('/api/products?search=Sneaker&sort=price_desc');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data.items).toHaveLength(1);
    expect(searchRes.body.data.items[0].slug).toBe('giay-sneaker-urban-runner');

    // Validation errors (min_price > max_price, invalid boolean, unknown sort)
    expect((await request(app).get('/api/products?min_price=500000.00&max_price=100000.00')).status).toBe(400);
    expect((await request(app).get('/api/products?in_stock=maybe')).status).toBe(400);
    expect((await request(app).get('/api/products?sort=invalid')).status).toBe(400);

    // V13 same-SKU check: giay-sneaker-urban-runner has EU40/42 at 1650000.00 (in stock) and US9 at 1750000.00 (0 stock!)
    const matchOutOfStockPrice = await request(app).get(
      '/api/products?product_type=SHOES&min_price=1700000.00&max_price=1800000.00',
    );
    expect(matchOutOfStockPrice.status).toBe(200);
    expect(matchOutOfStockPrice.body.data.items).toHaveLength(1);

    const mixPriceAndStock = await request(app).get(
      '/api/products?product_type=SHOES&min_price=1700000.00&max_price=1800000.00&in_stock=true',
    );
    expect(mixPriceAndStock.status).toBe(200);
    expect(mixPriceAndStock.body.data.items).toHaveLength(0);
  });

  it('returns complete ProductDetail by slug and id, hiding draft/inactive products', async () => {
    const bySlug = await request(app).get('/api/products/by-slug/ao-hoodie-maison-classic');
    expect(bySlug.status).toBe(200);
    const detail = bySlug.body.data;
    expect(detail.brand.slug).toBe('maison-atelier');
    expect(detail.category.slug).toBe('fashion');
    expect(detail.images.length).toBeGreaterThanOrEqual(2);
    expect(detail.variants.length).toBe(2);
    const whiteVariant = (detail.variants as Array<{ sku: string; price: string; list_price: string | null; stock_quantity: number }>).find(
      (v) => v.sku === 'MA-HOODIE-WHT-M',
    );
    expect(whiteVariant).toMatchObject({
      sku: 'MA-HOODIE-WHT-M',
      price: '1450000.00',
      list_price: '1750000.00',
    });
    expect(typeof whiteVariant?.stock_quantity).toBe('number');
    expect(detail.option_schema.length).toBe(2);

    const byId = await request(app).get(`/api/products/${detail.id}`);
    expect(byId.status).toBe(200);
    expect(byId.body.data.slug).toBe('ao-hoodie-maison-classic');

    // Draft product from 001_demo.sql is hidden from public endpoints
    const draftRes = await request(app).get('/api/products/by-slug/seed-demo-clothing');
    expect(draftRes.status).toBe(404);
  });

  it('enforces ADMIN authorization and supports full catalog/variant/image/banner lifecycle', async () => {
    // Non-admin rejected with 403; unauthenticated rejected with 401
    expect((await request(app).post('/api/brands').send({ name: 'X', slug: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/brands').set('Authorization', `Bearer ${customerToken}`).send({ name: 'X', slug: 'x' })).status).toBe(403);
    expect((await request(app).get('/api/admin/products').set('Authorization', `Bearer ${customerToken}`)).status).toBe(403);

    // Create & update Brand and Category
    const brandRes = await request(app)
      .post('/api/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Atelier Test', slug: 'atelier-test', description: 'Brand mới', logo_path: '/media/sanphamdemo5.jpg', is_active: true });
    expect(brandRes.status).toBe(201);
    const brandId = brandRes.body.data.id as number;

    const brandPut = await request(app)
      .put(`/api/brands/${brandId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Atelier Test Updated', description: 'Mô tả mới', logo_path: null, is_active: true });
    expect(brandPut.status).toBe(200);
    expect(brandPut.body.data.name).toBe('Atelier Test Updated');

    const catRes = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Limited Drops', slug: 'limited-drops', description: null, is_active: true });
    expect(catRes.status).toBe(201);
    const categoryId = catRes.body.data.id as number;

    // Create draft product; creating directly active is rejected
    const badActiveCreate = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad', slug: 'bad-prod', category_id: categoryId, brand_id: brandId, product_type_code: 'PERFUME', is_active: true });
    expect(badActiveCreate.status).toBe(400);

    const prodCreate = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nước Hoa Atelier Test', slug: 'nuoc-hoa-atelier-test', category_id: categoryId, brand_id: brandId, product_type_code: 'PERFUME', description: 'Hương mới' });
    expect(prodCreate.status).toBe(201);
    expect(prodCreate.body.data.is_active).toBe(false);
    const productId = prodCreate.body.data.id as number;

    // Cannot publish without SKU and image -> 409 PRODUCT_NOT_PUBLISHABLE
    const earlyPublish = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nước Hoa Atelier Test', category_id: categoryId, brand_id: brandId, description: 'Hương mới', is_active: true });
    expect(earlyPublish.status).toBe(409);
    expect(earlyPublish.body.error.code).toBe('PRODUCT_NOT_PUBLISHABLE');

    // Look up PERFUME option IDs from /api/product-types
    const types = (await request(app).get('/api/product-types')).body.data.items as Array<{
      code: string;
      attributes: Array<{ id: number; code: string; values: Array<{ id: number; code: string }> }>;
    }>;
    const perfumeType = types.find((t) => t.code === 'PERFUME')!;
    const volAttr = perfumeType.attributes.find((a) => a.code === 'volume_ml')!;
    const concAttr = perfumeType.attributes.find((a) => a.code === 'concentration')!;

    // Missing required concentration -> 400 VARIANT_OPTIONS_INVALID
    const badVariant = await request(app)
      .post(`/api/products/${productId}/variants`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sku: 'ATELIER-50-BAD',
        price: '1200000.00',
        options: [{ attribute_id: volAttr.id, value_id: volAttr.values[0]!.id }],
      });
    expect(badVariant.status).toBe(400);
    expect(badVariant.body.error.code).toBe('VARIANT_OPTIONS_INVALID');

    // Valid PERFUME variant
    const varRes = await request(app)
      .post(`/api/products/${productId}/variants`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sku: 'ATELIER-50-EDP',
        price: '1200000.00',
        list_price: '1500000.00',
        options: [
          { attribute_id: volAttr.id, value_id: volAttr.values[0]!.id },
          { attribute_id: concAttr.id, value_id: concAttr.values[0]!.id },
        ],
      });
    expect(varRes.status).toBe(201);
    expect(varRes.body.data.stock_quantity).toBe(0);
    const variantId = varRes.body.data.id as number;

    // Duplicate combo -> 409 DUPLICATE_VARIANT
    const dupCombo = await request(app)
      .post(`/api/products/${productId}/variants`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sku: 'ATELIER-50-EDP-2',
        price: '1200000.00',
        options: [
          { attribute_id: volAttr.id, value_id: volAttr.values[0]!.id },
          { attribute_id: concAttr.id, value_id: concAttr.values[0]!.id },
        ],
      });
    expect(dupCombo.status).toBe(409);
    expect(dupCombo.body.error.code).toBe('DUPLICATE_VARIANT');

    // Add gallery image & reject path traversal
    const badImg = await request(app)
      .post(`/api/products/${productId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ asset_path: '/media/../secret.png', alt_text: 'Bad' });
    expect(badImg.status).toBe(400);

    const imgRes = await request(app)
      .post(`/api/products/${productId}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ asset_path: '/media/sanphamdemo2.jpg', alt_text: 'Chai nước hoa demo', is_primary: true });
    expect(imgRes.status).toBe(201);
    const imageId = imgRes.body.data.id as number;

    // Publish product -> 200 and now visible in public catalog
    const publishOk = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nước Hoa Atelier Test', category_id: categoryId, brand_id: brandId, description: 'Hương mới', is_active: true });
    expect(publishOk.status).toBe(200);
    expect(publishOk.body.data.is_active).toBe(true);

    const pubDetail = await request(app).get('/api/products/by-slug/nuoc-hoa-atelier-test');
    expect(pubDetail.status).toBe(200);

    // Cannot delete last image while product is active -> 409 LAST_PRODUCT_IMAGE
    const delLastImg = await request(app)
      .delete(`/api/product-images/${imageId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delLastImg.status).toBe(409);
    expect(delLastImg.body.error.code).toBe('LAST_PRODUCT_IMAGE');

    // Cannot deactivate last active variant while product is active -> 409 PRODUCT_NOT_PUBLISHABLE
    const deactivateLastVar = await request(app)
      .put(`/api/variants/${variantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: '1200000.00', list_price: null, is_active: false });
    expect(deactivateLastVar.status).toBe(409);
    expect(deactivateLastVar.body.error.code).toBe('PRODUCT_NOT_PUBLISHABLE');

    // Update variant price -> 200
    const priceUpd = await request(app)
      .put(`/api/variants/${variantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: '1350000.00', list_price: '1600000.00', is_active: true });
    expect(priceUpd.status).toBe(200);
    expect(priceUpd.body.data.price).toBe('1350000.00');

    // Banner CRUD
    const bannerCreate = await request(app)
      .post('/api/admin/banners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Banner Nước Hoa Mới',
        desktop_path: '/media/styleweb.png',
        alt_text: 'Banner mới',
        placement: 'PROMO',
        target_type: 'PRODUCT',
        product_id: productId,
        starts_at: '2026-01-01T00:00:00Z',
        ends_at: '2030-01-01T00:00:00Z',
        is_active: true,
      });
    expect(bannerCreate.status).toBe(201);
    expect(bannerCreate.body.data.target_path).toBe('/products/nuoc-hoa-atelier-test');

    // Deactivate product -> hides product and banner from public endpoints
    await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nước Hoa Atelier Test', category_id: categoryId, brand_id: brandId, description: 'Hương mới', is_active: false });
    expect((await request(app).get('/api/products/by-slug/nuoc-hoa-atelier-test')).status).toBe(404);
    const adminProd = await request(app).get(`/api/admin/products/${productId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(adminProd.status).toBe(200);
    expect(adminProd.body.data.is_active).toBe(false);
  });
});
