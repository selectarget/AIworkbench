import React from 'react';
import type { Account, PlatformDefinition } from '@shared/contracts';
import { Icon } from '../../icons/Icon';

export interface AccountCardProps {
  account: Account;
  isActive: boolean;
  isOpen: boolean;
  isSelected: boolean;
  noticeCount: number;
  platforms: PlatformDefinition[];
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExternalOpen: () => void;
  onReorder: (draggedId: string, targetId: string, side: 'before' | 'after') => void;
}

export function AccountCard({
  account,
  isActive,
  isOpen,
  isSelected,
  noticeCount,
  platforms,
  onSelect,
  onOpen,
  onEdit,
  onDelete,
  onExternalOpen,
  onReorder
}: AccountCardProps): React.JSX.Element {
  const platformName = platforms.find((p) => p.id === account.platform)?.name ?? '';

  return (
    <div
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/account-id', account.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const side = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
        onReorder(event.dataTransfer.getData('text/account-id'), account.id, side);
      }}
      className={`account-card ${isActive ? 'selected' : ''} ${isOpen ? 'open' : ''} ${
        noticeCount ? 'has-video-notice' : ''
      }`}
      onDoubleClick={onEdit}
    >
      <input
        className="account-check"
        type="checkbox"
        checked={isSelected}
        onChange={(event) => onSelect(event.target.checked)}
      />
      <button
        type="button"
        className="account-main"
        aria-label={`打开账号 ${account.name}`}
        title={isOpen ? `切换到 ${account.name}` : `打开 ${account.name}`}
        onClick={onOpen}
      >
        <span className={`platform-dot ${account.platform}`}>
          {platformName.slice(0, 1)}
        </span>
        <span>
          <strong>{account.name}</strong>
          <small>
            {account.group || platformName}
            {isOpen ? ' · 已打开' : ''}
            {account.proxy.enabled ? ' · 代理' : ''}
            {noticeCount > 0 && (
              <em className="account-video-notice" title="有新视频">
                {noticeCount > 9 ? '9+' : noticeCount} 新视频
              </em>
            )}
          </small>
        </span>
      </button>
      <div className="card-menu">
        <button
          type="button"
          aria-label={`在系统浏览器打开 ${account.name}`}
          title="在系统 Chrome/Edge 打开并带入当前登录态"
          onClick={(event) => {
            event.stopPropagation();
            onExternalOpen();
          }}
        >
          <Icon name="external" size={14} />
        </button>
        <button
          type="button"
          aria-label={`编辑账号 ${account.name}`}
          title="编辑账号"
          onClick={onEdit}
        >
          <Icon name="settings" size={14} />
        </button>
        <button
          type="button"
          aria-label={`删除账号 ${account.name}`}
          title="删除账号"
          onClick={onDelete}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}
