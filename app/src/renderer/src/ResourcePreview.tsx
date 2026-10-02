import { useEffect, useRef, useState } from 'react';
import type { MediaResource } from '../../shared/contracts';

export function ResourcePreview({
  resource,
  convertedUrl,
  busy,
  onPrepare,
  onConvert,
  onRestore
}: {
  resource: MediaResource;
  convertedUrl: string | null;
  busy: boolean;
  onPrepare(): void;
  onConvert(): void;
  onRestore(): void;
}): React.JSX.Element {
  const [error, setError] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number; duration?: number } | null>(null);
  const compatibilityAttempted = useRef(false);

  useEffect(() => {
    compatibilityAttempted.current = false;
    setDimensions(
      resource.width && resource.height
        ? { width: resource.width, height: resource.height, duration: resource.duration }
        : null
    );
  }, [resource.id, resource.width, resource.height, resource.duration]);

  const source = convertedUrl || resource.previewUrl || resource.url;
  useEffect(() => {
    setError(false);
  }, [source]);

  const isVideo = resource.type === 'video';
  const hasError = error || Boolean(resource.previewError);

  const statusMessage = busy
    ? '正在生成兼容播放副本，原文件保留…'
    : resource.previewStatus === 'loading'
      ? '正在准备本地预览…'
      : convertedUrl
        ? '正在播放兼容 MP4 副本'
        : resource.previewCached
          ? '本地文件 · 无需重复加载'
          : '通过当前账号加载预览';

  const metaBadge = dimensions
    ? `${dimensions.width} × ${dimensions.height}${dimensions.duration ? ` · ${Math.round(dimensions.duration)}s` : ''}`
    : '';

  return (
    <div className="resource-preview-view enhanced-preview">
      <div className="preview-stage">
        {resource.type === 'image' ? (
          <img
            src={source}
            alt={resource.title || '图片预览'}
            onLoad={(event) => {
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight
              });
            }}
            onError={() => setError(true)}
          />
        ) : (
          <video
            controls
            playsInline
            preload="metadata"
            poster={resource.previewThumbUrl || resource.thumbUrl}
            src={source}
            onLoadedMetadata={(event) => {
              setDimensions({
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight,
                duration: event.currentTarget.duration
              });
            }}
            onError={(event) => {
              setError(true);
              const code = event.currentTarget.error?.code;
              if (
                (code === 3 || code === 4) &&
                resource.previewCached &&
                !convertedUrl &&
                !busy &&
                !compatibilityAttempted.current
              ) {
                compatibilityAttempted.current = true;
                onConvert();
              }
            }}
          />
        )}
      </div>

      {hasError && (
        <div className="preview-error" role="alert">
          <strong>{isVideo ? '视频暂时无法播放' : '图片暂时无法加载'}</strong>
          <p>
            {resource.previewError ||
              (isVideo
                ? '可能是地址过期或视频编码不兼容。可重新准备预览，或生成兼容 MP4。'
                : '图片地址可能已过期或网络异常，可尝试重新准备预览。')}
          </p>
        </div>
      )}

      <div className="preview-footer-bar">
        <div className="preview-status" role="status">
          <span
            className={`preview-status-dot ${
              hasError
                ? 'error'
                : busy || resource.previewStatus === 'loading'
                  ? 'loading'
                  : resource.previewCached
                    ? 'cached'
                    : 'remote'
            }`}
          />
          <span className="preview-status-text">{statusMessage}</span>
          {metaBadge && <span className="preview-meta-badge">{metaBadge}</span>}
        </div>

        <div className="preview-actions">
          {hasError ? (
            <>
              <button
                type="button"
                disabled={resource.previewStatus === 'loading'}
                onClick={onPrepare}
              >
                {resource.previewStatus === 'loading' ? '准备中…' : '重新准备预览'}
              </button>
              {isVideo && (
                <button type="button" disabled={busy} onClick={onConvert}>
                  {busy ? '转换中…' : '兼容 MP4 播放'}
                </button>
              )}
              {convertedUrl && (
                <button type="button" onClick={onRestore}>
                  恢复原文件
                </button>
              )}
            </>
          ) : (
            <>
              {!resource.previewCached && (
                <button
                  type="button"
                  disabled={resource.previewStatus === 'loading'}
                  onClick={onPrepare}
                >
                  {resource.previewStatus === 'loading' ? '准备中…' : '缓存本地预览'}
                </button>
              )}
              {isVideo && !convertedUrl && (
                <button type="button" disabled={busy} onClick={onConvert}>
                  {busy ? '转换中…' : '兼容 MP4 播放'}
                </button>
              )}
              {convertedUrl && (
                <button type="button" onClick={onRestore}>
                  恢复原文件
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
