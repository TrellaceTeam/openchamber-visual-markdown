// Scratch: list the rules OpenChamber appends to every extension page that are not scoped to its
// own `.oc-` classes, since those can restyle the editor.
import { GUEST_SCROLLBAR_CSS } from '@openchamber/sdk';
import { GUEST_UI_LOOK_CSS } from '@openchamber/sdk/ui';

const css = `${GUEST_SCROLLBAR_CSS}\n${GUEST_UI_LOOK_CSS}`;
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}');
for (const rule of rules) {
  const [selector, body] = rule.split('{');
  if (!body) continue;
  const bare = selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !part.includes('.oc-') && !part.startsWith('@'));
  if (bare.length > 0) console.log(`${bare.join(', ')} { ${body.trim().slice(0, 220)} }`);
}
console.log('total chars', css.length);
