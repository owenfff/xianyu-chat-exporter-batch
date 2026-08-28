# Xianyu Chat History Batch Exporter

🌐 [English](./README.md) | [中文](./README_zh.md)

A local Chrome extension for organizing and saving Xianyu chat history. It supports exporting the current conversation and archiving multiple conversations into a ZIP file with local media.

## Features

- Scan the conversations visible on the current Xianyu page and choose which ones to export
- Open conversations one at a time and load older messages through the page UI
- Capture text, images, videos, and quoted messages
- Download available media locally and place it beside the exported HTML
- Pause, resume, stop, and recover progress after reopening the popup
- Export a single conversation as HTML or Markdown
- Keep the original media URL and failure reason when a media download is unavailable

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.

## Usage

### Batch export Xianyu conversations

1. Open [Xianyu Web](https://www.goofish.com/) and sign in.
2. Click the extension icon in the browser toolbar.
3. Open the **Batch export** tab and click **Scan conversations**.
4. Adjust the selection if needed. New scans are selected by default.
5. Click **Start batch export**. Conversations are handled sequentially.
6. Click **Export ZIP** when the task is complete.

The popup can be closed while a task is running. Reopen it to view the saved progress. The task pauses when a captcha, access restriction, or abnormal page state is detected.

### Export the current conversation

Use the **Current chat** tab to review messages loaded on the current page, select the messages to keep, and export HTML or Markdown.

## ZIP layout

```text
xianyu-chat-backup.zip
├─ manifest.json
├─ conversations/
│  ├─ conversation-one.html
│  └─ conversation-two.html
├─ raw/
│  ├─ conversation-one.json
│  └─ conversation-two.json
└─ media/
   ├─ conversation-one_001.jpg
   └─ conversation-two_001.mp4
```

Conversation names are sanitized and made unique automatically. If the archive becomes too large for one download, the extension attempts to split it by conversation.

## Scope and limitations

- Reads data from the current logged-in page; it does not call Xianyu's internal pagination API
- Processes one conversation at a time and does not open conversations concurrently
- Does not read cookies or upload chat data to a third party
- Voice messages, files, stickers, and system messages are not guaranteed in this version
- Alibaba CDN media URLs may expire; failed downloads remain referenced in the exported data
- The default scan covers conversations that can be discovered from the current page

## Supported sites

- Xianyu Web: `xianyu.com` and `goofish.com`
- Fiverr: current-conversation export remains available

## Development and tests

```bash
node --test tests/*.test.cjs
```

The extension uses Manifest V3, content scripts, a service worker, and IndexedDB. Processing stays on the local machine.
