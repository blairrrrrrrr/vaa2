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
          instagram: '',
          theme: 'editorial',
          font: 'inter',
          logo: '', heroImage: '', heroTitle: '', heroText: '', announcement: '', accentColor: '', buttonStyle: 'pill', cardStyle: 'rounded', alignment: 'left', showBio: true, showInstagram: true, showAnnouncement: false
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
          logo: '', heroImage: '', heroTitle: '', heroText: '', announcement: '', accentColor: '', buttonStyle: 'pill', cardStyle: 'rounded', alignment: 'left', showBio: true, showInstagram: true, showAnnouncement: false,
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
  'GET /api/account/profile': [requireAuth(), async ({ user }) => {
    const { items } = await db.list<any>('account_profiles', { limit: 500 });
    const profile = items.find((x:any) => x.userId === user!.userId);
    return json({ profile: profile ? { role: profile.role, brandName: profile.brandName || '', status: profile.status || 'ACTIVE' } : null });
  }],
  'GET /api/brand/access': [requireAuth(), async (ctx) => {
    const { items: profiles } = await db.list<any>('account_profiles', { limit: 500 });
    const profile = profiles.find((x:any) => x.userId === ctx.user!.userId);
    const { items: owners } = await db.list<any>('brand_owners', { limit: 500 });
    const owned = owners.filter((x:any) => x.userId === ctx.user!.userId);
    const profileBrand = profile?.role === 'brand' ? String(profile.brandName || '').trim() : '';
    if (profileBrand && !owned.some((x:any) => x.brand === profileBrand)) {
      await db.add('brand_owners', [{ userId: ctx.user!.userId, brand: profileBrand, createdAt: new Date().toISOString() }]);
      owned.push({ userId: ctx.user!.userId, brand: profileBrand });
    }