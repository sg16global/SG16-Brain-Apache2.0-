// The former "Friend Engine · This Device" panel ran a third-party in-browser
// model (transformers.js + SmolLM2 weights from a model hub). It is removed:
// SG16 Brain (Q4_K_M, self-hosted) is the one and only brain of this system.
//
// The empty anchor stays on purpose. The live design hides #friend-engine and
// places its "Work with Sovereign SG16 Brain" panel (site/sg16-work.js) right
// after this element, so the anchor keeps the homepage layout identical.
export function LocalFriendPanel() {
  return <section id="friend-engine" aria-hidden="true" hidden />;
}
