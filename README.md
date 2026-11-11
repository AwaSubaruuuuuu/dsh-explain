# dsh-explain

A DSH client plugin: select text in an answer to highlight it, or ask the model to explain it in a side panel — without touching the main conversation.

- **Highlight** — mark the selected text yellow or blue (CSS Custom Highlight API). Click the same colour again to remove it; “Clear” removes only the selected part, so a long highlight can be split in two.
- **Explain** — a compact floating input asks what you want to know; the answer streams into the right sidebar panel and supports follow-up turns.

Panel Q&A never enters the main session (no message, no session event), so the transcript and later replies stay untouched. The shipped “引用文本 / Quote” pill keeps working.

## Install

From a DSH workspace, install this directory as a bundle:

```
plugin_manager install_bundle → absolute path/to/dsh-explain
```

Reload the Web GUI (client plugins need a page reload). Select text inside an answer and the “Highlight / Explain” pill appears next to the shipped quote pill.

## Behaviour

- The pill follows the shipped quote pill; if that pill is absent it falls back to the area below the selection.
- Highlights toggle directly on the selected range (no undo stack).
- Explain opens a flat input card; sending streamlines the answer into the right panel, where you can keep asking follow-ups.
- The panel’s “Save” checkbox persists the current thread to `localStorage` (`dsh-explain.conversation`); unchecked means “multi-turn, not saved”.
- Highlights are stored in the browser’s highlight registry and are lost when the message DOM re-renders (known limitation).
- Explanation requests go through the host route `POST /dsh-explain/ask`, which uses `ctx.llm` with the current model and appends nothing to the session.

## UI language

The client auto-detects the browser language: Chinese (`zh*`) uses Chinese strings, everything else uses English. No configuration needed.

## Structure

- `index.js` — host half: registers `/dsh-explain/ask`, builds the prompt from the selected text, the full answer and the panel history, streams the model output with `ctx.llm.prepareCall`.
- `client.js` — browser half: selection tracking, floating pill, highlights, ask card and the right sidebar tab.
- `cordis.patch.yml` — bundle mount layer.

## 中文说明

在 DSH 回答里选中文字后：

- **强调**：把选中的文字标成黄色或蓝色；再次点击同色取消，选中长高亮的一部分点「取消高亮」会只去掉这一段（可切成两段）。
- **解释**：弹出扁平输入窗，回答显示在右侧面板里，可多轮追问；面板问答不写入主会话、不影响后续回答。

安装：把本目录作为 bundle 安装后刷新 Web GUI。面板头部「保存」勾选后，问答存到 localStorage，刷新可恢复；不勾选则不落盘。

界面语言按浏览器语言自动切换：中文环境显示中文，其余显示英文。
