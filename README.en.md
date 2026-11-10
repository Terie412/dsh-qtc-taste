# dsh-qtc-taste

Two small tools for DSH: write your requirements into the system prompt, and check at a glance whether DSH is working hard.

## Features

### Personal prompt

- **Independent switches** — enable or disable each preference on its own, so you can test one at a time
- **Applies immediately** — save an edit and your next message already follows it; no restart
- **Verbatim** — code snippets and templates with braces are safe
- **Draft-friendly** — leave an unfinished entry switched off; the text is kept

### Performance panel

A gauge icon appears in the sidebar; click it for a live panel. The right column's start list gains a **Performance** entry too, so you can open it as a right-side tab and keep working beside it.

- **CPU** — machine-wide usage and this DSH process's own share, with a strip of recent samples
- **Memory** — the **whole application** (all processes combined, matching Task Manager) leads, with a per-process breakdown underneath: main, renderer, GPU and network service, with the host process marked. JS heap, off-heap and machine memory sit beside it
- **Storage** — the disk's total and free space, plus a per-directory breakdown of the DSH data home
- **Health** — event-loop delay (is it stalling?), process uptime, Node version

> Why memory is split up: the single row Task Manager shows for this app is the combined total (main process, renderers, GPU, network service and every subprocess), so reporting only the host understates it by roughly half. The panel leads with the combined figure and breaks it down by process, so it is clear which one is using the memory.

The panel refreshes once a second while it is open and samples nothing while it is closed. Pause or refresh manually from the toolbar. The right column is narrow, so the same content switches to a single column there.

## Install

Settings → Plugins → Add plugin, paste:

```
git+ssh://git@github.com/Terie412/dsh-qtc-taste.git
```

Or from the CLI:

```
dsh plugin add "git+ssh://git@github.com/Terie412/dsh-qtc-taste.git"
```

A **Personalization** page appears in Settings, a **Performance** icon in the sidebar, and a **Performance** entry in the right column's start list.

## Usage

### Write preferences

1. Open **Settings → Personalization**
2. Click **Add block**, fill in a title and body
3. Click **Save**

Come back and edit anytime — just remember to save.

### Watch performance

Two ways in:

- Click the gauge icon in the left sidebar to fill the centre column — the roomiest view
- Click **Performance** in the right column's start list to open it as a right-side tab and keep working

To study a moment more closely, click **Pause** to freeze it.

The storage figures are re-measured in the background every five seconds; **Re-measure storage** forces it immediately.

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
