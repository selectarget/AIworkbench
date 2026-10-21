import React from 'react';
import type { Account, AppSettings, PlatformDefinition } from '../../../../shared/contracts';
import { Icon } from '../icons/Icon';
import { EmptyState } from './EmptyState';

export interface TabMenuState {
  id: string;
  x: number;
  y: number;
}

export interface BrowserWorkspaceProps {
  accounts: Account[];
  platforms: PlatformDefinition[];
  openTabs: string[];
  /** Tabs whose page was released by idle sleep; selecting one reopens it. */
  sleepingTabs?: string[];
  activeId: string | null;
  secondaryId: string | null;
  settings: AppSettings | null;
  activeAccount: Account | undefined;
  tabOverviewOpen: boolean;
  tabMenu: TabMenuState | null;
  busy: boolean;
  videoNoticeByAccount: Record<string, number>;
  primaryRef: React.RefObject<HTMLDivElement | null>;
  secondaryRef: React.RefObject<HTMLDivElement | null>;
  accountName: (id: string | null) => string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (keepId: string) => void;
  onReorderOpenTabs: (draggedId: string, targetId: string, side: 'before' | 'after') => void;
  onToggleTabOverview: () => void;
  onCloseTabOverview: () => void;
  onSetTabMenu: (menu: TabMenuState | null) => void;
  onSecondaryChange: (id: string | null) => void;
  onClearDoubaoHistory: () => void;
  onNewAccount: () => void;
  onToggleResources?: () => void;
  onOpenLibrary?: () => void;
}

