import React from 'react';
import type { FingerprintProfile } from '@shared/contracts';
import { isWindowsPlatform } from '../../../utils/dom';

export interface FingerprintEditorProps {
  value: FingerprintProfile;
  onChange: (value: FingerprintProfile) => void;
  canPersist: boolean;
  onRegenerate: () => void;
  onReset: () => void;
}

export function FingerprintEditor({
  value,
  onChange,
  canPersist,
  onRegenerate,
  onReset
}: FingerprintEditorProps): React.JSX.Element {
  const patch = (next: Partial<FingerprintProfile>): void => onChange({ ...value, ...next });
  const platform = value.platform.trim().toLowerCase();
  const ua = value.userAgent;
  const uaPlatform = value.userAgentDataPlatform.trim().toLowerCase();
  const looksWindows = /windows nt/i.test(ua) || platform === 'win32' || uaPlatform === 'windows';
  const looksMac = /macintosh|mac os x/i.test(ua) || platform === 'macintel' || uaPlatform === 'macos';
  const identityWarnings = [
    (platform === 'win32' && /macintosh|mac os x/i.test(ua)) ||
    (platform === 'macintel' && /windows nt/i.test(ua))
      ? 'User-Agent 与浏览器平台不一致'
      : '',
    (uaPlatform === 'windows' && (platform === 'macintel' || /macintosh|mac os x/i.test(ua))) ||
    (uaPlatform === 'macos' && (platform === 'win32' || /windows nt/i.test(ua)))
      ? 'UA-CH 平台与 User-Agent 不一致'
      : '',
    !value.userAgent.trim() || !value.platform.trim() || !value.userAgentDataPlatform.trim()
      ? '身份字段尚未完整生成'
      : '',
    value.userAgentDataMobile && value.maxTouchPoints === 0 ? '移动 UA-CH 的最大触控点仍为 0' : ''
  ].filter(Boolean);
  const hardwareWarnings = [
    value.screenWidth < 640 || value.screenHeight < 480
      ? '屏幕尺寸偏小，请确认是否确实为移动设备'
      : '',
    value.deviceScaleFactor > 1 && value.screenWidth < 1280
      ? '高 DPR 与当前屏幕尺寸组合较少见'
      : '',
    value.hardwareConcurrency > 32 || value.deviceMemory > 32
      ? '硬件参数超过常见桌面档位，请确认来源'
      : ''
  ].filter(Boolean);
  const hasGeneratedIdentity = Boolean(
    value.seed || value.platform || value.userAgent || value.userAgentDataPlatform
  );
  const warnings =
    !canPersist && !hasGeneratedIdentity ? [] : [...identityWarnings, ...hardwareWarnings];
  const health =
    !canPersist && !hasGeneratedIdentity
      ? value.enabled
        ? 'ready'
        : 'off'
      : warnings.length
      ? 'check'
      : value.enabled
      ? 'ready'
      : 'off';
  const healthLabel =
    !canPersist && !hasGeneratedIdentity
      ? value.enabled
        ? '默认启用（保存后生成）'
        : '未启用'
      : warnings.length
      ? `${warnings.length} 项待检查`
      : value.enabled
      ? '配置一致'
      : '未启用';
  const appliedLabel = value.lastAppliedAt
    ? new Date(value.lastAppliedAt).toLocaleString()
    : canPersist
    ? '保存账号后应用'
    : '保存账号后生成';
  const browserFamily = looksMac
    ? 'macOS 桌面'
    : looksWindows
    ? 'Windows 桌面'
    : value.enabled
    ? isWindowsPlatform()
      ? 'Windows 桌面'
      : 'macOS 桌面'
    : '待生成';

  return (
    <div className="fingerprint-box">
      <div className="fingerprint-head">
        <div className="section-heading">
          <strong>账号级浏览器指纹</strong>
          <small>
            稳定种子只属于当前账号；只修改浏览器可见特征，不承诺改变操作系统、TLS 或真实 GPU 指纹。
          </small>
        </div>
        <span className={`fingerprint-health ${health}`}>
          <i />
          {healthLabel}
        </span>
      </div>
      <div className="fingerprint-summary" aria-label="指纹配置摘要">
        <div>
          <span>运行状态</span>
          <strong>{value.enabled ? '已启用' : '已关闭'}</strong>
          <small>最近应用：{appliedLabel}</small>
        </div>
        <div>
          <span>身份模板</span>
          <strong>{browserFamily}</strong>
          <small>{value.userAgentDataPlatform || value.platform || '等待生成平台信息'}</small>
        </div>
        <div>
          <span>设备尺寸</span>
          <strong>
            {value.screenWidth} × {value.screenHeight}
          </strong>
          <small>
            DPR {value.deviceScaleFactor} · {value.hardwareConcurrency} 核 · {value.deviceMemory} GB
          </small>
        </div>
      </div>
      <div className="fingerprint-toggle-row">
        <label className="switch-row">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          启用稳定随机指纹
        </label>
        <span>种子：{value.seed ? `${value.seed.slice(0, 12)}…` : '保存时生成'}</span>
      </div>
      {value.lastError && (
        <p className="form-warning">最近一次指纹注入失败：{value.lastError}</p>
      )}
      {warnings.length ? (
        <div className="fingerprint-warnings">
          <strong>一致性检查</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="fingerprint-ok">
          <span>✓</span>身份、平台和设备参数暂未发现明显冲突
        </div>
      )}
      <details className="fingerprint-section" open>
        <summary>
          <span>浏览器身份</span>
          <small>User-Agent、平台、语言和时区</small>
        </summary>
        <div className="form-grid fingerprint-grid">
          <label>
            浏览器平台
            <input
              value={value.platform}
              onChange={(event) => patch({ platform: event.target.value })}
              placeholder="Win32 / MacIntel"
            />
          </label>
          <label>
            浏览器厂商
            <input
              value={value.vendor}
              onChange={(event) => patch({ vendor: event.target.value })}
              placeholder="Google Inc."
            />
          </label>
          <label>
            语言（逗号分隔）
            <input
              value={value.languages.join(', ')}
              onChange={(event) =>
                patch({
                  languages: event.target.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                })
              }
            />
          </label>
          <label className="wide">
            User-Agent
            <input
              value={value.userAgent}
              onChange={(event) => patch({ userAgent: event.target.value })}
              placeholder="保存账号后自动生成平台原生 UA"
            />
          </label>
          <label>
            时区
            <input
              value={value.timezone}
              onChange={(event) => patch({ timezone: event.target.value })}
              placeholder="Asia/Shanghai"
            />
          </label>
        </div>
      </details>
      <details className="fingerprint-section" open>
        <summary>
          <span>设备与屏幕</span>
          <small>硬件并发、内存、触控、尺寸和 DPR</small>
        </summary>
        <div className="form-grid fingerprint-grid">
          <label>
            硬件并发
            <input
              type="number"
              min="1"
              max="128"
              value={value.hardwareConcurrency}
              onChange={(event) => patch({ hardwareConcurrency: Number(event.target.value) })}
            />
          </label>
          <label>
            设备内存 GB
            <input
              type="number"
              min="0.25"
              max="128"
              step="0.25"
              value={value.deviceMemory}
              onChange={(event) => patch({ deviceMemory: Number(event.target.value) })}
            />
          </label>
          <label>
            最大触控点
            <input
              type="number"
              min="0"
              max="20"
              value={value.maxTouchPoints}
              onChange={(event) => patch({ maxTouchPoints: Number(event.target.value) })}
            />
          </label>
          <label>
            屏幕
            <input
              value={`${value.screenWidth} × ${value.screenHeight}`}
              onChange={(event) => {
                const match = event.target.value.match(/(\d+)\s*[×x]\s*(\d+)/i);
                if (match)
                  patch({ screenWidth: Number(match[1]), screenHeight: Number(match[2]) });
              }}
            />
          </label>
          <label>
            DPR
            <input
              type="number"
              min="0.5"
              max="8"
              step="0.25"
              value={value.deviceScaleFactor}
              onChange={(event) => patch({ deviceScaleFactor: Number(event.target.value) })}
            />
          </label>
          <label>
            WebRTC
            <select
              value={value.webRtcPolicy}
              onChange={(event) =>
                patch({ webRtcPolicy: event.target.value as FingerprintProfile['webRtcPolicy'] })
              }
            >
              <option value="default">浏览器默认</option>
              <option value="disable_non_proxied_udp">禁止非代理 UDP</option>
            </select>
          </label>
        </div>
      </details>
      <details className="fingerprint-section">
        <summary>
          <span>渲染与隐私</span>
          <small>WebGL、Canvas、Audio 和高级 UA-CH</small>
        </summary>
        <div className="form-grid fingerprint-grid">
          <label className="wide">
            WebGL Vendor
            <input
              value={value.webGlVendor}
              onChange={(event) => patch({ webGlVendor: event.target.value })}
              placeholder="Google Inc."
            />
          </label>
          <label className="wide">
            WebGL Renderer
            <input
              value={value.webGlRenderer}
              onChange={(event) => patch({ webGlRenderer: event.target.value })}
              placeholder="ANGLE (Default Renderer)"
            />
          </label>
          <label className="wide">
            UA-CH Brands
            <input
              value={value.userAgentDataBrands}
              onChange={(event) => patch({ userAgentDataBrands: event.target.value })}
              placeholder={'"Not/A)Brand";v="8", "Chromium";v="128"'}
            />
          </label>
          <label className="wide">
            UA-CH Full Version List
            <input
              value={value.userAgentDataFullVersionList}
              onChange={(event) => patch({ userAgentDataFullVersionList: event.target.value })}
              placeholder={'"Not/A)Brand";v="8.0.0.0", "Chromium";v="128.0.0.0"'}
            />
          </label>
          <label>
            UA-CH 平台
            <input
              value={value.userAgentDataPlatform}
              onChange={(event) => patch({ userAgentDataPlatform: event.target.value })}
              placeholder="Windows / macOS"
            />
          </label>
          <label>
            UA-CH 平台版本
            <input
              value={value.userAgentDataPlatformVersion}
              onChange={(event) => patch({ userAgentDataPlatformVersion: event.target.value })}
            />
          </label>
          <label>
            UA-CH 架构
            <input
              value={value.userAgentDataArchitecture}
              onChange={(event) => patch({ userAgentDataArchitecture: event.target.value })}
              placeholder="x86 / arm"
            />
          </label>
          <label>
            UA-CH 位数
            <input
              value={value.userAgentDataBitness}
              onChange={(event) => patch({ userAgentDataBitness: event.target.value })}
              placeholder="64"
            />
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={value.userAgentDataMobile}
              onChange={(event) => patch({ userAgentDataMobile: event.target.checked })}
            />
            UA-CH 移动端
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={value.canvasNoise}
              onChange={(event) => patch({ canvasNoise: event.target.checked })}
            />
            Canvas 噪声
          </label>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={value.audioNoise}
              onChange={(event) => patch({ audioNoise: event.target.checked })}
            />
            Audio 噪声
          </label>
        </div>
      </details>
      <div className="fingerprint-actions">
        <span className="form-hint">
          指纹只在打开账号后重新注入；重新生成会保留启用状态并替换稳定种子。
        </span>
        <button type="button" disabled={!canPersist} onClick={onRegenerate}>
          重新生成
        </button>
        <button type="button" onClick={onReset}>
          恢复默认
        </button>
      </div>
    </div>
  );
}
