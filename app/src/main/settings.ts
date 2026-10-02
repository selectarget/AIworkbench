import { settingsSchema, type AppSettings } from '../shared/contracts';
import { AtomicStore } from './atomic-store';

export class SettingsService {
  private readonly store: AtomicStore<AppSettings>;
  private readonly listeners = new Set<(settings: AppSettings, previous: AppSettings) => void>();
  constructor(file: string, private readonly downloadDir: string) {
    this.store = new AtomicStore(file, settingsSchema, settingsSchema.parse({ downloadDir, videoDownloadDir: '' }));
    const current = this.store.read();
    if (!current.downloadDir.trim() || !current.lightThemeMigrated || current.theme !== 'light') this.store.write({
      ...current, downloadDir: current.downloadDir.trim() ? current.downloadDir : downloadDir,
      theme: 'light', lightThemeMigrated: true
    });
  }
  get(): AppSettings { return this.store.read(); }
  onChange(listener: (settings: AppSettings, previous: AppSettings) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  update(patch: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const value = settingsSchema.parse({ ...current, ...patch, theme: 'light', bossKey: { ...current.bossKey, ...(patch.bossKey ?? {}) } });
    value.downloadDir = value.downloadDir.trim() || this.downloadDir;
    this.store.write(value);
    for (const listener of this.listeners) listener(value, current);
    return value;
  }
}
