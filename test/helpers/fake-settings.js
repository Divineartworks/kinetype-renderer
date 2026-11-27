// A simulated Android 15 Settings app for `device-locale` tests: realistic uiautomator dumps per screen (English or
// Norwegian UI), taps hit-tested against the dumped bounds, `input text` into the search field, `input draganddrop`
// on the language list, and the settings/getprop the tool verifies with.
const P = 'com.android.settings';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const node = (n) => `<node index="0" text="${esc(n.text || '')}" resource-id="${n.id || ''}" class="${n.cls || 'android.widget.TextView'}" package="${P}" content-desc="${esc(n.desc || '')}" checkable="false" checked="false" clickable="${n.click ? 'true' : 'false'}" enabled="true" focusable="${n.click ? 'true' : 'false'}" focused="${n.focused ? 'true' : 'false'}" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[${n.b[0]},${n.b[1]}][${n.b[2]},${n.b[3]}]" />`;
const page = (nodes) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${P}" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">${nodes.map(node).join('')}</node></hierarchy>`;

const L = {
  en: { languages: 'Languages', system: 'System languages', app: 'App languages', keyboard: 'Keyboard', add: '+ Add a language', addTitle: 'Add a language', search: 'Search', suggested: 'Suggested', all: 'All languages', change: 'Change', keep: 'Keep current', dialog: (l) => `Change system language to ${l}?`, remove: 'Remove' },
  nb: { languages: 'Språk', system: 'Systemspråk', app: 'Appspråk', keyboard: 'Tastatur', add: '+ Legg til et språk', addTitle: 'Legg til et språk', search: 'Søk', suggested: 'Foreslåtte', all: 'Alle språk', change: 'Endre', keep: 'Behold gjeldende', dialog: (l) => `Vil du endre systemspråket til ${l}?`, remove: 'Fjern' },
};
const NAME = { 'en-US': 'English (United States)', 'nb-NO': 'Norsk bokmål (Norge)' };

export function fakeSettings({ locales = ['en-US'], ui = null } = {}) {
  const st = { locales: [...locales], screen: 'home', query: '', log: [], picked: null };
  const lang = () => L[ui || (st.locales[0].startsWith('nb') ? 'nb' : 'en')];
  const screens = {
    home: () => [{ text: 'Home', b: [0, 0, 1080, 200] }],
    languages: () => { const t = lang(); return [{ text: t.languages, b: [48, 200, 600, 290] }, { text: t.system, id: 'android:id/title', click: true, b: [48, 380, 1032, 450], go: 'system' }, { text: NAME[st.locales[0]], id: 'android:id/summary', b: [48, 450, 1032, 500] }, { text: t.app, id: 'android:id/title', click: true, b: [48, 560, 1032, 630] }, { text: t.keyboard, id: 'android:id/title', click: true, b: [48, 740, 1032, 810] }]; },
    system: () => { const t = lang(); return [{ text: t.system, b: [48, 200, 700, 290] }, { desc: t.remove, click: true, b: [960, 120, 1060, 200] }, { id: `${P}:id/dragList`, cls: 'androidx.recyclerview.widget.RecyclerView', b: [0, 320, 1080, 320 + 150 * st.locales.length] },
      ...st.locales.map((l, i) => ({ text: NAME[l], id: `${P}:id/label`, b: [180, 340 + 150 * i, 900, 420 + 150 * i], row: l })),
      { text: t.add, id: `${P}:id/add_language`, click: true, b: [48, 360 + 150 * st.locales.length, 1032, 460 + 150 * st.locales.length], go: 'picker' }]; },
    picker: () => { const t = lang(); return [{ text: t.addTitle, b: [160, 200, 800, 290] }, { desc: t.search, id: `${P}:id/search`, click: true, b: [940, 200, 1040, 290], go: 'search' }, { text: t.suggested, b: [48, 340, 600, 400] }, { text: 'English (United Kingdom)', click: true, b: [48, 420, 1032, 500] }, { text: t.all, b: [48, 560, 600, 620] }, ...['Afrikaans', 'Azərbaycan', 'Bahasa Indonesia', 'Català', 'Čeština', 'Dansk', 'Deutsch'].map((x, i) => ({ text: x, click: true, b: [48, 640 + 110 * i, 1032, 720 + 110 * i] }))]; },
    search: () => { const t = lang(); const res = st.query ? ['Norsk bokmål', 'Norsk nynorsk'].filter((x) => x.toLowerCase().includes(st.query.toLowerCase())) : []; return [{ text: st.query || t.search, id: `${P}:id/search_src_text`, cls: 'android.widget.EditText', click: true, focused: true, b: [160, 200, 900, 290] }, { text: t.all, b: [48, 340, 600, 400] }, ...res.map((x, i) => ({ text: x, click: true, b: [48, 420 + 110 * i, 1032, 500 + 110 * i], pick: x }))]; },
    region: () => [{ text: st.picked, b: [160, 200, 800, 290] }, { text: 'Norge', click: true, b: [48, 340, 1032, 420], region: 'nb-NO' }, { text: 'Svalbard og Jan Mayen', click: true, b: [48, 450, 1032, 530], region: 'nb-SJ' }],
    dialog: () => { const t = lang(); return [{ text: t.dialog(NAME['nb-NO']), b: [100, 900, 980, 1000] }, { text: t.keep, cls: 'android.widget.Button', click: true, b: [120, 1200, 520, 1290], keep: true }, { text: t.change, cls: 'android.widget.Button', click: true, b: [560, 1200, 960, 1290], change: true }]; },
  };
  const hit = (x, y) => screens[st.screen]().filter((n) => n.click && x >= n.b[0] && x <= n.b[2] && y >= n.b[1] && y <= n.b[3]).sort((a, b) => (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]) - (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]))[0];
  return {
    state: st,
    async dump() { return page(screens[st.screen]()); },
    async sh(argv) {
      st.log.push(argv.join(' '));
      const [a, b, c, d] = argv;
      if (a === 'settings' && b === 'get' && d === 'system_locales') return st.locales.join(',');
      if (a === 'getprop' && b === 'persist.sys.locale') return st.locales[0] === 'en-US' && locales[0] === 'en-US' && !st.changed ? '' : st.locales[0];
      if (a === 'am' && b === 'start') { st.screen = 'languages'; return 'Starting: Intent'; }
      if (a === 'input' && b === 'keyevent') { st.screen = 'home'; return ''; }
      if (a === 'input' && b === 'text') { if (st.screen === 'search') st.query += c.replace(/%s/g, ' '); return ''; }
      if (a === 'input' && b === 'draganddrop') {
        const [x1, y1, , y2] = argv.slice(2).map(Number);
        if (st.screen !== 'system') return '';
        const rows = screens.system().filter((n) => n.row);
        const from = rows.find((n) => y1 >= n.b[1] && y1 <= n.b[3]);
        if (from && y2 < rows[0].b[3]) { st.locales = [from.row, ...st.locales.filter((l) => l !== from.row)]; st.changed = true; }
        void x1; return '';
      }
      if (a === 'input' && b === 'tap') {
        const n = hit(Number(c), Number(d));
        if (!n) return '';
        if (n.go) st.screen = n.go;
        else if (n.pick) { st.picked = n.pick; st.screen = 'region'; }
        else if (n.region) { if (!st.locales.includes(n.region)) st.locales.push(n.region); st.screen = 'dialog'; }
        else if (n.change) { st.locales = ['nb-NO', ...st.locales.filter((l) => l !== 'nb-NO')]; st.changed = true; st.screen = 'system'; }
        else if (n.keep) st.screen = 'system';
        return '';
      }
      return '';
    },
  };
}
