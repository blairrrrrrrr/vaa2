import { router, json, error, requireAuth, requireAdminEmailAllowlist } from '@appdeploy/sdk';
import { storage } from '@appdeploy/sdk';
import { db } from './database';

const BRAND_SUBSCRIPTION_PRICE = 400;
const SUBSCRIPTION_TRIAL_DAYS = 14;
const subscriptionExpiry = (days:number) => new Date(Date.now() + days * 86400000).toISOString();
const subscriptionExpiryFromStart = (startedAt:string,days:number) => new Date(new Date(startedAt).getTime()+days*86400000).toISOString();
const normalizeTrialExpiry = async (subscription:any) => { if(subscription?.status!=='TRIAL'||!subscription.startedAt||!subscription.id)return subscription;const expiresAt=subscriptionExpiryFromStart(subscription.startedAt,SUBSCRIPTION_TRIAL_DAYS);if(subscription.expiresAt===expiresAt)return subscription;const record={...subscription,expiresAt,updatedAt:new Date().toISOString()};const ok=await db.update('brand_subscriptions',[{id:subscription.id,record}]);return ok[0]?record:subscription; };
const ensureBrandSubscriptions = async (brands:string[]) => { const {items:current}=await db.list<any>('brand_subscriptions',{limit:500});const now=new Date().toISOString();for(const brand of Array.from(new Set(brands.filter(Boolean))))if(!current.some((x:any)=>x.brand===brand)){const expiry=subscriptionExpiry(SUBSCRIPTION_TRIAL_DAYS);await db.add('brand_subscriptions',[{brand,status:'TRIAL',price:BRAND_SUBSCRIPTION_PRICE,startedAt:now,expiresAt:expiry,createdAt:now,updatedAt:now}]);}for(const subscription of current)if(subscription.status==='TRIAL')await normalizeTrialExpiry(subscription);const {items:refreshed}=await db.list<any>('brand_subscriptions',{limit:500});return new Set(refreshed.filter((x:any)=>['ACTIVE','TRIAL'].includes(String(x.status))&&String(x.expiresAt||'')>now).map((x:any)=>String(x.brand)));};
const ADMIN_EMAILS = ['blairmbugua868@gmail.com'];

