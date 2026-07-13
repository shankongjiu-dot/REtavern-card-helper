/**
 * ImportPanel - File import and text input
 * Migrated from .temp_statusbar.astro
 */

import { useRef, useCallback } from 'react';
import type { ImportedFileMeta } from '../types';
import { formatNumber } from '../utils';

interface ImportPanelProps {
  sourceText: string;
  contextText: string;
  importedFileMeta: ImportedFileMeta | null;
  onSourceTextChange: (text: string) => void;
  onContextTextChange: (text: string) => void;
  onFileImport: (file: File) => void;
  onClearFile: () => void;
}

export function ImportPanel({
  sourceText,
  contextText,
  importedFileMeta,
  onSourceTextChange,
  onContextTextChange,
  onFileImport,
  onClearFile,
}: ImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFileImport(file);
  }, [onFileImport]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (file) onFileImport(file);
  }, [onFileImport]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <section className="novel-card novel-import-dock">
      <div className="novel-card-head">
        <strong>原始资料</strong>
        <span>先导入小说，再设置解锁方式</span>
      </div>
      <div className="novel-card-body">
        <label
          id="novelDropzone"
          className="novel-dropzone"
          htmlFor="novelSourceFile"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <span className="novel-dropzone-icon">📥</span>
          <span className="novel-dropzone-title">点击或拖拽导入小说文件</span>
          <span className="novel-dropzone-subtitle">
            全文只在内存里参与生成，不会直接渲染到输入框，适合 txt / md / json
          </span>
        </label>

        <div className="novel-upload-row">
          <label className="novel-upload-btn" htmlFor="novelSourceFile">
            选择文件
          </label>
          <input
            ref={fileInputRef}
            id="novelSourceFile"
            type="file"
            accept=".txt,.md,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <span id="novelFileHint" className="novel-upload-hint">
            {importedFileMeta
              ? `已载入内存文件：${importedFileMeta.name}`
              : sourceText
                ? '当前仅使用手动摘录 / 摘要'
                : '支持 txt / md / json'}
          </span>
          {importedFileMeta && (
            <button
              id="btnNovelClearFile"
              type="button"
              className="novel-upload-clear"
              onClick={onClearFile}
            >
              清空文件
            </button>
          )}
        </div>

        {importedFileMeta && (
          <div id="novelFileSummary" className="novel-file-summary">
            <strong>{importedFileMeta.name}</strong>
            <span>
              已加载 {formatNumber(importedFileMeta.charCount)} 字符到内存。
              生成时会使用全文，但不会把全文渲染到前端输入框里。
            </span>
          </div>
        )}

        <div className="novel-source-layout">
          <div className="novel-editor-block">
            <div className="novel-editor-head">
              <label htmlFor="novelSourceText">手动补充摘录</label>
              <span>
                这里适合补少量片段、章节摘要或人工备注，不再直接显示整本小说全文。
              </span>
            </div>
            <textarea
              id="novelSourceText"
              className="novel-textarea novel-source-text"
              placeholder="贴入章节原文、人物设定表、卷纲摘要，或之前整理过的设定资料。"
              value={sourceText}
              onChange={(e) => onSourceTextChange(e.target.value)}
            />
          </div>

          <div className="novel-editor-block">
            <div className="novel-editor-head">
              <label htmlFor="novelContextText">补充说明</label>
              <span>告诉 AI 这次整理应该避开什么、重点抓什么</span>
            </div>
            <textarea
              id="novelContextText"
              className="novel-textarea novel-context-text"
              placeholder="例如：只做公开信息；不要提前泄露真相；优先抽人物、地点、势力；这是卷一到卷三的资料。"
              value={contextText}
              onChange={(e) => onContextTextChange(e.target.value)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
