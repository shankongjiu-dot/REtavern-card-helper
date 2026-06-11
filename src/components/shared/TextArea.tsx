/** Textarea with label */
import type { TextareaHTMLAttributes, Ref } from 'react';

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ label, error, className = '', textareaRef, ...props }: TextAreaProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-slate-300">{label}</label>}
      <textarea
        ref={textareaRef}
        className={`w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100
          placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
          resize-y min-h-[80px] ${error ? 'border-red-500' : ''} ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
