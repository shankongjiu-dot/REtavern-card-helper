const fs = require('fs');
const path = require('path');

const files = [
  'd:/111/REtavern-card-helper/src/components/wizard/StepMvuVariables.tsx',
  'd:/111/REtavern-card-helper/src/components/wizard/StepPolishExport.tsx',
  'd:/111/REtavern-card-helper/src/components/wizard/StepStagedMode.tsx',
  'd:/111/REtavern-card-helper/src/components/wizard/StepFirstMessage.tsx',
];

const pattern = /(?:hover:|focus:|active:|disabled:|group-hover:|peer-)?(?:text|bg|border|ring|shadow|from|to|via|fill|stroke|decoration|outline|caret|accent|divide|placeholder|selection)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|transparent|primary|info|success|warning|danger)-[0-9]{2,4}(?:\/[0-9]+)?/g;

const allClasses = new Set();
for (const f of files) {
  const content = fs.readFileSync(f, 'utf-8');
  const matches = content.match(pattern) || [];
  for (const m of matches) allClasses.add(m);
}

for (const c of Array.from(allClasses).sort()) {
  console.log(c);
}
