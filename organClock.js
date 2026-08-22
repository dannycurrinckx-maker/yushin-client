// Orgaanklok (Zi Wu Liu Zhu) — data + SVG-rendering, verbatim overgenomen
// uit extracted.js (const ORGAN_CLOCK, clockSegId, renderOrganClockSVG) voor
// de nieuwe SaaS-client (taak #72). Puur presentationeel: de server bepaalt
// WELKE segment-id's gemarkeerd zijn (result.clockHighlights), deze data
// bepaalt enkel hoe dat getekend wordt.

const ORGAN_CLOCK = [
  {h1:21,h2:23,organ:"Pericard",   note:"Stress, Shen"},
  {h1:23,h2:25,organ:"Galblaas",   note:"Besluiteloosheid, Shao Yang"},
  {h1:25,h2:27,organ:"Lever",      note:"Qi-stagnatie, Vuur, emoties"},
  {h1:27,h2:29,organ:"Long",       note:"Verdriet, Wei Qi, Yin"},
  {h1:29,h2:31,organ:"Dikke Darm", note:"Eliminatie, loslaten"},
  {h1:31,h2:33,organ:"Maag",       note:"Ontvangst van Qi, voeding"},
  {h1:33,h2:35,organ:"Milt",       note:"Qi-productie, concentratie"},
  {h1:35,h2:37,organ:"Hart",       note:"Shen, circulatie"},
  {h1:37,h2:39,organ:"Dunne Darm", note:"Assimilatie"},
  {h1:39,h2:41,organ:"Blaas",      note:"Vochtmetabolisme"},
  {h1:41,h2:43,organ:"Nier",       note:"Jing, vitaliteit"},
  {h1:43,h2:45,organ:"Pericard",   note:"Ontspanning, relaties"}
];
function clockSegId(h1,h2){
  const p = n => String(n%24).padStart(2,"0");
  return p(h1) + "-" + p(h2);
}
/* Bouwt de orgaanklok als SVG-ringdiagram op (polygon-sectoren i.p.v. arc-paden,
   zodat er geen ambiguïteit is over large-arc/sweep-flags). highlightSet bevat
   segId's ("hh-hh") die uit de antwoorden van de patiënt naar voren kwamen. */
function renderOrganClockSVG(size, highlightSet){
  highlightSet = highlightSet || new Set();
  const cx = size/2, cy = size/2, rOut = size*0.46, rIn = size*0.26;
  const toXY = (r, hourRaw) => {
    const a = (hourRaw/24)*2*Math.PI - Math.PI/2;
    return [cx + r*Math.cos(a), cy + r*Math.sin(a)];
  };
  let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Orgaanklok">`;
  ORGAN_CLOCK.forEach(seg=>{
    const segId = clockSegId(seg.h1, seg.h2);
    const isHi = highlightSet.has(segId);
    const steps = 8;
    const outerPts = [], innerPts = [];
    for(let i=0;i<=steps;i++){
      const h = seg.h1 + (seg.h2-seg.h1)*i/steps;
      outerPts.push(toXY(rOut, h));
      innerPts.push(toXY(rIn, h));
    }
    const pts = outerPts.concat(innerPts.reverse()).map(p=>p[0].toFixed(2)+","+p[1].toFixed(2)).join(" ");
    const fill = isHi ? "#D9A24B" : "#F2EFEA";
    svg += `<polygon points="${pts}" fill="${fill}" stroke="#1E2A24" stroke-width="1"/>`;
    const amid = ((seg.h1+seg.h2)/2/24)*2*Math.PI - Math.PI/2;
    const rmid = (rOut+rIn)/2;
    const lx = cx + rmid*Math.cos(amid), ly = cy + rmid*Math.sin(amid);
    const labelColor = isHi ? "#3A2E20" : "#1E2A24";
    svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(8,size*0.032).toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" fill="${labelColor}" font-weight="${isHi?700:500}">${seg.organ}</text>`;
    const [tx,ty] = toXY(rOut + size*0.05, seg.h1);
    svg += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(7,size*0.026).toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" fill="#8a97a3">${String(seg.h1%24).padStart(2,"0")}</text>`;
  });
  svg += `<circle cx="${cx}" cy="${cy}" r="${rIn*0.62}" fill="#ffffff" stroke="#dfe4e8" stroke-width="1"/>`;
  svg += `<text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="${Math.max(9,size*0.036).toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" fill="#8B1E1E" font-weight="700">Orgaan-</text>`;
  svg += `<text x="${cx}" y="${cy+10}" text-anchor="middle" font-size="${Math.max(9,size*0.036).toFixed(1)}" font-family="Segoe UI, Arial, sans-serif" fill="#8B1E1E" font-weight="700">klok</text>`;
  svg += `</svg>`;
  return svg;
}

/* ---------- Vraag/antwoord-data, rechtstreeks getranscribeerd uit "10+2 tcm.pdf" ---------- */

