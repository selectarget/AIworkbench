import React from 'react';

export interface AppHeaderProps {
  status: string;
}

export function AppHeader({ status }: AppHeaderProps): React.JSX.Element {
  return (
    <header className="topbar" aria-label="AI 创作工作台">
      <div className="brand">
        <div className="brand-mark">AI</div>
        <div className="brand-text">
          <strong>AI创作工作台</strong>
          <span className="brand-sub">多账号创作与素材中心</span>
        </div>
      </div>
      <div className="statusbar" aria-live="polite">
        <span className="status-dot" />
        <span className="statusbar-message">{status}</span>
      </div>
    </header>
  );
}
