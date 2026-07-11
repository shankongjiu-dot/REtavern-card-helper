import re
from pathlib import Path
import sys

files = [
    r'd:\111\REtavern-card-helper\src\components\wizard\StepMvuVariables.tsx',
    r'd:\111\REtavern-card-helper\src\components\wizard\StepPolishExport.tsx',
    r'd:\111\REtavern-card-helper\src\components\wizard\StepStagedMode.tsx',
    r'd:\111\REtavern-card-helper\src\components\wizard\StepFirstMessage.tsx',
]

pattern = re.compile(r'(?:hover:|focus:|active:|disabled:|group-hover:|peer-)?(?:text|bg|border|ring|shadow|from|to|via|fill|stroke|decoration|outline|caret|accent|divide|placeholder|selection)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|transparent|primary|info|success|warning|danger)-[0-9]{2,4}(?:/[0-9]+)?')

all_classes = set()
for f in files:
    content = Path(f).read_text(encoding='utf-8')
    classes = pattern.findall(content)
    all_classes.update(classes)

for c in sorted(all_classes):
    print(c)
