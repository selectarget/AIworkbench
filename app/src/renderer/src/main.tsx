import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './tailwind.css';
import './workbench.css';
import './media-panel.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
document.documentElement.dataset.platform = navigator.platform.startsWith('Win') ? 'windows' : 'other';
document.documentElement.dataset.theme = 'light';

if (!window.workbench) {
  root.render(
    <main className="startup-error" role="alert">
      <section>
        <h1>工作台界面加载失败</h1>
        <p>安全通信模块没有成功加载。请重新启动应用；如果问题持续，请查看 data/logs/workbench.log。</p>
        <code>PRELOAD_API_UNAVAILABLE</code>
      </section>
    </main>
  );
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
