import React from 'react';
import { isWindowsPlatform } from '../../../utils/dom';

export function HelpPanel(): React.JSX.Element {
  const modifier = isWindowsPlatform() ? 'Ctrl' : '⌘';
  return (
    <div className="help-panel">
      <section className="help-hero">
        <div className="help-hero-mark" aria-hidden="true">
          ✦
        </div>
        <div>
          <span className="eyebrow">QUICK START</span>
          <h3>从账号到成片，只需三步</h3>
          <p>把登录环境、网页操作和素材下载放在一个可恢复的工作台里。</p>
        </div>
      </section>
      <div className="help-grid">
        <article className="help-card">
          <span className="help-step">01</span>
          <div>
            <strong>创建账号</strong>
            <p>点击左侧“＋”，选择平台并保存。每个账号都会使用独立 Session。</p>
          </div>
        </article>
        <article className="help-card">
          <span className="help-step">02</span>
          <div>
            <strong>打开并创作</strong>
            <p>双击账号可编辑配置，点击账号名称打开页面；工具栏负责导航、缩放和双窗口。</p>
          </div>
        </article>
        <article className="help-card">
          <span className="help-step">03</span>
          <div>
            <strong>预览并下载</strong>
            <p>网页捕获的图片和视频会进入右侧素材流，失败任务可以重试，候选地址可单独查看。</p>
          </div>
        </article>
      </div>
      <section className="help-section">
        <div className="section-heading">
          <strong>常用快捷键</strong>
          <small>{isWindowsPlatform() ? 'Windows' : 'macOS'}</small>
        </div>
        <div className="help-shortcuts">
          <div className="help-shortcut">
            <span>聚焦账号搜索</span>
            <span>
              <kbd>{modifier}</kbd>
              <b>+</b>
              <kbd>K</kbd>
            </span>
          </div>
          <div className="help-shortcut">
            <span>关闭最上层菜单或弹窗</span>
            <kbd>Esc</kbd>
          </div>
          <div className="help-shortcut">
            <span>地址栏导航</span>
            <span>
              <kbd>Enter</kbd>
              <small>在地址栏中</small>
            </span>
          </div>
          <div className="help-shortcut">
            <span>打开账号</span>
            <span>
              <kbd>单击</kbd>
              <small>切换</small>
              <kbd>双击</kbd>
              <small>编辑</small>
            </span>
          </div>
        </div>
      </section>
      <section className="help-section">
        <div className="section-heading">
          <strong>工作台提示</strong>
          <small>保持操作可恢复</small>
        </div>
        <div className="help-points">
          <div>
            <span className="help-badge good">隔离</span>
            <p>账号的 Cookie、LocalStorage、IndexedDB、缓存和扩展环境互不共享。</p>
          </div>
          <div>
            <span className="help-badge info">代理</span>
            <p>订阅代理异常时不会自动降级到直连，需在账号配置中明确切换。</p>
          </div>
          <div>
            <span className="help-badge neutral">边界</span>
            <p>素材下载使用平台公开的原始资源链路，不绕过 DRM、权限或第三方验证。</p>
          </div>
        </div>
      </section>
    </div>
  );
}
