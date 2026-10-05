import React from 'react';
import type {
  AccountInput,
  PlatformDefinition,
  PlatformId,
  ProxyConfig,
  ProxyRuntimeState,
  SessionDataKind
} from '@shared/contracts';
import { Modal } from '../../ui/Modal';
import { BrowserEditor } from './BrowserEditor';
import { FingerprintEditor } from './FingerprintEditor';
import { ProxyEditor } from './ProxyEditor';

const MAX_STANDARD_ACCOUNT_CREATION = 100;

export interface AccountModalProps {
  editingId: string | null;
  form: AccountInput;
  platforms: PlatformDefinition[];
  busy: boolean;
  runtimeState: ProxyRuntimeState | null;
  newAccountCount: number;
  startAfterCreate: boolean;
  onFormChange: React.Dispatch<React.SetStateAction<AccountInput>>;
  onNewAccountCountChange: (count: number) => void;
  onStartAfterCreateChange: (start: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  onImportSubscription: () => void;
  onRefreshSubscription: () => void;
  onSelectNode: (tag: string) => void;
  onTestNode: (tag?: string) => void;
  onTestAllNodes: () => void;
  onTestProxy: () => void;
  onClearSession: (kind: SessionDataKind) => void;
  onRegenerateFingerprint: () => void;
  onResetFingerprint: () => void;
}

export function AccountModal({
  editingId,
  form,
  platforms,
  busy,
  runtimeState,
  newAccountCount,
  startAfterCreate,
  onFormChange,
  onNewAccountCountChange,
  onStartAfterCreateChange,
  onSave,
  onClose,
  onImportSubscription,
  onRefreshSubscription,
  onSelectNode,
  onTestNode,
  onTestAllNodes,
  onTestProxy,
  onClearSession,
  onRegenerateFingerprint,
  onResetFingerprint
}: AccountModalProps): React.JSX.Element {
  return (
    <Modal
      title={editingId ? '编辑账号' : '添加账号'}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={onSave}
          >
            保存账号
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          平台
          <select
            value={form.platform}
            onChange={(event) =>
              onFormChange((current: AccountInput) => ({
                ...current,
                platform: event.target.value as PlatformId
              }))
            }
          >
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          账号名称
          <input
            value={form.name}
            onChange={(event) =>
              onFormChange((current: AccountInput) => ({ ...current, name: event.target.value }))
            }
            placeholder="留空自动生成名称"
          />
        </label>
        <label>
          分组
          <input
            value={form.group}
            onChange={(event) =>
              onFormChange((current: AccountInput) => ({ ...current, group: event.target.value }))
            }
          />
        </label>
        <label>
          备注
          <input
            value={form.remark}
            onChange={(event) =>
              onFormChange((current: AccountInput) => ({ ...current, remark: event.target.value }))
            }
          />
        </label>
        {!editingId && (
          <>
            <label>
              添加数量
              <input
                type="number"
                min="1"
                max={MAX_STANDARD_ACCOUNT_CREATION}
                step="1"
                value={newAccountCount}
                onChange={(event) =>
                  onNewAccountCountChange(Number(event.target.value) || 1)
                }
              />
              <small className="form-hint">
                一次最多添加 {MAX_STANDARD_ACCOUNT_CREATION} 个，名称会自动编号。
              </small>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={startAfterCreate}
                onChange={(event) => onStartAfterCreateChange(event.target.checked)}
              />
              添加后启动
              <small className="form-hint">批量添加时打开成功的账号</small>
            </label>
          </>
        )}
        {form.platform === 'custom' && (
          <label className="wide">
            网站地址
            <input
              value={form.customUrl}
              onChange={(event) =>
                onFormChange((current: AccountInput) => ({
                  ...current,
                  customUrl: event.target.value
                }))
              }
              placeholder="https://example.com"
            />
          </label>
        )}
      </div>

      <ProxyEditor
        value={form.proxy}
        onChange={(proxy: ProxyConfig) =>
          onFormChange((current: AccountInput) => ({ ...current, proxy }))
        }
        editingId={editingId}
        runtimeState={runtimeState}
        busy={busy}
        onImport={onImportSubscription}
        onRefresh={onRefreshSubscription}
        onSelect={onSelectNode}
        onTest={onTestNode}
        onTestAll={onTestAllNodes}
        onTestProxy={onTestProxy}
        onClearSession={onClearSession}
      />
      <BrowserEditor
        value={form.browser}
        onChange={(browser) =>
          onFormChange((current: AccountInput) => ({ ...current, browser }))
        }
      />
      <FingerprintEditor
        value={form.fingerprint}
        onChange={(fingerprint) =>
          onFormChange((current: AccountInput) => ({ ...current, fingerprint }))
        }
        canPersist={Boolean(editingId)}
        onRegenerate={onRegenerateFingerprint}
        onReset={onResetFingerprint}
      />
    </Modal>
  );
}
