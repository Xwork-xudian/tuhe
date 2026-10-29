import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, MapPin } from 'lucide-react';
import { api } from './lib/api';
import type { Dashboard, Place, SyncJob } from './lib/types';
import { cn } from './lib/utils';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { PlaceModal } from './components/PlaceModal';
import { SyncModal } from './components/SyncModal';
import { OverviewPage } from './pages/OverviewPage';
import { PlacesPage } from './pages/PlacesPage';
import { SyncPage } from './pages/SyncPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { TransferPage } from './pages/TransferPage';
import { FootprintPage } from './pages/FootprintPage';

type Toast = { id: number; message: string; tone: 'success' | 'error' };

function readRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/overview';
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState<Place | null>(null);
  const [syncState, setSyncState] = useState<{ open: boolean; ids?: string[] }>({ open: false });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3600);
  }, []);

  const navigate = useCallback((path: string) => {
    window.location.hash = path;
    setRoute(path);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const handler = () => { setRoute(readRoute()); setSidebarOpen(false); };
    window.addEventListener('hashchange', handler);
    if (!window.location.hash) window.location.hash = '/overview';
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!dashboard) setLoading(true);
    api.dashboard()
      .then((data) => { if (!cancelled) setDashboard(data); })
      .catch((error) => notify(error instanceof Error ? error.message : '无法连接途合 API', 'error'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshVersion, notify]);

  useEffect(() => {
    const handler = () => setRefreshVersion((value) => value + 1);
    window.addEventListener('tuhe-refresh', handler);
    return () => window.removeEventListener('tuhe-refresh', handler);
  }, []);

  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);

  const openAdd = () => { setEditingPlace(null); setPlaceOpen(true); };
  const openEdit = (place: Place) => { setEditingPlace(place); setPlaceOpen(true); };
  const openSync = (ids?: string[]) => setSyncState({ open: true, ids });

  const onSyncStarted = (_job: SyncJob) => {
    refresh();
    navigate('/sync');
  };

  const page = (() => {
    if (route.startsWith('/places')) {
      return <PlacesPage route={route} onAdd={openAdd} onEdit={openEdit} onSync={openSync} notify={notify} refreshVersion={refreshVersion} />;
    }
    if (route.startsWith('/footprint')) {
      return <FootprintPage notify={notify} refreshVersion={refreshVersion} />;
    }
    if (route.startsWith('/sync')) {
      return <SyncPage dashboard={dashboard} notify={notify} onNavigate={navigate} refreshVersion={refreshVersion} />;
    }
    if (route.startsWith('/connections')) {
      return <ConnectionsPage navigate={navigate} notify={notify} refreshVersion={refreshVersion} />;
    }
    if (route.startsWith('/transfer')) {
      return <TransferPage route={route} dashboard={dashboard} notify={notify} refreshVersion={refreshVersion} />;
    }
    return <OverviewPage dashboard={dashboard} loading={loading} navigate={navigate} onAdd={openAdd} onSync={() => openSync()} onEdit={openEdit} />;
  })();

  return (
    <div className="app-shell">
      <Sidebar
        route={route}
        navigate={navigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        syncRate={dashboard?.stats.syncRate ?? 0}
        connected={dashboard?.stats.bridgeReady ?? 0}
      />
      <div className="main-shell">
        <Topbar route={route} navigate={navigate} onAdd={openAdd} onMenu={() => setSidebarOpen(true)} />
        <main>{page}</main>
        <footer className="app-footer">
          <span><MapPin size={13} /> 途合 TUHE · 本地优先的跨平台收藏地图</span>
          <span>坐标已适配 · 数据归你所有</span>
        </footer>
      </div>

      <PlaceModal
        open={placeOpen}
        place={editingPlace}
        onClose={() => setPlaceOpen(false)}
        onSaved={refresh}
        notify={notify}
      />
      <SyncModal
        open={syncState.open}
        onClose={() => setSyncState({ open: false })}
        platforms={dashboard?.platformStats ?? null}
        placeIds={syncState.ids}
        onStarted={onSyncStarted}
        notify={notify}
      />

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className={cn('toast', toast.tone)} key={toast.id}>
            {toast.tone === 'success' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
            <span>{toast.message}</span>
            <button onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
