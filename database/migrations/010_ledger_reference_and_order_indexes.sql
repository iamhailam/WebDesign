-- Up Migration
SET LOCAL ROLE db_admin;
CREATE INDEX idx_ledger_reference ON app.inventory_transactions(reference_id, variant_id) WHERE reference_id IS NOT NULL;
CREATE INDEX idx_ledger_created ON app.inventory_transactions(created_at DESC, id DESC);
CREATE INDEX idx_orders_created ON app.orders(created_at DESC, id DESC);

-- Down Migration
SET LOCAL ROLE db_admin;
DROP INDEX app.idx_orders_created;
DROP INDEX app.idx_ledger_created;
DROP INDEX app.idx_ledger_reference;
