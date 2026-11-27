// The look registry. A look owns everything visual about kinetic captions —
// fonts, palette, footage treatment, caption motion and its hero moment — on
// top of the shared core (transcript, timing, heroes, energy, camera hit).
// Interface: { id, summary, fonts: [roles], palette, energy?, zone?, uppercase?,
//   build(api) → { layout(p), front(g,t,tq,p,hit), behind?(…), onSubject?(…),
//   footage?(g,t,frame,hit), hit?(g,t,hit,frame), post?(g,t,hit), panelFrame?, samplesHint?,
//   ownSubject? (the look draws the cut-out itself), subjectFilter?(t,p,hit) → CSS filter for the core's cut-out } }
import cover from './cover.js';
import neon from './neon.js';
import noir from './noir.js';
import poster from './poster.js';
import terminal from './terminal.js';
import swiss from './swiss.js';
import riso from './riso.js';
import cinema from './cinema.js';
import marker from './marker.js';

export const LOOKS = Object.fromEntries([cover, neon, noir, poster, terminal, swiss, riso, cinema, marker].map((l) => [l.id, l]));
export const LOOK_IDS = Object.keys(LOOKS);
