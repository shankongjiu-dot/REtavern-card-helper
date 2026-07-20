/**
 * PipelinePanel - Workflow steps and call estimation
 * Migrated from .temp_statusbar.astro
 */

import { useMemo } from 'react';
import type { WorkflowRunState, GateMode, NarrativeMode } from '../types';
import { buildCallEstimate, renderCallRisk, formatNumber } from '../utils';

interface PipelinePanelProps {
  source: string;
  chunkCharLimit: number;
  gateMode: GateMode;
  narrativeMode: NarrativeMode;
  entryBudget: number;
  workflowRunState: WorkflowRunState;
}

export function PipelinePanel({
  source,
  chunkCharLimit,
  workflowRunState,
}: PipelinePanelProps) {
  // Re-splitting the whole novel on every render is expensive; memoize on the
  // inputs that actually affect the estimate.
  const estimate = useMemo(() => buildCallEstimate(source, chunkCharLimit), [source, chunkCharLimit]);

  const steps = [
    {
      title: '准备资料',
      detail: estimate.sourceChars
        ? `已就绪 ${formatNumber(estimate.sourceChars)} 字。${renderCallRisk(estimate)}`
        : renderCallRisk(estimate),
    },
    {
      title: '分段提取',
      detail: estimate.chunkCount
        ? `预计调用 ${formatNumber(estimate.chunkCount)} 次 AI，把长文本分成几段，分别提取人物、地点、势力与规则。`
        : '暂无文本，暂不需要分段提取。',
    },
    {
      title: '合并整理',
      detail: estimate.mergeCalls
        ? `预计再调用 ${formatNumber(estimate.mergeCalls)} 次 AI，把重复的人物和设定合并到一起。`
        : '当前文本量较少，可以直接整合，不需要额外合并。',
    },
    {
      title: '写入世界书',
      detail: '最后把整理好的内容写进世界书，同时生成用于控制剧情解锁的 AI 记忆变量。',
    },
  ];

  const getStepClasses = (index: number): string => {
    const classes = ['novel-workflow-step'];
    if (workflowRunState.phase === 'idle') {
      if (index === 0 && estimate.sourceChars) classes.push('is-active');
    } else {
      if ((workflowRunState.phase === 'extract' && index === 1) ||
          (workflowRunState.phase === 'merge' && index === 2) ||
          (workflowRunState.phase === 'inject' && index === 3)) {
        classes.push('is-active');
      }
      if ((workflowRunState.phase === 'extract' || workflowRunState.phase === 'merge' || 
           workflowRunState.phase === 'inject' || workflowRunState.phase === 'done') && index === 0) {
        classes.push('is-done');
      }
      if ((workflowRunState.phase === 'merge' || workflowRunState.phase === 'inject' || 
           workflowRunState.phase === 'done') && index === 1) {
        classes.push('is-done');
      }
      if ((workflowRunState.phase === 'inject' || workflowRunState.phase === 'done') && index === 2) {
        classes.push('is-done');
      }
      if (workflowRunState.phase === 'done' && index === 3) {
        classes.push('is-done');
      }
    }
    return classes.join(' ');
  };

  const getStepDetail = (index: number, detail: string): string => {
    if (index === 1 && workflowRunState.phase === 'extract' && workflowRunState.extractionTotal) {
      const base = `正在处理第 ${formatNumber(workflowRunState.extractionDone + 1)} / ${formatNumber(workflowRunState.extractionTotal)} 段。`;
      const skipped = workflowRunState.failedChunks.length;
      return skipped > 0 ? `${base}（${skipped} 段失败已跳过）` : base;
    }
    if (index === 2 && workflowRunState.phase === 'merge' && workflowRunState.mergeTotal) {
      const base = `正在进行第 ${formatNumber(workflowRunState.mergeDone + 1)} / ${formatNumber(workflowRunState.mergeTotal)} 次合并整理。`;
      const fallbacks = workflowRunState.mergeFallbacks;
      return fallbacks > 0 ? `${base}（${fallbacks} 次改用本地合并）` : base;
    }
    if (index === 3 && workflowRunState.phase === 'inject') {
      return '正在写入世界书条目，同时生成 AI 记忆变量。';
    }
    return detail;
  };

  return (
    <section className="novel-card novel-pipeline-card">
      <div className="novel-card-head">
        <strong>处理步骤</strong>
        <span>生成前先看预计花费</span>
      </div>
      <div className="novel-card-body">
        <div id="novelEstimateBar" className="novel-estimate-bar">
          <div className="novel-estimate-card is-accent">
            <strong>{estimate.totalCalls ? `${estimate.totalCalls} 次` : '0 次'}</strong>
            <span>预计需要调用 AI 多少次</span>
          </div>
          <div className="novel-estimate-card">
            <strong>{estimate.chunkCount ? `${estimate.chunkCount} 段` : '未分段'}</strong>
            <span>按每段约 {formatNumber(estimate.chunkSize)} 字预先分段</span>
          </div>
          <div className="novel-estimate-card">
            <strong>{estimate.sourceChars ? `${formatNumber(estimate.sourceChars)} 字` : '未载入'}</strong>
            <span>导入全文与手动摘录合计字符数</span>
          </div>
        </div>

        <div id="novelWorkflowSteps" className="novel-workflow-steps">
          {steps.map((step, index) => (
            <div key={index} className={getStepClasses(index)}>
              <div className="novel-workflow-index">{index + 1}</div>
              <div className="novel-workflow-copy">
                <strong>{step.title}</strong>
                <span>{getStepDetail(index, step.detail)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
