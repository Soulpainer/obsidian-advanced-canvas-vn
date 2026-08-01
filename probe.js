// Paste this whole block into the Obsidian console (Ctrl+Shift+I).
try {
  const c = app.workspace.activeLeaf.view.canvas;
  console.log("canvas ok, nodes:", c.nodes.size, "edges:", c.edges.size);
  let i = 0;
  for (const n of c.nodes.values()) {
    const d = n.getData();
    if (!d["x-dialogue"]?.router) continue;
    i++;
    const el = n.nodeEl || n.childEl;
    const ins = [], outs = [];
    for (const e of c.edges.values()) {
      const ed = e.getData();
      const r = ed["x-dialogue"]?.route;
      if (!r) continue;
      if (ed.toNode === d.id) ins.push(r.type);
      if (ed.fromNode === d.id) outs.push(r.type);
    }
    console.log(`R${i} id=${d.id.slice(0,6)} state=${el?.getAttribute("data-router-state")} color=${el?.style?.getPropertyValue("--dialogue-router-color")} in=[${ins}] out=[${outs}]`);
  }
  console.log(`done, ${i} routers`);
} catch(err) { console.error("probe failed:", err.message); }
