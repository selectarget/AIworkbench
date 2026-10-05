import React from 'react';
import { Icon } from '../icons/Icon';

export interface EmptyStateProps {
  onAdd: () => void;
}

export function EmptyState({ onAdd }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty-browser">
      <div className="orb">
        <Icon name="sparkle" size={30} />
      </div>
      <span className="eyebrow">CREATIVE WORKSPACE</span>
      <h1>一个窗口，管理所有 AI 创作账号</h1>
      <p>独立登录环境、素材自动捕获、原文件下载与多平台工作流。</p>
      <button type="button" className="primary" onClick={onAdd}>
        <Icon name="plus" size={15} />
        <span>添加第一个账号</span>
      </button>
    </div>
  );
}
