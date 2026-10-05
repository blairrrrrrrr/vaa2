import { api, auth } from '@appdeploy/client';
import { ArrowRight, Check, ChevronDown, ChevronRight, Heart, Package, SlidersHorizontal, X } from 'lucide-react';
import { Search, ShoppingBag } from 'lucide-react';
import { Bell, Menu, UserRound } from 'lucide-react';
import { Store } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Product = {
  id: number; productId?: number; sku?: string; name: string; brand: string; price: number; category: string;
  color: string; sizes: string[]; badge?: string; image: string; description: string; stock?: number; lowStockThreshold?: number;
  material?: string; care?: string;
};

type CartItem = Product & { size: string; qty: number };

const categories = ['All','Tops','Bottoms','Outerwear','Footwear'];
const money = (v:number) => 'KES ' + v.toLocaleString();
const STOREFRONT_THEMES: Record<string,{name:string;bg:string;surface:string;ink:string;muted:string;accent:string;accentText:string;border:string;radius:string}> = {
  editorial: { name:'Editorial', bg:'#f6f5f2', surface:'#ffffff', ink:'#11110f', muted:'#11110f99', accent:'#11110f', accentText:'#ffffff', border:'#11110f18', radius:'1.5rem' },
  noir: { name:'Noir', bg:'#11110f', surface:'#1d1d1a', ink:'#ffffff', muted:'#ffffff99', accent:'#ffffff', accentText:'#11110f', border:'#ffffff1c', radius:'0.75rem' },
  studio: { name:'Studio', bg:'#f2f0ff', surface:'#ffffff', ink:'#211d36', muted:'#211d3690', accent:'#5b45d9', accentText:'#ffffff', border:'#5b45d926', radius:'1.75rem' },
  earth: { name:'Earth', bg:'#eee7dc', surface:'#faf7f1', ink:'#30271f', muted:'#30271f8c', accent:'#6f4e37', accentText:'#ffffff', border:'#6f4e3724', radius:'1.75rem' },
  electric: { name:'Electric', bg:'#e8f4f2', surface:'#ffffff', ink:'#062a27', muted:'#062a278c', accent:'#0a7f76', accentText:'#ffffff', border:'#0a7f7626', radius:'1rem' }
};
const FONT_FAMILIES: Record<string,string> = {
  inter: 'Inter, ui-sans-serif, system-ui, sans-serif',
  'space-grotesk': '"Space Grotesk", ui-sans-serif, sans-serif',
  'dm-sans': '"DM Sans", ui-sans-serif, sans-serif',
  playfair: '"Playfair Display", Georgia, serif',
  cormorant: '"Cormorant Garamond", Georgia, serif',
  bebas: '"Bebas Neue", Impact, sans-serif'
};
const STOREFRONT_FONTS = [['inter','Inter'],['space-grotesk','Space Grotesk'],['dm-sans','DM Sans'],['playfair','Playfair Display'],['cormorant','Cormorant Garamond'],['bebas','Bebas Neue']] as const;

