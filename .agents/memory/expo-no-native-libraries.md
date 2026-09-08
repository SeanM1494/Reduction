---
name: Expo Go native-library restriction
description: Constraint on adding native Expo modules mid-task, and the general fallback strategy.
---

The `expo` skill forbids adding native libraries beyond what Expo Go ships pre-installed (or JS-only packages) unless the project moves to an EAS development build.

**Why:** Expo Go can only run modules it was compiled with; adding a new native module requires rebuilding the dev client (EAS build), which is a bigger step than a normal code change and shouldn't be taken silently mid-task.

**How to apply:** Before relying on any native module, check the expo skill's allowed-library list first. If a needed capability isn't covered, don't add the module — ship the closest JS-only/foreground equivalent and record the full capability as a disclosed follow-up task rather than a silent scope cut.
