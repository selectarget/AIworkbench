import React from 'react';
import type { MediaResource } from '@shared/contracts';
import { mediaCandidates } from '../../../utils/rendererState';
import { Modal } from '../../ui/Modal';

export interface CandidateModalProps {
  resource: MediaResource;
  onSelectCandidate: (resource: MediaResource, url: string) => void;
  onCopyUrl: (url: string) => void;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}

export function CandidateModal({
  resource,
  onSelectCandidate,
  onCopyUrl,
  onOpenUrl,
  onClose
}: CandidateModalProps): React.JSX.Element {
  return (
    <Modal
      title={`资源候选 · ${
        resource.title || (resource.type === 'image' ? '图片素材' : '视频素材')
      }`}
      wide
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="candidate-summary">
        <p className="form-hint">
          只显示该素材从页面公开响应或 Blob
          中观察到的地址。选择后会将其设为首选，下载仍由账号 Session
          和主进程队列处理。
        </p>
        {resource.rejectedCandidates?.length ? (
          <div className="rejected-candidates">
            <strong>
              最近失败的候选 · {resource.rejectedCandidates.length}
            </strong>
            {resource.rejectedCandidates
              .slice(-8)
              .reverse()
              .map((url: string) => (
                <small key={url} title={url}>
                  {url}
                </small>
              ))}
          </div>
        ) : null}
        <div className="candidate-list">
          {mediaCandidates(resource).map((candidate) => {
            const selected = candidate.url === resource.url;
            const roleLabel =
              candidate.role === 'primary'
                ? '当前首选'
                : candidate.role === 'backup'
                ? '备用地址'
                : `候选地址 ${candidate.index - 1}`;
            return (
              <article
                key={candidate.url}
                className={`candidate-row ${selected ? 'selected' : ''}`}
              >
                <div className="candidate-copy">
                  <strong>{roleLabel}</strong>
                  <small title={candidate.url}>{candidate.url}</small>
                </div>
                <div className="candidate-actions">
                  {!selected && (
                    <button
                      type="button"
                      onClick={() => onSelectCandidate(resource, candidate.url)}
                    >
                      设为首选
                    </button>
                  )}
                  <button type="button" onClick={() => onCopyUrl(candidate.url)}>
                    复制
                  </button>
                  {/^https?:\/\//i.test(candidate.url) && (
                    <button
                      type="button"
                      onClick={() => onOpenUrl(candidate.url)}
                    >
                      打开
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
