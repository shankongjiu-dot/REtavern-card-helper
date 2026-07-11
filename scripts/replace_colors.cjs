const fs = require('fs');

const files = [
  'd:/111/REtavern-card-helper/src/components/wizard/StepMvuVariables.tsx',
  'd:/111/REtavern-card-helper/src/components/wizard/StepPolishExport.tsx',
  'd:/111/REtavern-card-helper/src/components/wizard/StepStagedMode.tsx',
  'd:/111/REtavern-card-helper/src/components/wizard/StepFirstMessage.tsx',
];

const replacements = [
  // Text colors
  { from: 'text-slate-100', to: 'text-[var(--text-color)]' },
  { from: 'text-slate-200', to: 'text-[var(--text-color)]' },
  { from: 'text-slate-300', to: 'text-[var(--color-text-secondary)]' },
  { from: 'text-slate-400', to: 'text-[var(--color-text-secondary)]' },
  { from: 'text-slate-500', to: 'text-[var(--color-text-muted)]' },
  { from: 'text-slate-600', to: 'text-[var(--color-text-muted)]' },
  { from: 'text-white', to: 'text-[var(--text-color)]' },
  { from: 'text-emerald-300', to: 'text-[var(--color-status-success)]' },
  { from: 'text-emerald-300/80', to: 'text-[var(--color-status-success)]' },
  { from: 'text-emerald-400', to: 'text-[var(--color-status-success)]' },
  { from: 'text-emerald-400/60', to: 'text-[var(--color-status-success)]' },
  { from: 'text-emerald-500/60', to: 'text-[var(--color-status-success)]' },
  { from: 'text-amber-200/80', to: 'text-[var(--color-status-warning)]' },
  { from: 'text-amber-300', to: 'text-[var(--color-status-warning)]' },
  { from: 'text-amber-400', to: 'text-[var(--color-status-warning)]' },
  { from: 'text-amber-400/50', to: 'text-[var(--color-status-warning)]' },
  { from: 'text-amber-400/60', to: 'text-[var(--color-status-warning)]' },
  { from: 'text-amber-400/80', to: 'text-[var(--color-status-warning)]' },
  { from: 'text-red-300', to: 'text-[var(--color-status-danger)]' },
  { from: 'text-violet-200', to: 'text-[var(--color-purple)]' },
  { from: 'text-violet-300', to: 'text-[var(--color-purple)]' },
  { from: 'text-violet-400', to: 'text-[var(--color-purple)]' },
  { from: 'text-purple-200', to: 'text-[var(--color-purple)]' },
  { from: 'text-purple-300', to: 'text-[var(--color-purple)]' },
  { from: 'text-purple-300/60', to: 'text-[var(--color-purple)]' },
  { from: 'text-purple-400/60', to: 'text-[var(--color-purple)]' },
  { from: 'text-sky-300', to: 'text-[var(--color-info)]' },
  { from: 'text-sky-400', to: 'text-[var(--color-info)]' },
  { from: 'text-teal-200', to: 'text-[var(--color-info)]' },
  { from: 'text-teal-300', to: 'text-[var(--color-info)]' },
  { from: 'text-teal-400/50', to: 'text-[var(--color-info)]' },
  { from: 'text-teal-400/60', to: 'text-[var(--color-info)]' },
  { from: 'text-teal-400/80', to: 'text-[var(--color-info)]' },
  { from: 'text-pink-300/50', to: 'text-[var(--color-purple)]' },
  { from: 'text-pink-400/80', to: 'text-[var(--color-purple)]' },

  // Solid borders
  { from: 'border-slate-600', to: 'border-[var(--input-border)]' },
  { from: 'border-slate-700', to: 'border-[var(--color-border-default)]' },
  { from: 'border-emerald-500', to: 'border-[var(--color-status-success)]' },
  { from: 'border-purple-500', to: 'border-[var(--color-purple)]' },

  // Solid backgrounds
  { from: 'bg-slate-700', to: 'bg-[var(--color-surface-elevated)]' },
  { from: 'bg-slate-800', to: 'bg-[var(--color-surface-raised)]' },
  { from: 'bg-slate-900', to: 'bg-[var(--input-bg)]' },
  { from: 'bg-slate-950', to: 'bg-[var(--color-surface-base)]' },
  { from: 'bg-emerald-500', to: 'bg-[var(--color-status-success)]' },
  { from: 'bg-rose-600', to: 'bg-[var(--color-status-danger)]' },

  // Placeholder
  { from: 'placeholder-slate-500', to: 'placeholder-[var(--color-text-muted)]' },
  { from: 'focus:border-amber-500', to: 'focus:border-[var(--color-status-warning)]' },
  { from: 'hover:text-slate-300', to: 'hover:text-[var(--color-text-secondary)]' },
  { from: 'hover:border-slate-500', to: 'hover:border-[var(--color-text-muted)]' },
  { from: 'hover:border-slate-600', to: 'hover:border-[var(--input-border)]' },
  { from: 'hover:text-emerald-300', to: 'hover:text-[var(--color-status-success)]' },
  { from: 'hover:text-red-300', to: 'hover:text-[var(--color-status-danger)]' },

  // Translucent borders
  { from: 'border-slate-600/50', to: 'border-[color-mix(in_srgb,var(--input-border)_50%,transparent)]' },
  { from: 'border-slate-700/30', to: 'border-[color-mix(in_srgb,var(--color-border-default)_30%,transparent)]' },
  { from: 'border-slate-700/40', to: 'border-[color-mix(in_srgb,var(--color-border-default)_40%,transparent)]' },
  { from: 'border-slate-700/50', to: 'border-[color-mix(in_srgb,var(--color-border-default)_50%,transparent)]' },
  { from: 'border-amber-600/40', to: 'border-[color-mix(in_srgb,var(--color-status-warning)_40%,transparent)]' },
  { from: 'border-amber-600/50', to: 'border-[color-mix(in_srgb,var(--color-status-warning)_50%,transparent)]' },
  { from: 'border-amber-700/20', to: 'border-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)]' },
  { from: 'border-amber-700/30', to: 'border-[color-mix(in_srgb,var(--color-status-warning)_30%,transparent)]' },
  { from: 'border-amber-700/40', to: 'border-[color-mix(in_srgb,var(--color-status-warning)_40%,transparent)]' },
  { from: 'border-emerald-400/25', to: 'border-[color-mix(in_srgb,var(--color-status-success)_25%,transparent)]' },
  { from: 'border-emerald-500/20', to: 'border-[color-mix(in_srgb,var(--color-status-success)_20%,transparent)]' },
  { from: 'border-emerald-500/30', to: 'border-[color-mix(in_srgb,var(--color-status-success)_30%,transparent)]' },
  { from: 'border-emerald-500/50', to: 'border-[color-mix(in_srgb,var(--color-status-success)_50%,transparent)]' },
  { from: 'border-emerald-700/30', to: 'border-[color-mix(in_srgb,var(--color-status-success)_30%,transparent)]' },
  { from: 'border-emerald-700/40', to: 'border-[color-mix(in_srgb,var(--color-status-success)_40%,transparent)]' },
  { from: 'border-pink-700/30', to: 'border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)]' },
  { from: 'border-purple-500/30', to: 'border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)]' },
  { from: 'border-purple-700/40', to: 'border-[color-mix(in_srgb,var(--color-purple)_40%,transparent)]' },
  { from: 'border-red-700/30', to: 'border-[color-mix(in_srgb,var(--color-status-danger)_30%,transparent)]' },
  { from: 'border-teal-700/30', to: 'border-[color-mix(in_srgb,var(--color-info)_30%,transparent)]' },
  { from: 'border-teal-700/40', to: 'border-[color-mix(in_srgb,var(--color-info)_40%,transparent)]' },
  { from: 'hover:border-emerald-500/50', to: 'hover:border-[color-mix(in_srgb,var(--color-status-success)_50%,transparent)]' },
  { from: 'hover:border-purple-500/40', to: 'hover:border-[color-mix(in_srgb,var(--color-purple)_40%,transparent)]' },

  // Translucent backgrounds
  { from: 'bg-amber-900/20', to: 'bg-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)]' },
  { from: 'bg-amber-900/40', to: 'bg-[color-mix(in_srgb,var(--color-status-warning)_40%,transparent)]' },
  { from: 'bg-amber-950/10', to: 'bg-[color-mix(in_srgb,var(--color-status-warning)_10%,transparent)]' },
  { from: 'bg-amber-950/20', to: 'bg-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)]' },
  { from: 'bg-emerald-500/10', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_10%,transparent)]' },
  { from: 'bg-emerald-500/20', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_20%,transparent)]' },
  { from: 'bg-emerald-800/40', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_40%,transparent)]' },
  { from: 'bg-emerald-900/20', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_20%,transparent)]' },
  { from: 'bg-emerald-900/30', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_30%,transparent)]' },
  { from: 'bg-emerald-900/40', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_40%,transparent)]' },
  { from: 'bg-emerald-900/50', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_50%,transparent)]' },
  { from: 'bg-emerald-950/10', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_10%,transparent)]' },
  { from: 'bg-emerald-950/20', to: 'bg-[color-mix(in_srgb,var(--color-status-success)_20%,transparent)]' },
  { from: 'bg-pink-950/10', to: 'bg-[color-mix(in_srgb,var(--color-purple)_10%,transparent)]' },
  { from: 'bg-purple-500/10', to: 'bg-[color-mix(in_srgb,var(--color-purple)_10%,transparent)]' },
  { from: 'bg-purple-900/20', to: 'bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]' },
  { from: 'bg-purple-900/40', to: 'bg-[color-mix(in_srgb,var(--color-purple)_40%,transparent)]' },
  { from: 'bg-purple-950/20', to: 'bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]' },
  { from: 'bg-red-900/20', to: 'bg-[color-mix(in_srgb,var(--color-status-danger)_20%,transparent)]' },
  { from: 'bg-sky-900/40', to: 'bg-[color-mix(in_srgb,var(--color-info)_40%,transparent)]' },
  { from: 'bg-slate-700/50', to: 'bg-[color-mix(in_srgb,var(--color-surface-elevated)_50%,transparent)]' },
  { from: 'bg-slate-700/60', to: 'bg-[color-mix(in_srgb,var(--color-surface-elevated)_60%,transparent)]' },
  { from: 'bg-slate-800/50', to: 'bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)]' },
  { from: 'bg-slate-900/30', to: 'bg-[color-mix(in_srgb,var(--input-bg)_30%,transparent)]' },
  { from: 'bg-slate-900/40', to: 'bg-[color-mix(in_srgb,var(--input-bg)_40%,transparent)]' },
  { from: 'bg-slate-900/50', to: 'bg-[color-mix(in_srgb,var(--input-bg)_50%,transparent)]' },
  { from: 'bg-slate-900/60', to: 'bg-[color-mix(in_srgb,var(--input-bg)_60%,transparent)]' },
  { from: 'bg-slate-900/80', to: 'bg-[color-mix(in_srgb,var(--input-bg)_80%,transparent)]' },
  { from: 'bg-slate-950/35', to: 'bg-[color-mix(in_srgb,var(--color-surface-base)_35%,transparent)]' },
  { from: 'bg-slate-950/50', to: 'bg-[color-mix(in_srgb,var(--color-surface-base)_50%,transparent)]' },
  { from: 'bg-slate-950/75', to: 'bg-[color-mix(in_srgb,var(--color-surface-base)_75%,transparent)]' },
  { from: 'bg-teal-950/10', to: 'bg-[color-mix(in_srgb,var(--color-info)_10%,transparent)]' },
  { from: 'bg-teal-950/20', to: 'bg-[color-mix(in_srgb,var(--color-info)_20%,transparent)]' },
  { from: 'bg-violet-900/40', to: 'bg-[color-mix(in_srgb,var(--color-purple)_40%,transparent)]' },
  { from: 'hover:bg-amber-900/20', to: 'hover:bg-[color-mix(in_srgb,var(--color-status-warning)_20%,transparent)]' },
  { from: 'hover:bg-emerald-900/10', to: 'hover:bg-[color-mix(in_srgb,var(--color-status-success)_10%,transparent)]' },
  { from: 'hover:bg-emerald-900/20', to: 'hover:bg-[color-mix(in_srgb,var(--color-status-success)_20%,transparent)]' },
  { from: 'hover:bg-slate-700/30', to: 'hover:bg-[color-mix(in_srgb,var(--color-surface-elevated)_30%,transparent)]' },
  { from: 'hover:bg-slate-800/50', to: 'hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_50%,transparent)]' },

  // Gradient
  { from: 'from-slate-950/75', to: 'from-[color-mix(in_srgb,var(--color-surface-base)_75%,transparent)]' },

  // Black / white overlays and accents
  { from: 'bg-black/45', to: 'bg-[color-mix(in_srgb,var(--color-surface-base)_45%,transparent)]' },
  { from: 'border-white/30', to: 'border-[color-mix(in_srgb,var(--text-color)_30%,transparent)]' },
  { from: 'border-white/10', to: 'border-[color-mix(in_srgb,var(--text-color)_10%,transparent)]' },
  { from: 'after:bg-white', to: 'after:bg-[var(--text-color)]' },
  { from: 'peer-checked:after:border-white', to: 'peer-checked:after:border-[var(--text-color)]' },

  // Hardcoded hex in inline HTML string
  { from: "color:#6b7280", to: "color:var(--color-text-muted)" },
];

// Sort by length descending to avoid partial replacements
replacements.sort((a, b) => b.from.length - a.from.length);

for (const f of files) {
  let content = fs.readFileSync(f, 'utf-8');
  let changed = false;
  for (const { from, to } of replacements) {
    if (content.includes(from)) {
      const newContent = content.split(from).join(to);
      if (newContent !== content) {
        content = newContent;
        changed = true;
      }
    }
  }
  if (changed) {
    fs.writeFileSync(f, content, 'utf-8');
    console.log('Updated:', f);
  } else {
    console.log('No changes:', f);
  }
}
