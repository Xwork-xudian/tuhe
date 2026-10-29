export type PlatformId = 'amap' | 'baidu' | 'yuanzhou';

export interface Platform {
  id: PlatformId;
  name: string;
  shortName: string;
  mark: string;
  color: string;
  softColor: string;
  coordSystem: string;
  description: string;
  importFormats: string[];
  exportFormats: string[];
  docs: string;
}

export interface PlatformLink {
  externalId?: string | null;
  status: 'synced' | 'pending';
  lastSyncedAt?: string | null;
}

export interface PlaceSync {
  linkedCount: number;
  syncedCount: number;
  pendingCount: number;
  missingCount: number;
  coverage: number;
  state: 'complete' | 'partial' | 'unlinked';
}

export interface Place {
  id: string;
  name: string;
  address: string;
  city: string;
  district: string;
  category: string;
  tags: string[];
  note: string;
  rating: number | null;
  url: string;
  location: { lng: number; lat: number } | null;
  coordSystem: string;
  source: { platform: string; externalId?: string | null; importedAt: string };
  links: Partial<Record<PlatformId, PlatformLink>>;
  createdAt: string;
  updatedAt: string;
  sync: PlaceSync;
}

export interface PlatformStat extends Platform {
  enabled: boolean;
  mode: ConnectionMode;
  bridgeReady?: boolean;
  lastSyncAt: string | null;
  linked: number;
  synced: number;
  pending: number;
  coverage: number;
}

export interface DashboardStats {
  total: number;
  linked: number;
  complete: number;
  pending: number;
  incomplete: number;
  cities: number;
  duplicates: number;
  syncRate: number;
  platformCount: number;
  bridgeReady: number;
  located: number;
}

export interface Activity {
  id: string;
  type: string;
  title: string;
  detail: string;
  platform: string;
  createdAt: string;
}

export interface SyncJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  platforms: PlatformId[];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  progress: number;
  strategy?: string;
  trigger?: string;
  createdAt: string;
  updatedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  results?: Array<{ placeId: string; placeName?: string; platform: PlatformId; status: string; reason?: string; externalId?: string }>;
}


export interface BridgeLog {
  at: string;
  platform: PlatformId;
  status: string;
  placeName?: string;
  method?: string;
  url?: string;
  httpStatus?: number;
  error?: string | null;
  response?: string;
}

export interface CityAnalysisCity {
  name: string;
  count: number;
  located: number;
  platforms: Record<string, number>;
  categories: Array<{ name: string; count: number }>;
  topPlaces: Array<{ id: string; name: string; category: string }>;
}

export interface CityAnalysis {
  excludedPlatform: 'yuanzhou';
  sourcePlatforms: Array<{ id: string; name: string }>;
  total: number;
  cityCount: number;
  crossPlatformCount: number;
  crossPlatformRate: number;
  platformTotals: Record<string, number>;
  dominantPlatform: { id: string; name: string; count: number } | null;
  topCategory: { name: string; count: number } | null;
  categories: Array<{ name: string; count: number }>;
  cities: CityAnalysisCity[];
}

export interface FootprintPoint { lng: number; lat: number; t?: string | null }
export interface FootprintTrack { name: string; points: FootprintPoint[] }
export interface FootprintStats {
  points: number;
  tracks: number;
  distanceMeters: number;
  gridCells: number;
  startAt: string | null;
  endAt: string | null;
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
}
export interface FootprintSummary {
  id: string;
  name: string;
  source: string;
  fileName: string;
  format: string;
  stats: FootprintStats;
  warnings: string[];
  createdAt: string;
  updatedAt?: string;
}
export interface FootprintDetail extends FootprintSummary { tracks: FootprintTrack[] }
export interface FootprintList {
  items: FootprintSummary[];
  totals: { sets: number; points: number; tracks: number; distanceMeters: number; gridCells: number; startAt: string | null; endAt: string | null };
}

export interface Dashboard {
  stats: DashboardStats;
  platformStats: Record<PlatformId, PlatformStat>;
  topCities: Array<{ name: string; count: number }>;
  categories: Array<{ name: string; count: number }>;
  cityAnalysis: CityAnalysis;
  recentJobs: SyncJob[];
  recentPlaces: Place[];
  activities: Activity[];
  syncedAt: string;
}

export interface PlacesResponse {
  items: Place[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  facets: { cities: string[]; categories: string[]; tags: string[] };
}

export type ConnectionMode = 'webhook';

export interface Connection extends Platform {
  enabled: boolean;
  mode: ConnectionMode;
  webhookUrl: string;
  hasToken: boolean;
  lastSyncAt: string | null;
  linked: number;
  synced: number;
  pending: number;
}

export interface ImportPreview {
  format: string;
  total: number;
  newCount: number;
  duplicates: number;
  located: number;
  warnings: string[];
  sourceSystems: string[];
  preview: Array<Partial<Place> & { duplicate: boolean; duplicateOf: string | null }>;
}

export interface ImportResult {
  id: string;
  platform: PlatformId;
  fileName: string;
  format: string;
  total: number;
  imported: number;
  merged: number;
  createdAt: string;
  warnings: string[];
}

export interface PullPreview {
  total: number;
  newCount: number;
  mergedCount: number;
  located: number;
  preview: Array<{ name: string; address: string; city: string; location: { lng: number; lat: number } | null; duplicate: boolean; externalId: string }>;
}

export interface PullResult {
  total: number;
  newCount: number;
  mergedCount: number;
  located: number;
  batchId?: string;
}

export interface PullAllResult {
  total: number;
  newCount: number;
  mergedCount: number;
  located: number;
  items: Array<{
    id: PlatformId;
    name: string;
    ok: boolean;
    total?: number;
    newCount?: number;
    mergedCount?: number;
    located?: number;
    error?: string;
  }>;
}

export interface OneDriveStatus {
  connected: boolean;
  accountName: string;
  accountEmail: string;
  driveType: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastPath: string;
  importedCount: number;
  redirectUri: string;
  clientId: string;
  profileWarning?: string;
}

export interface OneDriveItem {
  id: string;
  name: string;
  size: number;
  modifiedAt: string | null;
  eTag: string;
  extension: string;
  supported: boolean;
}

export interface OneDriveFolder {
  id: string;
  name: string;
  childCount: number;
  modifiedAt: string | null;
}

export interface OneDriveListing {
  path: string;
  folders: OneDriveFolder[];
  files: OneDriveItem[];
}

export interface OneDriveSyncResult {
  path: string;
  scanned: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  truncated: boolean;
  results: Array<{ name: string; path: string; status: string; points?: number; error?: string }>;
  at: string;
}

export interface PlaceDraft {
  name: string;
  address: string;
  city: string;
  district: string;
  category: string;
  tags: string[];
  note: string;
  rating: number | null;
  url: string;
  lng: string;
  lat: string;
}
