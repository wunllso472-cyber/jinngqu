import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './ctx.jsx';
import { ConfirmHost, Spinner, ToastHost } from './ui.jsx';
import LoginModal, { openLogin } from './components/LoginModal.jsx';
import Home from './pages/Home.jsx';
import DressUp from './pages/DressUp.jsx';
import Discover from './pages/Discover.jsx';
import TemplateDetail from './pages/TemplateDetail.jsx';
import Create from './pages/Create.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Works from './pages/Works.jsx';
import Me from './pages/Me.jsx';
import Characters from './pages/Characters.jsx';
import Orders from './pages/Orders.jsx';
import Favorites from './pages/Favorites.jsx';
import { TicketDetail, TicketList, TicketNew } from './pages/Tickets.jsx';
import { PrintDetail, PrintList } from './pages/Prints.jsx';
import Points from './pages/Points.jsx';
import Agreement from './pages/Agreement.jsx';
import Merchant from './pages/Merchant.jsx';
import Admin from './pages/admin/Admin.jsx';

function RequireAuth({ children, roles }) {
  const { user, ready } = useApp();
  const loc = useLocation();
  const needLogin = ready && !user;
  useEffect(() => {
    if (needLogin) openLogin();
  }, [needLogin]);
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/me" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/me" replace />;
  return children;
}

const TABS = [
  { to: '/', label: '首页', icon: '⌂' },
  { to: '/dress-up', label: '换装', icon: '✦' },
  { to: '/characters', center: true },
  { to: '/discover', label: '发现', icon: '◎' },
  { to: '/me', label: '我的', icon: '◉' },
];
const TAB_PATHS = TABS.map((t) => t.to);

export default function App() {
  const loc = useLocation();
  const showTabs = TAB_PATHS.includes(loc.pathname);
  const wide = loc.pathname.startsWith('/admin') || loc.pathname.startsWith('/merchant');
  return (
    <div className={`app ${wide ? 'app-wide' : ''} ${showTabs ? 'with-tabs' : ''}`}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dress-up" element={<DressUp />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/template/:id" element={<TemplateDetail />} />
        <Route path="/create/:templateId" element={<RequireAuth><Create /></RequireAuth>} />
        <Route path="/orders" element={<RequireAuth><Orders /></RequireAuth>} />
        <Route path="/orders/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
        <Route path="/works" element={<Works />} />
        <Route path="/me" element={<Me />} />
        <Route path="/characters" element={<RequireAuth><Characters /></RequireAuth>} />
        <Route path="/favorites" element={<RequireAuth><Favorites /></RequireAuth>} />
        <Route path="/prints" element={<RequireAuth><PrintList /></RequireAuth>} />
        <Route path="/prints/:id" element={<RequireAuth><PrintDetail /></RequireAuth>} />
        <Route path="/points" element={<RequireAuth><Points /></RequireAuth>} />
        <Route path="/tickets" element={<RequireAuth><TicketList /></RequireAuth>} />
        <Route path="/tickets/new" element={<RequireAuth><TicketNew /></RequireAuth>} />
        <Route path="/tickets/:id" element={<RequireAuth><TicketDetail /></RequireAuth>} />
        <Route path="/agreement" element={<Agreement />} />
        <Route path="/merchant/*" element={<RequireAuth roles={['merchant', 'admin']}><Merchant /></RequireAuth>} />
        <Route path="/admin/*" element={<RequireAuth roles={['admin']}><Admin /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {showTabs && (
        <nav className="tabbar" aria-label="主导航">
          {TABS.map((t) =>
            t.center ? (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab-center ${isActive ? 'active' : ''}`} aria-label="人物管理">
                <img src="/origin/icon-characters.png" alt="" />
              </NavLink>
            ) : (
              <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="tab-icon">{t.icon}</span>
                <span>{t.label}</span>
              </NavLink>
            ),
          )}
        </nav>
      )}
      <LoginModal />
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}
