export interface WindowCloseState {
  dirty: boolean;
  allowClose: boolean;
  closeRequestPending: boolean;
}

export type WindowCloseDecision = "allow" | "request" | "wait";

export function getWindowCloseDecision(
  state: WindowCloseState
): WindowCloseDecision {
  if (!state.dirty || state.allowClose) {
    return "allow";
  }
  return state.closeRequestPending ? "wait" : "request";
}
