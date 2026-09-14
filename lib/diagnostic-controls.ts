/** Mounted only for explicit diagnostic sessions; no background DOM updates. */
export function diagnosticControls(
  snapshot: () => {
    samples: { kind: string; at: number; values: Record<string, unknown> }[];
    [key: string]: unknown;
  },
  restartContext: () => void,
  replay: (mode: 'short' | 'endurance' | 'stop') => void,
) {
  const panel = document.createElement('details');
  panel.dataset.diagnosticControls = '';
  panel.style.cssText =
    'position:fixed;z-index:10000;top:8px;right:8px;max-width:480px;max-height:65vh;overflow:auto;background:#101725;color:#fff;padding:10px;font:14px monospace;pointer-events:auto';
  const title = document.createElement('summary');
  title.textContent = 'Diagnostic local';
  panel.appendChild(title);
  const output = document.createElement('pre');
  output.dataset.diagnosticSnapshot = '';
  output.style.cssText = 'white-space:pre-wrap;font-size:12px';
  let json = '';
  const capture = () => {
    const data = snapshot();
    json = JSON.stringify(data, null, 2);
    const frames = data.samples.filter((sample) => sample.kind === 'frame');
    output.textContent = JSON.stringify(
      {
        ...data,
        samples: frames.slice(-2),
        retainedEvents: data.samples.length,
      },
      null,
      2,
    );
  };
  const button = (label: string, action: () => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.style.cssText =
      'display:block;padding:8px;border:1px solid #728097;margin:6px 0';
    element.onclick = action;
    panel.appendChild(element);
  };
  button('Afficher la capture', capture);
  const download = () => {
    // Download the displayed snapshot, so inspection and export are identical.
    if (!json) capture();
    const url = URL.createObjectURL(
      new Blob([json], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'astra-diagnostics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  button('Télécharger la capture', download);
  button('Tester la restauration WebGL', restartContext);
  button('Parcours de référence × 3', () => replay('short'));
  button('Endurance 15 min', () => replay('endurance'));
  button('Arrêter le parcours', () => replay('stop'));
  let backgroundTab: Window | null = null;
  let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
  button('Tester l’arrière-plan (35 s)', () => {
    if (backgroundTab && !backgroundTab.closed) return;
    backgroundTab = window.open('about:blank', '_blank');
    if (!backgroundTab) {
      output.textContent = 'Onglet de test bloqué par le navigateur.';
      return;
    }
    backgroundTab.document.title = 'ASTRA — test arrière-plan';
    backgroundTab.document.body.textContent =
      'Test local ASTRA. Cet onglet se ferme automatiquement après 35 secondes.';
    backgroundTab.focus();
    backgroundTimer = setTimeout(() => {
      backgroundTab?.close();
      backgroundTab = null;
    }, 35000);
  });
  panel.appendChild(output);
  document.body.appendChild(panel);
  window.addEventListener('astra:export-diagnostics', download);
  return () => {
    clearTimeout(backgroundTimer);
    backgroundTab?.close();
    window.removeEventListener('astra:export-diagnostics', download);
    panel.remove();
  };
}
