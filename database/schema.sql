-- Vaa PostgreSQL schema
-- AppDeploy authentication remains the identity provider; user_id stores its stable user ID.

BEGIN;

CREATE TABLE IF NOT EXISTS account_profiles (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('customer', 'brand')),
    brand_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brands (
    id BIGSERIAL PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    brand TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_user_id, brand)
);

CREATE TABLE IF NOT EXISTS brand_owners (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    brand TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, brand)
);

CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL UNIQUE,
    owner_user_id TEXT NOT NULL,
    brand TEXT NOT NULL,
    name TEXT NOT NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    category TEXT NOT NULL DEFAULT 'Tops',
    color TEXT NOT NULL DEFAULT 'Black',
    sizes TEXT[] NOT NULL DEFAULT ARRAY['M'],
    badge TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    image_path TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand);
CREATE INDEX IF NOT EXISTS idx_products_owner ON products (owner_user_id);

CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    customer_user_id TEXT,
    subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    shipping NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (shipping >= 0),
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    commission_rate NUMERIC(6,5) NOT NULL DEFAULT 0.15,
    commission NUMERIC(12,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    delivery_name TEXT NOT NULL DEFAULT '',
    delivery_phone TEXT NOT NULL DEFAULT '',
    delivery_address TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id BIGINT,
    product_external_id BIGINT,
    product_name TEXT NOT NULL,
    brand TEXT NOT NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    size TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_brand ON order_items (brand);

CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_reference TEXT,
    checkout_reference TEXT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'KES',
    status TEXT NOT NULL DEFAULT 'PENDING',
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_reference)
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);

CREATE TABLE IF NOT EXISTS commissions (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rate NUMERIC(6,5) NOT NULL DEFAULT 0.15,
    gross_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
    commission NUMERIC(12,2) NOT NULL DEFAULT 0,
    brand_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING_PAYOUT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS payouts (
    id BIGSERIAL PRIMARY KEY,
    brand_owner_user_id TEXT NOT NULL,
    brand TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    status TEXT NOT NULL DEFAULT 'PENDING',
    provider TEXT,
    provider_reference TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_owner ON payouts (brand_owner_user_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts (status);

CREATE TABLE IF NOT EXISTS reviews (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    product_external_id BIGINT,
    customer_user_id TEXT,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PUBLISHED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_customer ON reviews (customer_user_id);

COMMIT;
