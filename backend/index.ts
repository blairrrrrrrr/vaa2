import { router, json, error, requireAuth, requireAdminEmailAllowlist } from '@appdeploy/sdk';
import { db, storage, secrets } from '@appdeploy/sdk';

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
  'POST /api/orders': [requireAuth(), async ({ body, user }) => {
    const input = body as OrderInput & { paymentMethod?: string; customer?: { name?: string; phone?: string; email?: string; address?: string } };
    if (!input?.orderId || !Array.isArray(input.items) || input.items.length === 0) return error('Invalid order', 400);
    if (input.paymentMethod !== 'MPESA') return error('M-PESA payment is required', 400);
    const phoneRaw = String(input.customer?.phone || '').replace(/\D/g, '');
    const phone = phoneRaw.startsWith('254') ? phoneRaw : phoneRaw.startsWith('0') ? '254' + phoneRaw.slice(1) : '254' + phoneRaw;
    if (!/^254[17]\d{8}$/.test(phone)) return error('Enter a valid Kenyan M-PESA number', 400);
    if (!Number.isFinite(input.total) || input.total < 1) return error('Invalid payment amount', 400);
    const { items: catalog }=await db.list<any>('products',{limit:500}); const normalizedItems=input.items.map(i=>{const p=catalog.find((x:any)=>x.productId===Number(i.productId)); return p?{...i,price:Number(p.price),stock:Number(p.stock ?? 99)}:null;}); if(normalizedItems.some((x:any)=>!x))return error('One or more products are no longer available',400); if(normalizedItems.some((x:any)=>Number(x.qty)>Number(x.stock)))return error('One or more products do not have enough stock',409); const [id] = await db.add('orders', [{ orderId:input.orderId, userId:user!.userId, subtotal:input.subtotal, shipping:input.shipping, total:input.total, items:normalizedItems.map((x:any)=>({productId:x.productId,name:x.name,brand:x.brand,price:x.price,qty:x.qty})), customer:input.customer || {}, paymentMethod:'MPESA', commissionRate:COMMISSION_RATE, commission:0, brandEarnings:[], status:'PENDING_PAYMENT', createdAt:new Date().toISOString() }]);
    if (!id) return error('Could not create pending order', 500);
    try {
      const consumerKey = await secrets.readSecret('MPESA_CONSUMER_KEY');
      const consumerSecret = await secrets.readSecret('MPESA_CONSUMER_SECRET');
      const shortcode = await secrets.readSecret('MPESA_SHORTCODE');
      const passkey = await secrets.readSecret('MPESA_PASSKEY');
      const basic = Buffer.from(consumerKey + ':' + consumerSecret).toString('base64');
      const authResponse = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',{headers:{Authorization:'Basic '+basic}});
      const authData = await authResponse.json();
      if (!authResponse.ok || !authData.access_token) {
        const code = String(authData.errorCode || authData.error || `HTTP_${authResponse.status}`);
        const message = String(authData.errorMessage || authData.error_description || 'M-PESA authentication failed');
        throw new Error(`[${code}] ${message}`);
      }
      const timestamp = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
      const password = Buffer.from(String(shortcode) + String(passkey) + timestamp).toString('base64');
      const pushResponse = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',{method:'POST',headers:{Authorization:'Bearer '+authData.access_token,'Content-Type':'application/json'},body:JSON.stringify({BusinessShortCode:String(shortcode),Password:password,Timestamp:timestamp,TransactionType:'CustomerPayBillOnline',Amount:Math.round(input.total),PartyA:phone,PartyB:String(shortcode),PhoneNumber:phone,CallBackURL:'https://vaa-6ect23.v2.appdeploy.ai/api/mpesa/callback',AccountReference:input.orderId,TransactionDesc:'Vaa order'})});
      const pushData = await pushResponse.json();
      if (!pushResponse.ok || !pushData.CheckoutRequestID) {
        const code = String(pushData.errorCode || pushData.error || `HTTP_${pushResponse.status}`);
        const message = String(pushData.errorMessage || pushData.ResponseDescription || 'M-PESA STK Push failed');
        throw new Error(`[${code}] ${message}`);
      }
      await db.add('payments',[{orderId:input.orderId,provider:'MPESA',checkoutRequestId:pushData.CheckoutRequestID,merchantRequestId:pushData.MerchantRequestID || '',phone,amount:Math.round(input.total),status:'PENDING',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]);
      return json({saved:true,status:'PENDING_PAYMENT',checkoutRequestId:pushData.CheckoutRequestID,customerMessage:pushData.CustomerMessage || 'STK Push sent'});
    } catch (e:any) {
      const message=String(e?.message || 'M-PESA request failed');
      await db.update('orders',[{id,record:{orderId:input.orderId,subtotal:input.subtotal,shipping:input.shipping,total:input.total,items:input.items,customer:input.customer || {},paymentMethod:'MPESA',commissionRate:COMMISSION_RATE,commission:0,brandEarnings:[],status:'PAYMENT_FAILED',paymentError:message,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}]);
      const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
      const errorCode = match?.[1] || 'MPESA_REQUEST_FAILED';
      const errorMessage = match?.[2] || message;
      return json({saved:false,status:'PAYMENT_FAILED',error:`Safaricom M-PESA error ${errorCode}: ${errorMessage}`,errorCode,errorMessage},200);
    }
  }],
  'GET /api/payments/mpesa/status': [async ({ query }) => {
    const orderId=String(query.orderId || '');
    if (!orderId) return error('orderId is required',400);
    const { items: orders } = await db.list<any>('orders',{limit:500});
    const order=orders.find((x:any)=>x.orderId===orderId);
    if (!order) return error('Order not found',404);
    const { items: payments } = await db.list<any>('payments',{limit:500});
    const payment=payments.filter((x:any)=>x.orderId===orderId).sort((a:any,b:any)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))[0];
    return json({orderId,status:order.status,resultDesc:payment?.resultDesc||order.paymentError||'',receipt:payment?.receipt||''});
  }],
  'POST /api/mpesa/callback': [async ({ body }) => {
    const callback=(body as any)?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) return json({ResultCode:0,ResultDesc:'Accepted'});
    const { items: payments } = await db.list<any>('payments',{limit:500});
    const payment=payments.find((x:any)=>x.checkoutRequestId===callback.CheckoutRequestID);
    if (!payment) return json({ResultCode:0,ResultDesc:'Accepted'});
    const { items: orders } = await db.list<any>('orders',{limit:500});
    const order=orders.find((x:any)=>x.orderId===payment.orderId);
    if (!order) return json({ResultCode:0,ResultDesc:'Accepted'});
    if (order.status==='PAID_PENDING_FULFILMENT') return json({ResultCode:0,ResultDesc:'Already processed'});
    const resultCode=Number(callback.ResultCode);
    const resultDesc=String(callback.ResultDesc||'');
    const metadata=Array.isArray(callback.CallbackMetadata?.Item)?callback.CallbackMetadata.Item:[];
    const value=(name:string)=>metadata.find((x:any)=>x?.Name===name)?.Value;
    if (resultCode===0) {
      const amount=Number(value('Amount')||0);
      if (amount!==Number(payment.amount)) {
        await db.update('payments',[{id:payment.id,record:{...payment,status:'FAILED',resultCode,resultDesc:'Payment amount mismatch',updatedAt:new Date().toISOString()}}]);
        return json({ResultCode:0,ResultDesc:'Accepted'});
      }
      const receipt=String(value('MpesaReceiptNumber')||'');
      const brandTotals:Record<string,number>={};
      for (const item of order.items||[]) brandTotals[item.brand]=(brandTotals[item.brand]||0)+Number(item.price)*Number(item.qty);
      const brandEarnings=Object.entries(brandTotals).map(([brand,sales])=>({brand,grossSales:sales,commission:Math.round(sales*COMMISSION_RATE),netEarnings:sales-Math.round(sales*COMMISSION_RATE)}));
      const commission=Math.round(Number(order.subtotal)*COMMISSION_RATE);
      await db.update('payments',[{id:payment.id,record:{...payment,status:'PAID',resultCode:0,resultDesc,receipt,updatedAt:new Date().toISOString()}}]);
      const { items: currentProducts }=await db.list<any>('products',{limit:500}); for(const item of order.items||[]){const p=currentProducts.find((x:any)=>x.productId===Number(item.productId)); if(p&&p.stock!==undefined){const next=Math.max(0,Number(p.stock)-Number(item.qty)); await db.update('products',[{id:p.id,record:{...p,stock:next,updatedAt:new Date().toISOString()}}]);}} await db.update('orders',[{id:order.id,record:{...order,status:'PAID_PENDING_FULFILMENT',commissionRate:COMMISSION_RATE,commission,brandEarnings,paymentReceipt:receipt,paidAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}]);
      const { items: commissions }=await db.list<any>('commissions',{limit:500});
      if (!commissions.some((x:any)=>x.orderId===order.orderId)) await db.add('commissions',[{orderId:order.orderId,rate:COMMISSION_RATE,grossSales:order.subtotal,commission,brandEarnings:Number(order.subtotal)-commission,status:'PENDING_PAYOUT',createdAt:new Date().toISOString()}]);
      const { items: payouts }=await db.list<any>('payouts',{limit:500}); for(const earning of brandEarnings){const existing=payouts.find((x:any)=>x.orderId===order.orderId&&x.brand===earning.brand); if(!existing) await db.add('payouts',[{orderId:order.orderId,brand:earning.brand,amount:earning.netEarnings,status:'PENDING_PAYOUT',createdAt:new Date().toISOString()}]);}
    } else {
      await db.update('payments',[{id:payment.id,record:{...payment,status:'FAILED',resultCode,resultDesc,updatedAt:new Date().toISOString()}}]);
      await db.update('orders',[{id:order.id,record:{...order,status:'PAYMENT_FAILED',paymentError:resultDesc,updatedAt:new Date().toISOString()}}]);
    }
    return json({ResultCode:0,ResultDesc:'Accepted'});
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
  'POST /api/brand/products': [requireAuth(), async ({ body, user }) => { const input = body as any; if (!input?.name?.trim() || !input?.brand?.trim() || !Number.isFinite(Number(input.price))) return error('Name, brand and price are required', 400); const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input.brand.trim())) return error('Brand owner access required', 403); const record = { productId: Date.now(), sku: String(input.sku || `VAA-${Date.now()}`), name: input.name.trim(), brand: input.brand.trim(), price: Number(input.price), stock: Math.max(0,Number(input.stock ?? 1)), lowStockThreshold: Math.max(0,Number(input.lowStockThreshold ?? 3)), category: input.category || 'Tops', color: input.color || 'Black', sizes: Array.isArray(input.sizes) && input.sizes.length ? input.sizes : ['M'], badge: input.badge || '', image: input.image || '', imagePath: input.imagePath || '', description: input.description || '', material: input.material || '', care: input.care || '', ownerUserId: user!.userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; const [id] = await db.add('products', [record]); if (!id) return error('Could not create product', 500); return json({ saved: true, product: record, id }); }],
  'PUT /api/brand/products': [requireAuth(), async ({ body, user }) => { const input = body as any; const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input?.brand)) return error('Brand owner access required', 403); const { items } = await db.list<any>('products', { limit: 500 }); const current = items.find((p:any) => p.productId === Number(input.productId) && p.ownerUserId === user!.userId); if (!current) return error('Product not found', 404); const record = { ...current, sku: input.sku?.trim() || current.sku || `VAA-${current.productId}`, name: input.name?.trim() || current.name, price: Number(input.price ?? current.price), stock: Math.max(0,Number(input.stock ?? current.stock ?? 0)), lowStockThreshold: Math.max(0,Number(input.lowStockThreshold ?? current.lowStockThreshold ?? 3)), category: input.category || current.category, color: input.color || current.color, sizes: Array.isArray(input.sizes) && input.sizes.length ? input.sizes : current.sizes, badge: input.badge ?? current.badge, image: input.image ?? current.image, imagePath: input.imagePath ?? current.imagePath, description: input.description ?? current.description, material: input.material ?? current.material, care: input.care ?? current.care, updatedAt: new Date().toISOString() }; const ok = await db.update('products', [{ id: current.id, record }]); if (!ok[0]) return error('Could not update product', 500); return json({ saved: true, product: record }); }],

  'DELETE /api/brand/products': [requireAuth(), async ({ query, user }) => { const productId=Number(query.productId || 0); if (!productId) return error('productId is required',400); const { items: owners } = await db.list<any>('brand_owners',{limit:500}); const ownedBrands=owners.filter((x:any)=>x.userId===user!.userId).map((x:any)=>x.brand); const { items } = await db.list<any>('products',{limit:500}); const current=items.find((p:any)=>p.productId===productId && ownedBrands.includes(p.brand) && p.ownerUserId===user!.userId); if (!current) return error('Product not found',404); const ok=await db.delete('products',[current.id]); if (!ok[0]) return error('Could not delete product',500); return json({deleted:true,productId}); }],
  'GET /api/brand/orders': [requireAuth(), async ({ user }) => { const { items: owners }=await db.list<any>('brand_owners',{limit:500}); const brands=owners.filter((x:any)=>x.userId===user!.userId).map((x:any)=>x.brand); if(!brands.length)return error('Brand owner access required',403); const { items: orders }=await db.list<any>('orders',{limit:500}); const result=orders.filter((o:any)=>o.status!=='PENDING_PAYMENT'&&o.status!=='PAYMENT_FAILED'&&Array.isArray(o.items)&&o.items.some((i:any)=>brands.includes(i.brand))).map((o:any)=>{ const items=o.items.filter((i:any)=>brands.includes(i.brand)); const brandTotal=items.reduce((n:any,i:any)=>n+Number(i.price)*Number(i.qty),0); const status=o.status==='PAID_PENDING_FULFILMENT'?'PROCESSING':o.status; const statusLabel=status==='PROCESSING'?'Processing':status==='SHIPPED'?'Shipped':status==='DELIVERED'?'Delivered':status; return {...o,items,brandTotal,status,statusLabel}; }); return json({orders:result}); }],
  'PUT /api/brand/orders': [requireAuth(), async ({ body, user }) => { const input=body as any; const allowed=['PROCESSING','SHIPPED','DELIVERED']; if(!input?.orderId||!allowed.includes(input.status))return error('Invalid order update',400); const { items: owners }=await db.list<any>('brand_owners',{limit:500}); const brands=owners.filter((x:any)=>x.userId===user!.userId).map((x:any)=>x.brand); const { items: orders }=await db.list<any>('orders',{limit:500}); const current=orders.find((o:any)=>o.orderId===input.orderId&&Array.isArray(o.items)&&o.items.some((i:any)=>brands.includes(i.brand))); if(!current)return error('Order not found',404); const record={...current,status:input.status,trackingNumber:String(input.trackingNumber||current.trackingNumber||''),courier:String(input.courier||current.courier||''),deliveryNote:String(input.deliveryNote||current.deliveryNote||''),estimatedDelivery:String(input.estimatedDelivery||current.estimatedDelivery||'2–5 business days'),updatedAt:new Date().toISOString()}; const ok=await db.update('orders',[{id:current.id,record}]); if(!ok[0])return error('Could not update order',500); if(current.userId){await db.add('notifications',[{userId:current.userId,type:'ORDER_UPDATE',title:`Order ${current.orderId} updated`,message:input.status==='SHIPPED'?`Your order is on the way${record.trackingNumber?` · ${record.courier||'Courier'} ${record.trackingNumber}`:''}.`:input.status==='DELIVERED'?'Your order has been delivered.':`Your order is now being prepared.`,orderId:current.orderId,read:false,createdAt:new Date().toISOString()}]);} return json({saved:true,orderId:current.orderId,status:input.status,trackingNumber:record.trackingNumber,courier:record.courier}); }],
  'GET /api/brand/storefront': [requireAuth(), async ({ user }) => { const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); const brand = owners.find((x:any) => x.userId === user!.userId)?.brand; if (!brand) return error('Brand owner access required', 403); const { items } = await db.list<any>('brands', { limit: 500 }); return json({ brand, storefront: items.find((x:any) => x.ownerUserId === user!.userId && x.brand === brand) || { brand } }); }],
  'PUT /api/brand/storefront': [requireAuth(), async ({ body, user }) => { const input = body as any; const { items: owners } = await db.list<any>('brand_owners', { limit: 500 }); if (!owners.some((x:any) => x.userId === user!.userId && x.brand === input?.brand)) return error('Brand owner access required', 403); const { items } = await db.list<any>('brands', { limit: 500 }); const current = items.find((x:any) => x.ownerUserId === user!.userId && x.brand === input.brand); const record = { ownerUserId: user!.userId, brand: input.brand, tagline: input.tagline || '', bio: input.bio || '', instagram: input.instagram || '', updatedAt: new Date().toISOString() }; if (current) { const ok = await db.update('brands', [{ id: current.id, record }]); if (!ok[0]) return error('Could not update storefront', 500); } else { const [id] = await db.add('brands', [record]); if (!id) return error('Could not create storefront', 500); } return json({ saved: true, storefront: record }); }],
  'GET /api/brand/earnings': [requireAuth(), async ({ query, user }) => {
    const brand = query.brand || 'OTG';
    const { items: owners } = await db.list<any>('brand_owners', { limit: 100 });
    if (!owners.some((x:any) => x.userId === user!.userId && x.brand === brand)) return error('Brand owner access required', 403);
    const { items } = await db.list<any>('orders', { limit: 100 });
    const relevant = items.filter(o => Array.isArray(o.brandEarnings) && o.brandEarnings.some((b:any) => b.brand === brand));
    let grossSales=0,commission=0,netEarnings=0; relevant.forEach(o=>{const b=o.brandEarnings.find((x:any)=>x.brand===brand);grossSales+=b.grossSales;commission+=b.commission;netEarnings+=b.netEarnings;}); const {items:payouts}=await db.list<any>('payouts',{limit:500}); const pendingPayout=payouts.filter((x:any)=>x.brand===brand&&x.status==='PENDING_PAYOUT').reduce((n:any,x:any)=>n+Number(x.amount||0),0); return json({brand,commissionRate:COMMISSION_RATE,grossSales,commission,netEarnings,pendingPayout});
  }],
  'GET /api/account/orders': [requireAuth(), async ({ user }) => { const { items }=await db.list<any>('orders',{limit:500}); return json({orders:items.filter((o:any)=>o.userId===user!.userId).map((o:any)=>({orderId:o.orderId,status:o.status,total:o.total,items:o.items,createdAt:o.createdAt,paymentReceipt:o.paymentReceipt,trackingNumber:o.trackingNumber||'',courier:o.courier||'',deliveryNote:o.deliveryNote||'',estimatedDelivery:o.estimatedDelivery||'2–5 business days'}))}); }],
  'POST /api/account/orders/cancel': [requireAuth(), async ({ body,user }) => { const input=body as any; const { items }=await db.list<any>('orders',{limit:500}); const current=items.find((o:any)=>o.orderId===input?.orderId&&o.userId===user!.userId); if(!current)return error('Order not found',404); if(!['PENDING_PAYMENT','PAID_PENDING_FULFILMENT'].includes(current.status))return error('Order can no longer be cancelled',409); const record={...current,status:'CANCELLED',cancelledAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; const ok=await db.update('orders',[{id:current.id,record}]); if(!ok[0])return error('Could not cancel order',500); return json({saved:true,status:'CANCELLED'}); }],
  'GET /api/reviews': [async ({ query }) => { const productId=Number(query.productId||0); const { items }=await db.list<any>('reviews',{limit:500}); const rows=items.filter((x:any)=>!productId||Number(x.productId)===productId); const average=rows.length?rows.reduce((n:any,x:any)=>n+Number(x.rating),0)/rows.length:0; return json({count:rows.length,average:Number(average.toFixed(1)),reviews:rows.map((x:any)=>({rating:x.rating,createdAt:x.createdAt}))}); }],
  'POST /api/reviews': [requireAuth(), async ({ body,user }) => { const input=body as any; const rating=Number(input?.rating||0); const productId=Number(input?.productId||0); if(!productId||rating<1||rating>5)return error('Invalid review',400); const { items: orders }=await db.list<any>('orders',{limit:500}); const bought=orders.some((o:any)=>o.userId===user!.userId&&['PAID_PENDING_FULFILMENT','SHIPPED','DELIVERED'].includes(o.status)&&Array.isArray(o.items)&&o.items.some((i:any)=>Number(i.productId)===productId)); if(!bought)return error('Buy the product before reviewing it',403); const { items: reviews }=await db.list<any>('reviews',{limit:500}); const existing=reviews.find((x:any)=>x.userId===user!.userId&&Number(x.productId)===productId); const record={...(existing||{}),userId:user!.userId,productId,rating,updatedAt:new Date().toISOString(),createdAt:existing?.createdAt||new Date().toISOString()}; if(existing){const ok=await db.update('reviews',[{id:existing.id,record}]);if(!ok[0])return error('Could not update review',500);}else{const [id]=await db.add('reviews',[record]);if(!id)return error('Could not save review',500);} return json({saved:true,rating}); }],
  'POST /api/account/refunds': [requireAuth(), async ({body,user})=>{const input=body as any;const reason=String(input?.reason||'').trim();if(!input?.orderId||reason.length<5)return error('Order and refund reason are required',400);const {items:orders}=await db.list<any>('orders',{limit:500});const order=orders.find((o:any)=>o.orderId===input.orderId&&o.userId===user!.userId);if(!order)return error('Order not found',404);if(!['SHIPPED','DELIVERED'].includes(order.status))return error('This order is not eligible for a return/refund request',409);const {items:refunds}=await db.list<any>('refunds',{limit:500});if(refunds.some((x:any)=>x.orderId===order.orderId&&['REQUESTED','APPROVED','PROCESSING'].includes(x.status)))return error('A return/refund request already exists',409);const [id]=await db.add('refunds',[{orderId:order.orderId,userId:user!.userId,amount:order.total,reason,status:'REQUESTED',returnStatus:'REQUESTED',createdAt:new Date().toISOString()}]);if(!id)return error('Could not create return request',500);await db.add('notifications',[{userId:user!.userId,type:'REFUND_UPDATE',title:'Return request submitted',message:`We received your return/refund request for ${order.orderId}.`,orderId:order.orderId,read:false,createdAt:new Date().toISOString()}]);return json({saved:true,status:'REQUESTED'});}],
  'GET /api/admin/refunds': [requireAuth(),requireAdminEmailAllowlist(ADMIN_EMAILS),async()=>{const {items}=await db.list<any>('refunds',{limit:500});return json({refunds:items.filter((x:any)=>['REQUESTED','APPROVED','PROCESSING'].includes(x.status))});}],
  'POST /api/admin/refunds/approve': [requireAuth(),requireAdminEmailAllowlist(ADMIN_EMAILS),async({body})=>{const input=body as any;const {items}=await db.list<any>('refunds',{limit:500});const current=items.find((x:any)=>x.orderId===input?.orderId&&x.status==='REQUESTED');if(!current)return error('Refund request not found',404);const ok=await db.update('refunds',[{id:current.id,record:{...current,status:'APPROVED',returnStatus:'APPROVED',approvedAt:new Date().toISOString(),note:'Approved for manual payment-provider refund.'}}]);if(!ok[0])return error('Could not approve refund',500);await db.add('notifications',[{userId:current.userId,type:'REFUND_UPDATE',title:'Return approved',message:`Your return/refund request for ${current.orderId} was approved.`,orderId:current.orderId,read:false,createdAt:new Date().toISOString()}]);return json({saved:true,status:'APPROVED',manualRefundRequired:true});}],
  'GET /api/brand/payout': [requireAuth(), async ({ user }) => { const { items: owners }=await db.list<any>('brand_owners',{limit:500}); const brand=owners.find((x:any)=>x.userId===user!.userId)?.brand; if(!brand)return error('Brand owner access required',403); const { items }=await db.list<any>('payouts',{limit:500}); const p=items.find((x:any)=>x.userId===user!.userId&&x.brand===brand); return json({phone:p?.phone||'',accountName:p?.accountName||'',status:p?.status||'NOT_SET'}); }],
  'PUT /api/brand/payout': [requireAuth(), async ({ body,user }) => { const input=body as any; const { items: owners }=await db.list<any>('brand_owners',{limit:500}); if(!owners.some((x:any)=>x.userId===user!.userId&&x.brand===input?.brand))return error('Brand owner access required',403); const { items }=await db.list<any>('payouts',{limit:500}); const current=items.find((x:any)=>x.userId===user!.userId&&x.brand===input.brand); const record={userId:user!.userId,brand:input.brand,phone:String(input.phone||''),accountName:String(input.accountName||''),status:'READY',updatedAt:new Date().toISOString()}; if(current){const ok=await db.update('payouts',[{id:current.id,record}]);if(!ok[0])return error('Could not save payout details',500);}else{const [id]=await db.add('payouts',[record]);if(!id)return error('Could not save payout details',500);} return json({saved:true}); }],
  'GET /api/admin/operations': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => { const [{items:products},{items:orders},{items:payouts},{items:refunds}]=await Promise.all([db.list<any>('products',{limit:500}),db.list<any>('orders',{limit:500}),db.list<any>('payouts',{limit:500}),db.list<any>('refunds',{limit:500})]); return json({products:products.length,orders:orders.length,payouts:payouts.filter((x:any)=>x.status==='PENDING_PAYOUT').length,refunds:refunds.filter((x:any)=>x.status==='REQUESTED').length}); }],
  'POST /api/admin/payouts/pay': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => { const { items }=await db.list<any>('payouts',{limit:500}); const pending=items.filter((x:any)=>x.status==='PENDING_PAYOUT'); for(const p of pending) await db.update('payouts',[{id:p.id,record:{...p,status:'PAID',paidAt:new Date().toISOString()}}]); const {items:commissions}=await db.list<any>('commissions',{limit:500}); for(const c of commissions.filter((x:any)=>x.status==='PENDING_PAYOUT')) await db.update('commissions',[{id:c.id,record:{...c,status:'PAID',paidAt:new Date().toISOString()}}]); return json({saved:true,count:pending.length}); }],
  'GET /api/admin/access': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async ({ user }) => json({ isAdmin: true, email: user!.email })],
  'GET /api/account/notifications': [requireAuth(), async ({ user }) => { const { items }=await db.list<any>('notifications',{limit:500}); const rows=items.filter((x:any)=>x.userId===user!.userId).sort((a:any,b:any)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,50); return json({notifications:rows,unread:rows.filter((x:any)=>!x.read).length}); }],
  'POST /api/account/notifications/read': [requireAuth(), async ({ user }) => { const { items }=await db.list<any>('notifications',{limit:500}); const rows=items.filter((x:any)=>x.userId===user!.userId&&!x.read); for(const row of rows) await db.update('notifications',[{id:row.id,record:{...row,read:true,readAt:new Date().toISOString()}}]); return json({saved:true}); }],
  'POST /api/analytics/event': [async ({ body }) => { const input=body as any; const allowed=['page_view','product_view','add_to_cart','checkout_start','checkout_submit','payment_started','payment_confirmed','payment_failed']; if(!allowed.includes(String(input?.event)))return error('Invalid analytics event',400); await db.add('analytics_events',[{event:String(input.event),productId:input.productId?Number(input.productId):null,orderId:String(input.orderId||''),metadata:input.metadata||{},createdAt:new Date().toISOString()}]); return json({saved:true}); }],
  'GET /api/admin/analytics': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => { const { items }=await db.list<any>('analytics_events',{limit:5000}); const count=(event:string)=>items.filter((x:any)=>x.event===event).length; return json({events:items.length,pageViews:count('page_view'),productViews:count('product_view'),addToCart:count('add_to_cart'),checkoutStarts:count('checkout_start'),checkoutSubmits:count('checkout_submit'),paymentsStarted:count('payment_started'),paymentsConfirmed:count('payment_confirmed'),paymentsFailed:count('payment_failed')}); }],
  'GET /api/admin/revenue': [requireAuth(), requireAdminEmailAllowlist(ADMIN_EMAILS), async () => {
    const { items }=await db.list<any>('commissions',{limit:100}); const {items:payouts}=await db.list<any>('payouts',{limit:500}); const grossSales=items.reduce((n:any,x:any)=>n+(x.grossSales||0),0); const commission=items.reduce((n:any,x:any)=>n+(x.commission||0),0); const brandEarnings=items.reduce((n:any,x:any)=>n+(x.brandEarnings||0),0); const pendingPayouts=payouts.filter((x:any)=>x.status==='PENDING_PAYOUT').reduce((n:any,x:any)=>n+Number(x.amount||0),0); return json({commissionRate:COMMISSION_RATE,grossSales,commission,brandEarnings,pendingPayouts});
    return json({ commissionRate: COMMISSION_RATE, grossSales, commission, brandEarnings, pendingPayouts });
  }]
});
