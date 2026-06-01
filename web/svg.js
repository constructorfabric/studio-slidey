// SLIDEY — diagram-svg geometry solver
//
// Faithful port of `_renderSvgPanel` from src/template.html. Instead of building
// an HTML string it returns structured render data (nodes/edges as plain
// objects) that DiagramSvgScene.vue renders with v-for. The endpoint/anchor math
// is unchanged so the resulting SVG geometry matches the original pixel-for-pixel.

export function buildPanel(panel, idx) {
  const viewBox  = panel.viewBox || '0 0 400 360';
  const nodes    = panel.nodes || [];
  const nodeMap  = Object.fromEntries(nodes.map(n => [n.id, n]));
  const markerId = `arrow-${idx}`;

  const renderNodes = nodes.map(n => {
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;

    const stack = [];
    if (n.label) stack.push({ text: n.label, cls: 'dsvg-label', lh: 50 });
    if (n.sub)   stack.push({ text: n.sub,   cls: 'dsvg-sub',   lh: 34 });
    (n.lines || []).forEach(t => stack.push({ text: t, cls: 'dsvg-line', lh: 32 }));

    const totalH = stack.reduce((s, l) => s + l.lh, 0);
    let y = cy - totalH / 2 + (stack[0] ? stack[0].lh / 2 : 0);
    const texts = stack.map(l => {
      const el = { cls: l.cls, x: cx, y, text: l.text };
      y += l.lh;
      return el;
    });

    return {
      groupClass: `dsvg-node dsvg-style-${n.style || 'default'}`,
      rect: { x: n.x, y: n.y, w: n.w, h: n.h },
      texts,
    };
  });

  const renderEdges = (panel.edges || []).map(e => {
    const from = nodeMap[e.from], to = nodeMap[e.to];
    if (!from || !to) return null;

    const fromCx = from.x + from.w / 2, fromCy = from.y + from.h / 2;
    const toCx   = to.x   + to.w   / 2, toCy   = to.y   + to.h   / 2;
    const dx = toCx - fromCx, dy = toCy - fromCy;
    const offset = e.side === 'left' ? -32 : (e.side === 'right' ? 32 : 0);

    let x1, y1, x2, y2;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      if (dx > 0) { x1 = from.x + from.w; x2 = to.x; }
      else        { x1 = from.x;          x2 = to.x + to.w; }
      y1 = fromCy + offset;
      y2 = toCy   + offset;
    } else {
      if (dy > 0) { y1 = from.y + from.h; y2 = to.y; }
      else        { y1 = from.y;          y2 = to.y + to.h; }
      x1 = fromCx + offset;
      x2 = toCx   + offset;
    }

    const labelX = (x1 + x2) / 2 + (horizontal ? 0 : (e.side === 'left' ? -10 : (e.side === 'right' ? 10 : 0)));
    const labelY = (y1 + y2) / 2 + (horizontal ? -10 : 0);
    const anchor = (!horizontal && e.side === 'left')  ? 'end'
                 : (!horizontal && e.side === 'right') ? 'start'
                 : 'middle';

    if (e.gate) {
      const gateText = e.gate;
      const gateBarReach = e.highlighted ? 75 : 90;
      const gateGap = e.highlighted
        ? gateText.length * 11 + 27
        : gateText.length * 9  + 22;
      const hl = e.highlighted ? ' dsvg-highlighted' : '';
      return {
        type: 'gate',
        barClass: `dsvg-gate-bar${hl}`,
        textClass: `dsvg-edge-gate${hl}`,
        bar1: { x1: labelX - gateBarReach - gateGap, y1: labelY, x2: labelX - gateGap, y2: labelY },
        bar2: { x1: labelX + gateGap, y1: labelY, x2: labelX + gateBarReach + gateGap, y2: labelY },
        text: gateText, labelX, labelY,
        dim: !!e.dim,
      };
    }

    return {
      type: 'arrow',
      line: { x1, y1, x2, y2 },
      markerId,
      label: e.label || null,
      labelX, labelY, anchor,
      dim: !!e.dim,
    };
  }).filter(Boolean);

  return {
    viewBox,
    markerId,
    label: panel.label || null,
    caption: panel.caption || null,
    nodes: renderNodes,
    edges: renderEdges,
  };
}

export function buildPanels(scene) {
  return (scene.panels || []).map((p, i) => buildPanel(p, i));
}
