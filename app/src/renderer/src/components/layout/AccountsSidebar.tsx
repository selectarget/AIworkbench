import React from 'react';
import type { Account, PlatformDefinition, PlatformId } from '@shared/contracts';
import { isWindowsPlatform } from '../../utils/dom';
import { AccountCard } from '../features/accounts/AccountCard';
import { Icon } from '../icons/Icon';

export interface GroupedAccounts {
  name: string;
  accounts: Account[];
}

export interface AccountsSidebarProps {
  accounts: Account[];
  filteredAccounts: Account[];
  groupedAccounts: GroupedAccounts[];
  groups: string[];
  platforms: PlatformDefinition[];
  openTabs: string[];
  activeId: string | null;
  selectedAccounts: string[];
  search: string;
  groupFilter: string;
  platformFilter: PlatformId | '';
  collapsedGroups: string[];
  accountToolsCollapsed: boolean;
  videoNoticeByAccount: Record<string, number>;
  busy: boolean;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (value: string) => void;
  onGroupFilterChange: (value: string) => void;
  onPlatformFilterChange: (value: PlatformId | '') => void;
  onToggleAccountTools: () => void;
  onToggleGroupCollapse: (groupName: string) => void;
  onOpenSettings: () => void;
  onNewAccount: () => void;
  onManageGroup: (action: 'rename' | 'remove') => void;
  onDeleteGroupAccounts: () => void;
  onDeletePlatformAccounts: () => void;
  onImportAccounts: () => void;
  onExportAccounts: () => void;
  onOpenFilteredAccounts: () => void;
  onRefreshOpenTabs: () => void;
  onCloseAllOpenTabs: () => void;
  onDeleteAllAccounts: () => void;
  onOpenDownloadDir: () => void;
  onToggleSelectAll: () => void;
  onBatchAccounts: (action: 'open' | 'refresh' | 'close') => void;
  onBatchAssignGroup: () => void;
  onBatchProxy: () => void;
  onDeleteSelectedAccounts: () => void;
  onSelectAccount: (accountId: string, checked: boolean) => void;
  onOpenAccount: (accountId: string) => void;
  onEditAccount: (account: Account) => void;
  onDeleteAccount: (account: Account) => void;
  onExternalOpenAccount: (account: Account) => void;
  onReorderAccount: (draggedId: string, targetId: string, side: 'before' | 'after') => void;
  onClearFilters: () => void;
}

