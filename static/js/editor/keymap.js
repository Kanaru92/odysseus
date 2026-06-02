/**
 * Centralized, remappable keymap — single source of truth for editor
 * shortcuts, defaulting to the de-facto industry-standard bindings most
 * digital artists already have in muscle memory (see internal parity notes).
 *
 * Today this drives TOOL-selection keys (consumed by build/toolbar.js, which
 * feeds keyboard-shortcuts.js via toolKeyMap). It's structured so action
 * shortcuts and user remapping can migrate here next without scattering key
 * handling. `''`/absent = intentionally unbound (e.g. AI tools, or standard
 * tools we don't have yet so their letter stays free for when we add them).
 */

// Tool id → default key. Letters chosen to match the common industry standard
// so an artist's muscle memory carries over. Tools without a standard single
// key (free transform = Ctrl/Cmd+T) are left unbound.
export const TOOL_KEYS = {
  move: 'V',
  marquee: 'M',    // rectangular / elliptical marquee
  crop: 'C',
  brush: 'B',
  eraser: 'E',
  clone: 'S',      // clone-stamp
  lasso: 'L',
  wand: 'W',       // magic wand
  quickselect: '', // quick-selection drag-flood (shares W in PS — left unbound)
  eyedropper: 'I', // eyedropper / color sampler
  gradient: 'G',   // gradient tool (shares G with the bucket)
  text: 'T',       // type / text tool (PS standard)
  bucket: '',      // paint bucket / flood fill (shares G with gradient — left unbound)
  // Tools not yet built — letters reserved so the binding is correct the day
  // they land (keeps us from squatting standard letters on unrelated tools):
  //   marquee:'M', eyedropper:'I', gradient/bucket:'G', heal:'J',
  //   pen:'P', text:'T', shape:'U', hand:'H', zoom:'Z', dodge/burn:'O'
  // AI / non-standard tools — intentionally unbound:
  transform: '',
  inpaint: '',
  rembg: '',
  sharpen: '',
  liquify: '', // forward-warp deform — bound to Ctrl+Shift+X in keyboard-shortcuts.js (no single key)
  distort: '', // free 4-corner warp (part of free transform — no single key)
  pcrop: '',   // perspective crop (de-skew a quad — no standard single key)
  smudge: '',  // smear / finger-paint (grouped with blur/sharpen — no single key)
  mixer: '',   // mixer brush (wet-paint blending; shares B in PS — left unbound)
  dodgeburn: 'O', // dodge / burn / sponge (standard tonal-brush key)
  heal: 'J',      // spot healing brush (PS healing-tool key)
};

// Non-tool action shortcuts that are already standard elsewhere
// (keyboard-shortcuts.js) — documented here as the migration target:
//   Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+S save · Ctrl+T free transform
//   [ / ] brush size · X swap fg/bg · D default colors · Tab hide panels
//   1-9 opacity · Ctrl+Alt+I invert selection · Ctrl+D deselect
export const ACTION_KEYS = {
  brushSizeDown: '[',
  brushSizeUp: ']',
  hardnessDown: '{',
  hardnessUp: '}',
  swapColors: 'X',
  defaultColors: 'D',
  togglePanels: 'Tab',
};

/** Resolve a tool's display key from the active keymap (falsy = unbound). */
export function toolKey(toolId) {
  return TOOL_KEYS[toolId] || '';
}
