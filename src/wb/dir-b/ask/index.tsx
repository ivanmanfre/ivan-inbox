/* Direction B, the Ask surface. `AskPane` is the override the seam mounts on
 * desktop; `AskThread` is the shared thread the phone chrome mounts inside its
 * own frame (`../mobile` imports it from './AskThread' directly). */
export { AskThread } from './AskThread'
export { AskPane } from './AskPane'
