# dsh-qtc-taste

Adds a **Personalization** page to DeepSeek Harness: write your own standing instructions once, and the model follows them in every conversation.

For example:

- Lead with the conclusion, then explain in clear paragraphs
- Skip jargon; match the depth to what I already know
- Make reasonable decisions yourself; finish long tasks in one go
- Don't over-invest in simple tasks

Write it once and every new session picks it up. No repeating yourself.

---

## What you get

One master switch plus any number of entries. Each entry can be enabled, disabled, reordered, edited, and deleted on its own.

- **Applies immediately** — save an edit and your next message already follows it; no restart
- **Verbatim** — whatever you write is what gets used. Code snippets and templates with braces are safe
- **Draft-friendly** — leave an unfinished entry switched off; the text is kept

---

## How to use it

### 1. Open Settings

Open **Settings** (the gear in the bottom-left). A new **Personalization** item appears in the left column.

### 2. Add an entry

Click **Add block** and fill in two fields:

| Field | What goes there |
|---|---|
| Title | What the entry is about, e.g. "Response style" or "About me". For your eyes only. |
| Body | The actual requirement. Multi-line, any structure. |

### 3. Apply it

Click **Save**.

The buttons work like this:

- **Save** — only clickable when something changed; shows "Saved" when done
- **Revert** — undo everything back to the last save
- **Unsaved changes** — appears while you have edits that aren't written yet
- **Master switch** ("Inject personal preferences") — pauses everything at once; the text is kept

### 4. Check it worked

Send any message and ask "what personal preferences are you following right now?" If it repeats your text back, it's live.

### 5. Adjust

- Try one entry at a time: switch the others off
- Reorder: the up/down arrows on each row
- Remove: the trash icon, with a confirmation first

> **Note**: adding, editing, and deleting all happen on the page first — nothing is written until you click **Save**. Close Settings without saving and the changes are gone. If you can see the "Unsaved changes" tag, it isn't written yet.

---

## Install

### Option 1: from the Harness UI (recommended)

1. Open **Settings → Plugins**
2. Click **Add plugin** in the top right
3. Paste this and confirm:

```
git+ssh://git@github.com/Terie412/dsh-qtc-taste.git
```

The plugin appears in the list as **Personal prompt**, and a **Personalization** page shows up in Settings.

### Option 2: command line

```
dsh plugin add "git+ssh://git@github.com/Terie412/dsh-qtc-taste.git"
```

### Installed but nothing shows up?

- Check that **Personal prompt** is switched on in the plugin list
- Quit Harness completely and reopen it
- The page lives in **Settings → Personalization**, not inside the Plugins page

### Uninstall

Settings → Plugins → **Personal prompt** → uninstall.

Your entries stay on disk and come back if you reinstall.

---

## Details

### Where the text is stored

```
<DSH_HOME>/storages/dsh-qtc-taste/taste.json
```

On Windows that is usually `C:\Users\<you>\.dsh\storages\dsh-qtc-taste\taste.json`.

The page footer shows the real path so you can copy it.

- To back up, copy that file
- To move machines, copy it to the same place
- To edit by hand, edit the JSON directly — the next message picks it up

### Limits

Up to 50 entries, 20000 characters each, 120000 in total. The footer counts as you type; a save that exceeds the total is refused with a message.

Realistically you will never approach this.

### Where it lands

In the system prompt — the part the model reads every turn — not in your message.

It sits after tool guidance and before the persona suffix, so your preferences outrank general style guidance but **cannot override hard rules** such as how a tool actually behaves, or the facts of the task.

### One tip

Write **concrete and actionable**, not abstract adjectives.

- Good: "Lead with the conclusion, then explain in up to three points, two sentences each"
- Weak: "Be professional, clear, and organized"

Models follow specific instructions far more reliably than adjectives.

---

## What it does not do

- **Doesn't touch your chat history** — injection changes what the model reads, not what you see
- **Doesn't edit your config** — it only reads and writes its own JSON file, never Harness's own configuration files
- **No network access** — fully local
- **No telemetry** — nothing is collected or reported

---

## Feedback

Questions or feature requests: [Issues](https://github.com/Terie412/dsh-qtc-taste/issues).
