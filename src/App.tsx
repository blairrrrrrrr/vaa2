import { useEffect, useMemo, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import {
  ArrowRight, Bell, Check, ChevronRight, Heart, Menu, Package, Search,
  ShoppingBag, SlidersHorizontal, Store, UserRound, X
} from 'lucide-react';

type Product = {
  id: number; name: string; brand: string; price: number; category: string;
  color: string; sizes: string[]; badge?: string; image: string; description: string;
};

type CartItem = Product & { size: string; qty: number };

const categories = ['All','Tops','Bottoms','Outerwear','Footwear'];
const money = (v:number) => 'KES ' + v.toLocaleString();

function App() {
  const [view,setView] = useState<'shop'|'brands'|'workspace'|'orders'|'admin'>('shop');
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('All');
  const [brand,setBrand] = useState('All brands');
  const [sort,setSort] = useState('Featured');
  const [products,setProducts] = useState<Product[]>([]);
  const [brands,setBrands] = useState<string[]>([]);
  const [cart,setCart] = useState<CartItem[]>([]);
  const [likes,setLikes] = useState<number[]>([]);
  const [selected,setSelected] = useState<Product|null>(null);
  const [cartOpen,setCartOpen] = useState(false);
  const [authOpen,setAuthOpen] = useState(false);
  const [authMode,setAuthMode] = useState<'signin'|'signup'>('signin');
  const [signupRole,setSignupRole] = useState<'customer'|'brand'>('customer');
  const [signupBrand,setSignupBrand] = useState('');
  const [checkoutOpen,setCheckoutOpen] = useState(false);
  const [menuOpen,setMenuOpen] = useState(false);
  const [accountMenuOpen,setAccountMenuOpen] = useState(false);
  const [notice,setNotice] = useState('');
  const [orders,setOrders] = useState<string[]>([]);
  const [review,setReview] = useState<Record<number,number>>({});
  const [reviewOpen,setReviewOpen] = useState<number|null>(null);
  const [email,setEmail] = useState('');
  const [brandEarnings,setBrandEarnings] = useState({grossSales:0,commission:0,netEarnings:0,pendingPayout:0});
  const [adminRevenue,setAdminRevenue] = useState({grossSales:0,commission:0,brandEarnings:0,pendingPayouts:0});
  const [cleanupLoading,setCleanupLoading] = useState(false);
  const [currentUser,setCurrentUser] = useState<any>(null);
  const [brandAccess,setBrandAccess] = useState({isBrandOwner:false,brands:[] as string[]});
  const [adminAccess,setAdminAccess] = useState({isAdmin:false,email:''});
  const [authLoading,setAuthLoading] = useState(false);
  const [authError,setAuthError] = useState('');
  const [deleteAccountLoading,setDeleteAccountLoading] = useState(false);
  const [productModal,setProductModal] = useState<Product|null|false>(false);
  const [productForm,setProductForm] = useState({name:'',price:'',category:'Tops',color:'Black',sizes:'S,M,L',badge:'',image:'',imagePath:'',description:''});
  const [productImageFile,setProductImageFile] = useState<File|null>(null);
  const [productImagePreview,setProductImagePreview] = useState('');
  const [storefrontOpen,setStorefrontOpen] = useState(false);
  const [storefrontForm,setStorefrontForm] = useState({tagline:'',bio:'',instagram:''});
  const [managerLoading,setManagerLoading] = useState(false);

  const refreshAuthState = async () => {
    try {
      const user = await auth.getUser();
      setCurrentUser(user);
      if (!user) {
        setBrandAccess({isBrandOwner:false,brands:[]});
        setAdminAccess({isAdmin:false,email:''});
        return null;
      }
      const [brandResult, adminResult] = await Promise.allSettled([
        api.get('/api/brand/access'),
        api.get('/api/admin/access')
      ]);
      if (brandResult.status === 'fulfilled') setBrandAccess(brandResult.value.data);
      else setBrandAccess({isBrandOwner:false,brands:[]});
      if (adminResult.status === 'fulfilled' && adminResult.value.data?.isAdmin) setAdminAccess(adminResult.value.data);
      else setAdminAccess({isAdmin:false,email:''});
      return user;
    } catch {
      setCurrentUser(null);
      setBrandAccess({isBrandOwner:false,brands:[]});
      setAdminAccess({isAdmin:false,email:''});
      return null;
    }
  };

  useEffect(() => {
    Promise.all([api.get('/api/products'),api.get('/api/brands')]).then(([p,b])=>{
      setProducts(Array.isArray(p.data?.products)?p.data.products:[]);
      setBrands(Array.isArray(b.data?.brands)?b.data.brands.map((x:any)=>x.brand).filter(Boolean):[]);
    }).catch(()=>{});
  }, []);

  useEffect(() => {
    if (view === 'brands') {
      api.get('/api/brands').then(r => {
        setBrands(Array.isArray(r.data?.brands) ? r.data.brands.map((x:any) => x.brand).filter(Boolean) : []);
      }).catch(() => setBrands([]));
    }
  }, [view]);

  useEffect(() => {
    refreshAuthState().then(async user => {
      if (user) {
        try {
          const result = await api.get('/api/brand/access');
          if (result.data?.isBrandOwner) setView('workspace');
        } catch {}
      }
    });
    try {
      const saved = localStorage.getItem('vaa-cart');
      const savedOrders = localStorage.getItem('vaa-orders');
      if (saved) setCart(JSON.parse(saved));
      if (savedOrders) setOrders(JSON.parse(savedOrders));
    } catch {}
  }, []);

  useEffect(() => { localStorage.setItem('vaa-cart',JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('vaa-orders',JSON.stringify(orders)); }, [orders]);

  const filtered = useMemo(() => {
    const result = products.filter(p => {
      const text = (p.name+' '+p.brand+' '+p.category).toLowerCase();
      return text.includes(query.toLowerCase()) &&
        (category==='All'||p.category===category) &&
        (brand==='All brands'||p.brand===brand);
    });
    if (sort==='Price: low') return [...result].sort((a,b)=>a.price-b.price);
    if (sort==='Price: high') return [...result].sort((a,b)=>b.price-a.price);
    return result;
  },[query,category,brand,sort]);

  const cartCount = cart.reduce((n,i)=>n+i.qty,0);
  const subtotal = cart.reduce((n,i)=>n+i.price*i.qty,0);
  const shipping = subtotal>=15000||subtotal===0?0:350;

  const addToCart = (p:Product,size:string) => {
    setCart(current => {
      const found=current.find(i=>i.id===p.id&&i.size===size);
      return found ? current.map(i=>i.id===p.id&&i.size===size?{...i,qty:i.qty+1}:i) : [...current,{...p,size,qty:1}];
    });
    setNotice('Added to bag');
    setSelected(null);
  };

  const updateQty = (id:number,size:string,delta:number) => setCart(c=>c.map(i=>i.id===id&&i.size===size?{...i,qty:i.qty+delta}:i).filter(i=>i.qty>0));
  const show = (message:string) => { setNotice(message); window.setTimeout(()=>setNotice(''),2200); };
  const loadBrandManager = async () => {
    try {
      const [p,s] = await Promise.all([api.get('/api/brand/products'),api.get('/api/brand/storefront')]);
      setProducts(Array.isArray(p.data?.products)?p.data.products:products);
      const sf=s.data?.storefront||{};
      setStorefrontForm({tagline:sf.tagline||'',bio:sf.bio||'',instagram:sf.instagram||''});
    } catch {}
  };
  const openAddProduct = async () => { setProductModal(null); setProductForm({name:'',price:'',category:'Tops',color:'Black',sizes:'S,M,L',badge:'',image:'',imagePath:'',description:''}); setProductImageFile(null); setProductImagePreview(''); setProductModal(null); };
  const openEditProduct = (p:Product) => { setProductForm({name:p.name,price:String(p.price),category:p.category,color:p.color,sizes:p.sizes.join(','),badge:p.badge||'',image:p.image||'',imagePath:(p as any).imagePath||'',description:p.description||''}); setProductImageFile(null); setProductImagePreview(p.image||''); setProductModal(p); };
  const saveProduct = async () => {
    const brandName=brandAccess.brands[0]; if (!brandName) return show('Brand access not found');
    setManagerLoading(true); try { let imagePath=productForm.imagePath; if (productImageFile) { const data=await new Promise<string>((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]||''); reader.onerror=()=>reject(reader.error); reader.readAsDataURL(productImageFile); }); const upload=await api.post('/api/brand/product-image',{fileName:productImageFile.name,contentType:productImageFile.type,data}); if (!upload.data?.uploaded) throw new Error(); imagePath=upload.data.path; } const payload={...productForm,image:'',imagePath,price:Number(productForm.price),brand:brandName,sizes:productForm.sizes.split(',').map(x=>x.trim()).filter(Boolean)}; const r=productModal&&typeof productModal==='object' ? await api.put('/api/brand/products',{...payload,productId:productModal.id}) : await api.post('/api/brand/products',payload); if (!r.data?.saved) throw new Error(); const refreshed=await api.get('/api/products'); setProducts(refreshed.data.products||[]); setProductModal(false); setProductImageFile(null); setProductImagePreview(''); show(productModal?'Product updated':'Product added to storefront'); } catch { show('Could not save product. Please check the image and details.'); } finally { setManagerLoading(false); }
  };
  const openStorefront = async () => { await loadBrandManager(); setStorefrontOpen(true); };
  const saveStorefront = async () => { const brandName=brandAccess.brands[0]; if(!brandName)return; setManagerLoading(true); try { const r=await api.put('/api/brand/storefront',{brand:brandName,...storefrontForm}); if(!r.data?.saved)throw new Error(); const refreshed=await api.get('/api/brands'); setBrands((refreshed.data.brands||[]).map((x:any)=>x.brand).filter(Boolean)); setStorefrontOpen(false); show('Storefront updated'); } catch { show('Could not update storefront. Please try again.'); } finally { setManagerLoading(false); } };

  const placeOrder = async () => {
    const id='VAA-'+Math.floor(100000+Math.random()*900000);
    try {
      const result = await api.post('/api/orders',{orderId:id,subtotal,shipping,total:subtotal+shipping,items:cart.map(i=>({productId:i.id,name:i.name,brand:i.brand,price:i.price,qty:i.qty}))});
      if (!result.data?.saved) throw new Error('Order not saved');
      setOrders(o=>[id,...o]); setCart([]); setCheckoutOpen(false); setCartOpen(false); setView('orders');
      show('Order placed · 15% Vaa commission recorded');
    } catch { show('Order could not be recorded. Please try again.'); }
  }; 
  useEffect(()=>{ if(view==='workspace' && brandAccess.isBrandOwner) api.get('/api/brand/earnings?brand='+encodeURIComponent(brandAccess.brands[0] || 'OTG')).then(r=>setBrandEarnings(r.data)).catch(()=>{}); },[view,brandAccess]);
  useEffect(()=>{ if(view==='workspace' && !brandAccess.isBrandOwner) setView('shop'); },[view,brandAccess.isBrandOwner]);
  useEffect(()=>{ if(view==='admin' && adminAccess.isAdmin) api.get('/api/admin/revenue').then(r=>setAdminRevenue(r.data)).catch(()=>{}); },[view,adminAccess.isAdmin]);
  useEffect(()=>{ if(view==='admin' && !adminAccess.isAdmin) setView('shop'); },[view,adminAccess.isAdmin]);

  return <div className="min-h-screen bg-[#f6f5f2] text-[#11110f]">
    <header className="sticky top-0 z-40 border-b border-black/10 bg-[#f6f5f2]/95 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-[1400px] items-center justify-between px-5 md:px-8">
        <button onClick={()=>{setView('shop');setMenuOpen(false)}} className="text-3xl font-black tracking-[-0.08em]">vaa<span className="text-black/35">.</span></button>
        <nav className="hidden items-center gap-7 text-sm font-medium md:flex">
          {(['shop','brands','orders','workspace','admin'] as const).filter(item=>(item!=='workspace'||brandAccess.isBrandOwner)&&(item!=='admin'||adminAccess.isAdmin)).map(item=><button key={item} onClick={()=>setView(item)} className={view===item?'border-b-2 border-black pb-1':'text-black/45'}>{item==='workspace'?'For brands':item==='admin'?'Admin':item[0].toUpperCase()+item.slice(1)}</button>)}
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 sm:flex"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Vaa" className="w-28 bg-transparent text-sm outline-none"/></div>
          {currentUser ? <div className="relative"><button onClick={()=>setAccountMenuOpen(v=>!v)} className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2.5" aria-label="Open account menu"><UserRound size={17}/><span className="hidden text-xs font-semibold lg:block">{adminAccess.isAdmin?'Admin':brandAccess.isBrandOwner?'Brand':'Account'}</span></button>{accountMenuOpen&&<div className="absolute right-0 top-14 z-50 w-60 rounded-2xl border border-black/10 bg-[#f6f5f2] p-2 shadow-2xl"><div className="rounded-xl bg-white px-4 py-3"><p className="truncate text-sm font-semibold">{currentUser.name||currentUser.email||'Vaa account'}</p><p className="mt-1 text-[11px] uppercase tracking-wider text-black/40">{adminAccess.isAdmin?'Admin account':brandAccess.isBrandOwner?'Brand account':'Customer account'}</p></div>{brandAccess.isBrandOwner&&<button onClick={()=>{setView('workspace');setAccountMenuOpen(false)}} className="mt-2 w-full rounded-xl px-4 py-3 text-left text-xs font-semibold hover:bg-white">Brand dashboard</button>}{adminAccess.isAdmin&&<button onClick={()=>{setView('admin');setAccountMenuOpen(false)}} className="mt-2 w-full rounded-xl px-4 py-3 text-left text-xs font-semibold hover:bg-white">Admin dashboard</button>}<button onClick={async()=>{await auth.signOut();await refreshAuthState();setView('shop');setAccountMenuOpen(false);show('Signed out')}} className="mt-1 w-full rounded-xl px-4 py-3 text-left text-xs font-semibold hover:bg-white">Sign out</button><button onClick={async()=>{if(adminAccess.isAdmin)return;if(!window.confirm('Delete your Vaa account? Your Vaa profile and brand access will be permanently removed.'))return;setDeleteAccountLoading(true);try{await api.delete('/api/account');await auth.signOut();await refreshAuthState();setView('shop');setAccountMenuOpen(false);show('Vaa account deleted');}catch{show('Account deletion failed. Please try again.');}finally{setDeleteAccountLoading(false);}}} disabled={deleteAccountLoading||adminAccess.isAdmin} className="mt-1 w-full rounded-xl px-4 py-3 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-30">{deleteAccountLoading?'Deleting…':'Delete account'}</button></div>}</div> : <><button onClick={()=>{setAuthError('');setAuthMode('signin');setAuthOpen(true)}} className="hidden rounded-full border border-black/10 bg-white px-4 py-3 text-xs font-semibold sm:block">Sign in</button><button onClick={()=>{setAuthError('');setAuthMode('signup');setAuthOpen(true)}} className="hidden rounded-full bg-black px-4 py-3 text-xs font-semibold text-white sm:block">Sign up</button></>}
          <button onClick={()=>setCartOpen(true)} className="relative rounded-full border border-black/10 bg-white p-3"><ShoppingBag size={17}/>{cartCount>0&&<span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] text-white">{cartCount}</span>}</button>
          <button onClick={()=>setMenuOpen(!menuOpen)} className="rounded-full border border-black/10 bg-white p-3 md:hidden">{menuOpen?<X size={17}/>:<Menu size={17}/>}</button>
        </div>
      </div>
      {menuOpen&&<div className="border-t border-black/10 px-5 py-5 md:hidden"><div className="grid gap-4 text-sm font-medium">{(['shop','brands','orders','workspace','admin'] as const).filter(item=>(item!=='workspace'||brandAccess.isBrandOwner)&&(item!=='admin'||adminAccess.isAdmin)).map(item=><button key={item} onClick={()=>{setView(item);setMenuOpen(false)}} className="text-left">{item==='workspace'?'For brands':item==='admin'?'Admin':item[0].toUpperCase()+item.slice(1)}</button>)}<div className="mt-2 grid grid-cols-2 gap-2">{currentUser?<><button onClick={async()=>{await auth.signOut();await refreshAuthState();setView('shop');setMenuOpen(false);show('Signed out')}} className="rounded-full border border-black/10 bg-white py-3">Sign out</button><button onClick={async()=>{if(adminAccess.isAdmin)return;if(!window.confirm('Delete your Vaa account? Your Vaa profile and brand access will be permanently removed.'))return;setDeleteAccountLoading(true);try{await api.delete('/api/account');await auth.signOut();await refreshAuthState();setView('shop');setMenuOpen(false);show('Vaa account deleted');}catch{show('Account deletion failed. Please try again.');}finally{setDeleteAccountLoading(false);}}} disabled={deleteAccountLoading||adminAccess.isAdmin} className="rounded-full border border-red-200 bg-white py-3 text-red-700 disabled:opacity-30">{deleteAccountLoading?'Deleting…':'Delete account'}</button></>:<><button onClick={()=>{setAuthError('');setAuthMode('signin');setAuthOpen(true);setMenuOpen(false)}} className="rounded-full border border-black/10 bg-white py-3">Sign in</button><button onClick={()=>{setAuthError('');setAuthMode('signup');setAuthOpen(true);setMenuOpen(false)}} className="rounded-full bg-black py-3 text-white">Sign up</button></>}</div></div></div>}
    </header>

    {view==='shop'&&<main>
      <section className="mx-auto max-w-[1400px] px-5 pb-12 pt-8 md:px-8 md:pt-14">
        <div className="grid min-h-[480px] overflow-hidden rounded-[2rem] bg-[#171714] text-white md:grid-cols-[1.15fr_.85fr]">
          <div className="flex flex-col justify-between p-7 md:p-12">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">The new fashion marketplace</p>
            <div><h1 className="text-6xl font-black leading-[.86] tracking-[-0.07em] md:text-8xl">FASHION,<br/><span className="text-white/35">DISCOVERED.</span></h1><p className="mt-7 max-w-lg text-sm leading-6 text-white/55">Find independent brands shaping what comes next. Shop the pieces. Discover the people behind them.</p><button onClick={()=>document.getElementById('discover')?.scrollIntoView({behavior:'smooth'})} className="mt-8 flex items-center gap-3 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black">Explore collection <ArrowRight size={16}/></button></div>
          </div>
          <div className="relative min-h-[340px]"><img src={products[2]?.image || ''} className="h-full w-full object-cover opacity-80" alt="Fashion editorial"/><div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent"/><p className="absolute bottom-6 left-6 text-xs uppercase tracking-[0.2em] text-white/70">No products yet</p></div>
        </div>
      </section>
      <section id="discover" className="mx-auto max-w-[1400px] px-5 pb-20 md:px-8">
        <div className="flex flex-col gap-5 border-b border-black/10 pb-5 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/40">Curated marketplace</p><h2 className="mt-2 text-4xl font-black tracking-[-0.05em]">The latest drops.</h2></div><div className="flex flex-wrap gap-2">{categories.map(c=><button key={c} onClick={()=>setCategory(c)} className={'rounded-full px-4 py-2 text-xs font-medium '+(category===c?'bg-black text-white':'border border-black/10 bg-white')}>{c}</button>)}</div></div>
        <div className="mt-6 flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 sm:hidden"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search products" className="w-32 bg-transparent text-sm outline-none"/></div><div className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2"><SlidersHorizontal size={14}/><select value={brand} onChange={e=>setBrand(e.target.value)} className="bg-transparent text-xs outline-none">{['All brands',...brands].map(b=><option key={b}>{b}</option>)}</select></div><select value={sort} onChange={e=>setSort(e.target.value)} className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs outline-none"><option>Featured</option><option>Price: low</option><option>Price: high</option></select><span className="ml-auto text-xs text-black/40">{filtered.length} pieces</span></div>
        <div className="mt-7 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-5">{filtered.map(p=><article key={p.id} className="group"><div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#e5e3dd]"><button onClick={()=>setSelected(p)} className="h-full w-full"><img src={p.image} alt={p.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"/></button>{p.badge&&<span className="absolute left-3 top-3 rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider">{p.badge}</span>}<button onClick={()=>setLikes(l=>l.includes(p.id)?l.filter(x=>x!==p.id):[...l,p.id])} className="absolute right-3 top-3 rounded-full bg-white/90 p-2">{likes.includes(p.id)?<Heart size={15} fill="currentColor"/>:<Heart size={15}/>}</button><button onClick={()=>setSelected(p)} className="absolute bottom-3 left-3 right-3 translate-y-2 rounded-full bg-black px-4 py-3 text-xs font-semibold text-white opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">Quick view</button></div><button onClick={()=>setSelected(p)} className="mt-4 text-left"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/40">{p.brand}</p><h3 className="mt-1 text-sm font-semibold">{p.name}</h3><p className="mt-1 text-sm text-black/55">{money(p.price)}</p></button></article>)}</div>
      </section>
      <section className="border-y border-black/10 bg-white"><div className="mx-auto grid max-w-[1400px] gap-10 px-5 py-16 md:grid-cols-2 md:px-8 md:py-24"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/35">Built for independent fashion</p><h2 className="mt-4 max-w-xl text-5xl font-black leading-[.9] tracking-[-0.06em]">Your next favourite brand is probably still small.</h2></div><div className="flex flex-col justify-end"><p className="max-w-lg text-sm leading-6 text-black/55">Vaa gives emerging labels a place to be discovered without getting lost in a sea of generic products.</p><button onClick={()=>setView('brands')} className="mt-7 flex w-fit items-center gap-2 border-b border-black pb-2 text-sm font-semibold">Meet the brands <ArrowRight size={15}/></button></div></div></section>
    </main>}

    {view==='brands'&&<main className="mx-auto max-w-[1400px] px-5 py-12 md:px-8 md:py-16"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/40">The Vaa directory</p><h1 className="mt-3 text-6xl font-black tracking-[-0.07em] md:text-8xl">Meet the<br/>makers.</h1><p className="mt-6 max-w-xl text-sm leading-6 text-black/55">Independent labels, designers and collectives building the next generation of fashion.</p>{brands.length===0?<div className="mt-14 flex min-h-64 items-center justify-center rounded-3xl border border-dashed border-black/15 bg-white text-sm text-black/45">No brands yet.</div>:<div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{brands.map(b=><button key={b} onClick={()=>{setBrand(b);setView('shop')}} className="rounded-3xl border border-black/10 bg-white p-7 text-left transition hover:-translate-y-0.5"><p className="text-xs uppercase tracking-[0.18em] text-black/35">Independent label</p><h2 className="mt-3 text-3xl font-black tracking-[-0.05em]">{b}</h2><p className="mt-3 text-sm text-black/50">View products from {b}</p><span className="mt-6 flex items-center gap-2 text-xs font-semibold">Shop brand <ArrowRight size={14}/></span></button>)}</div>}</main>}

    {view==='orders'&&<main className="mx-auto max-w-[1000px] px-5 py-12 md:px-8 md:py-16"><p className="text-xs uppercase tracking-[0.2em] text-black/40">Your account</p><h1 className="mt-3 text-6xl font-black tracking-[-0.07em]">Orders.</h1>{orders.length===0?<div className="mt-10 rounded-3xl border border-black/10 bg-white p-8"><Package className="text-black/35"/><h2 className="mt-5 text-2xl font-bold">No orders yet.</h2><p className="mt-2 text-sm text-black/50">Your purchases will appear here after checkout.</p><button onClick={()=>setView('shop')} className="mt-6 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white">Start shopping</button></div>:<div className="mt-10 grid gap-4">{orders.map(id=><div key={id} className="rounded-3xl border border-black/10 bg-white p-6"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.18em] text-black/40">Order</p><h2 className="mt-1 text-xl font-bold">{id}</h2></div><span className="rounded-full bg-black px-3 py-1 text-xs text-white">Processing</span></div><div className="mt-6 grid grid-cols-3 gap-2 text-xs"><span className="rounded-xl bg-black p-3 text-white">Order placed</span><span className="rounded-xl bg-black/5 p-3">Packed</span><span className="rounded-xl bg-black/5 p-3">Delivered</span></div><p className="mt-4 text-xs text-black/40">Estimated delivery: 2–5 business days</p><button onClick={()=>setReviewOpen(0)} className="mt-5 flex items-center gap-2 text-xs font-semibold">Leave a review <ChevronRight size={14}/></button></div>)}</div>}</main>}

    {view==='admin'&&adminAccess.isAdmin&&<main className="mx-auto max-w-[1200px] px-5 py-12 md:px-8 md:py-16"><div className="rounded-[2rem] bg-[#171714] p-7 text-white md:p-12"><p className="text-xs uppercase tracking-[0.2em] text-white/40">Vaa administration</p><h1 className="mt-3 text-6xl font-black leading-[.88] tracking-[-0.07em] md:text-8xl">Control<br/><span className="text-white/35">the marketplace.</span></h1><p className="mt-6 max-w-xl text-sm leading-6 text-white/55">Owner-only operations dashboard for marketplace revenue and platform economics.</p><p className="mt-8 text-xs text-white/45">Signed in as {adminAccess.email}</p></div><div className="mt-5 grid gap-4 md:grid-cols-4"><div className="rounded-3xl border border-black/10 bg-white p-6"><p className="text-xs uppercase tracking-wider text-black/40">Marketplace sales</p><p className="mt-3 text-3xl font-black">{money(adminRevenue.grossSales)}</p></div><div className="rounded-3xl border border-black/10 bg-white p-6"><p className="text-xs uppercase tracking-wider text-black/40">Vaa commission</p><p className="mt-3 text-3xl font-black">{money(adminRevenue.commission)}</p><p className="mt-1 text-xs text-black/40">15%</p></div><div className="rounded-3xl border border-black/10 bg-white p-6"><p className="text-xs uppercase tracking-wider text-black/40">Brand earnings</p><p className="mt-3 text-3xl font-black">{money(adminRevenue.brandEarnings)}</p></div><div className="rounded-3xl border border-black/10 bg-white p-6"><p className="text-xs uppercase tracking-wider text-black/40">Pending payouts</p><p className="mt-3 text-3xl font-black">{money(adminRevenue.pendingPayouts)}</p></div></div><div className="mt-5 grid gap-5 md:grid-cols-2"><div className="rounded-3xl border border-black/10 bg-white p-7"><p className="text-xs uppercase tracking-[0.18em] text-black/35">Platform economics</p><div className="mt-5 space-y-4 text-sm"><div className="flex justify-between"><span className="text-black/50">Commission rate</span><b>15%</b></div><div className="flex justify-between"><span className="text-black/50">Gross marketplace volume</span><b>{money(adminRevenue.grossSales)}</b></div><div className="flex justify-between"><span className="text-black/50">Vaa retained</span><b>{money(adminRevenue.commission)}</b></div><div className="flex justify-between border-t border-black/10 pt-4"><span className="text-black/50">Brand share</span><b>{money(adminRevenue.brandEarnings)}</b></div></div></div><div className="rounded-3xl border border-black/10 bg-white p-7"><p className="text-xs uppercase tracking-[0.18em] text-black/35">Admin access</p><p className="mt-5 text-sm leading-6 text-black/55">This dashboard and its revenue endpoint are restricted to the Vaa owner email configured on the backend.</p><div className="mt-5 rounded-2xl bg-[#f6f5f2] p-4 text-sm font-semibold">{adminAccess.email}</div><button disabled={cleanupLoading} onClick={async()=>{if(!window.confirm('Delete every non-admin account and all brand records? This cannot be undone.'))return;setCleanupLoading(true);try{const r=await api.post('/api/admin/cleanup-marketplace',{});show('Cleanup complete · '+JSON.stringify(r.data.deleted));await refreshAuthState();}catch{show('Cleanup failed. Please try again.');}finally{setCleanupLoading(false);}}} className="mt-5 w-full rounded-full bg-black px-4 py-3 text-xs font-semibold text-white disabled:opacity-40">{cleanupLoading?'Cleaning…':'Delete all accounts & brands'}</button></div></div></main>}

    {view==='workspace'&&brandAccess.isBrandOwner&&<main className="mx-auto max-w-[1200px] px-5 py-12 md:px-8 md:py-16"><div className="rounded-[2rem] bg-[#171714] p-7 text-white md:p-12"><Store size={22} className="text-white/50"/><p className="mt-8 text-xs uppercase tracking-[0.2em] text-white/40">Vaa for brands</p><h1 className="mt-3 text-6xl font-black leading-[.88] tracking-[-0.07em] md:text-8xl">Build your<br/><span className="text-white/35">world here.</span></h1><p className="mt-7 max-w-xl text-sm leading-6 text-white/55">Manage products, storefront identity, orders and customer feedback from one place.</p><div className="mt-10 grid gap-3 md:grid-cols-4">{[[String(products.filter(p=>p.brand===brandAccess.brands[0]).length),'Products live'],['4.8k','Profile visits'],[money(brandEarnings.grossSales),'Gross sales'],[money(brandEarnings.netEarnings),'Brand earnings']].map(([v,l])=><div key={l} className="rounded-2xl border border-white/10 bg-white/5 p-5"><p className="text-3xl font-bold">{v}</p><p className="mt-1 text-xs text-white/40">{l}</p></div>)}</div></div><div className="mt-5 grid gap-5 md:grid-cols-2"><div className="rounded-3xl border border-black/10 bg-white p-7"><p className="text-xs uppercase tracking-[0.18em] text-black/35">Marketplace economics</p><div className="mt-5 grid gap-3 text-sm"><div className="flex justify-between"><span className="text-black/50">Vaa commission</span><b>15%</b></div><div className="flex justify-between"><span className="text-black/50">Brand gross sales</span><b>{money(brandEarnings.grossSales)}</b></div><div className="flex justify-between"><span className="text-black/50">Vaa earned</span><b>{money(brandEarnings.commission)}</b></div><div className="flex justify-between"><span className="text-black/50">Brand net earnings</span><b>{money(brandEarnings.netEarnings)}</b></div><div className="flex justify-between border-t border-black/10 pt-3"><span className="text-black/50">Pending payout</span><b>{money(brandEarnings.pendingPayout)}</b></div></div></div><div className="rounded-3xl border border-black/10 bg-white p-7"><p className="text-xs uppercase tracking-[0.18em] text-black/35">Vaa admin revenue</p><div className="mt-5 grid gap-3 text-sm"><div className="flex justify-between"><span className="text-black/50">Marketplace sales</span><b>{money(adminRevenue.grossSales)}</b></div><div className="flex justify-between"><span className="text-black/50">15% commission</span><b>{money(adminRevenue.commission)}</b></div><div className="flex justify-between"><span className="text-black/50">Brand payouts</span><b>{money(adminRevenue.brandEarnings)}</b></div></div></div><div className="rounded-3xl border border-black/10 bg-white p-7"><p className="text-xs uppercase tracking-[0.18em] text-black/35">Product manager</p><div className="mt-5 grid gap-2"><button onClick={openAddProduct} className="flex items-center justify-between rounded-xl bg-black px-4 py-4 text-left text-sm font-semibold text-white">Add a product <ArrowRight size={15}/></button><button onClick={openStorefront} className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-4 text-left text-sm font-semibold">Edit storefront <ArrowRight size={15}/></button></div></div><div className="rounded-3xl border border-black/10 bg-white p-7"><p className="text-xs uppercase tracking-[0.18em] text-black/35">Seller tools</p><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><span className="text-black/50">Orders to fulfil</span><b>7</b></div><div className="flex justify-between"><span className="text-black/50">Low stock</span><b>3</b></div><div className="flex justify-between"><span className="text-black/50">Unread reviews</span><b>12</b></div></div></div></div></main>}

    {productModal!==false&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-5" onClick={()=>!managerLoading&&setProductModal(false)}><div onClick={e=>e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-[2rem] bg-[#f6f5f2] p-7"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-black/40">Product manager</p><h2 className="mt-2 text-3xl font-black">{productModal&&typeof productModal==='object'?'Edit product':'Add a product'}</h2></div><button onClick={()=>setProductModal(false)}><X/></button></div><div className="mt-6 grid gap-3"><input value={productForm.name} onChange={e=>setProductForm(f=>({...f,name:e.target.value}))} placeholder="Product name" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><input value={productForm.price} onChange={e=>setProductForm(f=>({...f,price:e.target.value}))} placeholder="Price in KES" type="number" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><div className="grid grid-cols-2 gap-3"><select value={productForm.category} onChange={e=>setProductForm(f=>({...f,category:e.target.value}))} className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm"><option>Tops</option><option>Bottoms</option><option>Outerwear</option><option>Footwear</option></select><input value={productForm.color} onChange={e=>setProductForm(f=>({...f,color:e.target.value}))} placeholder="Color" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/></div><input value={productForm.sizes} onChange={e=>setProductForm(f=>({...f,sizes:e.target.value}))} placeholder="Sizes e.g. S,M,L" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><div className="rounded-2xl border border-dashed border-black/15 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Product image</p><p className="mt-1 text-[11px] text-black/40">Upload JPG, PNG or WebP</p></div><label className="cursor-pointer rounded-full bg-black px-4 py-2 text-xs font-semibold text-white">{productImageFile?'Change image':'Choose image'}<input type="file" accept="image/*" className="hidden" onChange={e=>{const file=e.target.files?.[0]||null;setProductImageFile(file);if(file){setProductImagePreview(URL.createObjectURL(file));}}}/></label></div>{productImagePreview&&<img src={productImagePreview} alt="Product preview" className="mt-4 aspect-[4/5] w-full rounded-xl object-cover"/>}</div><input value={productForm.badge} onChange={e=>setProductForm(f=>({...f,badge:e.target.value}))} placeholder="Badge e.g. New" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><textarea value={productForm.description} onChange={e=>setProductForm(f=>({...f,description:e.target.value}))} placeholder="Description" className="min-h-28 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><button disabled={managerLoading||!productForm.name.trim()||!productForm.price} onClick={saveProduct} className="rounded-full bg-black py-4 text-sm font-semibold text-white disabled:opacity-30">{managerLoading?'Saving…':productModal&&typeof productModal==='object'?'Save changes':'Add product'}</button></div></div></div>}
    {storefrontOpen&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-5" onClick={()=>!managerLoading&&setStorefrontOpen(false)}><div onClick={e=>e.stopPropagation()} className="w-full max-w-lg rounded-[2rem] bg-[#f6f5f2] p-7"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-black/40">Storefront editor</p><h2 className="mt-2 text-3xl font-black">{brandAccess.brands[0]}</h2></div><button onClick={()=>setStorefrontOpen(false)}><X/></button></div><div className="mt-6 grid gap-3"><input value={storefrontForm.tagline} onChange={e=>setStorefrontForm(f=>({...f,tagline:e.target.value}))} placeholder="Tagline" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><textarea value={storefrontForm.bio} onChange={e=>setStorefrontForm(f=>({...f,bio:e.target.value}))} placeholder="Tell customers about your brand" className="min-h-32 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><input value={storefrontForm.instagram} onChange={e=>setStorefrontForm(f=>({...f,instagram:e.target.value}))} placeholder="Instagram handle or URL" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><button disabled={managerLoading} onClick={saveStorefront} className="rounded-full bg-black py-4 text-sm font-semibold text-white disabled:opacity-30">{managerLoading?'Saving…':'Save storefront'}</button></div></div></div>}
    {cartOpen&&<div className="fixed inset-0 z-50 bg-black/40" onClick={()=>setCartOpen(false)}><aside onClick={e=>e.stopPropagation()} className="absolute right-0 top-0 h-full w-full max-w-md bg-[#f6f5f2] p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-2xl font-black">Your bag</h2><button onClick={()=>setCartOpen(false)} className="rounded-full bg-white p-2"><X size={16}/></button></div>{cart.length===0?<div className="py-20 text-center"><ShoppingBag className="mx-auto text-black/30"/><p className="mt-4 text-sm text-black/50">Your bag is empty.</p></div>:<><div className="mt-8 space-y-5">{cart.map(i=><div key={i.id+'-'+i.size} className="flex gap-4"><img src={i.image} className="h-24 w-20 rounded-xl object-cover" alt={i.name}/><div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-wider text-black/40">{i.brand}</p><p className="mt-1 text-sm font-semibold">{i.name}</p><p className="text-xs text-black/45">Size {i.size} · {money(i.price)}</p><div className="mt-2 flex items-center gap-3"><button onClick={()=>updateQty(i.id,i.size,-1)} className="h-7 w-7 rounded-full border">−</button><span className="text-xs">{i.qty}</span><button onClick={()=>updateQty(i.id,i.size,1)} className="h-7 w-7 rounded-full border">+</button></div></div></div>)}</div><div className="absolute bottom-6 left-6 right-6 border-t border-black/10 pt-5"><div className="flex justify-between text-sm"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="mt-1 flex justify-between text-xs text-black/45"><span>Delivery</span><span>{shipping===0?'Free':money(shipping)}</span></div><button onClick={()=>setCheckoutOpen(true)} className="mt-5 w-full rounded-full bg-black py-4 text-sm font-semibold text-white">Checkout · {money(subtotal+shipping)}</button></div></>}</aside></div>}

    {authOpen&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-5" onClick={()=>!authLoading&&setAuthOpen(false)}><div onClick={e=>e.stopPropagation()} className="w-full max-w-md rounded-[2rem] bg-[#f6f5f2] p-7 md:p-9"><div className="flex justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-black/40">{authMode==='signup'?'Join Vaa':'Welcome back'}</p><h2 className="mt-2 text-4xl font-black tracking-[-0.05em]">{authMode==='signup'?'Create your account.':'Sign in.'}</h2></div><button disabled={authLoading} onClick={()=>setAuthOpen(false)}><X/></button></div>{authMode==='signup'&&<><p className="mt-3 text-sm text-black/50">Choose how you’ll use Vaa.</p><div className="mt-6 grid grid-cols-2 gap-2"><button onClick={()=>setSignupRole('customer')} className={'rounded-2xl p-4 text-left text-sm '+(signupRole==='customer'?'bg-black text-white':'bg-white border border-black/10')}>Customer<br/><span className="text-xs opacity-60">Shop independent fashion</span></button><button onClick={()=>setSignupRole('brand')} className={'rounded-2xl p-4 text-left text-sm '+(signupRole==='brand'?'bg-black text-white':'bg-white border border-black/10')}>Brand<br/><span className="text-xs opacity-60">Sell on Vaa</span></button></div>{signupRole==='brand'&&<input value={signupBrand} onChange={e=>setSignupBrand(e.target.value)} placeholder="Brand name" className="mt-3 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/>}</>}{authMode==='signin'&&<p className="mt-4 text-sm text-black/50">Continue with Google, Apple, X, or email. We’ll keep you signed in on this device.</p>}{authError&&<div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{authError}</div>}<button onClick={async()=>{setAuthLoading(true);setAuthError('');try{const result=await auth.signIn();if(!result?.user) throw new Error('Authentication did not return a user');setCurrentUser(result.user);if(authMode==='signup'){await api.post('/api/account/profile',{role:signupRole,brandName:signupRole==='brand'?signupBrand.trim():''});show(signupRole==='brand'?'Brand account created · opening dashboard':'Customer account created');}else{show('Signed in');}const refreshedUser = await refreshAuthState();
        if (refreshedUser) {
          try {
            const access = await api.get('/api/brand/access');
            if (access.data?.isBrandOwner) {
              setView('workspace');
              show('Welcome to your brand dashboard');
            }
          } catch {}
        }
        setAuthOpen(false);}catch(err:any){const message=String(err?.message||'');if(message.toLowerCase().includes('cancel')) setAuthError('Sign-in was cancelled. Please try again.');else if(message.toLowerCase().includes('popup')) setAuthError('The sign-in window could not open. Allow pop-ups for Vaa and try again.');else setAuthError('We could not complete sign-in. Please try again.');}finally{setAuthLoading(false);}}} disabled={authLoading||(authMode==='signup'&&signupRole==='brand'&&!signupBrand.trim())} className="mt-7 w-full rounded-full bg-black py-4 text-sm font-semibold text-white disabled:opacity-30">{authLoading?'Connecting…':authMode==='signup'?'Continue to account':'Continue to sign in'}</button><button disabled={authLoading} onClick={()=>{setAuthError('');setAuthMode(authMode==='signup'?'signin':'signup')}} className="mt-4 w-full text-xs font-semibold text-black/50">{authMode==='signup'?'Already have an account? Sign in':'New to Vaa? Create an account'}</button></div></div>}
    {reviewOpen!==null&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-5"><div className="w-full max-w-sm rounded-3xl bg-[#f6f5f2] p-7"><div className="flex justify-between"><h2 className="text-xl font-bold">Rate this piece</h2><button onClick={()=>setReviewOpen(null)}><X size={17}/></button></div><p className="mt-2 text-sm text-black/50">Your feedback helps the brand.</p><div className="mt-7 flex justify-center gap-2">{[1,2,3,4,5].map(n=><button key={n} onClick={()=>{if(reviewOpen>0)setReview(r=>({...r,[reviewOpen]:n}));setReviewOpen(null);show('Thanks for the review')}} className="rounded-full bg-white p-3"><Heart size={18} fill={n<=(review[reviewOpen]||0)?'currentColor':'none'}/></button>)}</div></div></div>}

    {notice&&<div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-5 py-3 text-xs font-semibold text-white shadow-2xl"><Check size={15}/>{notice}</div>}
    <footer className="border-t border-black/10"><div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 py-10 md:flex-row md:items-center md:justify-between md:px-8"><p className="text-2xl font-black tracking-[-0.06em]">vaa.</p><p className="text-xs text-black/40">Fashion marketplace · Built for brands and people.</p><div className="flex gap-5 text-xs text-black/45"><span>About</span><span>Help</span><span>Instagram</span></div></div></footer>
  </div>;
}

function ProductModal({product,onClose,onAdd,review,onReview}:{product:Product;onClose:()=>void;onAdd:(p:Product,size:string)=>void;review:number;onReview:()=>void}) {
  const [size,setSize]=useState(product.sizes[0]);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-6" onClick={onClose}><div onClick={e=>e.stopPropagation()} className="grid max-h-[94vh] w-full max-w-4xl overflow-auto rounded-t-[2rem] bg-[#f6f5f2] md:grid-cols-2 md:rounded-[2rem]"><img src={product.image} alt={product.name} className="aspect-[4/5] w-full object-cover"/><div className="p-7 md:p-10"><div className="flex justify-end"><button onClick={onClose} className="rounded-full bg-white p-2"><X size={16}/></button></div><p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-black/40">{product.brand}</p><h2 className="mt-2 text-4xl font-black tracking-[-0.05em]">{product.name}</h2><p className="mt-2 text-lg text-black/55">{money(product.price)}</p><p className="mt-6 text-sm leading-6 text-black/55">{product.description}</p><div className="mt-7"><p className="text-xs font-semibold uppercase tracking-wider">Size</p><div className="mt-2 flex flex-wrap gap-2">{product.sizes.map(s=><button key={s} onClick={()=>setSize(s)} className={'rounded-full px-4 py-2 text-xs '+(size===s?'bg-black text-white':'border border-black/10 bg-white')}>{s}</button>)}</div></div><button onClick={()=>onAdd(product,size)} className="mt-7 w-full rounded-full bg-black py-4 text-sm font-semibold text-white">Add to bag · {money(product.price)}</button><button onClick={onReview} className="mt-4 flex items-center gap-2 text-xs font-semibold">Reviews {review>0?'· '+review+'/5':''} <ChevronRight size={14}/></button></div></div></div>;
}

function CheckoutModal({subtotal,shipping,email,setEmail,onClose,onPlace}:{subtotal:number;shipping:number;email:string;setEmail:(v:string)=>void;onClose:()=>void;onPlace:()=>void}) {
  const [name,setName]=useState(''); const [phone,setPhone]=useState(''); const [address,setAddress]=useState(''); const [method,setMethod]=useState('M-PESA');
  const valid=name&&phone&&address&&email;
  return <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 md:items-center md:p-5" onClick={onClose}><div onClick={e=>e.stopPropagation()} className="max-h-[94vh] w-full max-w-2xl overflow-auto rounded-t-[2rem] bg-[#f6f5f2] p-7 md:rounded-[2rem] md:p-10"><div className="flex justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-black/40">Secure checkout</p><h2 className="mt-2 text-4xl font-black">Complete your order.</h2></div><button onClick={onClose}><X/></button></div><div className="mt-8 grid gap-3 md:grid-cols-2"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone number" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none"/><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" type="email" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none md:col-span-2"/><input value={address} onChange={e=>setAddress(e.target.value)} placeholder="Delivery address / pickup point" className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none md:col-span-2"/></div><p className="mt-7 text-xs font-semibold uppercase tracking-wider">Payment</p><div className="mt-2 grid grid-cols-2 gap-2"><button onClick={()=>setMethod('M-PESA')} className={'rounded-xl p-4 text-left text-sm '+(method==='M-PESA'?'bg-black text-white':'bg-white border border-black/10')}>M-PESA<br/><span className="text-xs opacity-60">Mobile money</span></button><button onClick={()=>setMethod('Card')} className={'rounded-xl p-4 text-left text-sm '+(method==='Card'?'bg-black text-white':'bg-white border border-black/10')}>Card<br/><span className="text-xs opacity-60">Visa / Mastercard</span></button></div><div className="mt-7 border-t border-black/10 pt-5 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div><div className="mt-2 flex justify-between text-black/50"><span>Delivery</span><span>{shipping===0?'Free':money(shipping)}</span></div><div className="mt-4 flex justify-between text-lg font-bold"><span>Total</span><span>{money(subtotal+shipping)}</span></div></div><button disabled={!valid} onClick={onPlace} className="mt-6 w-full rounded-full bg-black py-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-30">Place order · {method}</button><p className="mt-3 text-center text-[11px] text-black/40">Payments are simulated in this MVP and ready to connect to a real provider.</p></div></div>;
}

export default App;