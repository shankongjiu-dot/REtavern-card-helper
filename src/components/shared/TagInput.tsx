/** Tag input component - allows adding/removing comma-separated tags */
import { useState, type KeyboardEvent } from 'react';

interface TagInputProps {
  label?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput({ label, tags, onChange, placeholder = 'Type and press Enter...' }: TagInputProps) {
  const [input, setInput] = useState('');

  const addTag = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput('');
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
          {label}
        </label>
      )}
      <div
        className="flex flex-wrap gap-1.5 rounded-lg px-2 py-1.5 min-h-[38px]"
        style={{
          backgroundColor: 'var(--input-bg)',
          borderColor: 'var(--input-border)',
          borderWidth: '1px',
          borderStyle: 'solid',
        }}
      >
        {tags.map((tag, i) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-primary-tint-strong px-2 py-0.5 text-xs text-primary-bright"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(i)}
              className="ml-0.5 text-primary-bright hover:text-[var(--color-text-inverse)] cursor-pointer"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[100px] bg-transparent text-sm outline-none"
          style={{ color: 'var(--text-color)' }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => input.trim() && addTag(input)}
          placeholder={tags.length === 0 ? placeholder : ''}
        />
      </div>
    </div>
  );
}
