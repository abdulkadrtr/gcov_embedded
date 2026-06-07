const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');

function activate(context) {
    const provider = new GcovEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('gcovViewer.editor', provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gcovViewer.openRaw', async () => {
            // Determine the .gcov URI from the active custom editor tab
            const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
            const input = tab && tab.input;
            const uri = input && input.uri;
            if (!uri || !uri.fsPath.endsWith('.gcov')) {
                vscode.window.showWarningMessage('No .gcov file is currently active.');
                return;
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
        })
    );
}

function deactivate() {}

class GcovEditorProvider {
    constructor(context) { this._context = context; }
    async openCustomDocument(uri) { return { uri, dispose: () => {} }; }
    async resolveCustomEditor(document, panel) {
        const rawText = fs.readFileSync(document.uri.fsPath, 'utf8');
        const parsed  = parseGcov(rawText);
        panel.webview.options = { enableScripts: true };
        panel.webview.html    = buildHtml(parsed, document.uri);
    }
}

// ─── Parser ────────────────────────────────────────────────────────────────

function parseGcov(raw) {
    const lines     = raw.split('\n');
    const codeLines = [];
    const functions = [];
    let   pending   = [];

    for (const line of lines) {
        // skip file metadata
        if (/^\s*-:\s*0:/.test(line)) continue;

        // function summary
        const fnM = line.match(/^function\s+(\S+)\s+called\s+(\d+)\s+returned\s+(\S+)\s+blocks executed\s+(\S+)/);
        if (fnM) {
            functions.push({ name: fnM[1], called: parseInt(fnM[2]), blocks: fnM[4] });
            pending.push({ kind: 'function', name: fnM[1], called: parseInt(fnM[2]), blocks: fnM[4] });
            continue;
        }

        // branch / call / condition annotation
        const annM = line.match(/^(branch|call|condition)\s+(.*)/);
        if (annM) {
            pending.push({ kind: annM[1], detail: annM[2].trim() });
            continue;
        }

        // code line
        const lM = line.match(/^([^:]+):\s*(\d+):(.*)/);
        if (lM) {
            const countRaw = lM[1].trim();
            const lineNo   = parseInt(lM[2]);
            const code     = lM[3];
            if (lineNo === 0) { pending = []; continue; }

            let count = null, type = 'noncode';
            if (countRaw === '#####' || countRaw === '$$$$$') {
                count = 0; type = 'uncovered';
            } else if (countRaw !== '-') {
                count = parseInt(countRaw.replace(/,/g, ''));
                type  = count > 0 ? 'covered' : 'uncovered';
            }

            // Parse branch/condition annotations into structured form
            const branches   = [];
            const conditions = [];
            let   fnInfo     = null;
            for (const a of pending) {
                if (a.kind === 'function') { fnInfo = a; }
                else if (a.kind === 'branch') {
                    const never = a.detail.includes('never executed');
                    const m = a.detail.match(/(\d+)\s+(taken|never executed)\s*(\d+)?/);
                    branches.push({ idx: m ? m[1] : '?', hit: !never, detail: a.detail });
                } else if (a.kind === 'condition') {
                    // "condition outcomes covered X/Y"  → summary line
                    // "condition N not covered (true)"           → index N, true missing
                    // "condition N not covered (false)"          → index N, false missing
                    // "condition N not covered (true false)"     → index N, both missing
                    const outcomeM = a.detail.match(/outcomes covered\s+(\d+)\/(\d+)/);
                    if (outcomeM) {
                        conditions.push({
                            isSummary: true,
                            covNum: parseInt(outcomeM[1]),
                            covDen: parseInt(outcomeM[2]),
                            detail: a.detail
                        });
                    } else {
                        // e.g. "1 not covered (false)"  or  "0 not covered (true false)"
                        const missM = a.detail.match(/^(\d+)\s+not covered\s+\(([^)]+)\)/);
                        if (missM) {
                            const idx      = parseInt(missM[1]);
                            const missing  = missM[2].trim().split(/\s+/); // ["false"] or ["true","false"]
                            conditions.push({ isSummary: false, idx, missing, detail: a.detail });
                        }
                    }
                }
            }

            codeLines.push({ lineNo, count, countRaw, code, type, branches, conditions, fnInfo });
            pending = [];
        }
    }

    const exec      = codeLines.filter(l => l.type !== 'noncode');
    const covered   = codeLines.filter(l => l.type === 'covered');
    const uncovered = codeLines.filter(l => l.type === 'uncovered');

    // branch stats
    let totalBranches = 0, hitBranches = 0;
    for (const l of codeLines) {
        for (const b of l.branches) { totalBranches++; if (b.hit) hitBranches++; }
    }

    // MC/DC: sum "outcomes covered X/Y" values directly — matches gcov output exactly
    let totalConds = 0, coveredConds = 0;
    for (const l of codeLines) {
        for (const c of l.conditions) {
            if (c.isSummary) {
                coveredConds += c.covNum;
                totalConds   += c.covDen;
            }
        }
    }

    return {
        codeLines,
        functions,
        stats: {
            linePct:   exec.length   ? Math.round(covered.length / exec.length * 100)   : 0,
            lineCov:   covered.length, lineTotal: exec.length,
            branchPct: totalBranches ? Math.round(hitBranches / totalBranches * 100)     : null,
            branchCov: hitBranches,  branchTotal: totalBranches,
            mcdcPct:   totalConds    ? Math.round(coveredConds / totalConds * 100)       : null,
            mcdcCov:   Math.round(coveredConds), mcdcTotal: totalConds,
        }
    };
}

