# Bug Findings

No open findings.

Every defect the audit established has been fixed in the working tree. Nine in
total across two rounds: three in the scene's settle, verdict and throw-deferral
paths; an unbounded stored `playerCount` reaching a renderer as an array length;
a join code checked for length but not for its alphabet; a multi-touch guard
that could not see a finger placed while the turn was closed; a throw replayed
after the verdict that had already judged it; a refusal the alert region never
announced twice; and a colour palette that stayed live while the rest of the
lobby was disabled — plus the fan-ring geometry and the camera, fog and focus
findings this file previously carried.

## Summary

Findings by severity: Critical 0, High 0, Medium 0, Low 0.

Findings by confidence: High 0, Medium 0, Low 0.

| Severity | High | Medium | Low |
| --- | --- | --- | --- |
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 0 | 0 | 0 |
| Low | 0 | 0 | 0 |

One candidate remains **unverified** rather than fixed, and is deliberately not
listed above as a finding: a throw record for sequence N+1 arriving before the
match document carrying verdict N would have its dice deleted by the verdict
replay's whole-state restore. The mechanism is established in code; what could
not be established by reading is whether Firestore can deliver two independent
snapshot listeners out of commit order across a gap that normally spans a whole
turn. The check that would settle it: instrument `DishScene.applyThrow` to log
whenever a throw arrives while `resolution` or `pending` is set, then run a
three-player match with one tab backgrounded for about fifteen seconds.