function App() {
  const [view,setView] = useState<'shop'|'brands'|'workspace'|'orders'|'admin'>('shop');
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('All');
  const [brand,setBrand] = useState('All brands');
  const [sort,setSort] = useState('Featured');
  const [products,setProducts] = useState<Product[]>([]);
  const [notifications,setNotifications] = useState<any[]>([]);
  const [unreadNotifications,setUnreadNotifications] = useState(0);
  const [notificationOpen,setNotificationOpen] = useState(false);
  const [analytics,setAnalytics] = useState<any>({});
  const [orderDetails,setOrderDetails] = useState<Record<string,any>>({});
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
  const [brandOrders,setBrandOrders] = useState<any[]>([]);
  const [orderStatus,setOrderStatus] = useState<Record<string,string>>({});
  const [adminRevenue,setAdminRevenue] = useState({grossSales:0,commission:0,brandEarnings:0,pendingPayouts:0});
  const [reviewStats,setReviewStats] = useState<Record<number,{average:number;count:number}>>({});
  const [adminRefunds,setAdminRefunds] = useState<any[]>([]);
  const [cleanupLoading,setCleanupLoading] = useState(false);
  const [currentUser,setCurrentUser] = useState<any>(null);
  const [brandAccess,setBrandAccess] = useState({isBrandOwner:false,brands:[] as string[]});
  const [accountRole,setAccountRole] = useState<'customer'|'brand'|'admin'|null>(null);
  const [adminAccess,setAdminAccess] = useState({isAdmin:false,email:''});
  const [authLoading,setAuthLoading] = useState(false);
  const [authError,setAuthError] = useState('');
  const [deleteAccountLoading,setDeleteAccountLoading] = useState(false);
  const [productModal,setProductModal] = useState<Product|null|false>(false);
  const [productForm,setProductForm] = useState({name:'',sku:'',price:'',category:'Tops',color:'Black',sizes:'S,M,L',badge:'',image:'',imagePath:'',description:'',stock:'0',lowStockThreshold:'3',material:'',care:''});
  const [productImageFile,setProductImageFile] = useState<File|null>(null);
  const [productImagePreview,setProductImagePreview] = useState('');
  const [storefrontOpen,setStorefrontOpen] = useState(false);
  const [storefrontForm,setStorefrontForm] = useState({tagline:'',bio:'',instagram:'',theme:'editorial',font:'inter',logo:'',heroImage:'',heroTitle:'',heroText:'',announcement:'',accentColor:'',buttonStyle:'pill',cardStyle:'rounded',alignment:'left',showBio:true,showInstagram:true,showAnnouncement:false});
  const [activeStorefront,setActiveStorefront] = useState<any>(null);
  const [managerLoading,setManagerLoading] = useState(false);
  const [paymentLoading,setPaymentLoading] = useState(false);
  const [policyOpen,setPolicyOpen] = useState<string|null>(null);
  const [reviewBusy,setReviewBusy] = useState(false);
  const [brandPayout,setBrandPayout] = useState({phone:'',accountName:''});
  const [payoutLoading,setPayoutLoading] = useState(false);
  const track = (event:string, extra:any={}) => { api.post('/api/analytics/event',{event,...extra}).catch(()=>{}); };

  const refreshAuthState = async () => {
    try {
      const user = await auth.getUser();
      setCurrentUser(user);
      if (!user) {
        setBrandAccess({isBrandOwner:false,brands:[]});
        setAdminAccess({isAdmin:false,email:''});
        setAccountRole(null);
        return null;
      }
      const [profileResult, brandResult, adminResult] = await Promise.allSettled([
        api.get('/api/account/profile'),
        api.get('/api/brand/access'),
        api.get('/api/admin/access')
      ]);
      const profileRole = profileResult.status === 'fulfilled' ? profileResult.value.data?.profile?.role : null;
      if (adminResult.status === 'fulfilled' && adminResult.value.data?.isAdmin) {
        setAdminAccess(adminResult.value.data);
        setAccountRole('admin');
      } else {
        setAdminAccess({isAdmin:false,email:''});
        if (profileRole === 'brand' || (brandResult.status === 'fulfilled' && brandResult.value.data?.isBrandOwner)) setAccountRole('brand');
        else if (profileRole === 'customer') setAccountRole('customer');
        else setAccountRole(null);
      }
      if (brandResult.status === 'fulfilled') setBrandAccess(brandResult.value.data);
      else setBrandAccess({isBrandOwner:false,brands:[]});
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
    if (brand === 'All brands') {
      setActiveStorefront(null);
      return;
    }
    api.get('/api/brands').then(r => {
      const found = (Array.isArray(r.data?.brands) ? r.data.brands : []).find((x:any) => x.brand === brand);
      setActiveStorefront(found || { brand, theme:'editorial', font:'inter' });
    }).catch(() => setActiveStorefront({ brand, theme:'editorial', font:'inter' }));
  }, [brand]);

  useEffect(() => {
    if (view === 'brands') {
      api.get('/api/brands').then(r => {
        setBrands(Array.isArray(r.data?.brands) ? r.data.brands.map((x:any) => x.brand).filter(Boolean) : []);
      }).catch(() => setBrands([]));
    }
  }, [view]);

  useEffect(() => {
    refreshAuthState().then(user => {
      if (user) {
        const role = accountRole;
        if (role === 'admin') setView('admin');
        else if (role === 'brand') setView('workspace');
        else if (role === 'customer') setView('shop');
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
  useEffect(() => { track('page_view',{metadata:{view}}); },[view]);
  useEffect(() => { if(currentUser){ api.get('/api/account/notifications').then(r=>{setNotifications(Array.isArray(r.data?.notifications)?r.data.notifications:[]);setUnreadNotifications(Number(r.data?.unread||0));}).catch(()=>{}); } else { setNotifications([]);setUnreadNotifications(0); } },[currentUser,view,orderStatus]);

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
    const available=Number(p.stock ?? 99); const already=cart.find(i=>i.id===p.id&&i.size===size)?.qty||0;
    if(available<=already){ show('This item is out of stock'); return; }
    setCart(current => {
      const found=current.find(i=>i.id===p.id&&i.size===size);
      return found ? current.map(i=>i.id===p.id&&i.size===size?{...i,qty:i.qty+1}:i) : [...current,{...p,size,qty:1}];
    });
    track('add_to_cart',{productId:p.productId||p.id});