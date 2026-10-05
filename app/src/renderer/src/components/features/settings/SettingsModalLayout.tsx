import React, { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../../icons/Icon';

export const settingsSections: ReadonlyArray<{ id: string; label: string; icon: IconName }> = [
  { id: 'general', label: '常规', icon: 'settings' },
  { id: 'downloads', label: '下载', icon: 'download' },
  { id: 'browser', label: '浏览器', icon: 'globe' },
  { id: 'compatibility', label: '兼容性', icon: 'check' },
  { id: 'updates', label: '更新', icon: 'refresh' },
  { id: 'shortcuts', label: '快捷键', icon: 'keyboard' },
  { id: 'platforms', label: '平台', icon: 'grid' },
  { id: 'plugins', label: '插件', icon: 'library' },
  { id: 'backup', label: '备份', icon: 'folder' }
];

export function SettingsModalLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState('general');

  useEffect(() => {
    const root = rootRef.current;
    const list = root?.querySelector<HTMLElement>('.settings-list');
    const scrollContent = root?.querySelector<HTMLElement>('.settings-content');
    const scrollRoot = root?.closest<HTMLElement>('.modal-body');
    if (!list) return;
    const nodes = Array.from(list.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
    const sectionFor = (node: HTMLElement): string => {
      if (node.dataset.settingsSection) return node.dataset.settingsSection;
      const title = node.querySelector('strong')?.textContent?.trim() || '';
      if (title.includes('工作台外观') || title.includes('解析图片') || title.includes('常规')) return 'general';
      if (title.includes('实验性') || title.includes('兼容') || title.includes('旧版')) return 'compatibility';
      if (node.tagName === 'LABEL') return 'downloads';
      if (node.classList.contains('update-box')) return 'updates';
      if (node.classList.contains('boss-key')) return 'shortcuts';
      if (node.classList.contains('adapter-switches')) return 'platforms';
      if (node.classList.contains('plugin-manager')) return 'plugins';
      const heading = node.querySelector('.section-heading strong')?.textContent?.trim() ?? '';
      if (heading.includes('下载目录') || heading.includes('下载设置') || heading.includes('存储目录')) return 'downloads';
      if (
        heading.includes('外部登录浏览器') ||
        heading.includes('浏览器数据目录') ||
        heading.includes('账号运行管理') ||
        heading.includes('浏览器环境')
      )
        return 'browser';
      if (heading.includes('配置备份与恢复') || heading.includes('备份')) return 'backup';
      return 'compatibility';
    };
    nodes.forEach((node) => {
      const section = sectionFor(node);
      node.dataset.settingsSection = section;
      node.style.display = section === activeSection ? '' : 'none';
    });
    scrollContent?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    scrollRoot?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeSection]);

  const scrollToSection = (id: string): void => {
    setActiveSection(id);
  };

  return (
    <div className="settings-modal-layout" ref={rootRef}>
      <nav className="settings-nav" aria-label="设置分组">
        {settingsSections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={activeSection === section.id ? 'active' : ''}
            aria-current={activeSection === section.id ? 'page' : undefined}
            onClick={() => scrollToSection(section.id)}
          >
            <Icon name={section.icon} size={15} />
            <span>{section.label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-content">{children}</div>
    </div>
  );
}
