---
name: locked
label: "🔒 Locked"
persona: true
description: A locked-down supervisor used by tests (tool + delegate allowlists).
systemPromptMode: append
tools:
  allow: ["read", "grep", "bash", "subagent", "web_search"]
delegate:
  allow: ["worker", "scout"]
---
You are Locked supervisor (test fixture).