const rateBuckets = new Map<string, { startedAt:number; count:number }>();
const allowRate = (key:string, limit:number, windowMs:number) => { const now=Date.now(); const current=rateBuckets.get(key); if(!current||now-current.startedAt>=windowMs){rateBuckets.set(key,{startedAt:now,count:1});return true;} if(current.count>=limit)return false; current.count+=1; return true; };

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Vaa backend ready' })],
  'GET /api/products': [async () => { const [{items},{items:owners}]=await Promise.all([db.list<any>('products',{limit:500}),db.list<any>('brand_owners',{limit:500})]);const visible=await ensureBrandSubscriptions(owners.map((x:any)=>String(x.brand||'')));const published=items.filter((p:any)=>visible.has(String(p.brand)));const paths=published.map((p:any)=>p.imagePath).filter(Boolean);const urls=paths.length?await storage.url(paths):[];const byPath=new Map(urls.map((x:any)=>[x.path,x.url]));return json({products:published.map((p:any)=>({...p,image:p.imagePath?(byPath.get(p.imagePath)||''):(p.image||'')}))}); }],
  'POST /api/brand/product-image': [requireAuth(), async ({ body, user }) => { const input = body as { fileName?: string; contentType?: string; data?: string }; const types=['image/jpeg','image/png','image/webp']; const data=String(input?.data||''); const type=String(input?.contentType||'').toLowerCase(); if(!data||!types.includes(type))return error('JPG, PNG or WebP image required',400); if(data.length>7*1024*1024)return error('Image must be 5 MB or smaller',413); if(!allowRate('image:'+String(user!.userId),12,60000))return error('Too many image uploads',429); const safeName=(input.fileName||'product-image').replace(/[^a-zA-Z0-9._-]/g,'-').slice(-80); const path='product-images/'+user!.userId+'/'+Date.now()+'-'+safeName; const ok=await storage.write([{path,content:data,contentType:type}]); if(!ok[0])return error('Could not upload image',500); const [{url}]=await storage.url([path]); return json({uploaded:true,path,url}); }],
  'GET /api/brands': [async () => {
    const [{ items: storefronts }, { items: owners }] = await Promise.all([
      db.list<any>('brands', { limit: 500 }),
      db.list<any>('brand_owners', { limit: 500 })
    ]);
    const visible = await ensureBrandSubscriptions(owners.map((x:any)=>String(x.brand||'')));
    const byBrand = new Map<string, any>();
    storefronts.forEach((x:any) => { if (x.brand && visible.has(String(x.brand))) byBrand.set(x.brand, x); });
    owners.forEach((x:any) => {
      if (x.brand && visible.has(String(x.brand)) && !byBrand.has(x.brand)) {
        byBrand.set(x.brand, {
          brand: x.brand,
          ownerUserId: x.userId,
          tagline: '',
          bio: '',
          instagram: '',
          theme: 'editorial',
          font: 'inter',
          logo: '', heroImage: '', heroTitle: '', heroText: '', announcement: '', accentColor: '', buttonStyle: 'pill', cardStyle: 'rounded', alignment: 'left', showBio: true, showInstagram: true, showAnnouncement: false
        });
      }
    });
    return json({ brands: Array.from(byBrand.values()) });
  }],
  'GET /api/location/reverse-geocode': [async ({ query }) => { const latitude=Number(query.latitude),longitude=Number(query.longitude); if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude > 90||longitude < -180||longitude > 180)return error('Valid coordinates are required',400); if(!allowRate('geo:'+latitude.toFixed(2)+':'+longitude.toFixed(2),10,60000))return error('Too many location lookups',429); try { const response=await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat='+encodeURIComponent(String(latitude))+'&lon='+encodeURIComponent(String(longitude))+'&zoom=18&addressdetails=1',{headers:{'User-Agent':'Vaa marketplace/1.0'}}); const data=await response.json(); if(!response.ok)return error('Could not identify this location',502); const a=data?.address||{}; const placeName=data?.name||a.road||a.suburb||a.neighbourhood||a.town||a.city||a.county||data?.display_name||'Current location'; const area=[a.suburb,a.neighbourhood,a.city||a.town||a.village].filter(Boolean).filter((x:string,i:number,arr:string[])=>arr.indexOf(x)===i&&x!==placeName).join(', '); return json({placeName:area?placeName+', '+area:placeName}); } catch { return error('Could not identify this location',502); } }],
  'POST /api/orders': [requireAuth(), async () => error('Vaa no longer processes customer payments. Message the brand to arrange a purchase directly.', 410)],
  'POST /api/account/profile': [requireAuth(), async ({ body, user }) => {
    const input = body as { role?: string; customerName?: string; customerPhone?: string; customerLocation?: string; brandName?: string; founderName?: string; category?: string; phone?: string; instagram?: string; website?: string; location?: string; description?: string; verificationProofType?: string; verificationEvidenceLink?: string; verificationNotes?: string; confirmOwnsBrand?: boolean; agree?: boolean };
    if (input.role !== 'customer' && input.role !== 'brand') return error('Invalid account type', 400);
    if (input.role === 'customer') {
      if (!input.customerName?.trim()) return error('Full name is required', 400);
      if (!input.customerPhone?.trim()) return error('Phone number is required', 400);
    }
    if (input.role === 'brand') {
      if (!input.brandName?.trim()) return error('Brand name is required', 400);
      if (!input.founderName?.trim()) return error('Founder or contact name is required', 400);
      if (!input.category?.trim()) return error('Fashion category is required', 400);
      if (!input.phone?.trim()) return error('Business phone is required', 400);
      if (!input.description?.trim()) return error('Brand description is required', 400);
      if (!input.verificationProofType?.trim()) return error('Choose a type of brand verification evidence', 400);
      if (input.confirmOwnsBrand !== true) return error('Confirm that you own or are authorized to manage this brand', 400);
      if (input.agree !== true) return error('You must accept the Vaa marketplace rules', 400);
    }
    const { items } = await db.list<any>('account_profiles', { limit: 100 });
    const existing = items.find((x:any) => x.userId === user!.userId);
    if (ADMIN_EMAILS.some((email) => email.toLowerCase() === String(user!.email || '').toLowerCase())) return error('Admin access is managed separately from customer and brand profiles.', 403);
    if (existing && String(existing.role || '') !== input.role) return error('Account type cannot be changed after registration. Contact Vaa support if it needs correction.', 409);
    if (input.role === 'brand') {
      const { items: existingBrands } = await db.list<any>('brands', { limit: 500 });
      const duplicate = existingBrands.find((x:any) => String(x.brand || '').trim().toLowerCase() === String(input.brandName || '').trim().toLowerCase() && x.ownerUserId !== user!.userId);
      if (duplicate) return error('That brand name is already registered on Vaa', 409);
    }
    const record = {
      userId: user!.userId,
      email: user!.email || '',
      name: user!.name || '',
      role: input.role,
      brandName: input.role === 'brand' ? input.brandName!.trim() : '',
      customerName: input.role === 'customer' ? input.customerName!.trim() : '',
      customerPhone: input.role === 'customer' ? input.customerPhone!.trim() : '',
      customerLocation: input.role === 'customer' ? String(input.customerLocation || '').trim() : '',
      status: input.role === 'brand' ? 'ACTIVE' : 'ACTIVE',
      founderName: input.role === 'brand' ? input.founderName!.trim() : '',
      category: input.role === 'brand' ? input.category!.trim() : '',
      phone: input.role === 'brand' ? input.phone!.trim() : '',
      instagram: input.role === 'brand' ? String(input.instagram || '').trim() : '',
      website: input.role === 'brand' ? String(input.website || '').trim() : '',
      location: input.role === 'brand' ? String(input.location || '').trim() : '',
      description: input.role === 'brand' ? input.description!.trim() : '',
      verificationProofType: input.role === 'brand' ? String(input.verificationProofType || '').trim() : '',
      verificationEvidenceLink: input.role === 'brand' ? String(input.verificationEvidenceLink || '').trim() : '',
      verificationNotes: input.role === 'brand' ? String(input.verificationNotes || '').trim() : '',
      verificationStatus: input.role === 'brand' ? 'PENDING_REVIEW' : '',
      verificationSubmittedAt: input.role === 'brand' ? new Date().toISOString() : '',
      
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
          logo: '', heroImage: '', heroTitle: '', heroText: '', announcement: '', accentColor: '', buttonStyle: 'pill', cardStyle: 'rounded', alignment: 'left', showBio: true, showInstagram: true, showAnnouncement: false,
          updatedAt: new Date().toISOString()
        }]);
      }
    }
    return json({ saved: true, role: record.role, status: record.status, isBrandOwner: input.role === 'brand' });
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
  'GET /api/account/profile': [requireAuth(), async ({ user }) => {
    const { items } = await db.list<any>('account_profiles', { limit: 500 });
    const profile = items.find((x:any) => x.userId === user!.userId);
    const isAdmin = ADMIN_EMAILS.some((email) => email.toLowerCase() === String(user!.email || '').toLowerCase());
    return json({ profile: profile ? { role: isAdmin ? 'admin' : profile.role, brandName: isAdmin ? '' : (profile.brandName || ''), customerName: profile.customerName || '', customerPhone: profile.customerPhone || '', customerLocation: profile.customerLocation || '', status: profile.status || 'ACTIVE' } : (isAdmin ? { role: 'admin', brandName: '', customerName: '', customerPhone: '', customerLocation: '', status: 'ACTIVE' } : null) });
  }],
  'GET /api/brand/access': [requireAuth(), async (ctx) => {
    const isAdmin = ADMIN_EMAILS.some((email) => email.toLowerCase() === String(ctx.user!.email || '').toLowerCase());
    if (isAdmin) {
      const { items: owners } = await db.list<any>('brand_owners', { limit: 500 });
      const staleOwners = owners.filter((x:any) => x.userId === ctx.user!.userId);
      const staleBrands = Array.from(new Set(staleOwners.map((x:any) => String(x.brand || '').trim()).filter(Boolean)));
      for (const owner of staleOwners) await db.delete('brand_owners', [owner.id]);
      const { items: storefronts } = await db.list<any>('brands', { limit: 500 });
      const adminBrandIds = storefronts.filter((x:any) => x.ownerUserId === ctx.user!.userId || staleBrands.includes(String(x.brand || '').trim())).map((x:any) => x.id);
      if (adminBrandIds.length) await db.delete('brands', adminBrandIds);
      const { items: products } = await db.list<any>('products', { limit: 500 });
      const adminProductIds = products.filter((x:any) => x.ownerUserId === ctx.user!.userId || staleBrands.includes(String(x.brand || '').trim())).map((x:any) => x.id);
      if (adminProductIds.length) await db.delete('products', adminProductIds);
      return json({ isBrandOwner: false, brands: [], deletedBrands: staleBrands });
    }
    const { items: profiles } = await db.list<any>('account_profiles', { limit: 500 });
    const profile = profiles.find((x:any) => x.userId === ctx.user!.userId);
    const { items: owners } = await db.list<any>('brand_owners', { limit: 500 });
    const owned = owners.filter((x:any) => x.userId === ctx.user!.userId);
    const profileBrand = profile?.role === 'brand' ? String(profile.brandName || '').trim() : '';
    if (profileBrand && !owned.some((x:any) => x.brand === profileBrand)) {
      await db.add('brand_owners', [{ userId: ctx.user!.userId, brand: profileBrand, createdAt: new Date().toISOString() }]);
      owned.push({ userId: ctx.user!.userId, brand: profileBrand });
    }
    return json({ isBrandOwner: profile?.role === 'brand' || owned.length > 0, brands: owned.map((x:any) => x.brand).filter(Boolean) });
  }],
  'GET /api/brand/products': [requireAuth(), async ({ user }) => { const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); const owned = owners.filter((x:any) => x.userId === user!.userId).map((x:any) => x.brand); const { items } = await db.list<any>('products', { limit: 500 }); return json({ products: items.filter((p:any) => owned.includes(p.brand)) }); }],
  'POST /api/brand/products': [requireAuth(), async ({ body, user }) => { const input = body as any; if (!input?.name?.trim() || !input?.brand?.trim() || !Number.isFinite(Number(input.price))) return error('Name, brand and price are required', 400); const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input.brand.trim())) return error('Brand owner access required', 403); const record = { productId: Date.now(), sku: String(input.sku || `VAA-${Date.now()}`), name: input.name.trim(), brand: input.brand.trim(), price: Number(input.price), stock: Math.max(0,Number(input.stock ?? 1)), lowStockThreshold: Math.max(0,Number(input.lowStockThreshold ?? 3)), category: input.category || 'Tops', color: input.color || 'Black', sizes: Array.isArray(input.sizes) && input.sizes.length ? input.sizes : ['M'], badge: input.badge || '', image: input.image || '', imagePath: input.imagePath || '', description: input.description || '', material: input.material || '', care: input.care || '', ownerUserId: user!.userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; const [id] = await db.add('products', [record]); if (!id) return error('Could not create product', 500); return json({ saved: true, product: record, id }); }],
  'PUT /api/brand/products': [requireAuth(), async ({ body, user }) => { const input = body as any; const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input?.brand)) return error('Brand owner access required', 403); const { items } = await db.list<any>('products', { limit: 500 }); const current = items.find((p:any) => p.productId === Number(input.productId) && p.ownerUserId === user!.userId); if (!current) return error('Product not found', 404); const record = { ...current, sku: input.sku?.trim() || current.sku || `VAA-${current.productId}`, name: input.name?.trim() || current.name, price: Number(input.price ?? current.price), stock: Math.max(0,Number(input.stock ?? current.stock ?? 0)), lowStockThreshold: Math.max(0,Number(input.lowStockThreshold ?? current.lowStockThreshold ?? 3)), category: input.category || current.category, color: input.color || current.color, sizes: Array.isArray(input.sizes) && input.sizes.length ? input.sizes : current.sizes, badge: input.badge ?? current.badge, image: input.image ?? current.image, imagePath: input.imagePath ?? current.imagePath, description: input.description ?? current.description, material: input.material ?? current.material, care: input.care ?? current.care, updatedAt: new Date().toISOString() }; const ok = await db.update('products', [{ id: current.id, record }]); if (!ok[0]) return error('Could not update product', 500); return json({ saved: true, product: record }); }],

  'DELETE /api/brand/products': [requireAuth(), async ({ query, user }) => { const productId=Number(query.productId || 0); if (!productId) return error('productId is required',400); const { items: owners } = await db.list<any>('brand_owners',{limit:500}); const ownedBrands=owners.filter((x:any)=>x.userId===user!.userId).map((x:any)=>x.brand); const { items } = await db.list<any>('products',{limit:500}); const current=items.find((p:any)=>p.productId===productId && ownedBrands.includes(p.brand) && p.ownerUserId===user!.userId); if (!current) return error('Product not found',404); const ok=await db.delete('products',[current.id]); if (!ok[0]) return error('Could not delete product',500); return json({deleted:true,productId}); }],
  'GET /api/brand/storefront': [requireAuth(), async ({ user }) => { const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); const brand = owners.find((x:any) => x.userId === user!.userId)?.brand; if (!brand) return error('Brand owner access required', 403); const { items } = await db.list<any>('brands', { limit: 500 }); return json({ brand, storefront: items.find((x:any) => x.ownerUserId === user!.userId && x.brand === brand) || { brand, theme: 'editorial', font: 'inter' } }); }],
  'PUT /api/brand/storefront': [requireAuth(), async ({ body, user }) => { const input = body as any; const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input?.brand)) return error('Brand owner access required', 403); const { items } = await db.list<any>('brands', { limit: 500 }); const current = items.find((x:any) => x.ownerUserId === user!.userId && x.brand === input.brand); const allowedThemes = ['editorial','noir','studio','earth','electric']; const allowedFonts = ['inter','space-grotesk','dm-sans','playfair','cormorant','bebas']; const allowedButtons = ['pill','square']; const allowedCards = ['rounded','sharp']; const allowedAlignment = ['left','center']; const accent = String(input.accentColor || current?.accentColor || '').trim(); const safeAccent = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ''; const record = { ownerUserId: user!.userId, brand: input.brand, tagline: String(input.tagline || ''), bio: String(input.bio || ''), instagram: String(input.instagram || ''), logo: String(input.logo || ''), heroImage: String(input.heroImage || ''), heroTitle: String(input.heroTitle || ''), heroText: String(input.heroText || ''), announcement: String(input.announcement || ''), accentColor: safeAccent, buttonStyle: allowedButtons.includes(String(input.buttonStyle)) ? String(input.buttonStyle) : (current?.buttonStyle || 'pill'), cardStyle: allowedCards.includes(String(input.cardStyle)) ? String(input.cardStyle) : (current?.cardStyle || 'rounded'), alignment: allowedAlignment.includes(String(input.alignment)) ? String(input.alignment) : (current?.alignment || 'left'), showBio: input.showBio !== false, showInstagram: input.showInstagram !== false, showAnnouncement: input.showAnnouncement === true, theme: allowedThemes.includes(String(input.theme)) ? String(input.theme) : (current?.theme || 'editorial'), font: allowedFonts.includes(String(input.font)) ? String(input.font) : (current?.font || 'inter'), updatedAt: new Date().toISOString() }; if (current) { const ok = await db.update('brands', [{ id: current.id, record }]); if (!ok[0]) return error('Could not update storefront', 500); } else { const [id] = await db.add('brands', [record]); if (!id) return error('Could not create storefront', 500); } return json({ saved: true, storefront: record }); }],
  'GET /api/reviews': [async ({ query }) => { const productId=Number(query.productId||0); const { items }=await db.list<any>('reviews',{limit:500}); const rows=items.filter((x:any)=>!productId||Number(x.productId)===productId); const average=rows.length?rows.reduce((n:any,x:any)=>n+Number(x.rating),0)/rows.length:0; return json({count:rows.length,average:Number(average.toFixed(1)),reviews:rows.map((x:any)=>({rating:x.rating,createdAt:x.createdAt}))}); }],
  'POST /api/reviews': [requireAuth(), async ({ body,user }) => { const input=body as any; const rating=Number(input?.rating||0); const productId=Number(input?.productId||0); if(!productId||rating<1||rating>5)return error('Invalid review',400); const { items: orders }=await db.list<any>('orders',{limit:500}); const bought=orders.some((o:any)=>o.userId===user!.userId&&['PAID_PENDING_FULFILMENT','SHIPPED','DELIVERED'].includes(o.status)&&Array.isArray(o.items)&&o.items.some((i:any)=>Number(i.productId)===productId)); if(!bought)return error('Buy the product before reviewing it',403); const { items: reviews }=await db.list<any>('reviews',{limit:500}); const existing=reviews.find((x:any)=>x.userId===user!.userId&&Number(x.productId)===productId); const record={...(existing||{}),userId:user!.userId,productId,rating,updatedAt:new Date().toISOString(),createdAt:existing?.createdAt||new Date().toISOString()}; if(existing){const ok=await db.update('reviews',[{id:existing.id,record}]);if(!ok[0])return error('Could not update review',500);}else{const [id]=await db.add('reviews',[record]);if(!id)return error('Could not save review',500);} return json({saved:true,rating}); }],
  'GET /api/brand/subscription': [requireAuth(), async ({ user }) => { const {items:owners}=await db.list<any>('brand_owners',{limit:500});const owner=owners.find((x:any)=>x.userId===user!.userId);if(!owner)return error('Brand owner access required',403);const {items}=await db.list<any>('brand_subscriptions',{limit:500});let subscription=items.find((x:any)=>x.brand===owner.brand);if(!subscription){const now=new Date().toISOString();const expiry=subscriptionExpiry(SUBSCRIPTION_TRIAL_DAYS);const [id]=await db.add('brand_subscriptions',[{brand:owner.brand,status:'TRIAL',price:BRAND_SUBSCRIPTION_PRICE,startedAt:now,expiresAt:expiry,createdAt:now,updatedAt:now}]);subscription={id,brand:owner.brand,status:'TRIAL',price:BRAND_SUBSCRIPTION_PRICE,startedAt:now,expiresAt:expiry};}else subscription=await normalizeTrialExpiry(subscription);return json({subscription,price:BRAND_SUBSCRIPTION_PRICE,currency:'KES',interval:'month',trialDays:SUBSCRIPTION_TRIAL_DAYS}); }],
  'POST /api/brand/subscription/request': [requireAuth(), async ({ body,user }) => {const input=body as any;const reference=String(input?.transactionReference||'').trim().toUpperCase();if(!/^[A-Z0-9]{6,24}$/.test(reference))return error('Enter a valid M-Pesa transaction reference (6–24 letters or numbers).',400);const {items:owners}=await db.list<any>('brand_owners',{limit:500});const owner=owners.find((x:any)=>x.userId===user!.userId);if(!owner)return error('Brand owner access required',403);const {items}=await db.list<any>('brand_subscriptions',{limit:500});const current=items.find((x:any)=>x.brand===owner.brand);if(current&&['ACTIVE','TRIAL'].includes(String(current.status))&&String(current.expiresAt||'')>new Date().toISOString())return error('Your trial or subscription is still active. You can submit a renewal reference after it expires.',409);const now=new Date().toISOString();const record={...(current||{}),brand:owner.brand,ownerUserId:user!.userId,price:BRAND_SUBSCRIPTION_PRICE,status:'PENDING_REVIEW',transactionReference:reference,requestedAt:now,updatedAt:now};if(current)await db.update('brand_subscriptions',[{id:current.id,record}]);else await db.add('brand_subscriptions',[record]);return json({saved:true,status:'PENDING_REVIEW',transactionReference:reference});}],
  'GET /api/admin/subscriptions': [requireAuth(),requireAdminEmailAllowlist(ADMIN_EMAILS),async()=>{const {items}=await db.list<any>('brand_subscriptions',{limit:500});return json({subscriptions:items.sort((a:any,b:any)=>String(b.requestedAt||b.updatedAt||'').localeCompare(String(a.requestedAt||a.updatedAt||'')))});}],
  'POST /api/admin/subscriptions/review': [requireAuth(),requireAdminEmailAllowlist(ADMIN_EMAILS),async({body})=>{const input=body as any;const brand=String(input?.brand||'').trim();const decision=String(input?.decision||'');if(!brand||!['APPROVE','REJECT'].includes(decision))return error('Brand and valid decision are required',400);const {items}=await db.list<any>('brand_subscriptions',{limit:500});const current=items.find((x:any)=>x.brand===brand&&x.status==='PENDING_REVIEW');if(!current)return error('Pending subscription request not found',404);const now=new Date().toISOString();const expiresAt=decision==='APPROVE'?subscriptionExpiry(30):current.expiresAt;const record={...current,status:decision==='APPROVE'?'ACTIVE':'PAYMENT_REJECTED',startedAt:decision==='APPROVE'?now:current.startedAt,expiresAt,reviewedAt:now,reviewedBy:'ADMIN',updatedAt:now};const ok=await db.update('brand_subscriptions',[{id:current.id,record}]);if(!ok[0])return error('Could not review subscription',500);const {items:owners}=await db.list<any>('brand_owners',{limit:500});const owner=owners.find((x:any)=>x.brand===brand);if(owner)await db.add('notifications',[{userId:owner.userId,type:'SUBSCRIPTION_UPDATE',title:decision==='APPROVE'?'Storefront subscription active':'Subscription payment needs review',message:decision==='APPROVE'?'Your KES 400 subscription is active until '+expiresAt.slice(0,10):'We could not verify your subscription reference. Please check it and resubmit.',read:false,createdAt:now}]);return json({saved:true,subscription:record});}],  'GET /api/messages': [requireAuth(), async ({ user }) => { const [{items:messages},{items:owners}] = await Promise.all([db.list<any>('messages',{limit:500}),db.list<any>('brand_owners',{limit:500})]); const ownedBrands=owners.filter((x:any)=>x.userId===user!.userId).map((x:any)=>String(x.brand)); const mine=messages.filter((m:any)=>(m.customerUserId===user!.userId||m.brandOwnerUserId===user!.userId)&&(ownedBrands.length===0||m.customerUserId===user!.userId||ownedBrands.includes(String(m.brand)))); const grouped=new Map<string,any>(); for(const message of mine){const key=String(message.conversationId);const current=grouped.get(key)||{conversationId:key,brand:message.brand,customerUserId:message.customerUserId,brandOwnerUserId:message.brandOwnerUserId,productId:message.productId||null,messages:[]};current.messages.push(message);grouped.set(key,current);} const conversations=Array.from(grouped.values()).map((x:any)=>({...x,messages:x.messages.sort((a:any,b:any)=>String(a.createdAt).localeCompare(String(b.createdAt))),lastMessageAt:x.messages[x.messages.length-1]?.createdAt||''})).sort((a:any,b:any)=>String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));return json({conversations}); }],
  'POST /api/messages': [requireAuth(), async ({ body,user }) => { const input=body as any;const text=String(input?.body||'').trim();if(!text||text.length>2000)return error('Message must contain 1–2000 characters',400);const {items:owners}=await db.list<any>('brand_owners',{limit:500});const owned=owners.find((x:any)=>x.userId===user!.userId);let brand=String(input?.brand||'').trim();let customerUserId=String(input?.customerUserId||'');let brandOwnerUserId=String(input?.brandOwnerUserId||'');let conversationId=String(input?.conversationId||'');if(conversationId){const {items:all}=await db.list<any>('messages',{limit:500});const thread=all.find((m:any)=>m.conversationId===conversationId);if(!thread)return error('Conversation not found',404);brand=String(thread.brand);customerUserId=String(thread.customerUserId);brandOwnerUserId=String(thread.brandOwnerUserId);if(user!.userId!==customerUserId&&user!.userId!==brandOwnerUserId)return error('Conversation access denied',403);}else{if(owned)return error('Choose a customer conversation before replying',400);if(!brand)return error('Brand is required',400);const owner=owners.find((x:any)=>String(x.brand)===brand);if(!owner)return error('Brand not found',404);const visible=await ensureBrandSubscriptions([brand]);if(!visible.has(brand))return error('This brand storefront is not currently active on Vaa',403);brandOwnerUserId=owner.userId;customerUserId=user!.userId;conversationId='thread_'+customerUserId.replace(/[^a-zA-Z0-9]/g,'').slice(0,18)+'_'+brandOwnerUserId.replace(/[^a-zA-Z0-9]/g,'').slice(0,18)+'_'+brand.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,18);}const recipientUserId=user!.userId===customerUserId?brandOwnerUserId:customerUserId;const record={conversationId,brand,customerUserId,brandOwnerUserId,productId:Number(input?.productId||0)||null,senderUserId:user!.userId,recipientUserId,senderName:String(user!.name||user!.email||'Vaa member'),body:text,read:false,createdAt:new Date().toISOString()};const [id]=await db.add('messages',[record]);if(!id)return error('Could not send message',500);await db.add('notifications',[{userId:recipientUserId,type:'MESSAGE',title:'New message about '+brand,message:text.slice(0,160),conversationId,brand,read:false,createdAt:record.createdAt}]);return json({saved:true,message:{...record,id}}); }],
  'GET /api/admin/access': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async ({ user }) => json({ isAdmin: true, email: user!.email })],
  'GET /api/admin/accounts': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async ({ user }) => {
    const [{ items: profiles }, { items: owners }, { items: storefronts }, { items: products }] = await Promise.all([
      db.list<any>('account_profiles', { limit: 500 }),
      db.list<any>('brand_owners', { limit: 500 }),
      db.list<any>('brands', { limit: 500 }),
      db.list<any>('products', { limit: 500 })
    ]);
    const adminEmail = String(user!.email || '').toLowerCase();
    const isPrimaryAdmin = ADMIN_EMAILS.some((email) => email.toLowerCase() === adminEmail);

    if (isPrimaryAdmin) {
      const staleOwners = owners.filter((x:any) => x.userId === user!.userId);
      const staleBrands = Array.from(new Set(staleOwners.map((x:any) => String(x.brand || '').trim()).filter(Boolean)));
      for (const owner of staleOwners) await db.delete('brand_owners', [owner.id]);

      const staleBrandRecords = storefronts.filter((x:any) =>
        x.ownerUserId === user!.userId || staleBrands.includes(String(x.brand || '').trim())