import { ArrowLeftRight, Cable, Footprints, LayoutDashboard, MapPinned, RefreshCw, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils';

const navItems = [
  { path: '/overview', label: '总览', icon: LayoutDashboard },
  { path: '/places', label: '地点库', icon: MapPinned },
  { path: '/footprint', label: '足迹', icon: Footprints },
  { path: '/sync', label: '同步中心', icon: RefreshCw },
  { path: '/connections', label: '平台连接', icon: Cable },
  { path: '/transfer', label: '导入导出', icon: ArrowLeftRight },
];

interface SidebarProps {
  route: string;
  navigate: (path: string) => void;
  open: boolean;
  onClose: () => void;
  syncRate: number;
  connected: number;
}

export function Sidebar({ route, navigate, open, onClose, syncRate, connected }: SidebarProps) {
  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="关闭菜单" />}
      <aside className={cn('sidebar', open && 'is-open')}>
        <div className="brand" onClick={() => navigate('/overview')} role="button" tabIndex={0}>
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-ring ring-a" />
            <span className="brand-ring ring-b" />
            <span className="brand-pin" />
          </span>
          <span className="brand-copy">
            <strong>途合</strong>
            <small>TUHE · PLACE HUB</small>
          </span>
          <button className="sidebar-close" onClick={onClose} aria-label="关闭菜单"><X size={17} /></button>
        </div>

        <p className="sidebar-label">工作台</p>
        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = route.startsWith(item.path);
            return (
              <button key={item.path} className={cn('nav-item', active && 'is-active')} onClick={() => { navigate(item.path); onClose(); }}>
                <Icon size={18} strokeWidth={1.9} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <section className="sidebar-health">
          <div className="health-head">
            <span className="health-icon"><Sparkles size={15} /></span>
            <span>收藏同步率</span>
            <strong>{syncRate}%</strong>
          </div>
          <div className="health-track"><span style={{ width: `${syncRate}%` }} /></div>
          <p>{connected} 个平台桥接已配置<br />今天也把想去的地方收好。</p>
        </section>
        <button className="sidebar-profile" onClick={() => navigate('/connections')}>
          <span className="avatar">旅</span>
          <span className="profile-copy">
            <strong>旅人</strong>
            <small>本地空间 · 私有</small>
          </span>
          <span className="profile-dot" />
        </button>
      </aside>
    </>
  );
}
