import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { migrationConnection } from '../../scripts/environment.mjs';

const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const migrationCount = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).length;
const seedSql = await readFile(new URL('../seeds/001_demo.sql', import.meta.url), 'utf8');

test('PostgreSQL schema on a newly created empty database', { timeout: 120000 }, async (t) => {
  const config = migrationConnection();
  const admin = new pg.Client(config);
  const name = `schema_test_${randomBytes(8).toString('hex')}`;
  let created = false;
  let db;
  let serial = 0;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const target = config.connectionString
      ? { connectionString: (() => { const url = new URL(config.connectionString); url.pathname = `/${name}`; return url.href; })() }
      : { ...config, database: name };
    const options = { databaseUrl: target, dir: migrationDir, migrationsTable: 'pgmigrations', checkOrder: true, log: () => undefined };
    db = new pg.Client(target);
    await db.connect();
    await t.test('empty database has no app schema; all versioned migrations apply', async () => {
      assert.equal((await db.query("SELECT to_regnamespace('app') AS n")).rows[0].n, null);
      assert.equal((await runner({ ...options, direction: 'up' })).length, migrationCount);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='app' AND table_type='BASE TABLE'")).rows[0].n, 20);
    });
    await t.test('all migrations down then up on empty domain data', async () => {
      assert.equal((await runner({ ...options, direction: 'down', count: Infinity })).length, migrationCount);
      assert.equal((await db.query("SELECT to_regnamespace('app') AS n")).rows[0].n, null);
      assert.equal((await runner({ ...options, direction: 'up' })).length, migrationCount);
      assert.equal((await runner({ ...options, direction: 'up' })).length, 0);
    });
    async function seed() {
      await db.query('BEGIN');
      try { await db.query(seedSql); await db.query('COMMIT'); }
      catch (error) { await db.query('ROLLBACK'); throw error; }
    }
    await t.test('seed twice keeps fixture counts and stock balances unchanged', async () => {
      await seed();
      const snapshot = async () => (await db.query(`SELECT
        (SELECT count(*) FROM app.users) AS users,(SELECT count(*) FROM app.products) AS products,
        (SELECT count(*) FROM app.product_variants) AS variants,(SELECT count(*) FROM app.orders) AS orders,
        (SELECT count(*) FROM app.inventory_transactions) AS movements,(SELECT sum(quantity) FROM app.inventory) AS stock`)).rows[0];
      const before = await snapshot(); await seed(); assert.deepEqual(await snapshot(), before);
      assert.equal(Number(before.products), 6); assert.equal(Number(before.variants), 7);
      assert.equal((await db.query('SELECT count(DISTINCT product_type_code)::int AS n FROM app.products')).rows[0].n, 6);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM app.users WHERE is_active')).rows[0].n, 0);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM app.inventory i WHERE quantity<>(SELECT coalesce(sum(quantity_change),0) FROM app.inventory_transactions x WHERE x.variant_id=i.variant_id)`)).rows[0].n, 0);
    });
    const ids = (await db.query(`SELECT
      (SELECT id FROM app.brands WHERE slug='seed-demo-brand') AS brand,
      (SELECT id FROM app.categories WHERE slug='seed-demo-catalog') AS category,
      (SELECT id FROM app.product_variants WHERE sku='DEMO-CLOTHING-M') AS variant,
      (SELECT id FROM app.product_variants WHERE sku='DEMO-CLOTHING-L') AS second_variant,
      (SELECT id FROM app.products WHERE slug='seed-demo-clothing') AS product,
      (SELECT id FROM app.products WHERE slug='seed-demo-perfume') AS perfume_product,
      (SELECT id FROM app.users WHERE email='customer@seed-demo.invalid') AS customer,
      (SELECT id FROM app.users WHERE email='warehouse@seed-demo.invalid') AS warehouse,
      (SELECT id FROM app.users WHERE email='sales@seed-demo.invalid') AS sales,
      (SELECT id FROM app.carts WHERE user_id=(SELECT id FROM app.users WHERE email='customer@seed-demo.invalid')) AS cart,
      (SELECT id FROM app.vouchers WHERE code='SEED-DEMO10') AS voucher,
      (SELECT id FROM app.orders WHERE order_code='DEMO-ORDER-001') AS order_id`)).rows[0];

    async function transaction(action, expectedCode) {
      await db.query('BEGIN');
      try {
        await action();
        await db.query('SET CONSTRAINTS ALL IMMEDIATE');
        assert.equal(expectedCode, undefined, `Expected SQLSTATE ${expectedCode}`);
      } catch (error) {
        if (!expectedCode) throw error;
        assert.equal(error.code, expectedCode, `${error.message} (${error.constraint || 'no constraint name'})`);
      } finally { await db.query('ROLLBACK'); }
    }
    const positive = (name, action) => t.test(name, () => transaction(action));
    const negative = (name, code, action) => t.test(name, () => transaction(action, code));
    async function product(type = 'CLOTHING') {
      return (await db.query(`INSERT INTO app.products(category_id,brand_id,product_type_code,name,slug)
        VALUES($1,$2,$3,'Test fixture',$4) RETURNING id`, [ids.category, ids.brand, type, `schema-test-${++serial}`])).rows[0].id;
    }
    async function variant(pid, options = [['color', 'black'], ['clothing_size', 'm']]) {
      const id = (await db.query('INSERT INTO app.product_variants(product_id,sku,price,list_price) VALUES($1,$2,100.25,120.50) RETURNING id', [pid, `TEST-SKU-${++serial}`])).rows[0].id;
      for (const [attribute, value] of options) {
        const result = await db.query(`INSERT INTO app.variant_attribute_values(variant_id,attribute_id,value_id)
          SELECT $1,a.id,v.id FROM app.attributes a JOIN app.attribute_values v ON v.attribute_id=a.id WHERE a.code=$2 AND v.code=$3`, [id, attribute, value]);
        assert.equal(result.rowCount, 1);
      }
      return id;
    }
    async function order(voucherCode = null, user = ids.customer) {
      const id = (await db.query(`INSERT INTO app.orders(user_id,shipping_address,recipient_name,recipient_phone,subtotal_amount,discount_amount,final_amount,voucher_code_snapshot)
        VALUES($1,'Synthetic test address','Test','0900000000',100.25,0,100.25,$2) RETURNING id`, [user, voucherCode])).rows[0].id;
      await db.query(`INSERT INTO app.order_items(order_id,variant_id,quantity,unit_price,list_unit_price,product_name,brand_name,sku,options_snapshot)
        SELECT $1,v.id,1,100.25,120.50,p.name,b.name,v.sku,'[]'::jsonb FROM app.product_variants v
        JOIN app.products p ON p.id=v.product_id JOIN app.brands b ON b.id=p.brand_id WHERE v.id=$2`, [id, ids.variant]);
      return id;
    }
    async function usage(oid, user = ids.customer, status = 'APPLIED') {
      await db.query('INSERT INTO app.voucher_usages(voucher_id,user_id,order_id,status) VALUES($1,$2,$3,$4)', [ids.voucher, user, oid, status]);
    }

    await positive('all money columns use exact NUMERIC(12,2)', async () => {
      const result = await db.query("SELECT c.numeric_precision,c.numeric_scale FROM information_schema.columns c JOIN information_schema.tables t USING(table_catalog,table_schema,table_name) WHERE c.table_schema='app' AND c.data_type='numeric' AND t.table_type='BASE TABLE'");
      assert.ok(result.rows.length >= 10);
      for (const row of result.rows) assert.deepEqual(row, { numeric_precision: 12, numeric_scale: 2 });
      assert.equal((await db.query('SELECT (0.1::numeric+0.2::numeric)::text AS n')).rows[0].n, '0.3');
    });
    await negative('duplicate canonical email', '23505', () => db.query("INSERT INTO app.users(full_name,email,password_hash) VALUES('X','customer@seed-demo.invalid','disabled')"));
    await negative('uncanonical email is rejected', '23514', () => db.query("INSERT INTO app.users(full_name,email,password_hash) VALUES('X','UPPER@example.invalid','disabled')"));
    await negative('unknown application role', '23514', () => db.query("INSERT INTO app.users(full_name,email,password_hash,role) VALUES('X','x@example.invalid','disabled','SELLER')"));
    await negative('required profile name cannot be null', '23502', () => db.query("INSERT INTO app.users(full_name,email,password_hash) VALUES(NULL,'x@example.invalid','disabled')"));
    await negative('surrogate IDs must be positive', '23514', () => db.query("INSERT INTO app.brands(id,name,slug) VALUES(-1,'Negative','negative')"));
    await negative('duplicate slug', '23505', () => db.query("INSERT INTO app.brands(name,slug) VALUES('Other','seed-demo-brand')"));
    await negative('product brand foreign key', '23503', () => db.query("INSERT INTO app.products(category_id,brand_id,product_type_code,name,slug) VALUES($1,2147483647,'CLOTHING','Bad','bad-brand')", [ids.category]));
    await negative('referenced brand cannot be deleted', '23503', () => db.query('DELETE FROM app.brands WHERE id=$1', [ids.brand]));
    await negative('price cannot be negative', '23514', () => db.query('UPDATE app.product_variants SET price=-1 WHERE id=$1', [ids.variant]));
    await negative('list price cannot be below selling price', '23514', () => db.query('UPDATE app.product_variants SET list_price=1 WHERE id=$1', [ids.variant]));
    await negative('NaN price is rejected', '23514', () => db.query("UPDATE app.product_variants SET price='NaN' WHERE id=$1", [ids.variant]));
    await negative('money overflow is rejected', '22003', () => db.query('UPDATE app.product_variants SET price=10000000000 WHERE id=$1', [ids.variant]));
    await positive('nullable list price and exact cents are supported', async () => {
      await db.query('UPDATE app.product_variants SET list_price=NULL,price=100.25 WHERE id=$1', [ids.variant]);
      assert.equal((await db.query('SELECT price::text FROM app.product_variants WHERE id=$1', [ids.variant])).rows[0].price, '100.25');
    });
    await negative('SKU is globally unique', '23505', () => db.query("INSERT INTO app.product_variants(product_id,sku,price) VALUES($1,'DEMO-CLOTHING-M',1)", [ids.product]));
    await positive('complete clothing SKU gets inventory0 and a DB canonical key', async () => {
      const vid = await variant(await product());
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      const result = (await db.query('SELECT v.combo_key,i.quantity FROM app.product_variants v JOIN app.inventory i ON i.variant_id=v.id WHERE v.id=$1', [vid])).rows[0];
      assert.equal(result.quantity, 0); assert.match(result.combo_key, /^\d+=\d+,\d+=\d+$/);
    });
    await negative('missing required SKU axis fails deferred validation', '23514', async () => { await variant(await product(), [['color', 'black']]); });
    await negative('unrelated SKU axis is rejected', '23514', async () => { await variant(await product('PERFUME'), [['color', 'black']]); });
    await negative('duplicate SKU combination per product', '23505', async () => { await variant(ids.product); });
    await negative('value must belong to its attribute', '23503', async () => {
      const vid = await variant(await product());
      await db.query(`UPDATE app.variant_attribute_values SET value_id=(SELECT v.id FROM app.attribute_values v JOIN app.attributes a ON a.id=v.attribute_id WHERE a.code='concentration' AND v.code='edp') WHERE variant_id=$1 AND attribute_id=(SELECT id FROM app.attributes WHERE code='color')`, [vid]);
    });
    await negative('option identity cannot change after creation transaction', '23514', () => db.query('DELETE FROM app.variant_attribute_values WHERE variant_id=$1', [ids.variant]));
    await negative('product type cannot change after SKU creation', '23514', () => db.query("UPDATE app.products SET product_type_code='PERFUME' WHERE id=$1", [ids.product]));
    await negative('used option schema cannot silently change', '23514', () => db.query("UPDATE app.product_type_attributes SET is_required=FALSE WHERE product_type_code='CLOTHING'"));
    await negative('inventory cannot be negative', '23514', () => db.query('UPDATE app.inventory SET quantity=-1 WHERE variant_id=$1', [ids.variant]));
    await negative('SKU cannot lose its inventory row', '23514', () => db.query('DELETE FROM app.inventory WHERE variant_id=$1', [ids.second_variant]));
    await negative('user cannot lose their cart', '23514', () => db.query('DELETE FROM app.carts WHERE user_id=$1', [ids.sales]));
    await negative('cart quantities must be positive', '23514', () => db.query('INSERT INTO app.cart_items(cart_id,variant_id,quantity) VALUES($1,$2,0)', [ids.cart, ids.variant]));
    await negative('cart SKU is unique', '23505', async () => {
      await db.query('INSERT INTO app.cart_items(cart_id,variant_id,quantity) VALUES($1,$2,1),($1,$2,2)', [ids.cart, ids.variant]);
    });
    await positive('100-line cart permits existing-line UPSERT but rejects line101', async () => {
      let first;
      for (let i=0;i<100;i++) {
        const vid=await variant(await product()); first ??= vid;
        await db.query('INSERT INTO app.cart_items(cart_id,variant_id,quantity) VALUES($1,$2,1)',[ids.cart,vid]);
      }
      await db.query('INSERT INTO app.cart_items(cart_id,variant_id,quantity) VALUES($1,$2,1) ON CONFLICT(cart_id,variant_id) DO UPDATE SET quantity=2',[ids.cart,first]);
      assert.equal((await db.query('SELECT quantity FROM app.cart_items WHERE cart_id=$1 AND variant_id=$2',[ids.cart,first])).rows[0].quantity,2);
      const next=await variant(await product());
      await db.query('SAVEPOINT line_limit');
      await assert.rejects(db.query('INSERT INTO app.cart_items(cart_id,variant_id,quantity) VALUES($1,$2,1)',[ids.cart,next]),{code:'23514'});
      await db.query('ROLLBACK TO SAVEPOINT line_limit');
    });
    await negative('cross-product image SKU foreign key', '23503', () => db.query("INSERT INTO app.product_images(product_id,variant_id,asset_path,alt_text) VALUES($1,$2,'/media/x.jpg','X')", [ids.perfume_product, ids.variant]));
    await negative('at most one primary product image', '23505', () => db.query("INSERT INTO app.product_images(product_id,asset_path,alt_text,is_primary) VALUES($1,'/media/x.jpg','X',TRUE)", [ids.product]));
    await negative('asset traversal/script URLs are rejected', '23514', () => db.query("INSERT INTO app.product_images(product_id,asset_path,alt_text) VALUES($1,'/media/../secret.js','X')", [ids.product]));
    await negative('active product requires image', '23514', () => db.query('UPDATE app.products SET is_active=TRUE WHERE id=$1', [ids.perfume_product]));
    await positive('inactive brand hides an otherwise published catalog product', async () => {
      await db.query('UPDATE app.products SET is_active=TRUE WHERE id=$1', [ids.product]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM app.vw_catalog_products WHERE id=$1', [ids.product])).rows[0].n, 1);
      await db.query('UPDATE app.brands SET is_active=FALSE WHERE id=$1', [ids.brand]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM app.vw_catalog_products WHERE id=$1', [ids.product])).rows[0].n, 0);
    });
    await negative('banner must target exactly one matching entity', '23514', () => db.query("INSERT INTO app.banners(title,desktop_path,alt_text,placement,target_type,product_id,starts_at,ends_at) VALUES('X','/media/x.jpg','X','HERO','NONE',$1,now(),now()+interval '1 day')", [ids.product]));
    await negative('banner schedule must have positive duration', '23514', () => db.query("INSERT INTO app.banners(title,desktop_path,alt_text,placement,target_type,starts_at,ends_at) VALUES('X','/media/x.jpg','X','HERO','NONE',now(),now())"));
    await negative('voucher used_count cannot exceed limit', '23514', () => db.query('UPDATE app.vouchers SET used_count=usage_limit+1 WHERE id=$1', [ids.voucher]));
    await negative('percentage cannot exceed100', '23514', () => db.query('UPDATE app.vouchers SET discount_value=101 WHERE id=$1', [ids.voucher]));
    await negative('voucher date interval must be valid', '23514', () => db.query('UPDATE app.vouchers SET end_date=start_date WHERE id=$1', [ids.voucher]));
    await negative('voucher code identity cannot change', '23514', () => db.query("UPDATE app.vouchers SET code='RENAMED' WHERE id=$1", [ids.voucher]));
    await negative('order final_amount must equal subtotal-discount', '23514', () => db.query("INSERT INTO app.orders(user_id,shipping_address,recipient_name,recipient_phone,subtotal_amount,discount_amount,final_amount) VALUES($1,'Fixture address 001','X','0900000000',100,10,100)", [ids.customer]));
    await negative('only COD is supported', '23514', () => db.query("INSERT INTO app.orders(user_id,shipping_address,recipient_name,recipient_phone,subtotal_amount,discount_amount,final_amount,payment_method) VALUES($1,'Fixture address 001','X','0900000000',100,0,100,'CARD')", [ids.customer]));
    await negative('empty order fails at deferred check', '23514', () => db.query("INSERT INTO app.orders(user_id,shipping_address,recipient_name,recipient_phone,subtotal_amount,discount_amount,final_amount) VALUES($1,'Fixture address 001','X','0900000000',100,0,100)", [ids.customer]));
    await negative('order snapshot update is forbidden', '23514', () => db.query("UPDATE app.order_items SET unit_price=1 WHERE order_id=$1", [ids.order_id]));
    await negative('snapshot array elements require typed option fields', '23514', async () => {
      const oid=(await db.query(`INSERT INTO app.orders(user_id,shipping_address,recipient_name,recipient_phone,subtotal_amount,discount_amount,final_amount)
        VALUES($1,'Synthetic test address','Test','0900000000',100,0,100) RETURNING id`,[ids.customer])).rows[0].id;
      await db.query(`INSERT INTO app.order_items(order_id,variant_id,quantity,unit_price,product_name,brand_name,sku,options_snapshot)
        VALUES($1,$2,1,100,'X','X','X','[{"code":12}]')`,[oid,ids.variant]);
    });
    await negative('late append to historical order is forbidden', '23514', () => db.query("INSERT INTO app.order_items(order_id,variant_id,quantity,unit_price,product_name,brand_name,sku,options_snapshot) VALUES($1,$2,1,0,'X','X','X','[]')", [ids.order_id, ids.second_variant]));
    await positive('catalog price changes do not recalculate historical price', async () => {
      await db.query('UPDATE app.product_variants SET price=90,list_price=120.50 WHERE id=$1', [ids.variant]);
      assert.equal((await db.query('SELECT unit_price::text FROM app.order_items WHERE order_id=$1', [ids.order_id])).rows[0].unit_price, '100.25');
    });
    await negative('order state cannot jump to DELIVERED', '23514', () => db.query("UPDATE app.orders SET status='DELIVERED',payment_status='PAID',delivered_at=now() WHERE id=$1", [ids.order_id]));
    await positive('ordered transitions require PAID and delivered_at atomically', async () => {
      const oid = await order();
      await db.query("UPDATE app.orders SET status='CONFIRMED' WHERE id=$1", [oid]);
      await db.query("UPDATE app.orders SET status='SHIPPING' WHERE id=$1", [oid]);
      await db.query("UPDATE app.orders SET status='DELIVERED',payment_status='PAID',delivered_at=now() WHERE id=$1", [oid]);
      assert.equal((await db.query('SELECT payment_status FROM app.orders WHERE id=$1', [oid])).rows[0].payment_status, 'PAID');
    });
    await negative('orders may never be deleted', '23514', () => db.query('DELETE FROM app.orders WHERE id=$1', [ids.order_id]));
    await negative('ledger sign and reference are linked', '23514', () => db.query("INSERT INTO app.inventory_transactions(variant_id,type,quantity_change,reference_type,created_by,request_key) VALUES($1,'IMPORT',-1,'IMPORT',$2,$3)", [ids.variant, ids.warehouse, '11111111-1111-4111-8111-111111111111']));
    await negative('ledger cannot be edited', '23514', () => db.query("UPDATE app.inventory_transactions SET quantity_change=99 WHERE variant_id=$1", [ids.variant]));
    await negative('only one export per order and SKU', '23505', () => db.query("INSERT INTO app.inventory_transactions(variant_id,type,quantity_change,reference_type,reference_id,created_by) VALUES($1,'EXPORT_ORDER',-2,'ORDER',$2,$3)", [ids.variant, ids.order_id, ids.customer]));
    await negative('voucher usage owner matches order owner', '23503', async () => { await usage(await order('SEED-DEMO10'), ids.sales); });
    await negative('one active voucher use per account', '23505', async () => { await usage(await order('SEED-DEMO10')); await usage(await order('SEED-DEMO10')); });
    await positive('released voucher usage allows reuse on another order', async () => {
      const oid = await order('SEED-DEMO10'); await usage(oid);
      await db.query("UPDATE app.orders SET status='CANCELLED' WHERE id=$1", [oid]);
      await db.query("UPDATE app.voucher_usages SET status='RELEASED' WHERE order_id=$1", [oid]);
      await usage(await order('SEED-DEMO10'));
    });
    await negative('usage must match order voucher snapshot', '23514', async () => { await usage(await order()); });
    await negative('cancellation and voucher release must agree', '23514', async () => {
      const oid = await order('SEED-DEMO10'); await usage(oid); await db.query("UPDATE app.voucher_usages SET status='RELEASED' WHERE order_id=$1", [oid]);
    });
    await positive('runtime sees public views but no private user table', async () => {
      await db.query('SET LOCAL ROLE app_rw_user');
      await db.query('SELECT * FROM app.vw_catalog_products LIMIT 1');
      const rights = (await db.query("SELECT has_table_privilege(current_user,'app.users','SELECT') AS users,has_table_privilege(current_user,'app.inventory','UPDATE') AS stock,has_schema_privilege(current_user,'app','CREATE') AS ddl")).rows[0];
      assert.deepEqual(rights, { users: false, stock: false, ddl: false });
    });
    await negative('runtime direct stock write is denied', '42501', async () => { await db.query('SET LOCAL ROLE app_rw_user'); await db.query('UPDATE app.inventory SET quantity=0'); });
    await positive('report role only reads aggregate views', async () => {
      await db.query('SET LOCAL ROLE report_ro_user'); await db.query('SELECT * FROM app.vw_revenue_summary');
      const rights = (await db.query("SELECT has_table_privilege(current_user,'app.orders','SELECT') AS orders,has_table_privilege(current_user,'app.vw_revenue_summary','UPDATE') AS writes")).rows[0];
      assert.deepEqual(rights, { orders: false, writes: false });
    });
    await positive('new owner functions do not grant PUBLIC EXECUTE by default', async () => {
      await db.query('CREATE FUNCTION app.test_private_default() RETURNS INT LANGUAGE sql AS $$ SELECT 1 $$');
      assert.equal((await db.query("SELECT has_function_privilege('app_rw_user','app.test_private_default()','EXECUTE') AS allowed")).rows[0].allowed, false);
    });
    await positive('all app objects are owned by db_admin and runtime has no owner membership', async () => {
      assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND pg_get_userbyid(c.relowner)<>'db_admin'")).rows[0].n, 0);
      assert.equal((await db.query("SELECT pg_has_role('app_rw_user','db_admin','MEMBER') AS member")).rows[0].member, false);
    });
    await t.test('two independent sessions cannot commit duplicate SKU combinations', async () => {
      const pid = await product();
      const a = new pg.Client(target), b = new pg.Client(target);
      await a.connect(); await b.connect();
      async function insert(client, sku) {
        const vid = (await client.query('INSERT INTO app.product_variants(product_id,sku,price) VALUES($1,$2,100) RETURNING id', [pid, sku])).rows[0].id;
        for (const [code,value] of [['color','black'],['clothing_size','m']]) {
          await client.query(`INSERT INTO app.variant_attribute_values(variant_id,attribute_id,value_id)
            SELECT $1,x.id,v.id FROM app.attributes x JOIN app.attribute_values v ON v.attribute_id=x.id WHERE x.code=$2 AND v.code=$3`, [vid,code,value]);
        }
      }
      try {
        await a.query('BEGIN'); await b.query('BEGIN');
        await a.query("SET LOCAL statement_timeout='5s'"); await b.query("SET LOCAL statement_timeout='5s'");
        await insert(a,'CONCURRENT-A');
        const second = insert(b,'CONCURRENT-B');
        await a.query('COMMIT');
        await second;
        await assert.rejects(b.query('COMMIT'), { code: '23505' });
        assert.equal((await db.query('SELECT count(*)::int AS n FROM app.product_variants WHERE product_id=$1', [pid])).rows[0].n, 1);
      } finally {
        await a.query('ROLLBACK'); await b.query('ROLLBACK');
        await a.end(); await b.end();
      }
    });
    await t.test('a real COMMIT rejects missing SKU axes and rolls back all its rows', async () => {
      await db.query('BEGIN');
      const pid = await product(); await variant(pid, [['color', 'black']]);
      await assert.rejects(db.query('COMMIT'), { code: '23514' });
      assert.equal((await db.query('SELECT count(*)::int AS n FROM app.products WHERE id=$1', [pid])).rows[0].n, 0);
    });
  } finally {
    await db?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
