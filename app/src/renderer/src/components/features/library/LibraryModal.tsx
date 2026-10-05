import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Account,
  DownloadFile,
  LibraryPage,
  PlatformDefinition,
  PlatformId
} from '@shared/contracts';
import { formatBytes, unwrap } from '../../../utils/formatters';

export interface LibraryModalProps {
  accounts: Account[];
  platforms: PlatformDefinition[];
  onStatus: (value: string) => void;
}

export function LibraryModal({ accounts, platforms, onStatus }: LibraryModalProps): React.JSX.Element {
  const empty: LibraryPage = { items: [], total: 0, page: 1, pageSize: 30, pages: 1 };
  const [page, setPage] = useState(empty);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | 'image' | 'video' | 'other'>('all');
  const [account, setAccount] = useState('');
  const [platform, setPlatform] = useState<PlatformId | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const refreshTimer = useRef<number | null>(null);
  const completedTaskIds = useRef(new Set<string>());

  const loadPage = useCallback(
    (number: number) =>
      window.workbench.files
        .list({
          page: number,
          pageSize: 30,
          search,
          type,
          account,
          platform: platform || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined
        })
        .then(unwrap)
        .then(setPage)
        .catch((e) => onStatus(e instanceof Error ? e.message : String(e))),
    [onStatus, search, type, account, platform, dateFrom, dateTo]
  );

  const load = useCallback((number = page.page) => loadPage(number), [loadPage, page.page]);

  const scheduleRefresh = useCallback((): void => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void loadPage(1);
    }, 700);
  }, [loadPage]);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  useEffect(() => {
    const offNative = window.workbench.files.onDownloaded(() => scheduleRefresh());
    const offTasks = window.workbench.media.onTasks((next) => {
      let completed = false;
      for (const task of next) {
        if (task.status !== 'completed' || completedTaskIds.current.has(task.id)) continue;
        completedTaskIds.current.add(task.id);
        completed = true;
      }
      if (completed) scheduleRefresh();
    });
    return () => {
      offNative();
      offTasks();
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [scheduleRefresh]);

  const filtered =
    Boolean(search) ||
    type !== 'all' ||
    Boolean(account) ||
    Boolean(platform) ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  return (
    <div className="library">
      <div className="library-toolbar filters">
        <input
          placeholder="搜索文件"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="other">其他</option>
        </select>
        <select
          value={platform}
          onChange={(event) => setPlatform(event.target.value as PlatformId | '')}
        >
          <option value="">全部平台</option>
          {platforms.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select value={account} onChange={(event) => setAccount(event.target.value)}>
          <option value="">全部账号</option>
          {accounts.map((item) => (
            <option value={item.name} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="开始日期"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <input
          type="date"
          aria-label="结束日期"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />
        <button type="button" onClick={() => load()}>
          刷新
        </button>
        <button type="button" onClick={() => window.workbench.files.openDownloadDir()}>
          打开目录
        </button>
        <span>{page.total} 个文件</span>
      </div>
      {page.items.length === 0 ? (
        <div className="empty-list">
          <span>◇</span>
          <strong>{filtered ? '没有匹配的文件' : '还没有下载文件'}</strong>
          <p>
            {filtered
              ? '试试放宽筛选条件，或清空搜索关键词后重试。'
              : '完成一次下载后，文件会自动出现在这里。也可以直接打开下载目录查看。'}
          </p>
        </div>
      ) : (
        page.items.map((file: DownloadFile) => (
          <div
            className="file-row"
            draggable
            onDragStart={() => void window.workbench.files.drag(file.path)}
            key={file.path}
          >
            <span className={`file-icon ${file.type}`}>
              {file.previewUrl && file.type === 'image' ? (
                <img src={file.previewUrl} alt={file.name} />
              ) : file.previewUrl && file.type === 'video' ? (
                <video src={file.previewUrl} muted preload="metadata" />
              ) : file.type === 'video' ? (
                '▶'
              ) : file.type === 'image' ? (
                '▧'
              ) : (
                '·'
              )}
            </span>
            <span>
              <strong>{file.name}</strong>
              <small>
                {file.relativePath} · {formatBytes(file.size)} ·{' '}
                {new Date(file.modifiedAt).toLocaleString()}
              </small>
            </span>
            <div>
              <button type="button" onClick={() => window.workbench.files.open(file.path)}>
                打开
              </button>
              <button type="button" onClick={() => window.workbench.files.reveal(file.path)}>
                定位
              </button>
              <button
                type="button"
                onClick={() =>
                  window.workbench.files.copyPath(file.path).then(() => onStatus('文件路径已复制'))
                }
              >
                复制路径
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`确定删除“${file.name}”？此操作不可恢复。`))
                    void window.workbench.files
                      .remove(file.path)
                      .then(unwrap)
                      .then(() => load())
                      .catch((e) => onStatus(e instanceof Error ? e.message : String(e)));
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))
      )}
      <div className="pagination">
        <button type="button" disabled={page.page <= 1} onClick={() => load(page.page - 1)}>
          上一页
        </button>
        <span>
          {page.page} / {page.pages}
        </span>
        <button
          type="button"
          disabled={page.page >= page.pages}
          onClick={() => load(page.page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
