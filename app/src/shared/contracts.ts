import { z } from 'zod';

export const platformIds = ['doubao', 'qianwen', 'dola', 'yunque', 'higgsfield', 'kimi', 'oiioii', 'nano', 'lovart', 'jimeng', 'custom'] as const;
export const platformIdSchema = z.enum(platformIds);
export type PlatformId = z.infer<typeof platformIdSchema>;

export const captureModeSchema = z.enum(['all', 'image', 'video']);
export type CaptureMode = z.infer<typeof captureModeSchema>;

export const dolaAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'] as const;
export const dolaAspectRatioSchema = z.enum(dolaAspectRatios);
export type DolaAspectRatio = z.infer<typeof dolaAspectRatioSchema>;

export const videoGeneratedNoticeSchema = z.object({
  key: z.string().trim().min(1).max(512),
  title: z.string().trim().max(240).default(''),
  thumbUrl: z.string().trim().max(16_384).optional()
});
export type VideoGeneratedNotice = z.infer<typeof videoGeneratedNoticeSchema>;
export type AccountVideoGeneratedNotice = VideoGeneratedNotice & { accountId: string };
export type BrowserNavigationState = { accountId: string; url: string };

const webUrlSchema = z.string().url().or(z.literal('')).refine((value) => !value || /^https?:\/\//i.test(value), '网页地址只允许使用 HTTP 或 HTTPS');

export const proxyModeSchema = z.enum(['direct', 'subscription']);
export type ProxyMode = z.infer<typeof proxyModeSchema>;

export const proxyNodeSchema = z.object({
  name: z.string().trim().max(240).default(''),
  scheme: z.string().trim().max(32).default('socks5'),
  host: z.string().trim().max(255).default(''),
  port: z.coerce.number().int().min(1).max(65535),
  method: z.string().trim().max(128).default(''),
  username: z.string().max(255).default(''),
  password: z.string().max(1024).default(''),
  tag: z.string().trim().max(240).default(''),
  configJson: z.string().max(2_000_000).default(''),
  latencyMs: z.number().int().nonnegative().default(0),
  realIp: z.string().max(128).default('')
});
export type ProxyNode = z.infer<typeof proxyNodeSchema>;

export const proxySchema = z.object({
  enabled: z.boolean().default(false),
  mode: proxyModeSchema.default('direct'),
  type: z.enum(['http', 'https', 'socks5']).default('http'),
  host: z.string().trim().max(255).default(''),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  username: z.string().max(255).default(''),
  password: z.string().max(1024).default(''),
  directScheme: z.enum(['http', 'https', 'socks5']).default('http'),
  directAddressText: z.string().max(1024).default(''),
  directAuthText: z.string().max(1024).default(''),
  subscriptionUrl: z.string().url().or(z.literal('')).default(''),
  subscriptionUserAgent: z.string().max(255).default('sing-box'),
  selectedNodeName: z.string().max(240).default(''),
  selectedNodeTag: z.string().max(240).default(''),
  subscriptionConfigJson: z.string().max(10_000_000).default(''),
  subscriptionNodes: z.array(proxyNodeSchema).max(2000).default([]),
  lastRuntimeError: z.string().max(2000).default('')
}).superRefine((value, context) => {
  if (!value.enabled) return;
  if (value.mode === 'direct' && (!value.host || !value.port)) context.addIssue({ code: 'custom', message: '代理地址或端口不正确', path: ['host'] });
  if (value.mode === 'subscription' && !value.subscriptionUrl && !value.subscriptionConfigJson && !value.subscriptionNodes.length) context.addIssue({ code: 'custom', message: '订阅地址或节点配置不能为空', path: ['subscriptionUrl'] });
});
export type ProxyConfig = z.infer<typeof proxySchema>;

export const fingerprintSchema = z.object({
  enabled: z.boolean().default(false),
  seed: z.string().regex(/^[a-zA-Z0-9_-]{0,128}$/).default(''),
  // Runtime-shaped values are adapted when an account moves between the two
  // supported desktop operating systems.
  runtimePlatform: z.enum(['win32', 'darwin']).optional(),
  userAgent: z.string().max(1024).default(''),
  platform: z.string().max(128).default(''),
  vendor: z.string().max(128).default('Google Inc.'),
  languages: z.array(z.string().max(32)).min(1).max(12).default(['zh-CN', 'zh', 'en']),
  hardwareConcurrency: z.number().int().min(1).max(128).default(8),
  deviceMemory: z.number().min(0.25).max(128).default(8),
  maxTouchPoints: z.number().int().min(0).max(20).default(0),
  webGlVendor: z.string().max(256).default('Google Inc.'),
  webGlRenderer: z.string().max(512).default('ANGLE (Default Renderer)'),
  userAgentDataBrands: z.string().max(2000).default(''),
  userAgentDataFullVersionList: z.string().max(4000).default(''),
  userAgentDataMobile: z.boolean().default(false),
  userAgentDataPlatform: z.string().max(128).default(''),
  userAgentDataArchitecture: z.string().max(32).default(''),
  userAgentDataBitness: z.string().max(16).default(''),
  userAgentDataPlatformVersion: z.string().max(64).default(''),
  screenWidth: z.number().int().min(320).max(16384).default(1920),
  screenHeight: z.number().int().min(240).max(16384).default(1080),
  deviceScaleFactor: z.number().min(0.5).max(8).default(1),
  timezone: z.string().max(128).default(''),
  webRtcPolicy: z.enum(['default', 'disable_non_proxied_udp']).default('default'),
  canvasNoise: z.boolean().default(false),
  audioNoise: z.boolean().default(false),
  generatedAt: z.string().datetime().optional(),
  lastAppliedAt: z.string().datetime().optional(),
  lastError: z.string().max(2000).default('')
});
export type FingerprintProfile = z.infer<typeof fingerprintSchema>;

export const browserProfileSchema = z.object({
  homeUrl: webUrlSchema.default(''),
  lastUrl: webUrlSchema.default(''),
  zoomFactor: z.number().min(0.25).max(5).default(1),
  restoreOnStart: z.boolean().default(true)
});
export type BrowserProfile = z.infer<typeof browserProfileSchema>;

export const dolaClickPointSchema = z.object({
  xRatio: z.number().finite().min(0.01).max(0.99),
  yRatio: z.number().finite().min(0.01).max(0.99)
});
export type DolaClickPoint = z.infer<typeof dolaClickPointSchema>;
export const dolaClickProfileSchema = z.object({
  login: dolaClickPointSchema.default({ xRatio: 0.93, yRatio: 0.035 }),
  google: dolaClickPointSchema.default({ xRatio: 0.345, yRatio: 0.61 }),
  updatedAt: z.string().datetime().optional()
});
export type DolaClickProfile = z.infer<typeof dolaClickProfileSchema>;
export type DolaClickTarget = 'login' | 'google';

export const accountSchema = z.object({
  schemaVersion: z.number().int().positive().default(2),
  id: z.string().regex(/^[a-zA-Z0-9_-]{6,80}$/),
  name: z.string().trim().min(1).max(80),
  platform: platformIdSchema,
  group: z.string().trim().max(80).default(''),
  remark: z.string().trim().max(240).default(''),
  customUrl: webUrlSchema.optional(),
  proxy: proxySchema.default({ enabled: false, mode: 'direct', type: 'http', host: '', username: '', password: '', directScheme: 'http', directAddressText: '', directAuthText: '', subscriptionUrl: '', subscriptionUserAgent: 'sing-box', selectedNodeName: '', selectedNodeTag: '', subscriptionConfigJson: '', subscriptionNodes: [], lastRuntimeError: '' }),
  browser: browserProfileSchema.default({ homeUrl: '', lastUrl: '', zoomFactor: 1, restoreOnStart: true }),
  fingerprint: fingerprintSchema.default({ enabled: false, seed: '', userAgent: '', platform: '', vendor: 'Google Inc.', languages: ['zh-CN', 'zh', 'en'], hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, webGlVendor: 'Google Inc.', webGlRenderer: 'ANGLE (Default Renderer)', userAgentDataBrands: '', userAgentDataFullVersionList: '', userAgentDataMobile: false, userAgentDataPlatform: '', userAgentDataArchitecture: '', userAgentDataBitness: '', userAgentDataPlatformVersion: '', screenWidth: 1920, screenHeight: 1080, deviceScaleFactor: 1, timezone: '', webRtcPolicy: 'default', canvasNoise: false, audioNoise: false, lastError: '' }),
  createdAt: z.string().datetime(),
  order: z.number().int().nonnegative()
});
export type Account = z.infer<typeof accountSchema>;

export const accountInputSchema = accountSchema.omit({ schemaVersion: true, id: true, createdAt: true, order: true });
export type AccountInput = z.infer<typeof accountInputSchema>;

export const mediaResourceSchema = z.object({
  id: z.string(),
  type: z.enum(['image', 'video']),
  url: z.string(),
  previewUrl: z.string().max(16_384).optional(),
  previewThumbUrl: z.string().max(16_384).optional(),
  backupUrl: z.string().optional(),
  alternateUrls: z.array(z.string().max(16_384)).max(8).optional(),
  thumbUrl: z.string().optional(),
  title: z.string().default(''),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  expiresAt: z.string().datetime().optional(),
  confirmedNoWatermark: z.boolean().optional(),
  resolutionMethod: z.string().max(128).optional(),
  qualityEvidence: z.enum(['unknown', 'dom-direct', 'platform-api', 'decoded-token', 'server-original']).optional(),
  rejectedCandidates: z.array(z.string().max(2000)).max(100).optional(),
  messageId: z.string().optional(),
  conversationId: z.string().optional(),
  shareId: z.string().optional(),
  shareUrl: z.string().optional(),
  threadUrl: z.string().optional(),
  vid: z.string().optional(),
  keySeed: z.string().optional(),
  fplayUrl: z.string().optional(),
  dolaRecordKey: z.string().optional(),
  dolaCardId: z.string().optional(),
  dolaVideoElementId: z.string().optional(),
  source: z.string(),
  accountId: z.string(),
  capturedAt: z.string().datetime()
});
export type MediaResource = z.infer<typeof mediaResourceSchema>;

export const dolaResourceReferenceSchema = z.object({
  url: z.string().max(16_384).optional(),
  messageId: z.string().max(2_000).optional(),
  conversationId: z.string().max(2_000).optional(),
  shareId: z.string().max(2_000).optional(),
  shareUrl: z.string().max(16_384).optional(),
  threadUrl: z.string().max(16_384).optional(),
  vid: z.string().max(2_000).optional(),
  keySeed: z.string().max(20_000).optional(),
  fplayUrl: z.string().max(16_384).optional(),
  dolaRecordKey: z.string().max(2_000).optional(),
  dolaCardId: z.string().max(2_000).optional(),
  dolaVideoElementId: z.string().max(2_000).optional(),
  title: z.string().max(500).optional()
}).refine((value) => [value.url, value.messageId, value.shareId, value.shareUrl, value.threadUrl, value.vid, value.keySeed, value.fplayUrl, value.dolaRecordKey, value.dolaCardId, value.dolaVideoElementId].some((item) => Boolean(item?.trim())), 'Dola 素材缺少可解析定位信息');
export type DolaResourceReference = z.infer<typeof dolaResourceReferenceSchema>;

export const settingsSchema = z.object({
  schemaVersion: z.number().int().positive().default(2),
  theme: z.enum(['light', 'dark']).default('dark'),
  downloadDir: z.string().default(''),
  videoDownloadDir: z.string().default(''),
  useAccountDownloadSubfolders: z.boolean().default(true),
  downloadFolderPattern: z.enum(['account', 'platform', 'platform-account', 'date']).default('account'),
  legacyVideoLayout: z.boolean().default(true),
  legacyV44MediaFolders: z.boolean().default(false),
  videoFilenamePrefix: z.string().trim().max(80).default(''),
  captureMode: captureModeSchema.default('all'),
  downloadConcurrency: z.coerce.number().int().min(1).max(6).default(2),
  downloadRetryCount: z.coerce.number().int().min(0).max(5).default(2),
  experimentalResponsePatchEnabled: z.boolean().default(true),
  disabledAdapters: z.array(platformIdSchema).default([]),
  openTabs: z.array(z.string()).default([]),
  activeTabId: z.string().nullable().default(null),
  secondaryTabId: z.string().nullable().default(null),
  dualView: z.boolean().default(false),
  resourcesCollapsed: z.boolean().default(false),
  bossKey: z.object({ key: z.string().regex(/^[A-Za-z0-9]$/).default('H'), ctrl: z.boolean().default(true), alt: z.boolean().default(true), shift: z.boolean().default(false), meta: z.boolean().default(false), enabled: z.boolean().default(false) }).default({ key: 'H', ctrl: true, alt: true, shift: false, meta: false, enabled: false }),
  externalBrowserPath: z.string().max(2048).default(''),
  ffmpegPath: z.string().max(4096).default(''),
  dolaClickProfile: dolaClickProfileSchema.default({ login: { xRatio: 0.93, yRatio: 0.035 }, google: { xRatio: 0.345, yRatio: 0.61 } }),
  dolaAspectRatio: dolaAspectRatioSchema.default('16:9'),
  migrationCompleted: z.boolean().default(false)
});
export type AppSettings = z.infer<typeof settingsSchema>;

export type ProfileLocationInfo = {
  path: string;
  activePath: string;
  defaultPath: string;
  custom: boolean;
  restartRequired: boolean;
};

export type LegacyCacheCandidate = {
  path: string;
  source: 'local-appdata' | 'temp-full' | 'temp-normal' | 'temp-legacy';
  modifiedAt: string;
  ageHours: number;
  sizeBytes: number;
};

export type LegacyCacheScan = {
  scannedAt: string;
  candidates: LegacyCacheCandidate[];
  totalBytes: number;
};

export type LegacyCacheCleanReport = {
  cleanedAt: string;
  deleted: LegacyCacheCandidate[];
  failed: Array<{ candidate: LegacyCacheCandidate; error: string }>;
  freedBytes: number;
  remaining: LegacyCacheScan;
};

export type ApiError = { code: string; message: string };
export type ApiResult<T = void> = { ok: true; data: T } | { ok: false; error: ApiError };

export type ViewLayout = {
  primary: { x: number; y: number; width: number; height: number };
  secondary?: { x: number; y: number; width: number; height: number };
};

export type ExternalBrowserLayout = { x: number; y: number; width: number; height: number };

export type PlatformDefinition = { id: PlatformId; name: string; url: string; specialized: boolean };

/**
 * The capability contract is intentionally separate from PlatformDefinition.
 * A platform can have a dedicated parser or page bridge while still relying
 * on the generic browser container for other operations. Keeping this detail
 * explicit prevents diagnostics and future UI code from treating every
 * registered hostname as a fully migrated site adapter.
 */
export type AdapterTaskDuration = 15 | 30;
export type AdapterCapabilities = {
  domCapture: boolean;
  fetchCapture: boolean;
  xhrCapture: boolean;
  sseCapture: boolean;
  cdpNetworkCapture: boolean;
  requestModification: boolean;
  responseModification: boolean;
  imageParser: boolean;
  videoParser: boolean;
  dedicatedDownloader: boolean;
  loginAssist: boolean;
  taskDurations: AdapterTaskDuration[];
};

export type GroupSummary = { name: string; count: number };
export type SessionDataKind = 'cookies' | 'cache' | 'storage' | 'all';
export type ProxyTestResult = { ok: boolean; latencyMs: number; status?: number; ip?: string; message: string };
export type ProxyNodeTestResult = ProxyTestResult & { tag: string; name: string };
export type ProxyBatchTestResult = { nodes: ProxyNode[]; results: ProxyNodeTestResult[]; tested: number; succeeded: number; message: string };
export type MediaToolStatus = { available: boolean; path?: string; version?: string; packaged: boolean; message: string };
export type PreviewConversionResult = { path: string; url: string; cached: boolean; toolPath: string };
export type FaceGridMode = 'grid' | 'regroup';
export type FaceGridModel = { prototxt: Uint8Array; model: Uint8Array };
export type FaceGridImage = { path: string; dataUrl: string; mime: string };
export type FaceGridResult = { path: string; faceCount: number; scaled: boolean };
export type ProxyRuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'failed';
export type ProxyRuntimeState = { accountId: string; status: ProxyRuntimeStatus; localPort?: number; pid?: number; selectedNodeTag?: string; error?: string; startedAt?: string };
export type SubscriptionProfile = { format: 'sing-box-json' | 'clash-yaml' | 'v2ray-base64' | 'v2ray-uri' | 'unknown'; configJson: string; nodes: ProxyNode[]; skippedNodeCount: number; sourceUrl?: string };
export type SerializedStorageValue =
  | null
  | boolean
  | number
  | string
  | SerializedStorageValue[]
  | { [key: string]: SerializedStorageValue }
  | { __type: 'Date'; value: string | number }
  | { __type: 'ArrayBuffer' | 'Int8Array' | 'Uint8Array' | 'Uint8ClampedArray' | 'Int16Array' | 'Uint16Array' | 'Int32Array' | 'Uint32Array' | 'Float32Array' | 'Float64Array' | 'BigInt64Array' | 'BigUint64Array'; value: string }
  | { __type: 'Blob'; mimeType?: string };
export type IndexedDbKeyPath = string | string[];
export type IndexedDbIndex = { name: string; keyPath: IndexedDbKeyPath; unique?: boolean; multiEntry?: boolean };
export type IndexedDbRecord = { key?: SerializedStorageValue; value: SerializedStorageValue };
export type IndexedDbObjectStore = { name: string; keyPath?: IndexedDbKeyPath | null; autoIncrement?: boolean; indexes?: IndexedDbIndex[]; records?: IndexedDbRecord[] };
export type IndexedDbDatabase = { name: string; version?: number; objectStores?: IndexedDbObjectStore[] };
export type IndexedDbBundle = { databases: IndexedDbDatabase[] };
export type StorageImportBundle = {
  cookies?: Array<{ name: string; value: string; domain: string; path?: string; expires?: number; secure?: boolean; httpOnly?: boolean; sameSite?: string }>;
  localStorage?: Record<string, unknown>;
  sessionStorage?: Record<string, unknown>;
  indexedDb?: IndexedDbBundle;
  warnings?: string[];
};
export type BrowserDiagnostic = { accountId: string; open: boolean; url: string; sessionPartition: string };
export type DiagnosticsAccount = {
  id: string;
  name: string;
  platform: PlatformId;
  open: boolean;
  url: string;
  sessionPartition: string;
  adapterEnabled: boolean;
  adapterCapabilities: AdapterCapabilities;
  fingerprint: { enabled: boolean; seedPresent: boolean; lastAppliedAt?: string; lastError?: string };
  proxy: { enabled: boolean; mode: ProxyMode; status: ProxyRuntimeStatus; localPort?: number; pid?: number; selectedNodeName?: string; nodeCount: number; error?: string };
};
export type DiagnosticsSnapshot = {
  generatedAt: string;
  appVersion: string;
  electronVersion: string;
  platform: string;
  arch: string;
  packaged: boolean;
  accountCount: number;
  openTabCount: number;
  resourceCount: number;
  pluginCount: number;
  taskCounts: Record<DownloadTaskStatus, number>;
  accounts: DiagnosticsAccount[];
};
export const pluginSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{6,80}$/),
  name: z.string().trim().min(1).max(160),
  version: z.string().trim().max(80).default(''),
  description: z.string().max(500).default(''),
  manifestVersion: z.number().int().min(2).max(3),
  path: z.string().min(1).max(4096),
  enabled: z.boolean().default(true),
  installedAt: z.string().datetime(),
  source: z.enum(['directory', 'zip', 'crx'])
});
export type PluginRecord = z.infer<typeof pluginSchema>;
export type LegacyImportSettings = {
  downloadDir: string;
  hasDownloadDir: boolean;
  videoDownloadDir: string;
  hasVideoDownloadDir: boolean;
  legacyV44MediaFolders: boolean;
  hasLegacyV44MediaFolders: boolean;
  profileRoot: string;
  hasProfileRoot: boolean;
  bossKey: AppSettings['bossKey'];
  hasBossKey: boolean;
  dolaAspectRatio: AppSettings['dolaAspectRatio'];
  hasDolaAspectRatio: boolean;
  homeUrlCount: number;
};
export type LegacyImportPreview = { sourcePath: string; accountCount: number; fingerprintCount: number; proxyProfileCount: number; storageFiles: string[]; warnings: string[]; settings: LegacyImportSettings; accounts: Array<{ legacyId: number; name: string; platform: PlatformId; hasFingerprint: boolean; proxyMode: ProxyMode; conflict?: 'name' }> };
export type LegacyImportReport = LegacyImportPreview & { imported: number; skipped: number; backupPath: string; errors: string[] };
export type BatchLoginPlatform = 'dola' | 'higgsfield';
export type DolaLoginStep = { ok: boolean; readyToSync?: boolean; manual?: boolean; field?: string; message: string };
export type DolaLoginState = { ok: boolean; loggedIn: boolean; cookieCount: number; message: string };
export type ExternalLoginState = DolaLoginState & { running: boolean };
export type DolaExternalLoginState = ExternalLoginState;
export type DolaVideoTaskResult = {
  ok: boolean;
  message: string;
  duration: 15 | 30;
  aspectRatio: string;
  requestObserved?: boolean;
  requestDuration?: number;
  requestModel?: string;
  verification?: 'confirmed' | 'mismatch' | 'timeout' | 'unavailable';
};
export type DolaReferenceKind = 'audio' | 'video';
export type DolaReferenceUploadStatus = 'settled' | 'pending' | 'failed' | 'unavailable';
export type DolaReferenceUploadResult = {
  ok: boolean;
  message: string;
  kind: DolaReferenceKind;
  accepted: number;
  inputCount: number;
  boundCount: number;
  pendingCount: number;
  status: DolaReferenceUploadStatus;
  readyForSubmit: boolean;
};
export type DoubaoPromptResult = { ok: boolean; message: string };
export type DoubaoDuration = 15 | 30;
export type DoubaoDurationResult = {
  ok: boolean;
  message: string;
  duration: DoubaoDuration;
  durationFlag: '0' | '1';
  model: string;
  modelSupports30: boolean;
  bridgeReady: boolean;
};
export type DownloadTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export const downloadTaskSchema = z.object({
  id: z.string(), resourceId: z.string(), accountId: z.string(), title: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), receivedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative().optional(), progress: z.number().min(0).max(100).optional(), path: z.string().optional(), error: z.string().optional(),
  attempts: z.number().int().nonnegative(), createdAt: z.string().datetime(), updatedAt: z.string().datetime()
});
export type DownloadTask = z.infer<typeof downloadTaskSchema>;
/** Completion notice for an ordinary Chromium download (PDF, ZIP, JSON, etc.). */
export type NativeDownloadNotice = {
  accountId: string;
  filename: string;
  path: string;
  url: string;
};
export const libraryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(200).default(''), type: z.enum(['all', 'image', 'video', 'other']).default('all'),
  account: z.string().max(80).default(''), platform: platformIdSchema.optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;
