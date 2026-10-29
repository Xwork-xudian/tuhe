import type { CSSProperties } from 'react';
import type { Platform } from '../lib/types';
import { PLATFORM_ORDER, cn } from '../lib/utils';

interface MarkProps {
  platform: Platform | { id: string; mark: string; shortName: string; color: string; softColor: string };
  size?: number;
  className?: string;
  muted?: boolean;
}

export function PlatformMark({ platform, size = 36, className, muted = false }: MarkProps) {
  const style = {
    '--platform-color': platform.color,
    '--platform-soft': platform.softColor,
    width: size,
    height: size,
    fontSize: Math.max(11, Math.round(size * 0.36)),
  } as CSSProperties;
  return (
    <span className={cn('platform-mark', muted && 'is-muted', className)} style={style} title={platform.shortName} aria-label={platform.shortName}>
      {platform.mark}
    </span>
  );
}

export function PlatformStack({ links, platforms, size = 22, max = 4 }: { links: Record<string, unknown>; platforms: Platform[]; size?: number; max?: number }) {
  const linked = PLATFORM_ORDER.filter((id) => links?.[id]);
  const visible = linked.slice(0, max);
  const overflow = linked.length - visible.length;
  return (
    <span className="platform-stack" aria-label={`已关联 ${linked.length} 个平台`}>
      {visible.map((id) => {
        const platform = platforms.find((item) => item.id === id);
        return platform ? <PlatformMark key={id} platform={platform} size={size} /> : null;
      })}
      {overflow > 0 && <span className="platform-overflow">+{overflow}</span>}
      {!linked.length && <span className="platform-none">未关联</span>}
    </span>
  );
}
