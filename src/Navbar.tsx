import { Bell, Menu, Search, ShoppingBag, Store, UserRound, X } from 'lucide-react';

type View = 'shop'|'brands'|'workspace'|'orders'|'admin';

type Props = {
  view: View; currentUser: any; brandAccess: {isBrandOwner:boolean;brands:string[]}; adminAccess: {isAdmin:boolean;email:string};
  query:string; setQuery:(v:string)=>void; cartCount:number; menuOpen:boolean; setMenuOpen:any;
  accountMenuOpen:boolean; setAccountMenuOpen:any; unreadNotifications:number; setNotificationOpen:any;
  setCartOpen:(v:boolean)=>void; setAuthOpen:(v:boolean)=>void; setAuthMode:(v:'signin'|'signup')=>void;
  setAuthError:(v:string)=>void; setSignupRole:(v:'customer'|'brand')=>void; setView:(v:View)=>void; setBrand:(v:string)=>void;
  show:(v:string)=>void; signOut:()=>Promise<void>; deleteAccount:()=>Promise<void>; deleteAccountLoading:boolean;
};

export default function Navbar(p:Props) {
  const role = p.view==='admin' && p.adminAccess.isAdmin ? 'admin' : p.view==='workspace' && p.brandAccess.isBrandOwner ? 'brand' : 'customer';
  const go = (v:View) => { p.setView(v); p.setMenuOpen(false); if(v==='shop') p.setBrand('All brands'); };

  const account = p.currentUser ? (
    <div className="relative">
      <button onClick={()=>p.setAccountMenuOpen((v:boolean)=>!v)} className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2.5">
        <UserRound size={17}/><span className="hidden text-xs font-semibold lg:block">{role==='admin'?'Admin':role==='brand'?'Brand':'Account'}</span>
      </button>
      {p.accountMenuOpen&&<div className="absolute right-0 top-14 z-50 w-60 rounded-2xl border border-black/10 bg-[#f6f5f2] p-2 shadow-2xl">
        <div className="rounded-xl bg-white px-4 py-3"><p className="truncate text-sm font-semibold">{p.currentUser.name||p.currentUser.email||'Vaa account'}</p><p className="mt-1 text-[11px] uppercase tracking-wider text-black/40">{role==='admin'?'Admin account':role==='brand'?'Brand account':'Customer account'}</p></div>
        {p.brandAccess.isBrandOwner&&<button onClick={()=>{go('workspace');p.setAccountMenuOpen(false)}} className="mt-2 w-full rounded-xl px-4 py-3 text-left text-xs font-semibold hover:bg-white">Brand dashboard</button>}
        {p.adminAccess.isAdmin&&<button onClick={()=>{go('admin');p.setAccountMenuOpen(false)}} className="mt-2 w-full rounded-xl px-4 py-3 text-left text-xs font-semibold hover:bg-white">Admin dashboard</button>}
        <button onClick={async()=>{await p.signOut();p.setAccountMenuOpen(false);p.show('Signed out')}} className="mt-1 w-full rounded-xl px-4 py-3 text-left text-xs font-semibold hover:bg-white">Sign out</button>
        <button onClick={p.deleteAccount} disabled={p.deleteAccountLoading||p.adminAccess.isAdmin} className="mt-1 w-full rounded-xl px-4 py-3 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-30">{p.deleteAccountLoading?'Deleting…':'Delete account'}</button>
      </div>}
    </div>
  ) : <><button onClick={()=>{p.setAuthError('');p.setAuthMode('signin');p.setAuthOpen(true)}} className="hidden rounded-full border border-black/10 bg-white px-4 py-3 text-xs font-semibold sm:block">Sign in</button><button onClick={()=>{p.setAuthError('');p.setAuthMode('signup');p.setSignupRole('customer');p.setAuthOpen(true)}} className="hidden rounded-full bg-black px-4 py-3 text-xs font-semibold text-white sm:block">Sign up</button></>;

  if(role==='admin') return <header className="sticky top-0 z-40 border-b border-black/10 bg-[#11110f] text-white shadow-sm">
    <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 md:px-8">
      <button onClick={()=>go('admin')} className="flex items-center gap-3"><span className="text-2xl font-black tracking-[-0.08em]">vaa<span className="text-white/35">.</span></span><span className="hidden border-l border-white/15 pl-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50 sm:block">Admin</span></button>
      <nav className="hidden items-center gap-1 md:flex">{['Overview','Marketplace','Orders','Payouts','Analytics'].map(x=><button key={x} onClick={()=>go('admin')} className="rounded-full px-4 py-2 text-xs font-semibold text-white/55 hover:bg-white/10 hover:text-white">{x}</button>)}</nav>
      <div className="flex items-center gap-2">{p.currentUser&&<button onClick={()=>p.setNotificationOpen((v:boolean)=>!v)} className="relative rounded-full border border-white/15 bg-white/5 p-3"><Bell size={16}/>{p.unreadNotifications>0&&<span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">{p.unreadNotifications}</span>}</button>}{account}<button onClick={()=>p.setMenuOpen((v:boolean)=>!v)} className="rounded-full border border-white/15 bg-white/5 p-3 md:hidden">{p.menuOpen?<X size={17}/>:<Menu size={17}/>}</button></div>
    </div>
    {p.menuOpen&&<div className="border-t border-white/10 bg-[#11110f] px-5 py-5 md:hidden"><div className="grid gap-2">{['Overview','Marketplace','Orders','Payouts','Analytics'].map(x=><button key={x} onClick={()=>go('admin')} className="rounded-xl px-4 py-3 text-left text-sm font-semibold text-white/80 hover:bg-white/10">{x}</button>)}</div></div>}
  </header>;

  if(role==='brand') return <header className="sticky top-0 z-40 border-b border-black/10 bg-white/95 backdrop-blur">
    <div className="mx-auto flex h-[76px] max-w-[1400px] items-center justify-between px-5 md:px-8">
      <button onClick={()=>go('workspace')} className="flex items-center gap-3"><span className="text-2xl font-black tracking-[-0.08em]">vaa<span className="text-black/35">.</span></span><span className="hidden rounded-full bg-black px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white sm:block">For brands</span></button>
      <nav className="hidden items-center gap-7 text-sm font-medium md:flex">{['Dashboard','Products','Orders','Storefront'].map(x=><button key={x} onClick={()=>go('workspace')} className="text-black/45 hover:text-black">{x}</button>)}</nav>
      <div className="flex items-center gap-2"><button onClick={()=>go('shop')} className="hidden items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs font-semibold sm:flex"><Store size={15}/> View shop</button>{p.currentUser&&<button onClick={()=>p.setNotificationOpen((v:boolean)=>!v)} className="relative rounded-full border border-black/10 bg-white p-3"><Bell size={16}/>{p.unreadNotifications>0&&<span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] text-white">{p.unreadNotifications}</span>}</button>}{account}<button onClick={()=>p.setMenuOpen((v:boolean)=>!v)} className="rounded-full border border-black/10 bg-white p-3 md:hidden">{p.menuOpen?<X size={17}/>:<Menu size={17}/>}</button></div>
    </div>
    {p.menuOpen&&<div className="border-t border-black/10 bg-[#f6f5f2] px-5 py-5 md:hidden"><div className="grid gap-2">{['Dashboard','Products','Orders','Storefront'].map(x=><button key={x} onClick={()=>go('workspace')} className="rounded-xl bg-white px-4 py-3 text-left text-sm font-semibold">{x}</button>)}<button onClick={()=>go('shop')} className="mt-2 rounded-full bg-black py-3 text-sm font-semibold text-white">View shop</button></div></div>}
  </header>;

  return <header className="sticky top-0 z-40 border-b border-black/10 bg-[#f6f5f2]/95 backdrop-blur">
    <div className="mx-auto flex h-20 max-w-[1400px] items-center justify-between px-5 md:px-8">
      <button onClick={()=>go('shop')} className="text-3xl font-black tracking-[-0.08em]">vaa<span className="text-black/35">.</span></button>
      <nav className="hidden items-center gap-7 text-sm font-medium md:flex"><button onClick={()=>go('shop')} className={p.view==='shop'?'border-b-2 border-black pb-1':'text-black/45'}>Shop all</button><button onClick={()=>go('brands')} className={p.view==='brands'?'border-b-2 border-black pb-1':'text-black/45'}>Brands</button><button onClick={()=>go('orders')} className={p.view==='orders'?'border-b-2 border-black pb-1':'text-black/45'}>Orders</button></nav>
      <div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 sm:flex"><Search size={15}/><input value={p.query} onChange={e=>p.setQuery(e.target.value)} placeholder="Search Vaa" className="w-28 bg-transparent text-sm outline-none"/></div>{account}<button onClick={()=>p.setCartOpen(true)} className="relative rounded-full border border-black/10 bg-white p-3"><ShoppingBag size={17}/>{p.cartCount>0&&<span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-[10px] text-white">{p.cartCount}</span>}</button><button onClick={()=>p.setMenuOpen((v:boolean)=>!v)} className="rounded-full border border-black/10 bg-white p-3 md:hidden">{p.menuOpen?<X size={17}/>:<Menu size={17}/>}</button></div>
    </div>
    {p.menuOpen&&<div className="border-t border-black/10 px-5 py-5 md:hidden"><div className="grid gap-4 text-sm font-medium"><button onClick={()=>go('shop')} className="text-left">Shop all</button><button onClick={()=>go('brands')} className="text-left">Brands</button><button onClick={()=>go('orders')} className="text-left">Orders</button></div></div>}
  </header>;
}