export type LibraryPage = { items: DownloadFile[]; total: number; page: number; pageSize: number; pages: number };

export interface WorkbenchApi {
  accounts: {
    list(): Promise<ApiResult<Account[]>>;
    create(input: AccountInput): Promise<ApiResult<Account>>;
    update(id: string, patch: Partial<AccountInput>): Promise<ApiResult<Account>>;
    remove(id: string): Promise<ApiResult<void>>;
    removeMany(ids: string[]): Promise<ApiResult<void>>;
    reorder(ids: string[]): Promise<ApiResult<Account[]>>;
    import(): Promise<ApiResult<{ imported: number }>>;
    export(): Promise<ApiResult<{ path: string }>>;
    groups(): Promise<ApiResult<GroupSummary[]>>;
    renameGroup(from: string, to: string): Promise<ApiResult<Account[]>>;
    removeGroup(name: string): Promise<ApiResult<Account[]>>;
    bulkUpdate(ids: string[], patch: Partial<AccountInput>): Promise<ApiResult<Account[]>>;
  };
  browser: {
    open(accountId: string): Promise<ApiResult<void>>;
    openBatchWorkspace(accountIds: string[]): Promise<ApiResult<void>>;
    closeBatchWorkspace(): Promise<ApiResult<void>>;
    close(accountId: string): Promise<ApiResult<void>>;
    refresh(accountId: string): Promise<ApiResult<void>>;
    back(accountId: string): Promise<ApiResult<void>>;
    forward(accountId: string): Promise<ApiResult<void>>;
    setZoom(accountId: string, factor: number): Promise<ApiResult<number>>;
    reconfigure(accountId: string): Promise<ApiResult<void>>;
    resolveDolaResource(accountId: string, reference: DolaResourceReference, downloadAfterResolve?: boolean): Promise<ApiResult<void>>;
    navigate(accountId: string, url: string): Promise<ApiResult<void>>;
    onNavigation(listener: (state: BrowserNavigationState) => void): () => void;
    activate(primaryId: string | null, secondaryId?: string | null): Promise<ApiResult<void>>;
    setLayout(layout: ViewLayout): Promise<ApiResult<void>>;
    applyProxy(accountId: string): Promise<ApiResult<void>>;
    openMany(accountIds: string[]): Promise<ApiResult<{ succeeded: string[]; failed: Array<{ id: string; message: string }> }>>;
    closeMany(accountIds: string[]): Promise<ApiResult<void>>;
    refreshMany(accountIds: string[]): Promise<ApiResult<void>>;
    clearSession(accountId: string, kind: SessionDataKind): Promise<ApiResult<void>>;
    testProxy(accountId: string): Promise<ApiResult<ProxyTestResult>>;
    startJimengOriginal(accountId: string): Promise<ApiResult<{ ok: boolean; message: string }>>;
    startDoubaoCreationScan(accountId: string): Promise<ApiResult<{ ok: boolean; message: string; count?: number }>>;
    sendDoubao15sPrompt(accountId: string): Promise<ApiResult<DoubaoPromptResult>>;
    setDoubaoDuration(accountId: string, duration: DoubaoDuration): Promise<ApiResult<DoubaoDurationResult>>;
    externalLoginStart(accountId: string, layout?: ExternalBrowserLayout): Promise<ApiResult<{ port: number }>>;
    externalLoginStatus(accountId: string): Promise<ApiResult<{ running: boolean }>>;
    externalLoginState(accountId: string): Promise<ApiResult<ExternalLoginState>>;
    dolaLoginState(accountId: string): Promise<ApiResult<DolaLoginState>>;
    externalDolaLoginState(accountId: string): Promise<ApiResult<DolaExternalLoginState>>;
    externalBrowserOpen(accountId: string): Promise<ApiResult<{ port: number; cookies: number }>>;
    externalLoginSync(accountId: string): Promise<ApiResult<{ cookies: number }>>;
    externalLoginClose(accountId: string): Promise<ApiResult<void>>;
    batchLoginFill(accountId: string, email: string, password: string, platform: BatchLoginPlatform): Promise<ApiResult<DolaLoginStep>>;
    batchLoginCalibrate(accountId: string, platform: BatchLoginPlatform): Promise<ApiResult<DolaLoginStep>>;
    batchLoginFillEmbedded(accountId: string, email: string, password: string, platform: BatchLoginPlatform): Promise<ApiResult<DolaLoginStep>>;
    batchLoginCalibrateEmbedded(accountId: string, platform: BatchLoginPlatform): Promise<ApiResult<DolaLoginStep>>;
    dolaBatchFill(accountId: string, email: string, password: string): Promise<ApiResult<DolaLoginStep>>;
    dolaCalibrate(accountId: string): Promise<ApiResult<DolaLoginStep>>;
    dolaBatchFillEmbedded(accountId: string, email: string, password: string): Promise<ApiResult<DolaLoginStep>>;
    dolaCalibrateEmbedded(accountId: string): Promise<ApiResult<DolaLoginStep>>;
    dolaCaptureClickPoint(accountId: string, target: DolaClickTarget): Promise<ApiResult<DolaClickPoint>>;
    dolaTestClickPoint(accountId: string, target: DolaClickTarget): Promise<ApiResult<{ ok: boolean; message: string }>>;
    dolaUploadReferences(accountId: string, kind: DolaReferenceKind, paths: string[], aspectRatio?: string, duration?: 15 | 30): Promise<ApiResult<DolaReferenceUploadResult>>;
    dolaSubmitVideo(accountId: string, prompt: string, aspectRatio: string, duration: 15 | 30, referencePaths?: string[]): Promise<ApiResult<DolaVideoTaskResult>>;
  };
  proxy: {
    importSubscription(accountId: string, url?: string): Promise<ApiResult<SubscriptionProfile>>;
    refreshSubscription(accountId: string): Promise<ApiResult<SubscriptionProfile>>;
    listNodes(accountId: string): Promise<ApiResult<ProxyNode[]>>;
    selectNode(accountId: string, tag: string): Promise<ApiResult<ProxyRuntimeState>>;
    testNode(accountId: string, tag?: string): Promise<ApiResult<ProxyTestResult>>;
    testAllNodes(accountId: string): Promise<ApiResult<ProxyBatchTestResult>>;
    runtimeStatus(accountId: string): Promise<ApiResult<ProxyRuntimeState>>;
    stopRuntime(accountId: string): Promise<ApiResult<void>>;
    onState(listener: (state: ProxyRuntimeState) => void): () => void;
  };
  fingerprint: {
    get(accountId: string): Promise<ApiResult<FingerprintProfile>>;
    regenerate(accountId: string): Promise<ApiResult<FingerprintProfile>>;
    update(accountId: string, patch: Partial<FingerprintProfile>): Promise<ApiResult<FingerprintProfile>>;
    reset(accountId: string): Promise<ApiResult<FingerprintProfile>>;
  };
  migration: {
    preview(): Promise<ApiResult<LegacyImportPreview | null>>;
    import(): Promise<ApiResult<LegacyImportReport | null>>;
    importStorage(accountId: string): Promise<ApiResult<{ cookies: number; localStorage: number; sessionStorage: number; indexedDb: number; errors: string[] }>>;
  };
  media: {
    list(): Promise<ApiResult<MediaResource[]>>;
    clear(): Promise<ApiResult<void>>;
    download(resourceId: string): Promise<ApiResult<DownloadTask>>;
    downloadMany(resourceIds: string[]): Promise<ApiResult<DownloadTask[]>>;
    selectCandidate(resourceId: string, url: string): Promise<ApiResult<MediaResource>>;
    tasks(): Promise<ApiResult<DownloadTask[]>>;
    cancel(taskId: string): Promise<ApiResult<void>>;
    retry(taskId: string): Promise<ApiResult<DownloadTask>>;
    convertForPreview(resourceId: string): Promise<ApiResult<PreviewConversionResult>>;
    toolStatus(): Promise<ApiResult<MediaToolStatus>>;
    onUpdated(listener: (resources: MediaResource[]) => void): () => void;
    onTasks(listener: (tasks: DownloadTask[]) => void): () => void;
    onVideoGenerated(listener: (notice: AccountVideoGeneratedNotice) => void): () => void;
  };
  faceGrid: {
    chooseImage(): Promise<ApiResult<FaceGridImage | null>>;
    chooseOutputDir(): Promise<ApiResult<string>>;
    model(): Promise<ApiResult<FaceGridModel>>;
    save(input: { inputPath: string; outputDir?: string; mode: FaceGridMode; mime: string; dataUrl: string; faceCount: number; scaled: boolean }): Promise<ApiResult<FaceGridResult>>;
  };
  files: {
    list(query?: Partial<LibraryQuery>): Promise<ApiResult<LibraryPage>>;
    open(path: string): Promise<ApiResult<void>>;
    openUrl(url: string): Promise<ApiResult<void>>;
    reveal(path: string): Promise<ApiResult<void>>;
    remove(path: string): Promise<ApiResult<void>>;
    chooseImages(): Promise<ApiResult<string[]>>;
    chooseDolaReferences(kind: DolaReferenceKind): Promise<ApiResult<string[]>>;
    getPathForFile(file: File): string;
    chooseDownloadDir(): Promise<ApiResult<string>>;
    openDownloadDir(): Promise<ApiResult<void>>;
    chooseVideoDownloadDir(): Promise<ApiResult<string>>;
    openVideoDownloadDir(): Promise<ApiResult<void>>;
    copyPath(path: string): Promise<ApiResult<void>>;
    copyText(value: string): Promise<ApiResult<void>>;
    drag(path: string): Promise<ApiResult<void>>;
    onDownloaded(listener: (notice: NativeDownloadNotice) => void): () => void;
  };
  settings: {
    get(): Promise<ApiResult<AppSettings>>;
    update(patch: Partial<AppSettings>): Promise<ApiResult<AppSettings>>;
  };
  data: {
    profileLocation(): Promise<ApiResult<ProfileLocationInfo>>;
    chooseProfileLocation(): Promise<ApiResult<ProfileLocationInfo>>;
    resetProfileLocation(): Promise<ApiResult<ProfileLocationInfo>>;
    restart(): Promise<ApiResult<void>>;
  };
  maintenance: {
    scanLegacyCache(): Promise<ApiResult<LegacyCacheScan>>;
    cleanLegacyCache(): Promise<ApiResult<LegacyCacheCleanReport>>;
  };
  diagnostics(): Promise<ApiResult<DiagnosticsSnapshot>>;
  updates: {
    check(): Promise<ApiResult<UpdateInfo>>;
    download(): Promise<ApiResult<{ path: string }>>;
    openRelease(): Promise<ApiResult<void>>;
  };
  platforms(): Promise<ApiResult<PlatformDefinition[]>>;
  plugins: {
    list(): Promise<ApiResult<PluginRecord[]>>;
    importPackage(): Promise<ApiResult<PluginRecord>>;
    importDirectory(): Promise<ApiResult<PluginRecord>>;
    setEnabled(id: string, enabled: boolean): Promise<ApiResult<PluginRecord[]>>;
    remove(id: string): Promise<ApiResult<void>>;
    openFolder(): Promise<ApiResult<void>>;
  };
}

export type DownloadFile = { path: string; relativePath: string; name: string; size: number; modifiedAt: string; type: 'image' | 'video' | 'other'; previewUrl?: string; account?: string; platform?: PlatformId };
export type UpdateInfo = { enabled: boolean; hasUpdate: boolean; currentVersion: string; latestVersion?: string; releaseUrl?: string; target?: string; reason?: string };
