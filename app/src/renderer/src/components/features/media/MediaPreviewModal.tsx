import React from 'react';
import type { MediaResource } from '@shared/contracts';
import { ResourcePreview } from '../../../ResourcePreview';
import { Modal } from '../../ui/Modal';

export interface MediaPreviewModalProps {
  resource: MediaResource;
  convertedUrl: string | null;
  busy: boolean;
  onPrepare: () => void;
  onConvert: () => void;
  onRestore: () => void;
  onDownload: (resource: MediaResource) => void;
  onOpenUrl: (resource: MediaResource) => void;
  onClose: () => void;
}

export function MediaPreviewModal({
  resource,
  convertedUrl,
  busy,
  onPrepare,
  onConvert,
  onRestore,
  onDownload,
  onOpenUrl,
  onClose
}: MediaPreviewModalProps): React.JSX.Element {
  return (
    <Modal
      title={
        resource.title || (resource.type === 'image' ? '图片预览' : '视频预览')
      }
      wide
      className="preview-modal"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            关闭
          </button>
          {/^https?:\/\//i.test(resource.url) && (
            <button type="button" onClick={() => onOpenUrl(resource)}>
              打开链接
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => onDownload(resource)}
          >
            下载原文件
          </button>
        </>
      }
    >
      <ResourcePreview
        resource={resource}
        convertedUrl={convertedUrl}
        busy={busy}
        onPrepare={onPrepare}
        onConvert={onConvert}
        onRestore={onRestore}
      />
    </Modal>
  );
}
