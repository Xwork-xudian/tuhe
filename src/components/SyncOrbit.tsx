import type { PlatformId, PlatformStat } from '../lib/types';
import { PlatformMark } from './PlatformMark';
import { PLATFORM_ORDER } from '../lib/utils';

export function SyncOrbit({ platforms, syncRate }: { platforms: Record<PlatformId, PlatformStat>; syncRate: number }) {
  const list = PLATFORM_ORDER.map((id) => platforms?.[id]).filter(Boolean);
  return (
    <div className="sync-orbit" aria-label={`三个平台连接状态，整体同步率 ${syncRate}%`}>
      <div className="orbit-grid" />
      <div className="orbit-ring ring-one" />
      <div className="orbit-ring ring-two" />
      <div className="orbit-dash dash-one" />
      <div className="orbit-dash dash-two" />
      <div className="orbit-center">
        <span className="orbit-center-pin">途</span>
        <strong>{syncRate}%</strong>
        <small>同步率</small>
      </div>
      {list.map((platform, index) => (
        <div className={`orbit-node node-${index + 1}`} key={platform.id}>
          <PlatformMark platform={platform} size={38} />
          <span className="orbit-node-label">{platform.shortName}</span>
          <i className={platform.enabled && platform.bridgeReady ? 'is-online' : ''} />
        </div>
      ))}
      <span className="orbit-chip"><i />{list.filter((item) => item.enabled && item.bridgeReady).length}/{list.length} 桥接已配置</span>
    </div>
  );
}
