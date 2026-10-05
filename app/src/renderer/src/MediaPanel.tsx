import { useEffect, useMemo, useRef, useState } from 'react';
import { supersededDoubaoPlayback } from '../../shared/media-quality';
import type { DownloadTask, MediaResource } from '../../shared/contracts';

type Props = {
  resources: MediaResource[]; tasks: DownloadTask[]; selected: string[]; parseImages: boolean;
  accountName(id: string): string;
  onSelect(ids: string[]): void; onPreview(resource: MediaResource): void;
  onDownload(resource: MediaResource): void; onDownloadMany(resources: MediaResource[]): void;
  onCandidates(resource: MediaResource): void; onRefresh(resource: MediaResource): void;
  onOpenFolder(): void; onLibrary(): void; onCollapse?(): void; onClear(): void; onStatus(message: string): void;
};

function bytes(value: number): string {
  if (!value) return '0 B';
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

export function taskState(task?: DownloadTask): string {
  if (!task) return '可预览';
  if (task.status === 'queued' && task.retryAfter && Date.parse(task.retryAfter) > Date.now()) return '限流等待';
  if (task.status === 'running') return task.phase === 'resolving' ? '更新地址' : task.phase === 'retrying' ? '正在重试' : '下载中';
  return { queued: '等待下载', paused: '已暂停', completed: '已下载', failed: '下载失败', cancelled: '已取消' }[task.status];
}

function TaskProgress({ task }: { task: DownloadTask }): React.JSX.Element {
  return <><div className="material-progress"><span style={{ width: `${task.progress ?? 0}%` }} /></div><div className="material-transfer"><span>{bytes(task.receivedBytes)}{task.totalBytes ? ` / ${bytes(task.totalBytes)}` : ''}</span><span>{task.status === 'running' && task.speedBytesPerSecond ? `${bytes(task.speedBytesPerSecond)}/s` : taskState(task)}</span></div></>;
}

function MaterialCard({
  resource,
  task,
  selected,
  account,
  onSelect,
  onPreview,
  onDownload,
  onCandidates,
  onRefresh,
  onResume,
  onReveal
}: {
  resource: MediaResource;
  task?: DownloadTask;
  selected: boolean;
  account: string;
  onSelect(): void;
  onPreview(): void;
  onDownload(): void;
  onCandidates(): void;
  onRefresh(): void;
  onResume(): void;
  onReveal(): void;
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [_isHovered, setIsHovered] = useState(false);

  const videoUrl = resource.previewUrl || resource.url;
  const poster = resource.previewThumbUrl || resource.thumbUrl;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setFailed(false);
    setPosterFailed(false);
  }, [videoUrl, poster]);

  const handleMouseEnter = (): void => {
    hoverTimerRef.current = setTimeout(() => {
      setIsHovered(true);
      if (videoRef.current && videoUrl && resource.type === 'video') {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
      }
    }, 180);
  };

  const handleMouseLeave = (): void => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setIsHovered(false);
    if (videoRef.current && resource.type === 'video') {
      videoRef.current.pause();
      videoRef.current.currentTime = 0.1;
    }
  };

  const state = !resource.url
    ? '等待解析'
    : task
      ? taskState(task)
      : resource.previewStatus === 'loading'
        ? '准备预览'
        : resource.previewStatus === 'failed'
          ? '预览失败'
          : resource.previewCached
            ? '本地预览'
            : '可预览';

  const busy = task?.status === 'running' || task?.status === 'queued';
  const error = task?.status === 'failed' ? task.error : resource.previewError;
  const downloadLabel =
    task?.status === 'completed'
      ? '定位文件'
      : task?.status === 'paused'
        ? '继续下载'
        : busy
          ? '已加入队列'
          : task?.status === 'failed'
            ? '重试下载'
            : !videoUrl
              ? '解析并下载'
              : '下载';
  const handleDownload =
    task?.status === 'completed' && task.path
      ? onReveal
      : task?.status === 'paused'
        ? onResume
        : onDownload;

  return (
    <article
      ref={ref}
      className={`material-card ${selected ? 'is-selected' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="material-cover">
        <button
          className="material-preview-button"
          onClick={onPreview}
          disabled={!videoUrl}
          aria-label={`预览 ${resource.title || '素材'}`}
        >
          {visible && !failed && ((poster && !posterFailed) || resource.type === 'image') ? (
            <img
              loading="lazy"
              src={!posterFailed && poster ? poster : videoUrl}
              alt={resource.title || '素材封面'}
              onError={() => (poster && !posterFailed ? setPosterFailed(true) : setFailed(true))}
            />
          ) : visible && videoUrl && !failed && resource.type === 'video' ? (
            <video
              ref={videoRef}
              muted
              loop
              playsInline
              preload="metadata"
              src={videoUrl}
              onError={() => setFailed(true)}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (Number.isFinite(video.duration) && video.duration > 0)
                  video.currentTime = Math.min(0.1, video.duration / 2);
              }}
            />
          ) : (
            <span className="material-placeholder">
              {resource.type === 'video' ? '▷' : '▧'}
              <small>{failed ? '封面暂不可用' : !videoUrl ? '等待原始地址' : '加载封面'}</small>
            </span>
          )}
          {resource.type === 'video' && videoUrl && (
            <span className="material-play" aria-hidden="true">
              ▶
            </span>
          )}
        </button>
        <label className="material-select">
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={`选择素材 ${resource.title || resource.id}`}
          />
        </label>
        <span className={`material-state ${task?.status || ''}`}>{state}</span>

        <div className="material-cover-overlay">
          <div className="material-cover-info">
            <strong className="material-title" title={resource.title}>
              {resource.title || (resource.type === 'video' ? '视频作品' : '图片作品')}
            </strong>
            <div className="material-meta">
              <span className="material-account">{account}</span>
              <span className="material-tag">
                {resource.type === 'video' ? '视频' : '图片'}
                {resource.confirmedNoWatermark ? ' · 原始' : ''}
                {resource.duration
                  ? ` · ${Math.floor(resource.duration / 60)}:${String(
                      Math.floor(resource.duration % 60)
                    ).padStart(2, '0')}`
                  : ''}
              </span>
            </div>
          </div>
          <div className="material-actions">
            <button
              disabled={!videoUrl}
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              aria-label={`预览 ${resource.title || '素材'}`}
            >
              预览
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              title={downloadLabel}
            >
              {downloadLabel}
            </button>
            <button
              className="material-more"
              aria-label="素材更多操作"
              aria-expanded={more}
              onClick={(e) => {
                e.stopPropagation();
                setMore(!more);
              }}
            >
              ···
            </button>
          </div>
        </div>

        {task && ['running', 'queued', 'paused'].includes(task.status) && (
          <div className="material-cover-progress">
            <TaskProgress task={task} />
          </div>
        )}
        {error && (
          <p className="material-error" role="status">
            {error}
          </p>
        )}
        {more && (
          <div className="material-more-actions">
            <button onClick={onRefresh}>重新解析</button>
            <button onClick={onCandidates}>候选地址</button>
          </div>
        )}
      </div>
    </article>
  );
}

export function MediaPanel(props: Props): React.JSX.Element {
  const [tab, setTab] = useState<'videos' | 'images' | 'tasks'>('videos');
  const [limit, setLimit] = useState(30);
  const [taskFilter, setTaskFilter] = useState<'all' | 'active' | 'failed'>('active');
  const [actionBusy, setActionBusy] = useState(false);

  const videoCount = useMemo(() => props.resources.filter((r) => r.type === 'video').length, [props.resources]);
  const imageCount = useMemo(() => props.resources.filter((r) => r.type === 'image').length, [props.resources]);

  const latest = useMemo(() => {
    const resourceUrls = new Map(props.resources.map((resource) => [resource.id, resource.url]));
    const map = new Map<string, DownloadTask>();
    for (const task of props.tasks) {
      if (task.status === 'completed' && supersededDoubaoPlayback(task.resumeUrl, resourceUrls.get(task.resourceId) ?? '')) continue;
      if (!map.has(task.resourceId)) map.set(task.resourceId, task);
    }
    return map;
  }, [props.tasks, props.resources]);

  const isImages = tab === 'images';
  const currentType = isImages ? 'image' : 'video';
  const currentResources = useMemo(
    () => props.resources.filter((resource) => resource.type === currentType),
    [props.resources, currentType]
  );

  const filtered = currentResources;

  const active = props.tasks.filter((task) => ['queued', 'running', 'paused'].includes(task.status));
  const failed = props.tasks.filter((task) => task.status === 'failed' && !task.automatic);
  const tasks = props.tasks.filter((task) =>
    taskFilter === 'active'
      ? ['queued', 'running', 'paused'].includes(task.status)
      : taskFilter === 'failed'
        ? task.status === 'failed' && !task.automatic
        : !task.automatic || task.status !== 'failed'
  );

  const selectedInTab = useMemo(
    () => filtered.filter((resource) => props.selected.includes(resource.id)),
    [filtered, props.selected]
  );

  const allSelected = Boolean(filtered.length) && filtered.every((resource) => props.selected.includes(resource.id));

  const run = async (action: () => Promise<unknown>, message?: string): Promise<void> => {
    setActionBusy(true);
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'ok' in result && !result.ok && 'error' in result) {
        throw new Error((result.error as { message: string }).message);
      }
      if (message) props.onStatus(message);
    } catch (error) {
      props.onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <aside className="sidebar media-panel material-panel">
      <div className="material-panel-heading">
        <div className="material-panel-title">
          <h2>素材与下载</h2>
        </div>
        <div>
          <button title="打开视频目录" aria-label="视频目录" onClick={props.onOpenFolder}>
            ▱
          </button>
          <button title="查看已下载素材" onClick={props.onLibrary}>
            素材库
          </button>
          {props.onCollapse && (
            <button
              className="material-collapse-btn"
              title="收起素材栏"
              aria-label="收起素材栏"
              onClick={props.onCollapse}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="material-tabs">
        <button
          className={tab === 'videos' ? 'active' : ''}
          onClick={() => {
            setTab('videos');
            setLimit(30);
          }}
          aria-label="查看视频素材"
        >
          视频 <span>{videoCount}</span>
        </button>
        <button
          className={tab === 'images' ? 'active' : ''}
          onClick={() => {
            setTab('images');
            setLimit(30);
          }}
          aria-label="查看图片素材"
          data-parse-images={props.parseImages ? 'true' : 'false'}
          title={props.parseImages ? '查看图片素材' : '查看图片素材（可在设置中开启图片解析）'}
        >
          图片 <span>{imageCount}</span>
        </button>
        <button
          className={tab === 'tasks' ? 'active' : ''}
          onClick={() => setTab('tasks')}
          aria-label="查看下载任务"
        >
          下载任务 <span>{active.length || props.tasks.length}</span>
          {failed.length > 0 && <i />}
        </button>
      </div>

      {tab !== 'tasks' ? (
        <>
          <div className="material-batch">
            <label>
              <input
                type="checkbox"
                checked={allSelected}
                disabled={!filtered.length}
                onChange={() =>
                  props.onSelect(
                    allSelected
                      ? props.selected.filter((id) => !filtered.some((resource) => resource.id === id))
                      : [...new Set([...props.selected, ...filtered.map((resource) => resource.id)])]
                  )
                }
              />
              {selectedInTab.length ? `已选 ${selectedInTab.length}` : '全选'}
            </label>
            <button
              disabled={!filtered.length}
              onClick={() =>
                props.onDownloadMany(
                  selectedInTab.length ? selectedInTab : filtered
                )
              }
            >
              {selectedInTab.length
                ? '下载所选'
                : isImages
                  ? '下载全部图片'
                  : '下载全部视频'}
            </button>
            <button disabled={!currentResources.length} onClick={props.onClear}>
              清空
            </button>
          </div>
          <div className="material-feed">
            {filtered.slice(0, limit).map((resource) => (
              <MaterialCard
                key={resource.id}
                resource={resource}
                task={latest.get(resource.id)}
                selected={props.selected.includes(resource.id)}
                account={props.accountName(resource.accountId)}
                onSelect={() =>
                  props.onSelect(
                    props.selected.includes(resource.id)
                      ? props.selected.filter((id) => id !== resource.id)
                      : [...props.selected, resource.id]
                  )
                }
                onPreview={() => props.onPreview(resource)}
                onDownload={() => props.onDownload(resource)}
                onCandidates={() => props.onCandidates(resource)}
                onRefresh={() => props.onRefresh(resource)}
                onResume={() => {
                  const task = latest.get(resource.id);
                  if (task) void run(() => window.workbench.media.resumeTask(task.id));
                }}
                onReveal={() => {
                  const path = latest.get(resource.id)?.path;
                  if (path) void run(() => window.workbench.files.reveal(path));
                }}
              />
            ))}
            {!filtered.length && (
              <div className="material-empty">
                <span>{isImages ? '▧' : '▶'}</span>
                <strong>
                  {isImages ? (props.parseImages ? '暂无图片作品' : '图片解析暂未开启') : '等待你的下一份作品'}
                </strong>
                <p>
                  {isImages
                    ? (props.parseImages
                        ? '生成的图片作品会自动出现在这里。'
                        : '当前默认只捕获视频素材。可在【设置 -> 常规】中开启“解析图片素材”，即可自动捕获图片作品。')
                    : '视频生成后会自动出现在这里。'}
                </p>
              </div>
            )}
            {filtered.length > limit && (
              <button className="material-load-more" onClick={() => setLimit(limit + 30)}>
                再显示 30 个{isImages ? '图片' : '视频'}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="material-task-filters">
            {(['active', 'failed', 'all'] as const).map((value) => (
              <button
                key={value}
                className={taskFilter === value ? 'active' : ''}
                onClick={() => setTaskFilter(value)}
              >
                {value === 'active' ? '进行中' : value === 'failed' ? '失败' : '全部'}
              </button>
            ))}
            {failed.length > 0 && (
              <button
                disabled={actionBusy}
                onClick={() =>
                  void run(async () => {
                    const results = await Promise.all(failed.map((task) => window.workbench.media.retry(task.id)));
                    const succeeded = results.filter((result) => result.ok).length;
                    const errors = results.filter((result) => !result.ok).map((result) => result.error.message);
                    props.onStatus(`已重试 ${succeeded} 个任务${errors.length ? `；${errors.length} 个需要重新捕获素材` : ''}`);
                  })
                }
              >
                批量重试
              </button>
            )}
          </div>
          <div className="material-task-list">
            {tasks.slice(0, 100).map((task) => (
              <article className="material-task" key={task.id}>
                <div className="material-task-title">
                  <strong title={task.title}>{task.title || '视频作品'}</strong>
                  <span className={task.status}>{taskState(task)}</span>
                </div>
                <small>{props.accountName(task.accountId)}</small>
                {['running', 'paused', 'queued'].includes(task.status) && <TaskProgress task={task} />}
                {task.remainingSeconds && task.status === 'running' ? (
                  <small>预计剩余 {task.remainingSeconds >= 60 ? `${Math.ceil(task.remainingSeconds / 60)} 分钟` : `${task.remainingSeconds} 秒`}</small>
                ) : null}
                {task.error && <p className="material-error">{task.error}</p>}
                {task.path && <p className="material-task-path" title={task.path}>{task.path}</p>}
                <div className="material-task-actions">
                  {['queued', 'running'].includes(task.status) && (
                    <button disabled={actionBusy} onClick={() => void run(() => window.workbench.media.pause(task.id))}>
                      暂停
                    </button>
                  )}
                  {task.status === 'paused' && (
                    <button disabled={actionBusy} onClick={() => void run(() => window.workbench.media.resumeTask(task.id))}>
                      继续
                    </button>
                  )}
                  {['failed', 'cancelled'].includes(task.status) && (
                    <button disabled={actionBusy} onClick={() => void run(() => window.workbench.media.retry(task.id))}>
                      重试
                    </button>
                  )}
                  {['queued', 'running', 'paused'].includes(task.status) && (
                    <button disabled={actionBusy} onClick={() => void run(() => window.workbench.media.cancel(task.id))}>
                      取消
                    </button>
                  )}
                  {task.status === 'completed' && task.path && (
                    <>
                      <button onClick={() => void run(() => window.workbench.files.open(task.path!))}>播放文件</button>
                      <button onClick={() => void run(() => window.workbench.files.reveal(task.path!))}>定位文件</button>
                    </>
                  )}
                </div>
              </article>
            ))}
            {!tasks.length && (
              <div className="material-empty">
                <span>✓</span>
                <strong>{taskFilter === 'failed' ? '没有失败任务' : '这里暂时没有任务'}</strong>
                <p>下载进度和保存位置会显示在这里。</p>
              </div>
            )}
            {tasks.length > 100 && <p className="form-hint">显示最近 100 项任务，已下载文件可在素材库中查看。</p>}
          </div>
          {failed.length > 0 && (
            <div className="material-task-footer">
              <button disabled={actionBusy} onClick={() => void run(() => window.workbench.media.clearFailed(), '已清除失败记录，素材和已下载文件保留')}>
                清除失败记录
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