// ─── HTML ──────────────────────────────────────────────────────────────────

function buildHtml(parsed, uri) {
    const { codeLines, stats } = parsed;
    const fileName = path.basename(uri.fsPath);

    const rows = codeLines.map(l => {
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        // left gutter indicator
        let gutter = '';
        if      (l.type === 'covered')   gutter = `<span class="g-cov"></span>`;
        else if (l.type === 'uncovered') gutter = `<span class="g-uncov"></span>`;
        else                             gutter = `<span class="g-none"></span>`;

        // count cell
        let countHtml = '';
        if (l.type === 'noncode')    countHtml = `<td class="cnt"></td>`;
        else if (l.type === 'covered')   countHtml = `<td class="cnt cnt-cov">${fmtCount(l.count)}</td>`;
        else                             countHtml = `<td class="cnt cnt-uncov">0</td>`;

        // tooltip
        const tipLines = [];
        if (l.fnInfo) {
            tipLines.push(`<div class="tip-row tip-fn"><span class="tip-label">function</span><span class="tip-val">${esc(l.fnInfo.name)} — called ${l.fnInfo.called}× — blocks ${l.fnInfo.blocks}</span></div>`);
        }
        for (const b of l.branches) {
            const cls = b.hit ? 'tip-hit' : 'tip-miss';
            tipLines.push(`<div class="tip-row ${cls}"><span class="tip-label">branch</span><span class="tip-val">${esc(b.detail)}</span></div>`);
        }

        // MC/DC: build per-condition index map from summary + miss lines
        const summaryC = l.conditions.find(c => c.isSummary);
        const missLines = l.conditions.filter(c => !c.isSummary);
        if (summaryC) {
            // collect which (idx, outcome) pairs are missing
            // missLines: { idx, missing: ["false"] | ["true"] | ["true","false"] }
            const missMap = {}; // idx → Set of missing outcomes
            for (const m of missLines) {
                missMap[m.idx] = new Set(m.missing);
            }

            // total conditions = covDen / 2
            const totalCondCount = summaryC.covDen / 2;
            const summaryClass   = summaryC.covNum === summaryC.covDen ? 'tip-hit'
                                 : summaryC.covNum > 0                 ? 'tip-partial'
                                 :                                        'tip-miss';

            tipLines.push(`<div class="tip-row ${summaryClass}">
                <span class="tip-label">MC/DC</span>
                <span class="tip-val">outcomes covered ${summaryC.covNum}/${summaryC.covDen}</span>
            </div>`);

            // per-condition rows
            for (let i = 0; i < totalCondCount; i++) {
                const missing = missMap[i] || new Set();
                const tHit    = !missing.has('true');
                const fHit    = !missing.has('false');
                const rowCls  = (tHit && fHit) ? 'tip-hit' : (tHit || fHit) ? 'tip-partial' : 'tip-miss';

                const tSpan = tHit
                    ? `<span class="outcome-hit">T: tested</span>`
                    : `<span class="outcome-miss">T: not tested</span>`;
                const fSpan = fHit
                    ? `<span class="outcome-hit">F: tested</span>`
                    : `<span class="outcome-miss">F: not tested</span>`;

                const note = (!tHit || !fHit)
                    ? `<span class="tip-note"> ← not tested: ${[...missing].join(', ')}</span>`
                    : '';

                tipLines.push(`<div class="tip-row ${rowCls}">
                    <span class="tip-label">cond ${i}</span>
                    <span class="tip-val">${tSpan} &nbsp; ${fSpan}</span>
                </div>`);
            }
        }

        if (l.type === 'uncovered') {
            tipLines.unshift(`<div class="tip-row tip-miss"><span class="tip-label">coverage</span><span class="tip-val">not executed</span></div>`);
        }

        const hasTooltip = tipLines.length > 0;
        const tipHtml = hasTooltip ? `<div class="tip">${tipLines.join('')}</div>` : '';

        // branch dots (inline, after line number)
        let dots = '';
        if (l.branches.length > 0 || l.conditions.length > 0) {
            const allItems = [
                ...l.branches.map(b => b.hit ? 'hit' : 'miss'),
                ...l.conditions
                    .filter(c => c.isSummary)
                    .map(c => c.covNum === c.covDen ? 'hit' : c.covNum > 0 ? 'partial' : 'miss')
            ];
            dots = `<span class="dots">${allItems.map(s => `<span class="dot dot-${s}"></span>`).join('')}</span>`;
        }

        const rowCls = l.type === 'covered' ? 'row-cov' : l.type === 'uncovered' ? 'row-uncov' : 'row-none';

        return `<tr class="row ${rowCls}"${hasTooltip ? ' data-tip="1"' : ''}>
  <td class="gutter">${gutter}</td>
  <td class="lno">${l.lineNo}</td>
  ${countHtml}
  <td class="code">${tipHtml}${syntaxHL(l.code)}${dots}</td>
</tr>`;
    }).join('\n');

    // stat bar items
    const statItems = [];
    statItems.push(statChip('Line', stats.linePct, stats.lineCov, stats.lineTotal));
    if (stats.branchPct !== null) statItems.push(statChip('Branch', stats.branchPct, stats.branchCov, stats.branchTotal));
    if (stats.mcdcPct   !== null) statItems.push(statChip('MC/DC',  stats.mcdcPct,  stats.mcdcCov,  stats.mcdcTotal));

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  /* ── Reset & base — inherit VS Code vars ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: var(--vscode-editor-line-height, 19px);
    overflow-x: auto;
  }

  /* ── Stat bar ── */
  .statbar {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 4px 12px;
    background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-editorGroup-border, #333);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    position: sticky;
    top: 0;
    z-index: 100;
    flex-wrap: wrap;
    gap: 2px;
  }
  .fname {
    font-weight: 600;
    color: var(--vscode-editor-foreground);
    margin-right: 12px;
    font-size: 11px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    border-radius: 3px;
    margin-right: 4px;
    border: 1px solid transparent;
  }
  .chip-label { opacity: 0.65; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
  .chip-pct   { font-weight: 700; font-size: 12px; font-variant-numeric: tabular-nums; }
  .chip-frac  { opacity: 0.6; font-size: 10px; }
  .chip-green { background: var(--vscode-testing-iconPassed, #3c763d)22; border-color: var(--vscode-testing-iconPassed, #3c763d)44; }
  .chip-green .chip-pct { color: var(--vscode-testing-iconPassed, #73c991); }
  .chip-yellow { background: var(--vscode-editorWarning-foreground, #cca700)18; border-color: var(--vscode-editorWarning-foreground, #cca700)44; }
  .chip-yellow .chip-pct { color: var(--vscode-editorWarning-foreground, #cca700); }
  .chip-red  { background: var(--vscode-testing-iconFailed, #c72e0f)18; border-color: var(--vscode-testing-iconFailed, #c72e0f)44; }
  .chip-red  .chip-pct { color: var(--vscode-testing-iconFailed, #f14c4c); }

  /* ── Code table — exact editor feel ── */
  table.ct {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
  }
  table.ct col.col-gutter { width: 3px; }
  table.ct col.col-lno    { width: 44px; }
  table.ct col.col-cnt    { width: 52px; }
  table.ct col.col-code   { width: auto; }

  .row { vertical-align: top; }
  .row:hover td { background: var(--vscode-editor-hoverHighlightBackground, rgba(128,128,128,0.07)) !important; }

  /* row tint — subtle, like editor decorations */
  .row-cov   td.code, .row-cov   td.cnt, .row-cov   td.lno { background: rgba(57,197,87,0.06); }
  .row-uncov td.code, .row-uncov td.cnt, .row-uncov td.lno { background: rgba(255,70,70,0.08); }

  /* gutter stripe */
  .gutter { padding: 0; width: 3px; }
  .g-cov   { display: block; width: 3px; height: 100%; min-height: 19px; background: var(--vscode-testing-iconPassed, #57ba57); }
  .g-uncov { display: block; width: 3px; height: 100%; min-height: 19px; background: var(--vscode-testing-iconFailed, #e05252); }
  .g-none  { display: block; width: 3px; height: 100%; min-height: 19px; }

  /* line number */
  .lno {
    text-align: right;
    padding: 0 10px 0 0;
    color: var(--vscode-editorLineNumber-foreground, #858585);
    user-select: none;
    white-space: nowrap;
    font-size: 12px;
    vertical-align: top;
    padding-top: 0;
  }
  .row-uncov .lno { color: var(--vscode-testing-iconFailed, #e05252); opacity: 0.9; }
  .row-cov   .lno { color: var(--vscode-editorLineNumber-foreground); }

  /* count */
  .cnt {
    text-align: right;
    padding: 0 8px 0 0;
    white-space: nowrap;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 11px;
    vertical-align: top;
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
  .cnt-cov   { color: var(--vscode-testing-iconPassed, #73c991); opacity: 1; }
  .cnt-uncov { color: var(--vscode-testing-iconFailed, #f14c4c); opacity: 1; font-weight: 600; }

  /* code cell */
  .code {
    padding: 0 0 0 4px;
    white-space: pre;
    position: relative;
    vertical-align: top;
    overflow: visible;
  }

  /* ── Syntax colors — VS Code Dark+ palette ── */
  .kw   { color: var(--vscode-symbolIcon-keywordForeground, #569cd6); }
  .type { color: #4EC9B0; }
  .num  { color: var(--vscode-debugTokenExpression-number, #B5CEA8); }
  .str  { color: var(--vscode-debugTokenExpression-string, #CE9178); }
  .cmt  { color: var(--vscode-editorInlayHint-foreground, #6A9955); font-style: italic; }
  .pp   { color: #C586C0; }
  .fn   { color: #DCDCAA; }
  .hex  { color: #B5CEA8; }

  /* ── Branch dots ── */
  .dots { display: inline-flex; gap: 2px; margin-left: 6px; vertical-align: middle; }
  .dot  { display: inline-block; width: 6px; height: 6px; border-radius: 50%; }
  .dot-hit     { background: var(--vscode-testing-iconPassed, #73c991); }
  .dot-miss    { background: var(--vscode-testing-iconFailed, #f14c4c); }
  .dot-partial { background: var(--vscode-editorWarning-foreground, #cca700); }

  /* ── Tooltip ── */
  .code { position: relative; }
  .tip {
    display: none;
    position: absolute;
    left: 0; top: 100%;
    background: var(--vscode-editorHoverWidget-background, #252526);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
    border-radius: 3px;
    padding: 6px 10px;
    min-width: 260px;
    max-width: 460px;
    z-index: 9999;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 12px;
    white-space: normal;
    line-height: 1.5;
    color: var(--vscode-editorHoverWidget-foreground, #ccc);
  }
  .row[data-tip="1"]:hover .tip { display: block; }
  .tip-row   { display: flex; gap: 8px; align-items: baseline; padding: 1px 0; }
  .tip-label { font-size: 10px; opacity: 0.55; min-width: 46px; text-transform: uppercase; letter-spacing: 0.3px; flex-shrink: 0; }
  .tip-val   { font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; }
  .tip-hit     .tip-val { color: var(--vscode-testing-iconPassed, #73c991); }
  .tip-miss    .tip-val { color: var(--vscode-testing-iconFailed, #f14c4c); }
  .tip-partial .tip-val { color: var(--vscode-editorWarning-foreground, #cca700); }
  .tip-fn      .tip-val { color: var(--vscode-symbolIcon-functionForeground, #DCDCAA); }
  .outcome-hit  { color: var(--vscode-testing-iconPassed, #73c991); font-weight: 700; font-size: 12px; }
  .outcome-miss { color: var(--vscode-testing-iconFailed, #f14c4c); font-weight: 700; font-size: 12px; }
  .tip-note { color: var(--vscode-editorWarning-foreground, #cca700); font-style: italic; font-size: 11px; }
</style>
</head>
<body>

<div class="statbar">
  <span class="fname">${escHtml(fileName)}</span>
  ${statItems.join('')}
</div>

<table class="ct">
  <colgroup>
    <col class="col-gutter">
    <col class="col-lno">
    <col class="col-cnt">
    <col class="col-code">
  </colgroup>
  <tbody>
${rows}
  </tbody>
</table>

</body>
</html>`;
}

function statChip(label, pct, cov, total) {
    const cls = pct >= 90 ? 'chip-green' : pct >= 70 ? 'chip-yellow' : 'chip-red';
    return `<span class="chip ${cls}"><span class="chip-label">${label}</span><span class="chip-pct">${pct}%</span><span class="chip-frac">${cov}/${total}</span></span>`;
}

// ─── Syntax highlighter ────────────────────────────────────────────────────

function syntaxHL(code) {
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // preprocessor: whole line
    if (/^\s*#/.test(code)) return `<span class="pp">${esc(code)}</span>`;

    let c = esc(code);

    // comment (line comment only in gcov snippets)
    c = c.replace(/(\/\*.*?\*\/|\/\/.*$)/g, m => `\x00cmt\x01${m}\x00/cmt\x01`);
    // strings
    c = c.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, m => `\x00str\x01${m}\x00/str\x01`);
    // hex literals
    c = c.replace(/\b(0x[0-9A-Fa-f]+(?:[Uu]|[Ll]|[UuLl][Ll])?)\b/g, m => `\x00hex\x01${m}\x00/hex\x01`);
    // keywords
    c = c.replace(/\b(if|else|for|while|do|return|switch|case|break|continue|default|goto|typedef|struct|union|enum|sizeof|static|extern|const|volatile|inline|void|register)\b/g,
        m => `\x00kw\x01${m}\x00/kw\x01`);
    // types
    c = c.replace(/\b(int|char|float|double|long|short|unsigned|signed|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t|bool|_Bool|ptrdiff_t|uintptr_t)\b/g,
        m => `\x00type\x01${m}\x00/type\x01`);
    // numbers (decimal, not inside hex already)
    c = c.replace(/(?<!\x01)(?<![0-9A-Fa-fx])\b(\d+[UuLl]*)\b/g, m => `\x00num\x01${m}\x00/num\x01`);

    // convert placeholders to spans
    c = c.replace(/\x00(\w+)\x01/g,  (_, t) => `<span class="${t}">`);
    c = c.replace(/\x00\/\w+\x01/g, '</span>');

    return c;
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtCount(n) {
    if (!n && n !== 0) return '';
    if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
    if (n >= 1000)    return (n/1000).toFixed(1)+'k';
    return String(n);
}

module.exports = { activate, deactivate };
