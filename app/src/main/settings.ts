import { settingsSchema, type AppSettings } from '../shared/contracts';
import { AtomicStore } from './atomic-store';

export class SettingsService {
  private readonly store: AtomicStore<AppSettings>;
  private readonly listeners = new Set<(settings: AppSettings, previous: AppSettings) => void>();
  constructor(file: string, downloadDir: string) {
    this.store = new AtomicStore(file, settingsSchema, settingsSchema.parse({ downloadDir, videoDownloadDir: '' }));
    const current = this.store.read();
    if (!current.downloadDir.trim()) this.store.write({ ...current, downloadDir });
  }
  get(): AppSettings { return this.store.read(); }
  onChange(listener: (settings: AppSettings, previous: AppSettings) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  update(patch: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const value = settingsSchema.parse({ ...current, ...patch, bossKey: { ...current.bossKey, ...(patch.bossKey ?? {}) } });
    this.store.write(value);
    for (const listener of this.listeners) listener(value, current);
    return value;
  }
}
