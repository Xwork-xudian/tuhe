import { useState } from 'react';
import { Bell, Menu, Plus, Search } from 'lucide-react';

const routeTitles: Record<string, { eyebrow: string; title: string }> = {
  '/overview': { eyebrow: '工作台', title: '总览' },
  '/places': { eyebrow: '收藏资产', title: '地点库' },
  '/footprint': { eyebrow: '探索记录', title: '足迹' },
  '/sync': { eyebrow: '跨平台', title: '同步中心' },
  '/connections': { eyebrow: '数据源', title: '平台连接' },
  '/transfer': { eyebrow: '数据流转', title: '导入导出' },
};

interface TopbarProps {
  route: string;
  navigate: (path: string) => void;
  onAdd: () => void;
  onMenu: () => void;
}

export function Topbar({ route, navigate, onAdd, onMenu }: TopbarProps) {
  const [query, setQuery] = useState('');
  const current = Object.entries(routeTitles).find(([path]) => route.startsWith(path))?.[1] || routeTitles['/overview'];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    navigate(text ? `/places?q=${encodeURIComponent(text)}` : '/places');
  };

  return (
    <header className="topbar">
      <button className="icon-btn mobile-menu" onClick={onMenu} aria-label="打开菜单"><Menu size={20} /></button>
      <div className="breadcrumb">
        <span>{current.eyebrow}</span>
        <i>/</i>
        <strong>{current.title}</strong>
      </div>
      <form className="global-search" onSubmit={submit}>
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索地点、城市或标签" aria-label="搜索地点" />
        <kbd>⌘ K</kbd>
      </form>
      <div className="topbar-actions">
        <button className="icon-btn notification" aria-label="通知"><Bell size={18} /><span /></button>
        <button className="btn btn-primary topbar-add" onClick={onAdd}><Plus size={17} /><span>添加地点</span></button>
        <button className="topbar-avatar" onClick={() => navigate('/connections')} aria-label="个人资料">旅</button>
      </div>
    </header>
  );
}
