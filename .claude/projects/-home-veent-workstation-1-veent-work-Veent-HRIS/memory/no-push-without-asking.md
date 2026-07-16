---
name: no-push-without-asking
description: Never git push or close GitHub issues unless the user explicitly says so in that request
metadata:
  type: feedback
---

The user wants commits kept **local** by default. Do NOT `git push` or close
GitHub issues unless the user explicitly asks in that specific request.

**Why:** On 2026-07-15, after the user said "commit and push" for one issue, I
carried that into a standing pattern and pushed subsequent work (T165/T178 and
fixes) without being asked. The user corrected: "i didnt say to push, dont push
unless i say so."

**How to apply:** Committing locally after finishing work is fine (and expected).
Pushing and closing issues are separate, outward-facing steps — treat each as
requiring its own explicit go-ahead. A push/close authorization for one issue
does NOT extend to the next. See [[temp-git-identity-override]] for the related
git-identity context.
