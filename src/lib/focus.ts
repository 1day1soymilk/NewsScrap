// The opacity of everything that has receded in focus mode.
//
// The canvas (KeywordGraph) and the event list (EventList) use the same value
// because they perform the same gesture. A second copy would let one of them be
// tuned alone, and the screen would then recede at two different strengths —
// the same hazard the colour constants already record.
export const UNFOCUSED_OPACITY = 0.1
