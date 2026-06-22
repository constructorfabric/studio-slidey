// Stub for the headless RENDER bundle: video scenes render node-side, so the
// live RrwebPlayer (and rrweb itself) is never invoked here. Keeping rrweb out
// of dist-render avoids bloating the self-contained bundle and tripping the
// inline-render guard on rrweb_source strings like rel="stylesheet".
export const Replayer = undefined;
export const record = undefined;
export default {};
