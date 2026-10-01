import { router, json, error, requireAuth, requireAdminEmailAllowlist } from '@appdeploy/sdk';
import { db, storage } from '@appdeploy/sdk';

const COMMISSION_RATE = 0.15;
const ADMIN_EMAILS = ['blairmbugua868@gmail.com'];

type OrderInput = {
  orderId: string;
  subtotal: number;
  shipping: number;
  total: number;
  items: Array<{ productId:number; name:string; brand:string; price:number; qty:number }>;
};

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Vaa backend ready' })],
  'GET /api/products': [async () => { const { items } = await db.list<any>('products', { limit: 500 }); const paths = items.map((p:any) => p.imagePath).filter(Boolean); const urls = paths.length ? await storage.url(paths) : []; const byPath = new Map(urls.map((x:any) => [x.path, x.url])); const products = items.map((p:any) => ({ ...p, image: p.imagePath ? (byPath.get(p.imagePath) || '') : (p.image || '') })); return json({ products }); }],
  'POST /api/brand/product-image': [requireAuth(), async ({ body, user }) => { const input = body as { fileName?: string; contentType?: string; data?: string }; if (!input?.data || !input.contentType?.startsWith('image/')) return error('A valid image file is required', 400); const safeName = (input.fileName || 'product-image').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80); const path = `product-images/${user!.userId}/${Date.now()}-${safeName}`; const ok = await storage.write([{ path, content: input.data, contentType: input.contentType }]); if (!ok[0]) return error('Could not upload image', 500); const [{ url }] = await storage.url([path]); return json({ uploaded: true, path, url }); }],
  'GET /api/brands': [async () => {
    const [{ items: storefronts }, { items: owners }] = await Promise.all([
      db.list<any>('brands', { limit: 500 }),
      db.list<any>('brand_owners', { limit: 500 })
    ]);
    const byBrand = new Map<string, any>();
    storefronts.forEach((x:any) => { if (x.brand) byBrand.set(x.brand, x); });
    owners.forEach((x:any) => {
      if (x.brand && !byBrand.has(x.brand)) {
        byBrand.set(x.brand, {
          brand: x.brand,
          ownerUserId: x.userId,
          tagline: '',
          bio: '',
          instagram: ''
        });
      }
    });
    return json({ brands: Array.from(byBrand.values()) });
  }],
  'POST /api/orders': [async ({ body }) => {
    const input = body as OrderInput;
    if (!input?.orderId || !Array.isArray(input.items) || input.items.length === 0) return error('Invalid order', 400);
    const commission = Math.round(input.subtotal * COMMISSION_RATE);
    const brandTotals: Record<string, number> = {};
    for (const item of input.items) brandTotals[item.brand] = (brandTotals[item.brand] || 0) + item.price * item.qty;
    const brandEarnings = Object.entries(brandTotals).map(([brand, sales]) => ({
      brand, grossSales: sales, commission: Math.round(sales * COMMISSION_RATE), netEarnings: sales - Math.round(sales * COMMISSION_RATE)
    }));
    const [id] = await db.add('orders', [{
      orderId: input.orderId, subtotal: input.subtotal, shipping: input.shipping, total: input.total,
      commissionRate: COMMISSION_RATE, commission, status: 'PAID_PENDING_FULFILMENT', brandEarnings,
      createdAt: new Date().toISOString()
    }]);
    if (!id) return error('Could not record order', 500);
    await db.add('commissions', [{
      orderId: input.orderId, rate: COMMISSION_RATE, grossSales: input.subtotal,
      commission, brandEarnings: input.subtotal - commission, status: 'PENDING_PAYOUT',
      createdAt: new Date().toISOString()
    }]);
    return json({ saved: true, commissionRate: COMMISSION_RATE, commission, brandEarnings, orderRecordId:id });
  }],
  'POST /api/account/profile': [requireAuth(), async ({ body, user }) => {
    const input = body as { role?: string; brandName?: string };
    if (input.role !== 'customer' && input.role !== 'brand') return error('Invalid account type', 400);
    if (input.role === 'brand' && !input.brandName?.trim()) return error('Brand name is required', 400);
    const { items } = await db.list<any>('account_profiles', { limit: 100 });
    const existing = items.find((x:any) => x.userId === user!.userId);
    const record = {
      userId: user!.userId,
      email: user!.email || '',
      name: user!.name || '',
      role: input.role,
      brandName: input.role === 'brand' ? input.brandName!.trim() : '',
      status: input.role === 'brand' ? 'PENDING_BRAND_REVIEW' : 'ACTIVE',
      updatedAt: new Date().toISOString()
    };
    if (existing) {
      await db.update('account_profiles', [{ id: existing.id, record }]);
    } else {
      await db.add('account_profiles', [record]);
    }
    if (input.role === 'brand') {
      const { items: owners } = await db.list<any>('brand_owners', { limit: 100 });
      const alreadyOwner = owners.some((x:any) => x.userId === user!.userId && x.brand === record.brandName);
      if (!alreadyOwner) {
        await db.add('brand_owners', [{ userId: user!.userId, brand: record.brandName, createdAt: new Date().toISOString() }]);
      }
      const { items: storefronts } = await db.list<any>('brands', { limit: 100 });
      const storefrontExists = storefronts.some((x:any) => x.ownerUserId === user!.userId && x.brand === record.brandName);
      if (!storefrontExists) {
        await db.add('brands', [{
          ownerUserId: user!.userId,
          brand: record.brandName,
          tagline: '',
          bio: '',
          instagram: '',
          updatedAt: new Date().toISOString()
        }]);
      }
    }
    return json({ saved: true, role: record.role, status: input.role === 'brand' ? 'ACTIVE' : record.status, isBrandOwner: input.role === 'brand' });
  }],
  'DELETE /api/account': [requireAuth(), async ({ user }) => {
    if ((user!.email || '').toLowerCase() === ADMIN_EMAILS[0].toLowerCase()) return error('The admin account cannot be deleted from this screen.', 403);
    const { items: profiles } = await db.list<any>('account_profiles', { limit: 100 });
    const ownProfiles = profiles.filter((x:any) => x.userId === user!.userId).map((x:any) => x.id);
    if (ownProfiles.length) await db.delete('account_profiles', ownProfiles);
    const { items: owners } = await db.list<any>('brand_owners', { limit: 100 });
    const ownOwners = owners.filter((x:any) => x.userId === user!.userId).map((x:any) => x.id);
    if (ownOwners.length) await db.delete('brand_owners', ownOwners);
    const { items: storefronts } = await db.list<any>('brands', { limit: 100 });
    const ownStorefronts = storefronts.filter((x:any) => x.ownerUserId === user!.userId).map((x:any) => x.id);
    if (ownStorefronts.length) await db.delete('brands', ownStorefronts);
    return json({ deleted: true, note: 'Vaa account profile and brand access removed. The AppDeploy authentication identity is managed by the authentication provider.' });
  }],
  'GET /api/brand/access': [requireAuth(), async (ctx) => {
    const { items } = await db.list<any>('brand_owners', { limit: 100 });
    const owned = items.filter((x:any) => x.userId === ctx.user!.userId);
    return json({ isBrandOwner: owned.length > 0, brands: owned.map((x:any) => x.brand) });
  }],
  'GET /api/brand/products': [requireAuth(), async ({ user }) => { const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); const owned = owners.filter((x:any) => x.userId === user!.userId).map((x:any) => x.brand); const { items } = await db.list<any>('products', { limit: 500 }); return json({ products: items.filter((p:any) => owned.includes(p.brand)) }); }],
  'POST /api/brand/products': [requireAuth(), async ({ body, user }) => { const input = body as any; if (!input?.name?.trim() || !input?.brand?.trim() || !Number.isFinite(Number(input.price))) return error('Name, brand and price are required', 400); const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input.brand.trim())) return error('Brand owner access required', 403); const record = { productId: Date.now(), name: input.name.trim(), brand: input.brand.trim(), price: Number(input.price), category: input.category || 'Tops', color: input.color || 'Black', sizes: Array.isArray(input.sizes) && input.sizes.length ? input.sizes : ['M'], badge: input.badge || '', image: input.image || '', imagePath: input.imagePath || '', description: input.description || '', ownerUserId: user!.userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; const [id] = await db.add('products', [record]); if (!id) return error('Could not create product', 500); return json({ saved: true, product: record, id }); }],
  'PUT /api/brand/products': [requireAuth(), async ({ body, user }) => { const input = body as any; const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input?.brand)) return error('Brand owner access required', 403); const { items } = await db.list<any>('products', { limit: 500 }); const current = items.find((p:any) => p.productId === Number(input.productId) && p.ownerUserId === user!.userId); if (!current) return error('Product not found', 404); const record = { ...current, name: input.name?.trim() || current.name, price: Number(input.price ?? current.price), category: input.category || current.category, color: input.color || current.color, sizes: Array.isArray(input.sizes) && input.sizes.length ? input.sizes : current.sizes, badge: input.badge ?? current.badge, image: input.image ?? current.image, imagePath: input.imagePath ?? current.imagePath, description: input.description ?? current.description, updatedAt: new Date().toISOString() }; const ok = await db.update('products', [{ id: current.id, record }]); if (!ok[0]) return error('Could not update product', 500); return json({ saved: true, product: record }); }],
  'GET /api/brand/storefront': [requireAuth(), async ({ user }) => { const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); const brand = owners.find((x:any) => x.userId === user!.userId)?.brand; if (!brand) return error('Brand owner access required', 403); const { items } = await db.list<any>('brands', { limit: 500 }); return json({ brand, storefront: items.find((x:any) => x.ownerUserId === user!.userId && x.brand === brand) || { brand } }); }],
  'PUT /api/brand/storefront': [requireAuth(), async ({ body, user }) => { const input = body as any; const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input?.brand)) return error('Brand owner access required', 403); const { items } = await db.list<any>('brands', { limit: 500 }); const current = items.find((x:any) => x.ownerUserId === user!.userId && x.brand === input.brand); const record = { ownerUserId: user!.userId, brand: input.brand, tagline: input.tagline || '', bio: input.bio || '', instagram: input.instagram || '', updatedAt: new Date().toISOString() }; if (current) { const ok = await db.update('brands', [{ id: current.id, record }]); if (!ok[0]) return error('Could not update storefront', 500); } else { const [id] = await db.add('brands', [record]); if (!id) return error('Could not create storefront', 500); } return json({ saved: true, storefront: record }); }],
  'GET /api/brand/earnings': [requireAuth(), async ({ query, user }) => {
    const brand = query.brand || 'OTG';
    const { items: owners } = await db.list<any>('brand_owners', { limit: 100 });
    if (!owners.some((x:any) => x.userId === user!.userId && x.brand === brand)) return error('Brand owner access required', 403);
    const { items } = await db.list<any>('orders', { limit: 100 });
    const relevant = items.filter(o => Array.isArray(o.brandEarnings) && o.brandEarnings.some((b:any) => b.brand === brand));
    let grossSales = 0, commission = 0, netEarnings = 0;
    relevant.forEach(o => {
      const b = o.brandEarnings.find((x:any) => x.brand === brand);
      grossSales += b.grossSales; commission += b.commission; netEarnings += b.netEarnings;
    });
    return json({ brand, commissionRate: COMMISSION_RATE, grossSales, commission, netEarnings, pendingPayout: netEarnings });
  }],
  'GET /api/admin/access': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async ({ user }) => json({ isAdmin: true, email: user!.email })],
  'GET /api/admin/revenue': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => {
    const { items } = await db.list<any>('commissions', { limit: 100 });
    const grossSales = items.reduce((n:any,x:any)=>n+(x.grossSales||0),0);
    const commission = items.reduce((n:any,x:any)=>n+(x.commission||0),0);
    const brandEarnings = items.reduce((n:any,x:any)=>n+(x.brandEarnings||0),0);
    return json({ commissionRate: COMMISSION_RATE, grossSales, commission, brandEarnings, pendingPayouts: brandEarnings });
  }],
  'POST /api/admin/cleanup-marketplace': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => {
    const tables = ['account_profiles','brand_owners','brands','products'];
    const deleted: Record<string, number> = {};
    for (const table of tables) {
      const { items } = await db.list<any>(table, { limit: 500 });
      const ids = table === 'account_profiles'
        ? items.filter((x:any) => (x.email || '').toLowerCase() !== ADMIN_EMAILS[0].toLowerCase()).map((x:any) => x.id)
        : items.map((x:any) => x.id);
      if (ids.length > 0) {
        const results = await db.delete(table, ids);
        deleted[table] = results.filter(Boolean).length;
      } else {
        deleted[table] = 0;
      }
    }
    return json({ cleaned: true, deleted, preservedAdminEmail: ADMIN_EMAILS[0] });
  }]
});