export function AccountsSidebar({
  accounts,
  filteredAccounts,
  groupedAccounts,
  groups,
  platforms,
  openTabs,
  activeId,
  selectedAccounts,
  search,
  groupFilter,
  platformFilter,
  collapsedGroups,
  accountToolsCollapsed,
  videoNoticeByAccount,
  busy,
  searchRef,
  onSearchChange,
  onGroupFilterChange,
  onPlatformFilterChange,
  onToggleAccountTools,
  onToggleGroupCollapse,
  onOpenSettings,
  onNewAccount,
  onManageGroup,
  onDeleteGroupAccounts,
  onDeletePlatformAccounts,
  onImportAccounts,
  onExportAccounts,
  onOpenFilteredAccounts,
  onRefreshOpenTabs,
  onCloseAllOpenTabs,
  onDeleteAllAccounts,
  onOpenDownloadDir,
  onToggleSelectAll,
  onBatchAccounts,
  onBatchAssignGroup,
  onBatchProxy,
  onDeleteSelectedAccounts,
  onSelectAccount,
  onOpenAccount,
  onEditAccount,
  onDeleteAccount,
  onExternalOpenAccount,
  onReorderAccount,
  onClearFilters
}: AccountsSidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar accounts-panel">
      <div className="panel-title">
        <div className="panel-title-text">
          <h2>账号空间</h2>
          <span className="account-count-badge" title={`${openTabs.length} 个已打开`}>
            {filteredAccounts.length}
          </span>
        </div>
        <div className="panel-title-actions">
          <button
            type="button"
            className="icon-button secondary"
            aria-label="设置"
            title="工作台设置"
            onClick={onOpenSettings}
          >
            <Icon name="settings" size={14} />
            <span className="visually-hidden">设置</span>
          </button>
          <button
            type="button"
            className="icon-button primary"
            aria-label="添加账号"
            title="添加账号"
            onClick={onNewAccount}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>
      <div className="search-box">
        <input
          ref={searchRef}
          className="search"
          aria-label="搜索账号、分组或备注"
          placeholder="搜索账号、分组或备注"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <kbd>{isWindowsPlatform() ? 'Ctrl' : '⌘'} K</kbd>
      </div>
      <button
        type="button"
        className="account-tools-toggle"
        onClick={onToggleAccountTools}
        aria-expanded={!accountToolsCollapsed}
        aria-controls="account-tools-panel"
      >
        <span>
          <Icon name="settings" size={14} />
          筛选与批量管理
        </span>
        <Icon name={accountToolsCollapsed ? 'chevron-right' : 'chevron-down'} size={14} />
      </button>
      {!accountToolsCollapsed && (
        <div id="account-tools-panel" className="account-tools-panel">
          <div className="group-toolbar">
            <select
              value={groupFilter}
              onChange={(event) => onGroupFilterChange(event.target.value)}
            >
              <option value="">全部分组</option>
              {groups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
            <select
              value={platformFilter}
              onChange={(event) =>
                onPlatformFilterChange(event.target.value as PlatformId | '')
              }
            >
              <option value="">全部平台</option>
              {platforms.map((platform) => (
                <option value={platform.id} key={platform.id}>
                  {platform.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!groupFilter}
              onClick={() => onManageGroup('rename')}
            >
              重命名
            </button>
            <button
              type="button"
              disabled={!groupFilter}
              onClick={() => onManageGroup('remove')}
            >
              移除
            </button>
            <button
              type="button"
              className="danger"
              disabled={!groupFilter}
              onClick={onDeleteGroupAccounts}
            >
              删分组账号
            </button>
            <button
              type="button"
              className="danger"
              disabled={!platformFilter}
              onClick={onDeletePlatformAccounts}
            >
              删平台账号
            </button>
          </div>
          <div className="account-actions">
            <button type="button" onClick={onImportAccounts}>
              导入
            </button>
            <button type="button" onClick={onExportAccounts}>
              导出
            </button>
          </div>
          <div className="account-actions account-quick-actions">
            <button type="button" disabled={busy} onClick={onOpenFilteredAccounts}>
              打开筛选
            </button>
            <button type="button" disabled={busy} onClick={onRefreshOpenTabs}>
              刷新已开
            </button>
            <button type="button" disabled={busy} onClick={onCloseAllOpenTabs}>
              关闭全部
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy || !accounts.length}
              onClick={onDeleteAllAccounts}
            >
              删除全部
            </button>
            <button type="button" onClick={onOpenDownloadDir}>
              下载目录
            </button>
          </div>
          <div className="batch-toolbar">
            <button type="button" onClick={onToggleSelectAll}>
              {selectedAccounts.length ? '取消选择' : '全选'}
            </button>
            <button type="button" onClick={() => onBatchAccounts('open')}>
              打开
            </button>
            <button type="button" onClick={() => onBatchAccounts('refresh')}>
              刷新
            </button>
            <button type="button" onClick={() => onBatchAccounts('close')}>
              关闭
            </button>
            <button type="button" onClick={onBatchAssignGroup}>
              分组
            </button>
            <button type="button" onClick={onBatchProxy}>
              代理
            </button>
            <button type="button" onClick={onDeleteSelectedAccounts}>
              删除
            </button>
          </div>
        </div>
      )}
      <div className="account-list">
        {groupedAccounts.length ? (
          groupedAccounts.map((group) => (
            <section className="account-group" key={group.name}>
              <button
                type="button"
                className="account-group-header"
                aria-expanded={!collapsedGroups.includes(group.name)}
                onClick={() => onToggleGroupCollapse(group.name)}
              >
                <span>
                  <Icon
                    name={
                      collapsedGroups.includes(group.name)
                        ? 'chevron-right'
                        : 'chevron-down'
                    }
                    size={13}
                  />
                  {group.name}
                </span>
                <small>{group.accounts.length}</small>
              </button>
              {!collapsedGroups.includes(group.name) &&
                group.accounts.map((account) => {
                  const noticeCount = videoNoticeByAccount[account.id] ?? 0;
                  return (
                    <AccountCard
                      key={account.id}
                      account={account}
                      isActive={activeId === account.id}
                      isOpen={openTabs.includes(account.id)}
                      isSelected={selectedAccounts.includes(account.id)}
                      noticeCount={noticeCount}
                      platforms={platforms}
                      onSelect={(checked) => onSelectAccount(account.id, checked)}
                      onOpen={() => onOpenAccount(account.id)}
                      onEdit={() => onEditAccount(account)}
                      onDelete={() => onDeleteAccount(account)}
                      onExternalOpen={() => onExternalOpenAccount(account)}
                      onReorder={onReorderAccount}
                    />
                  );
                })}
            </section>
          ))
        ) : (
          <div className="account-empty">
            <span aria-hidden="true">⌕</span>
            <strong>{accounts.length ? '没有匹配账号' : '还没有账号'}</strong>
            <p>
              {accounts.length
                ? '试试清除搜索条件或切换分组、平台筛选。'
                : '添加第一个账号后，就可以在独立 Session 中开始创作。'}
            </p>
            {accounts.length ? (
              <button type="button" onClick={onClearFilters}>
                清除筛选
              </button>
            ) : (
              <button type="button" className="primary" onClick={onNewAccount}>
                添加账号
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