export function BrowserWorkspace({
  accounts,
  platforms,
  openTabs,
  sleepingTabs = [],
  activeId,
  secondaryId,
  settings,
  activeAccount,
  tabOverviewOpen,
  tabMenu,
  busy,
  videoNoticeByAccount,
  primaryRef,
  secondaryRef,
  accountName,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onReorderOpenTabs,
  onToggleTabOverview,
  onCloseTabOverview,
  onSetTabMenu,
  onSecondaryChange,
  onClearDoubaoHistory,
  onNewAccount,
  onToggleResources,
  onOpenLibrary
}: BrowserWorkspaceProps): React.JSX.Element {
  return (
    <section className="browser-panel">
      <div className="tabs">
        <div
          className="tab-scroll"
          role="tablist"
          aria-label="已打开的账号"
          onWheel={(event) => {
            if (event.deltaY) {
              event.currentTarget.scrollLeft += event.deltaY;
            }
          }}
        >
          {openTabs.map((id) => {
            const noticeCount = videoNoticeByAccount[id] ?? 0;
            const sleeping = sleepingTabs.includes(id);
            return (
              <div
                key={id}
                className={`tab ${activeId === id ? 'active' : ''} ${
                  noticeCount ? 'has-video-notice' : ''
                } ${sleeping ? 'sleeping' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/account-id', id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedId = event.dataTransfer.getData('text/account-id');
                  const rect = event.currentTarget.getBoundingClientRect();
                  const side = event.clientX > rect.left + rect.width / 2 ? 'after' : 'before';
                  onReorderOpenTabs(draggedId, id, side);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const width = 216;
                  const height = 92;
                  onSetTabMenu({
                    id,
                    x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
                    y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))
                  });
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onCloseTab(id);
                  }
                }}
                title={`${accountName(id)}${sleeping ? '（已休眠，点击唤醒）' : ''} (中键可直接关闭)`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeId === id}
                  className="tab-select"
                  onClick={() => onSelectTab(id)}
                >
                  <span className="tab-label">
                    <span className="tab-platform">
                      {platforms
                        .find((p) => p.id === accounts.find((a) => a.id === id)?.platform)
                        ?.name.slice(0, 1)}
                    </span>
                    <span className="tab-label-text">{accountName(id)}</span>
                    {noticeCount > 0 && <em className="tab-video-dot" title="有新视频">●</em>}
                  </span>
                </button>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`关闭 ${accountName(id)}`}
                  title={`关闭 ${accountName(id)}`}
                  onClick={() => onCloseTab(id)}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="tab-overview-anchor">
          <button
            type="button"
            className={`tab-count tab-count-btn ${tabOverviewOpen ? 'active' : ''}`}
            title="已打开标签速览列表"
            aria-label={`已打开 ${openTabs.length} 个标签，点击展开列表`}
            aria-expanded={tabOverviewOpen}
            onClick={onToggleTabOverview}
          >
            <span>{openTabs.length} 个标签</span>
            <Icon name={tabOverviewOpen ? 'chevron-up' : 'chevron-down'} size={11} />
          </button>
          {tabOverviewOpen && (
            <div
              className="tab-overview-menu"
              role="menu"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="tab-overview-header">
                <strong>已打开标签 ({openTabs.length})</strong>
                {openTabs.length > 1 && (
                  <button
                    type="button"
                    className="tab-overview-batch-btn"
                    onClick={() => {
                      onCloseTabOverview();
                      if (activeId) onCloseOtherTabs(activeId);
                    }}
                  >
                    关闭其他
                  </button>
                )}
              </div>
              <div className="tab-overview-list">
                {openTabs.map((id) => {
                  const account = accounts.find((a) => a.id === id);
                  const platformName =
                    platforms.find((p) => p.id === account?.platform)?.name.slice(0, 1) ?? '';
                  const isActive = activeId === id;
                  return (
                    <div
                      key={id}
                      role="menuitem"
                      className={`tab-overview-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        onCloseTabOverview();
                        onSelectTab(id);
                      }}
                    >
                      <span className="tab-platform">{platformName}</span>
                      <span className="tab-overview-name" title={accountName(id)}>
                        {accountName(id)}
                      </span>
                      {isActive && <span className="tab-overview-badge">当前</span>}
                      <button
                        type="button"
                        className="tab-overview-close"
                        title={`关闭 ${accountName(id)}`}
                        aria-label={`关闭 ${accountName(id)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onCloseTab(id);
                        }}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {activeAccount?.platform === 'doubao' && (
          <button
            type="button"
            className="doubao-history-button"
            aria-label="一键清理豆包历史会话"
            title={`清理 ${activeAccount.name} 的全部会话及关联作品，删除前确认数量`}
            disabled={busy}
            onClick={onClearDoubaoHistory}
          >
            <Icon name="trash" size={13} />
            <span>一键清理</span>
          </button>
        )}
        {settings?.resourcesCollapsed && onToggleResources && (
          <button
            type="button"
            className="expand-resources-button"
            aria-label="展开素材栏"
            title="展开右侧待下载素材栏 (快捷键 Shift+M)"
            onClick={onToggleResources}
          >
            <Icon name="grid" size={13} />
            <span>展开素材栏</span>
          </button>
        )}
      </div>
      {tabMenu && (
        <div
          className="tab-context-menu"
          role="menu"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSetTabMenu(null);
              onSelectTab(tabMenu.id);
            }}
          >
            <Icon name="chevron-right" size={14} />
            切换到此标签
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onCloseOtherTabs(tabMenu.id)}
          >
            <Icon name="close" size={14} />
            关闭其他标签
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSetTabMenu(null);
              onCloseTab(tabMenu.id);
            }}
          >
            <Icon name="trash" size={14} />
            关闭此标签
          </button>
        </div>
      )}
      <div className={`view-grid ${settings?.dualView ? 'dual' : ''}`}>
        <div ref={primaryRef} className="view-slot">
          {!activeId && <EmptyState onAdd={onNewAccount} />}
        </div>
        {settings?.dualView && (
          <div ref={secondaryRef} className="view-slot secondary">
            <select
              value={secondaryId ?? ''}
              onChange={(event) => {
                const id = event.target.value || null;
                onSecondaryChange(id);
              }}
            >
              <option value="">选择第二账号</option>
              {openTabs
                .filter((id) => id !== activeId)
                .map((id) => (
                  <option key={id} value={id}>
                    {accountName(id)}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
    </section>
  );
}
