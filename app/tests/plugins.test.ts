import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ shell: { openPath: vi.fn().mockResolvedValue('') } }));
import { PluginService } from '../src/main/plugins';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function manifest(name = '测试插件'): string {
  return JSON.stringify({ manifest_version: 3, name, version: '1.2.3', description: '用于测试导入和生命周期' });
}

function crx2(archive: Uint8Array): Buffer {
  const header = Buffer.alloc(16);
  header.write('Cr24', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(0, 12);
  return Buffer.concat([header, Buffer.from(archive)]);
}

function crx3(archive: Uint8Array): Buffer {
  const header = Buffer.alloc(12);
  header.write('Cr24', 0, 'ascii');
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(0, 8);
  return Buffer.concat([header, Buffer.from(archive)]);
}

describe('plugin service', () => {
  it('imports a directory, persists metadata, toggles and removes it safely', () => {
    const root = mkdtempSync(join(tmpdir(), 'workbench-plugin-')); roots.push(root);
    const source = join(root, 'source'); mkdirSync(source); writeFileSync(join(source, 'manifest.json'), manifest()); writeFileSync(join(source, 'content.js'), 'console.log(1);');
    const service = new PluginService(join(root, 'config'));
    const imported = service.importDirectory(source);
    expect(imported.name).toBe('测试插件'); expect(service.list()).toHaveLength(1); expect(readFileSync(join(imported.path, 'content.js'), 'utf8')).toContain('console.log');
    expect(service.setEnabled(imported.id, false)[0]?.enabled).toBe(false); expect(service.enabledPaths()).toEqual([]);
    service.remove(imported.id); expect(service.list()).toEqual([]);
  });

  it('imports ZIP packages with a single top-level directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'workbench-plugin-')); roots.push(root);
    const packagePath = join(root, 'plugin.zip');
    const bytes = zipSync({ 'plugin-root/': new Uint8Array(), 'plugin-root/manifest.json': new TextEncoder().encode(manifest('压缩插件')), 'plugin-root/background.js': new TextEncoder().encode('self.test = true;') });
    writeFileSync(packagePath, Buffer.from(bytes));
    const service = new PluginService(join(root, 'config'));
    const imported = service.importPackage(packagePath);
    expect(imported.source).toBe('zip'); expect(imported.name).toBe('压缩插件'); expect(readFileSync(join(imported.path, 'background.js'), 'utf8')).toContain('self.test');
  });

  it.each([
    ['CRX2', crx2],
    ['CRX3', crx3]
  ] as const)('imports %s packages after removing the CRX header', (_label, wrap) => {
    const root = mkdtempSync(join(tmpdir(), 'workbench-plugin-')); roots.push(root);
    const packagePath = join(root, `${_label.toLowerCase()}.crx`);
    const archive = zipSync({ 'manifest.json': new TextEncoder().encode(manifest(`${_label} 插件`)), 'content.js': new TextEncoder().encode('globalThis.crx = true;') });
    writeFileSync(packagePath, wrap(archive));
    const service = new PluginService(join(root, 'config'));
    const imported = service.importPackage(packagePath);
    expect(imported.source).toBe('crx'); expect(imported.name).toBe(`${_label} 插件`); expect(imported.manifestVersion).toBe(3);
    expect(readFileSync(join(imported.path, 'content.js'), 'utf8')).toContain('globalThis.crx');
  });

  it('rejects archive path traversal before writing outside the plugin root', () => {
    const root = mkdtempSync(join(tmpdir(), 'workbench-plugin-')); roots.push(root);
    const packagePath = join(root, 'unsafe.zip');
    writeFileSync(packagePath, Buffer.from(zipSync({ '../escape.txt': new TextEncoder().encode('no') })));
    const service = new PluginService(join(root, 'config'));
    expect(() => service.importPackage(packagePath)).toThrow(/路径穿越/);
    expect(() => readFileSync(join(root, 'escape.txt'), 'utf8')).toThrow();
  });
});
