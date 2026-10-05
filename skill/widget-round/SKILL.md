---
name: widget-round
description: Ask the user a question with visual options through the Claude Widget — one self-contained HTML page (a short description and one question or a group of them, the options drawn side by side) that the user answers in a window on their desktop; the answer comes back to you on its own. Use when a decision is easier made by seeing the options — UI looks, layouts, designs, diagrams, anything visual or rich — or when the user asks to be asked visually.
---

# Ask through the widget

The Claude Widget (the pixel cat on the user's desktop) shows your session as asking, chirps once,
and opens your page in a window centred on the user's monitor when they press «Відповісти». Their
answer reaches you through a background waiter — no polling, no copy-paste.

## Steps

1. **Where the page goes** (Bash):

   ```bash
   "$LOCALAPPDATA/ClaudeWidget/bin/claude-widget-hook.exe" where
   ```

   It prints this session's round folder (it uses `CLAUDE_CODE_SESSION_ID`, which Claude Code sets).

2. **Write the page** as `<folder>/<name>.html` — `<name>` is letters, digits, `-` and `_`. Start from
   `~/.claude/skills/widget-round/round-template.html` and keep its structure:
   - `<title>` — short; it is what the widget row and the window title show;
   - the description block: what we decide, and what to look at;
   - one `.q` block per question, numbered (`data-q`); its context in one or two lines of facts;
   - one `.card` per option (`data-v` = its letter) with the option **drawn** in `.vis` (HTML, inline
     SVG or canvas — the real look, not a description); add class `wide` to give a big option a whole
     row, so options can differ in size; mark the one you recommend «раджу» and say why in a line;
     a couple of short pluses and minuses each;
   - the «Свій варіант або коментар» textarea under each question.

   One file, fully self-contained: inline CSS, JS and SVG, no CDN or network. UI text in the user's
   language. Keep the template's send script: it POSTs `{page: location.pathname, text}` to `/answer`.
   A page a project already made that links shared files (a design kit) can go too — as a
   self-contained copy with those files inlined, as long as its send button POSTs the same `/answer`.
   Technical choices the user never sees are yours to make — don't ask them.

3. **Wait in the background** (Bash with `run_in_background: true`):

   ```bash
   "$LOCALAPPDATA/ClaudeWidget/bin/claude-widget-hook.exe" wait <name>
   ```

   Then tell the user in one line that the question is waiting in the widget, and end the turn (or go
   on with other work). When they send, the waiter prints `ANSWER to <name>:` followed by their answer
   and exits — that notification *is* the user's reply.

4. **Read the answer**: one line per question, `1 — A`, with `  коментар: …` under it when they wrote
   one. Act on it; if you ask again, ask only what is still open, in a new page with a new name.

The answer is also kept next to the page as `<name>.answer.md`. If the widget is not running, the
round simply waits until it is.
