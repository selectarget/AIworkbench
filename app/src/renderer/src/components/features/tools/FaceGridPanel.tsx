import React, { useState } from 'react';
import type { FaceGridImage, FaceGridMode } from '@shared/contracts';
import { processFaceGrid } from '../../../face-grid';
import { unwrap } from '../../../utils/formatters';

export interface FaceGridPanelProps {
  onStatus: (value: string) => void;
}

export function FaceGridPanel({ onStatus }: FaceGridPanelProps): React.JSX.Element {
  const [image, setImage] = useState<FaceGridImage | null>(null);
  const [outputDir, setOutputDir] = useState('');
  const [mode, setMode] = useState<FaceGridMode>('grid');
  const [thickness, setThickness] = useState(2);
  const [alpha, setAlpha] = useState(0.4);
  const [color, setColor] = useState('white');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ path: string; faceCount: number; scaled: boolean } | null>(
    null
  );

  const chooseImage = async (): Promise<void> => {
    try {
      const value = unwrap(await window.workbench.faceGrid.chooseImage());
      if (value) {
        setImage(value);
        setResult(null);
        onStatus(`已选择图片：${value.path}`);
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseOutput = async (): Promise<void> => {
    try {
      setOutputDir(unwrap(await window.workbench.faceGrid.chooseOutputDir()));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const run = async (): Promise<void> => {
    if (!image) return onStatus('请先选择图片');
    try {
      setBusy(true);
      onStatus('正在加载人脸模型并检测…');
      const model = unwrap(await window.workbench.faceGrid.model());
      const safeThickness = Number.isFinite(thickness) ? Math.max(0.5, Math.min(20, thickness)) : 2;
      const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.4;
      const processed = await processFaceGrid(image.dataUrl, model, {
        mode,
        thickness: safeThickness,
        alpha: safeAlpha,
        color: color.trim() || 'white'
      });
      const saved = unwrap(
        await window.workbench.faceGrid.save({
          inputPath: image.path,
          outputDir: outputDir || undefined,
          mode,
          mime: processed.mime,
          dataUrl: processed.dataUrl,
          faceCount: processed.faceCount,
          scaled: processed.scaled
        })
      );
      setResult(saved);
      onStatus(`处理完成：检测到 ${saved.faceCount} 张人脸，已保存到 ${saved.path}`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="face-grid-panel">
      <p>
        使用旧版 OpenCV SSD 模型在本地检测人脸，然后绘制网格或生成脸部重组图。图片不会上传云端。
      </p>
      <div className="face-grid-toolbar">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void chooseImage()}
        >
          选择图片
        </button>
        <button
          type="button"
          disabled={busy || !image}
          onClick={() => void chooseOutput()}
        >
          输出目录
        </button>
        <span>{image ? image.path : '尚未选择图片'}</span>
      </div>
      {image && (
        <div className="face-grid-preview">
          <img src={image.dataUrl} alt="待处理图片" />
        </div>
      )}
      <div className="form-grid face-grid-options">
        <label>
          处理模式
          <select value={mode} onChange={(event) => setMode(event.target.value as FaceGridMode)}>
            <option value="grid">网格</option>
            <option value="regroup">脸部重组</option>
          </select>
        </label>
        <label>
          线宽
          <input
            type="number"
            min="0.5"
            max="20"
            step="0.5"
            value={thickness}
            onChange={(event) => setThickness(Number(event.target.value))}
          />
        </label>
        <label>
          透明度
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={alpha}
            onChange={(event) => setAlpha(Number(event.target.value))}
          />
        </label>
        <label>
          颜色
          <input
            value={color}
            onChange={(event) => setColor(event.target.value)}
            placeholder="white / #ffffff / 255,255,255"
          />
        </label>
      </div>
      <div className="account-tools">
        <button
          type="button"
          className="primary"
          disabled={busy || !image}
          onClick={() => void run()}
        >
          {busy ? '处理中…' : '开始处理'}
        </button>
        {result && (
          <span className="inline-status success">
            {result.faceCount} 张人脸 · {result.scaled ? '已按 2500px 限制缩放 · ' : ''}
            {result.path}
          </span>
        )}
      </div>
    </div>
  );
}
