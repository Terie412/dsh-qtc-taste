# dsh-qtc-taste

Write your requirements into the system prompt, and the model follows them every turn. Write once, applies to every conversation.

## Features

- **Independent switches** — enable or disable each preference on its own, so you can test one at a time
- **Applies immediately** — save an edit and your next message already follows it; no restart
- **Verbatim** — code snippets and templates with braces are safe
- **Draft-friendly** — leave an unfinished entry switched off; the text is kept

## Install

Settings → Plugins → Add plugin, paste:

```
git+ssh://git@github.com/Terie412/dsh-qtc-taste.git
```

Or from the CLI:

```
dsh plugin add "git+ssh://git@github.com/Terie412/dsh-qtc-taste.git"
```

A **Personalization** page appears in Settings.

## Usage

1. Open **Settings → Personalization**
2. Click **Add block**, fill in a title and body
3. Click **Save**

Come back and edit anytime — just remember to save.

## What makes it work

Write concrete instructions, not adjectives.

✅ "Lead with the conclusion, then explain in up to three points, two sentences each"

❌ "Be professional, clear, and organized"

## Examples

**Response style**

```
Lead with the conclusion, then explain in paragraphs.
Pace the depth to what I already know; skip the jargon.
```

**Working style**

```
Make reasonable decisions yourself instead of asking repeatedly.
Finish long tasks in one go unless I ask for stages.
Don't over-invest in simple tasks.
```

---

Questions or requests: [Issues](https://github.com/Terie412/dsh-qtc-taste/issues).
