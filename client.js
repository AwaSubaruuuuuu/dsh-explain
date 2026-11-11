/**
 * dsh-explain — client half.
 *
 * Adds a small floating bar when the user selects text inside an answer:
 *   - 强调: recolour the selection (yellow / blue) with the CSS Custom Highlight API.
 *   - 解释: ask for an explanation in a flat floating card, then read the answer in
 *     a right-hand side panel. The request goes to the host route (POST
 *     /dsh-explain/ask) and never enters the main conversation, so the transcript
 *     and later answers are untouched.
 *
 * The bar lives next to (below) the shipped “引用文本” pill, which keeps working:
 * the shipped pill is rendered by @deepseek-ai/dsh-message-quotes and only the
 * first interaction that opens can own the chat surface, so this plugin does not
 * try to add buttons inside that surface.
 */

window.__ModuleLoader__.load({
  id: 'dsh-explain',
  factory(require) {
    const React = require('react')
    const API_PATH = 'dsh-explain/ask'
    const SAVE_KEY = 'dsh-explain.save'
    const CONV_KEY = 'dsh-explain.conversation'
    const YELLOW = 'dsh-explain-yellow'
    const BLUE = 'dsh-explain-blue'
    const MAX_SELECTED = 4000
    const MAX_ANSWER = 16000

    const STRINGS = {
      zh: {
        guideTitle: '侧边解释',
        guideDescription: '解释选中的回答文字',
        panelTitle: '侧边解释',
        panelSub: '不影响主对话',
        save: '保存',
        newChat: '新对话',
        close: '关闭',
        emphasis: '强调',
        emphasisTitle: '给选中的文字上色',
        explain: '解释',
        explainTitle: '在右侧面板解释这段文字',
        yellow: '黄色',
        blue: '蓝色',
        yellowTitle: '标记为黄色（再次点击取消）',
        blueTitle: '标记为蓝色（再次点击取消）',
        clear: '取消高亮',
        clearTitle: '取消选中文字上的高亮',
        noHighlight: '当前浏览器不支持文字高亮',
        askPlaceholder: '想了解这段文字的什么？例如：这个符号是什么意思？',
        askHint: 'Ctrl / ⌘ + Enter 发送',
        send: '发送',
        followPlaceholder: '继续追问（只在这个面板里）…',
        selected: '选中',
        empty: '在回答里选中一段文字，点「解释」后这里显示解释。面板问答不会进入主对话，也不会影响后续回答。',
        you: '你',
        error: '出错',
        assistant: '助手',
        thinking: '正在解释…',
        requestFailed: (status) => `请求失败（HTTP ${status}）`,
        emptyAnswer: '模型返回了空解释',
        explainFailed: (message) => `解释失败：${message}`,
      },
      en: {
        guideTitle: 'Explain',
        guideDescription: 'Explain selected answer text',
        panelTitle: 'Explain',
        panelSub: 'No effect on the main chat',
        save: 'Save',
        newChat: 'New',
        close: 'Close',
        emphasis: 'Highlight',
        emphasisTitle: 'Highlight the selected text',
        explain: 'Explain',
        explainTitle: 'Explain this text in the side panel',
        yellow: 'Yellow',
        blue: 'Blue',
        yellowTitle: 'Mark yellow (click again to remove)',
        blueTitle: 'Mark blue (click again to remove)',
        clear: 'Clear',
        clearTitle: 'Remove the highlight from the selection',
        noHighlight: 'This browser does not support text highlighting',
        askPlaceholder: 'What would you like to know about this text? For example: what does this symbol mean?',
        askHint: 'Ctrl / ⌘ + Enter to send',
        send: 'Send',
        followPlaceholder: 'Ask a follow-up (only in this panel)…',
        selected: 'Selected',
        empty: 'Select text in an answer and click Explain. Answers show up here and never enter the main conversation or affect later replies.',
        you: 'You',
        error: 'Error',
        assistant: 'Assistant',
        thinking: 'Explaining…',
        requestFailed: (status) => `Request failed (HTTP ${status})`,
        emptyAnswer: 'The model returned an empty explanation',
        explainFailed: (message) => `Explanation failed: ${message}`,
      },
    }
    const LANG = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en')
      .toLowerCase()
      .startsWith('zh') ? 'zh' : 'en'
    const S = STRINGS[LANG]

    const state = {
      selected: '',
      answer: '',
      messages: [],
      busy: false,
      open: false,
    }

    let toolbar = null
    let palette = null
    let askCard = null
    let panel = null
    let panelHost = null
    let pluginCtx = null
    let toastEl = null
    let pending = null
    let highlightEntries = []
    let lastRect = null

    const STYLES = `
      [data-dsh-explain-ui][hidden] { display: none !important; }

      ::highlight(${YELLOW}) { background-color: #ffec99; color: #1f1f1f; }
      ::highlight(${BLUE}) { background-color: #bcdcff; color: #1f1f1f; }

      .dx-toolbar {
        position: fixed;
        z-index: 2147482000;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 3px;
        border-radius: 10px;
        background: var(--dsw-alias-button-floating-fill, #ffffff);
        border: 1px solid var(--dsw-alias-border-l3, rgba(20, 20, 20, 0.12));
        box-shadow: var(--dsw-elevation-panel, 0 4px 16px rgba(0, 0, 0, 0.14));
        font: var(--dsw-font-xs-13, 13px/1.4 system-ui, sans-serif);
        color: var(--dsw-alias-label-primary, #1f1f1f);
        user-select: none;
      }
      .dx-toolbar button, .dx-palette button, .dx-card button, .dx-panel button {
        font: inherit;
        color: inherit;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        padding: 5px 10px;
        line-height: 1.2;
      }
      .dx-toolbar button:hover, .dx-palette button:hover, .dx-card button:hover, .dx-panel button:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
      }
      .dx-toolbar .dx-sep { width: 1px; height: 16px; margin: 0 2px; background: var(--dsw-alias-border-l3, rgba(0,0,0,.12)); }

      .dx-palette {
        position: fixed;
        z-index: 2147482001;
        display: flex;
        gap: 2px;
        padding: 3px;
        border-radius: 10px;
        background: var(--dsw-alias-button-floating-fill, #ffffff);
        border: 1px solid var(--dsw-alias-border-l3, rgba(20, 20, 20, 0.12));
        box-shadow: var(--dsw-elevation-panel, 0 4px 16px rgba(0, 0, 0, 0.14));
        font: var(--dsw-font-xs-13, 13px/1.4 system-ui, sans-serif);
        color: var(--dsw-alias-label-primary, #1f1f1f);
      }
      .dx-palette .dx-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 5px; vertical-align: -1px; }
      .dx-palette .dx-yellow { background: #ffd43b; }
      .dx-palette .dx-blue { background: #74c0fc; }

      .dx-card {
        position: fixed;
        z-index: 2147482002;
        width: 340px;
        max-width: calc(100vw - 16px);
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border-radius: 12px;
        background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-primary, #ffffff));
        border: 1px solid var(--dsw-alias-border-l3, rgba(20, 20, 20, 0.12));
        box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.16));
        color: var(--dsw-alias-label-primary, #1f1f1f);
        font: var(--dsw-font-xs-13, 13px/1.45 system-ui, sans-serif);
      }
      .dx-card .dx-card-title { font-weight: 600; font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }
      .dx-card textarea, .dx-panel textarea {
        width: 100%;
        box-sizing: border-box;
        resize: none;
        border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
        border-radius: 8px;
        background: var(--dsw-alias-bg-primary, #ffffff);
        color: inherit;
        font: inherit;
        padding: 8px;
        outline: none;
      }
      .dx-card textarea:focus, .dx-panel textarea:focus { border-color: var(--dsw-alias-brand-primary, #4c6ef5); }
      .dx-card .dx-row, .dx-panel .dx-row { display: flex; justify-content: flex-end; gap: 6px; }
      .dx-card .dx-primary, .dx-panel .dx-primary {
        background: var(--dsw-alias-brand-primary, #4c6ef5);
        color: #ffffff;
      }
      .dx-card .dx-primary:hover, .dx-panel .dx-primary:hover { filter: brightness(1.05); background: var(--dsw-alias-brand-primary, #4c6ef5); }
      .dx-card .dx-primary:disabled, .dx-panel .dx-primary:disabled { opacity: .5; cursor: default; }

      .dx-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 400px;
        max-width: 90vw;
        z-index: 2147481999;
        display: flex;
        flex-direction: column;
        background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-primary, #ffffff));
        border-left: 1px solid var(--dsw-alias-border-l3, rgba(20, 20, 20, 0.12));
        box-shadow: var(--dsw-elevation-panel, -8px 0 24px rgba(0, 0, 0, 0.10));
        color: var(--dsw-alias-label-primary, #1f1f1f);
        font: var(--dsw-font-xs-13, 13px/1.45 system-ui, sans-serif);
      }
      .dx-panel[hidden] { display: none; }
      .dx-panel .dx-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        box-sizing: border-box;
        border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.10));
      }
      .dx-panel .dx-head .dx-title { font-weight: 600; font-size: 13px; flex: 1; }
      .dx-panel .dx-head label { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; }
      .dx-panel .dx-head button { font-size: 11px; padding: 4px 8px; }
      .dx-panel .dx-body { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .dx-panel .dx-empty { color: var(--dsw-alias-label-secondary, #888); font-size: 12px; line-height: 1.6; }
      .dx-panel .dx-msg { display: flex; flex-direction: column; gap: 3px; }
      .dx-panel .dx-msg .dx-role { font-size: 11px; color: var(--dsw-alias-label-tertiary, #999); }
      .dx-panel .dx-msg .dx-text {
        white-space: pre-wrap;
        word-break: break-word;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--dsw-alias-bg-primary, #f4f4f5);
      }
      .dx-panel .dx-msg.dx-user .dx-text { background: var(--dsw-alias-brand-bg, #eef2ff); }
      .dx-panel .dx-msg.dx-error .dx-text { color: #c92a2a; background: #fff5f5; }
      .dx-panel .dx-foot { border-top: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.10)); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
      .dx-panel .dx-foot .dx-row { align-items: center; justify-content: space-between; }
      .dx-panel .dx-foot .dx-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary, #999); }

      .dx-toast {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        z-index: 2147483000;
        padding: 8px 14px;
        border-radius: 8px;
        background: rgba(20, 20, 20, 0.86);
        color: #fff;
        font: 12px/1.4 system-ui, sans-serif;
        opacity: 0;
        transition: opacity .18s ease;
        pointer-events: none;
      }
      .dx-toast.dx-show { opacity: 1; }
    `

    // v2 design pass: match the DSH shell (dark, flat surfaces, pill floats,
    // composer-like footer, squared right pane). Kept separate so the original
    // rules stay as a readable base and these later rules win.
    const STYLES_V2 = `
      .dx-toolbar {
        display: inline-flex;
        align-items: center;
        gap: 0;
        padding: 0;
        border-radius: 999px;
        background: var(--dsw-alias-button-floating-fill, rgba(38, 38, 43, 0.94));
        --dsw-elevation-stroke-color: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.12));
        box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.38));
        border: none;
        color: var(--dsw-alias-label-primary, #ececf1);
        font: var(--dsw-font-xs-13, 13px/1.4 system-ui, sans-serif);
        animation: dx-pop 120ms ease-out;
      }
      .dx-toolbar button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: 20px;
        cursor: pointer;
      }
      .dx-toolbar button:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.09));
      }
      .dx-toolbar .dx-sep {
        width: 1px;
        height: 14px;
        margin: 0 2px;
        background: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.12));
      }
      .dx-toolbar svg, .dx-palette svg, .dx-card svg, .dx-panel svg {
        width: 13px;
        height: 13px;
        flex: none;
      }

      .dx-palette {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        padding: 3px;
        border-radius: 999px;
        background: var(--dsw-alias-button-floating-fill, #26262b);
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.10));
        box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.38));
        color: var(--dsw-alias-label-primary, #ececf1);
        animation: dx-pop 120ms ease-out;
      }
      .dx-palette button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 9px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: 1;
        cursor: pointer;
      }
      .dx-palette button:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.09));
      }
      .dx-palette .dx-dot {
        width: 8px;
        height: 8px;
        margin: 0;
        border-radius: 50%;
        display: inline-block;
      }
      .dx-palette button.dx-active {
        background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.14));
        color: var(--dsw-alias-label-primary, #ffffff);
      }
      .dx-palette button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .dx-palette button:disabled:hover {
        background: transparent;
      }

      .dx-card {
        width: 400px;
        gap: 10px;
        padding: 12px;
        border-radius: 16px;
        background: var(--dsw-alias-bg-layer-3, #ffffff);
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.10));
        box-shadow: var(--dsw-elevation-panel, 0 16px 40px rgba(0, 0, 0, 0.42));
        color: var(--dsw-alias-label-primary, #ececf1);
        animation: dx-pop 140ms ease-out;
      }
      .dx-card-head {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .dx-card-head .dx-card-title {
        flex: 1;
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary, #ececf1);
      }
      .dx-icon-btn {
        width: 24px;
        height: 24px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary, #9a9aa2);
        cursor: pointer;
      }
      .dx-icon-btn:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.09));
        color: var(--dsw-alias-label-primary, #ececf1);
      }
      .dx-quote {
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary, #9a9aa2);
        background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04));
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10));
        padding: 7px 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        overflow: hidden;
      }
      .dx-quote .dx-quote-text {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .dx-quote-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dx-quote-row .dx-quote { flex: 1; min-width: 0; }
      .dx-quote-row .dx-icon-btn { flex: none; }
      .dx-card textarea {
        min-height: 64px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10));
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04));
        color: inherit;
      }
      .dx-card textarea:focus {
        border-color: var(--dsw-alias-brand-primary, #4d6bfe);
      }
      .dx-card-foot {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }
      .dx-hint {
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary, #6f6f78);
      }
      .dx-input-wrap { position: relative; }
      .dx-input-wrap textarea { display: block; width: 100%; padding-bottom: 38px; }
      .dx-input-tools {
        position: absolute;
        right: 6px;
        bottom: 6px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dx-input-tools .dx-send { width: 26px; height: 26px; }
      .dx-send {
        width: 30px;
        height: 30px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 50%;
        background: var(--dsw-alias-brand-primary, #4d6bfe);
        color: #ffffff;
        cursor: pointer;
        transition: filter 120ms ease, opacity 120ms ease;
      }
      .dx-send:hover { filter: brightness(1.08); }
      .dx-send:disabled { opacity: 0.4; cursor: default; }

      .dx-panel {
        width: 380px;
        max-width: min(92vw, 380px);
        background: var(--dsw-alias-bg-layer-1, #ffffff);
        border-left: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.10));
        box-shadow: var(--dsw-elevation-panel, 0 0 32px rgba(0, 0, 0, 0.25));
      }
      .dx-panel .dx-body::-webkit-scrollbar { width: 8px; }
      .dx-panel .dx-body::-webkit-scrollbar-thumb {
        background: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.12));
        border-radius: 4px;
      }
      .dx-panel.dx-panel-desktop {
        padding-top: 44px;
      }
      .dx-panel .dx-head {
        gap: 10px;
        padding: 12px;
        border-bottom: 1px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.07));
      }
      .dx-panel .dx-head .dx-title {
        font-size: 13px;
        font-weight: 600;
        flex: none;
      }
      .dx-panel .dx-head .dx-sub {
        flex: 1;
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary, #6f6f78);
      }
      .dx-panel .dx-head label {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary, #9a9aa2);
      }
      .dx-panel .dx-head input[type="checkbox"] {
        appearance: none;
        -webkit-appearance: none;
        width: 13px;
        height: 13px;
        margin: 0;
        padding: 0;
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.28));
        border-radius: 4px;
        background: transparent;
        position: relative;
        cursor: pointer;
      }
      .dx-panel .dx-head input[type="checkbox"]::after {
        content: '';
        position: absolute;
        inset: 0;
        display: none;
        background: currentColor;
        clip-path: polygon(20% 50%, 40% 70%, 80% 25%, 88% 35%, 42% 82%, 12% 58%);
      }
      .dx-panel .dx-head input[type="checkbox"]:checked {
        background: var(--dsw-alias-brand-primary, #4d6bfe);
        border-color: var(--dsw-alias-brand-primary, #4d6bfe);
        color: #ffffff;
      }
      .dx-panel .dx-head input[type="checkbox"]:checked::after { display: block; }
      .dx-panel .dx-body {
        gap: 14px;
        padding: 12px;
      }
      .dx-panel .dx-ctx {
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary, #9a9aa2);
        background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04));
        border-radius: 10px;
        border-left: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
        padding: 8px 10px;
      }
      .dx-panel .dx-ctx em {
        font-style: normal;
        color: var(--dsw-alias-label-tertiary, #6f6f78);
        margin-right: 6px;
      }
      .dx-panel .dx-msg {
        gap: 4px;
      }
      .dx-panel .dx-msg .dx-role {
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary, #6f6f78);
      }
      .dx-panel .dx-msg .dx-text {
        font-size: 13px;
        padding: 9px 11px;
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04));
      }
      .dx-panel .dx-msg.dx-user {
        align-items: flex-end;
      }
      .dx-panel .dx-msg.dx-user .dx-role { display: none; }
      .dx-panel .dx-msg.dx-user .dx-text {
        background: var(--dsw-alias-brand-bg, rgba(77, 107, 254, 0.18));
      }
      .dx-panel .dx-msg.dx-error .dx-text {
        color: #ff9a9a;
        background: rgba(255, 107, 107, 0.10);
      }
      .dx-panel .dx-empty {
        font-size: 12px;
        line-height: 1.7;
        color: var(--dsw-alias-label-tertiary, #6f6f78);
        padding: 2px;
      }
      .dx-panel .dx-foot {
        padding: 10px 12px 12px;
        border-top: 1px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.07));
      }
      .dx-panel .dx-composer {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.08));
        border-radius: 16px;
        background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.04));
      }
      .dx-panel .dx-composer:focus-within {
        border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.20));
      }
      .dx-panel .dx-composer textarea {
        flex: 1;
        max-height: 120px;
        padding: 3px 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        resize: none;
        outline: none;
      }
      .dx-panel .dx-composer textarea::placeholder {
        color: var(--dsw-alias-label-tertiary, #6f6f78);
      }
      .dx-panel .dx-composer .dx-send {
        width: 28px;
        height: 28px;
        margin-bottom: 1px;
      }

      .dx-busy {
        display: inline-flex;
        gap: 4px;
        margin-right: 6px;
        vertical-align: 1px;
      }
      .dx-busy i {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentColor;
        opacity: 0.3;
        animation: dx-blink 1s infinite;
      }
      .dx-busy i:nth-child(2) { animation-delay: 0.15s; }
      .dx-busy i:nth-child(3) { animation-delay: 0.3s; }

      .dx-toast {
        padding: 8px 14px;
        border-radius: 999px;
        background: var(--dsw-alias-toast-bg, rgba(38, 38, 43, 0.96));
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.10));
        color: var(--dsw-alias-toast-label, #ececf1);
        font: var(--dsw-font-xs-13, 13px/1.4 system-ui, sans-serif);
        box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.38));
      }

      @keyframes dx-pop {
        from { opacity: 0; transform: translateX(-2px) scale(0.99); }
        to { opacity: 1; transform: none; }
      }
      @keyframes dx-blink {
        0%, 80%, 100% { opacity: 0.25; }
        40% { opacity: 0.9; }
      }

      .dx-pane-wrap { width: 100%; height: 100%; min-height: 0; }
      .dx-pane-host { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; }
      .dx-panel.dx-embedded {
        position: relative;
        inset: auto;
        width: 100%;
        max-width: none;
        height: 100%;
        max-height: none;
        border-left: 0;
        border-radius: 0;
        box-shadow: none;
        background: transparent;
        z-index: auto;
      }
      .dx-panel.dx-embedded.dx-panel-desktop { padding-top: 0; }
      .dx-panel.dx-embedded .dx-head {
        justify-content: flex-end;
        padding: 6px 10px;
        height: var(--dx-head-h, auto);
      }
      .dx-panel.dx-embedded .dx-head .dx-title,
      .dx-panel.dx-embedded .dx-head .dx-sub { display: none; }
      .dx-panel.dx-embedded .dx-head .dx-icon-btn:last-child { display: none; }

      .dx-panel .dx-rich > div { margin: 0; }
      .dx-panel .dx-rich .dx-gap { height: 6px; }
      .dx-panel .dx-rich strong { font-weight: 600; }
      .dx-panel .dx-rich code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        padding: 0 4px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
      }
      .dx-panel .dx-rich pre {
        margin: 6px 0 8px;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.28);
        overflow: auto;
      }
      .dx-panel .dx-rich pre code {
        padding: 0;
        background: transparent;
        white-space: pre-wrap;
      }
    `

    function apply(ctx) {
      pluginCtx = ctx
      const run = () => {
        ensureStyles()
        const dispose = mount()
        return dispose
      }
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(run, 'dsh-explain: selection toolbar')
        registerSidebar(ctx)
      } else {
        run()
      }
    }

    function registerSidebar(ctx) {
      if (!ctx || !ctx.slots || !ctx.sidebarRightTabs || !ctx.sidebarRight) return
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-explain',
        kind: 'dsh-explain',
        priority: 'extension',
        title: () => S.guideTitle,
        guide: [{
          id: 'explain',
          order: 40,
          title: () => S.guideTitle,
          description: () => S.guideDescription,
          icon: ExplainIcon,
        }],
      }), 'dsh-explain: sidebar type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: 'dsh-explain',
      }, ExplainPane)), 'dsh-explain: sidebar body')
    }

    function ensureStyles() {
      if (document.getElementById('dsh-explain-style')) return
      const style = document.createElement('style')
      style.id = 'dsh-explain-style'
      style.textContent = STYLES
      const styleV2 = document.createElement('style')
      styleV2.id = 'dsh-explain-style-v2'
      styleV2.textContent = STYLES_V2
      document.head.append(style, styleV2)
    }

    function h(tag, props, ...children) {
      const node = document.createElement(tag)
      if (props) {
        for (const [key, value] of Object.entries(props)) {
          if (value === undefined || value === null || value === false) continue
          if (key === 'class') node.className = value
          else if (key === 'text') node.textContent = value
          else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
          else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
          else node.setAttribute(key, value === true ? '' : String(value))
        }
      }
      for (const child of children) {
        if (child === undefined || child === null || child === false) continue
        node.append(child)
      }
      return node
    }

    const ICONS = {
      marker: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'],
      chat: ['M21 11.5a8.4 8.4 0 0 1-9 8.4 9.4 9.4 0 0 1-3.8-.8L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z'],
      send: ['M12 19V5', 'M5 12l7-7 7 7'],
      close: ['M6 6l12 12', 'M18 6L6 18'],
      plus: ['M12 5v14', 'M5 12h14'],
    }

    function icon(name) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('stroke', 'currentColor')
      svg.setAttribute('stroke-width', '1.9')
      svg.setAttribute('stroke-linecap', 'round')
      svg.setAttribute('stroke-linejoin', 'round')
      svg.setAttribute('aria-hidden', 'true')
      for (const d of ICONS[name] || []) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', d)
        svg.append(path)
      }
      return svg
    }

    function ExplainIcon(props) {
      return React.createElement('svg', {
        width: 22,
        height: 22,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        ...props,
      },
        React.createElement('path', { d: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.4 9.4 0 0 1-3.8-.8L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z' }),
        React.createElement('path', { d: 'M9 11h6' }),
      )
    }

    function ExplainPane() {
      const hostRef = React.useRef(null)
      React.useEffect(() => {
        const host = document.createElement('div')
        host.className = 'dx-pane-host'
        hostRef.current.append(host)
        attachPanel(host)
        return () => {
          detachPanel(host)
          host.remove()
        }
      }, [])
      return React.createElement('div', { className: 'dx-pane-wrap', ref: hostRef })
    }

    function quotePreview(text) {
      const clean = String(text || '').replace(/\s+/g, ' ').trim()
      return clean.length > 140 ? clean.slice(0, 140) + '…' : clean
    }

    function richText(text) {
      const frag = document.createDocumentFragment()
      const parts = String(text).split(/(```[\s\S]*?```)/g)
      for (const part of parts) {
        if (!part) continue
        if (part.startsWith('```')) {
          const body = part.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
          frag.append(h('pre', {}, h('code', {}, body)))
          continue
        }
        for (const line of part.split('\n')) {
          if (!line.trim()) {
            frag.append(h('div', { class: 'dx-gap' }))
            continue
          }
          const row = h('div', {})
          for (const token of line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
            if (!token) continue
            if (token.length > 2 && token.startsWith('`') && token.endsWith('`'))
              row.append(h('code', {}, token.slice(1, -1)))
            else if (token.length > 4 && token.startsWith('**') && token.endsWith('**'))
              row.append(h('strong', {}, token.slice(2, -2)))
            else row.append(document.createTextNode(token))
          }
          frag.append(row)
        }
      }
      return frag
    }

    function mount() {
      const onMouseUp = (event) => {
        if (event.button !== 0) return
        if (insideOwnUi(event.target)) return
        window.setTimeout(() => {
          const info = selectionInfo()
          if (info) showToolbar(info)
          else hideToolbar()
        }, 0)
      }
      const onKeyUp = (event) => {
        if (insideOwnUi(event.target)) return
        if (event.key !== 'Shift' && !event.shiftKey) return
        window.setTimeout(() => {
          const info = selectionInfo()
          if (info) showToolbar(info)
        }, 0)
      }
      const onMouseDown = (event) => {
        if (insideOwnUi(event.target)) return
        hideToolbar()
      }
      const onSelectionChange = () => {
        if (!toolbar || toolbar.hidden) return
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) hideToolbar()
      }
      const onScroll = () => {
        if (!toolbar || toolbar.hidden) return
        if (!pending) return
        const rect = pending.rect
        const top = rect.top
        const bottom = rect.bottom
        if (bottom < 0 || top > window.innerHeight) {
          hideToolbar()
          return
        }
        const qrect = quoteSurface()
        if (qrect) placeBeside(toolbar, qrect, 6)
        else placeBelow(toolbar, pending.rect, 8)
      }
      const onResize = () => {
        hideToolbar()
        syncEmbeddedHead()
      }
      const onEscape = (event) => {
        if (event.key === 'Escape') {
          hideToolbar()
          if (askCard) closeAsk()
          if (panel && !panel.hidden) closePanel()
        }
      }

      document.addEventListener('mouseup', onMouseUp, true)
      document.addEventListener('keyup', onKeyUp, true)
      document.addEventListener('mousedown', onMouseDown, true)
      document.addEventListener('selectionchange', onSelectionChange)
      document.addEventListener('keydown', onEscape, true)
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', onResize)

      restoreSaved()

      return () => {
        document.removeEventListener('mouseup', onMouseUp, true)
        document.removeEventListener('keyup', onKeyUp, true)
        document.removeEventListener('mousedown', onMouseDown, true)
        document.removeEventListener('selectionchange', onSelectionChange)
        document.removeEventListener('keydown', onEscape, true)
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', onResize)
        hideToolbar()
        closeAsk()
        if (panel) panel.remove()
        if (toastEl) toastEl.remove()
        panel = null
        toastEl = null
        const style = document.getElementById('dsh-explain-style')
        if (style) style.remove()
        const styleV2 = document.getElementById('dsh-explain-style-v2')
        if (styleV2) styleV2.remove()
      }
    }

    function insideOwnUi(node) {
      const element = node instanceof Element ? node : node && node.parentElement
      return Boolean(element && element.closest('[data-dsh-explain-ui]'))
    }

    function selectionInfo() {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
      let text = selection.toString().trim()
      if (!text) return null
      if (text.length > MAX_SELECTED) text = text.slice(0, MAX_SELECTED)

      const sourceOf = (node) => {
        const element = node instanceof Element ? node : node && node.parentElement
        return element ? element.closest('[data-text-interaction-source]') : null
      }
      const anchorSource = sourceOf(selection.anchorNode)
      const focusSource = sourceOf(selection.focusNode)
      if (!anchorSource || anchorSource !== focusSource) return null
      if (anchorSource.closest('[hidden], [inert], [data-text-interaction-exclude]')) return null

      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return null

      const answer = (anchorSource.innerText || '').trim()
      return {
        text,
        answer: answer.slice(0, MAX_ANSWER),
        rect,
        range: range.cloneRange(),
      }
    }

    function ensureToolbar() {
      if (toolbar) return
      palette = h(
        'div',
        { class: 'dx-palette', 'data-dsh-explain-ui': '', hidden: true },
        h('button', { type: 'button', 'data-color': 'yellow', title: S.yellowTitle, onclick: () => toggleHighlight('yellow') },
          h('span', { class: 'dx-dot dx-yellow' }), S.yellow),
        h('button', { type: 'button', 'data-color': 'blue', title: S.blueTitle, onclick: () => toggleHighlight('blue') },
          h('span', { class: 'dx-dot dx-blue' }), S.blue),
        h('button', { type: 'button', class: 'dx-clear', title: S.clearTitle, onclick: clearHighlightSelection }, S.clear),
      )
      toolbar = h(
        'div',
        { class: 'dx-toolbar', 'data-dsh-explain-ui': '', hidden: true },
        h('button', { type: 'button', onclick: openPalette, title: S.emphasisTitle }, icon('marker'), S.emphasis),
        h('span', { class: 'dx-sep' }),
        h('button', { type: 'button', onclick: startExplain, title: S.explainTitle }, icon('chat'), S.explain),
      )
      toolbar.addEventListener('mousedown', (event) => event.preventDefault())
      palette.addEventListener('mousedown', (event) => event.preventDefault())
      document.body.append(toolbar, palette)
    }

    function showToolbar(info) {
      ensureToolbar()
      pending = info
      toolbar.hidden = false
      palette.hidden = true
      placeBelow(toolbar, info.rect, 8)
      settlePlacement()
    }

    function hideToolbar() {
      if (toolbar) toolbar.hidden = true
      if (palette) palette.hidden = true
    }

    function openPalette() {
      if (!pending) return
      ensureToolbar()
      palette.hidden = false
      const covering = colorCovering(pending.range)
      palette.querySelectorAll('button[data-color]').forEach((button) => {
        button.classList.toggle('dx-active', button.dataset.color === covering)
      })
      const clear = palette.querySelector('.dx-clear')
      if (clear) clear.disabled = !selectionHasHighlight(pending.range)
      const rect = toolbar.getBoundingClientRect()
      const width = palette.offsetWidth
      const height = palette.offsetHeight
      let left = rect.right + 6
      let top = rect.top
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
        top = pending.rect.bottom + 6
      }
      if (top + height > window.innerHeight - 8) top = pending.rect.top - height - 6
      palette.style.left = `${left}px`
      palette.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`
    }

    function placeBelow(node, rect, gap) {
      const width = node.offsetWidth
      const height = node.offsetHeight
      let left = rect.left + rect.width / 2 - width / 2
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
      let top = rect.bottom + gap
      if (top + height > window.innerHeight - 8) top = rect.top - height - gap
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8))
      node.style.left = `${left}px`
      node.style.top = `${top}px`
    }

    function quoteSurface() {
      const node = document.querySelector('[data-text-interaction-surface]')
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 ? rect : null
    }

    function placeBeside(node, rect, gap) {
      const width = node.offsetWidth
      const height = node.offsetHeight
      let left = rect.right + gap
      if (left + width > window.innerWidth - 8) left = rect.left - width - gap
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
      const top = Math.max(8, Math.min(rect.top + (rect.height - height) / 2, window.innerHeight - height - 8))
      node.style.left = `${left}px`
      node.style.top = `${top}px`
    }

    function settlePlacement() {
      let tries = 0
      const tick = () => {
        if (!toolbar || toolbar.hidden) return
        const rect = quoteSurface()
        if (rect) {
          placeBeside(toolbar, rect, 6)
          return
        }
        if (tries++ < 30) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }

    function supportsHighlights() {
      return Boolean(window.CSS && window.CSS.highlights && typeof window.Highlight === 'function')
    }

    function themeIsDark() {
      const probe = document.createElement('div')
      probe.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;background:var(--dsw-alias-bg-layer-1,#ffffff)'
      document.body.append(probe)
      const bg = window.getComputedStyle(probe).backgroundColor
      probe.remove()
      const parts = (bg.match(/\d+(\.\d+)?/g) || []).map(Number)
      if (parts.length < 3) return true
      return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) < 128
    }

    function collapsedRange(container, offset) {
      const range = document.createRange()
      range.setStart(container, offset)
      range.collapse(true)
      return range
    }

    function comparePoint(a, b) {
      return collapsedRange(a.container, a.offset)
        .compareBoundaryPoints(Range.START_TO_START, collapsedRange(b.container, b.offset))
    }

    function pointOf(range, edge) {
      return edge === 'start'
        ? { container: range.startContainer, offset: range.startOffset }
        : { container: range.endContainer, offset: range.endOffset }
    }

    function makeRange(start, end) {
      const range = document.createRange()
      range.setStart(start.container, start.offset)
      range.setEnd(end.container, end.offset)
      return range
    }

    function rangeOverlaps(a, b) {
      return comparePoint(pointOf(a, 'end'), pointOf(b, 'start')) > 0
        && comparePoint(pointOf(b, 'end'), pointOf(a, 'start')) > 0
    }

    function rangeContains(outer, inner) {
      return comparePoint(pointOf(outer, 'start'), pointOf(inner, 'start')) <= 0
        && comparePoint(pointOf(inner, 'end'), pointOf(outer, 'end')) <= 0
    }

    function isLive(range) {
      return Boolean(range && range.startContainer && range.endContainer
        && range.startContainer.isConnected !== false && range.endContainer.isConnected !== false)
    }

    function liveEntries() {
      return highlightEntries.filter((entry) => isLive(entry.range))
    }

    function selectionHasHighlight(range) {
      return liveEntries().some((entry) => rangeOverlaps(entry.range, range))
    }

    function colorCovering(range) {
      for (const entry of liveEntries()) {
        if (rangeContains(entry.range, range)) return entry.color
      }
      return null
    }

    function paintHighlights() {
      if (!supportsHighlights()) return
      highlightEntries = liveEntries()
      const groups = { yellow: [], blue: [] }
      for (const entry of highlightEntries) {
        if (!groups[entry.color]) groups[entry.color] = []
        groups[entry.color].push(entry.range)
      }
      for (const [color, name] of [['yellow', YELLOW], ['blue', BLUE]]) {
        window.CSS.highlights.delete(name)
        const ranges = groups[color]
        if (ranges.length) {
          const highlight = new Highlight()
          for (const range of ranges) highlight.add(range)
          window.CSS.highlights.set(name, highlight)
        }
      }
    }

    function carveRange(range) {
      const next = []
      for (const entry of liveEntries()) {
        if (!rangeOverlaps(entry.range, range)) {
          next.push(entry)
          continue
        }
        const start = pointOf(entry.range, 'start')
        const end = pointOf(entry.range, 'end')
        const cutStart = comparePoint(start, pointOf(range, 'start')) > 0 ? start : pointOf(range, 'start')
        const cutEnd = comparePoint(end, pointOf(range, 'end')) < 0 ? end : pointOf(range, 'end')
        if (comparePoint(start, cutStart) < 0) next.push({ color: entry.color, range: makeRange(start, cutStart) })
        if (comparePoint(cutEnd, end) < 0) next.push({ color: entry.color, range: makeRange(cutEnd, end) })
      }
      highlightEntries = next
    }

    function toggleHighlight(color) {
      if (!pending) return
      if (!supportsHighlights()) {
        toast(S.noHighlight)
        return
      }
      const range = pending.range.cloneRange()
      if (colorCovering(range) === color) {
        carveRange(range)
      } else {
        carveRange(range)
        highlightEntries.push({ color, range })
      }
      paintHighlights()
      hideToolbar()
      clearSelection()
    }

    function clearHighlightSelection() {
      if (!pending || !supportsHighlights()) return
      carveRange(pending.range)
      paintHighlights()
      hideToolbar()
      clearSelection()
    }

    function clearSelection() {
      const selection = window.getSelection()
      if (selection) selection.removeAllRanges()
    }

    function startExplain() {
      if (!pending) return
      state.selected = pending.text
      state.answer = pending.answer
      state.messages = []
      state.busy = false
      openAsk(pending.rect)
      hideToolbar()
    }

    function openAsk(rect) {
      closeAsk()
      const input = h('textarea', { rows: '3', placeholder: S.askPlaceholder })
      const send = h('button', { type: 'button', class: 'dx-send', title: S.send, onclick: () => submitAsk() }, icon('send'))
      send.disabled = true
      input.addEventListener('input', () => { send.disabled = !input.value.trim() })
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          submitAsk()
        }
      })
      askCard = h(
        'div',
        { class: 'dx-card', 'data-dsh-explain-ui': '' },
        h('div', { class: 'dx-quote-row' },
          h('div', { class: 'dx-quote' },
            h('span', { class: 'dx-quote-text' }, quotePreview(state.selected)),
          ),
          h('button', { type: 'button', class: 'dx-icon-btn', title: S.close, onclick: () => closeAsk() }, icon('close')),
        ),
        h('div', { class: 'dx-input-wrap' },
          input,
          h('div', { class: 'dx-input-tools' },
            h('span', { class: 'dx-hint' }, S.askHint),
            send,
          ),
        ),
      )
      askCard.addEventListener('mousedown', (event) => event.stopPropagation())
      askCard.style.colorScheme = themeIsDark() ? 'dark' : 'light'
      document.body.append(askCard)
      const width = askCard.offsetWidth || 400
      let left = rect.left + rect.width / 2 - width / 2
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
      let top = rect.bottom + 10
      const height = askCard.offsetHeight || 180
      if (top + height > window.innerHeight - 8) top = rect.top - height - 10
      askCard.style.left = `${left}px`
      askCard.style.top = `${Math.max(8, top)}px`
      window.setTimeout(() => input.focus(), 0)
    }

    function closeAsk() {
      if (askCard) {
        askCard.remove()
        askCard = null
      }
    }

    function submitAsk() {
      if (!askCard) return
      const input = askCard.querySelector('textarea')
      const question = input ? input.value.trim() : ''
      if (!question) {
        if (input) input.focus()
        return
      }
      closeAsk()
      presentPanel()
      state.messages.push({ role: 'user', text: question })
      renderPanel()
      void requestAnswer()
    }

    function ensurePanel() {
      if (panel) return panel
      const saveToggle = h('input', { type: 'checkbox' })
      saveToggle.checked = localStorage.getItem(SAVE_KEY) === '1'
      saveToggle.addEventListener('change', () => {
        localStorage.setItem(SAVE_KEY, saveToggle.checked ? '1' : '0')
        if (saveToggle.checked) persist()
        else localStorage.removeItem(CONV_KEY)
      })
      const follow = h('textarea', { rows: '1', placeholder: S.followPlaceholder })
      const send = h('button', { type: 'button', class: 'dx-send', title: S.send, onclick: () => submitFollowUp() }, icon('send'))
      send.disabled = true
      follow.addEventListener('input', () => { send.disabled = !follow.value.trim() || state.busy })
      follow.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          submitFollowUp()
        }
      })
      const body = h('div', { class: 'dx-body' })
      panel = h(
        'div',
        { class: 'dx-panel', 'data-dsh-explain-ui': '', hidden: true },
        h('div', { class: 'dx-head' },
          h('div', { class: 'dx-title' }, S.panelTitle),
          h('span', { class: 'dx-sub' }, S.panelSub),
          h('label', {}, saveToggle, S.save),
          h('button', { type: 'button', class: 'dx-icon-btn', title: S.newChat, onclick: resetConversation }, icon('plus')),
          h('button', { type: 'button', class: 'dx-icon-btn', title: S.close, onclick: closePanel }, icon('close')),
        ),
        body,
        h('div', { class: 'dx-foot' },
          h('div', { class: 'dx-composer' },
            follow,
            send,
          ),
        ),
      )
      panel.addEventListener('mousedown', (event) => event.stopPropagation())
      panel.style.colorScheme = themeIsDark() ? 'dark' : 'light'
      if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent))
        panel.classList.add('dx-panel-desktop')
      panel._body = body
      panel._follow = follow
      panel._send = send
      document.body.append(panel)
      return panel
    }

    function syncEmbeddedHead() {
      if (!panel || !panelHost || !panel.classList.contains('dx-embedded')) return
      const scroller = document.querySelector('[data-conversation-scroll]')
      if (!scroller) return
      const h = Math.round(scroller.getBoundingClientRect().top - panelHost.getBoundingClientRect().top)
      if (h > 0) panel.style.setProperty('--dx-head-h', `${h}px`)
    }

    function attachPanel(host) {
      const node = ensurePanel()
      node.hidden = false
      node.classList.add('dx-embedded')
      node.classList.remove('dx-panel-desktop')
      if (node.parentElement !== host) host.append(node)
      panelHost = host
      syncEmbeddedHead()
      renderPanel()
    }

    function detachPanel(host) {
      if (panel && panel.parentElement === host) {
        panel.classList.remove('dx-embedded')
        panel.hidden = true
        if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent))
          panel.classList.add('dx-panel-desktop')
        document.body.append(panel)
      }
      if (panelHost === host) panelHost = null
    }

    function openPanel() {
      ensurePanel().hidden = false
      panel._body.scrollTop = panel._body.scrollHeight
    }

    function presentPanel() {
      if (panelHost) {
        openPanel()
        return
      }
      let opened = false
      try {
        if (pluginCtx && pluginCtx.sidebarRight) {
          pluginCtx.sidebarRight.openTab('dsh-explain', {})
          opened = true
        }
      } catch {
        opened = false
      }
      if (!opened) openPanel()
    }

    function closePanel() {
      if (!panel) return
      if (panelHost && pluginCtx) {
        try {
          const active = pluginCtx.sidebarRight.active()
          if (active && active.kind === 'dsh-explain') {
            pluginCtx.sidebarRight.hide(active.id)
            return
          }
        } catch {
          // fall through to hiding the node
        }
      }
      panel.hidden = true
    }

    function resetConversation() {
      state.messages = []
      state.selected = ''
      state.answer = ''
      state.busy = false
      if (panel) panel._follow.value = ''
      renderPanel()
    }

    function renderPanel() {
      if (!panel) return
      const body = panel._body
      body.textContent = ''
      if (state.selected) {
        body.append(h('div', { class: 'dx-ctx' },
          h('em', {}, S.selected),
          document.createTextNode(quotePreview(state.selected)),
        ))
      }
      if (state.messages.length === 0) {
        body.append(h('div', { class: 'dx-empty', text: S.empty }))
      }
      for (const message of state.messages) {
        const isUser = message.role === 'user'
        const isError = message.role === 'error'
        body.append(h(
          'div',
          { class: `dx-msg ${isUser ? 'dx-user' : ''} ${isError ? 'dx-error' : ''}` },
          h('div', { class: 'dx-role' }, isUser ? S.you : isError ? S.error : S.assistant),
          isUser || isError
            ? h('div', { class: 'dx-text', text: message.text })
            : h('div', { class: 'dx-text dx-rich' }, richText(message.text)),
        ))
      }
      if (state.busy) {
        body.append(h('div', { class: 'dx-msg' },
          h('div', { class: 'dx-role' }, S.assistant),
          h('div', { class: 'dx-text' },
            h('span', { class: 'dx-busy' }, h('i'), h('i'), h('i')),
            S.thinking,
          ),
        ))
      }
      panel._send.disabled = state.busy || !panel._follow.value.trim()
      body.scrollTop = body.scrollHeight
    }

    function submitFollowUp() {
      if (!panel || state.busy) return
      const input = panel._follow
      const question = input.value.trim()
      if (!question) {
        input.focus()
        return
      }
      input.value = ''
      state.messages.push({ role: 'user', text: question })
      renderPanel()
      void requestAnswer()
    }

    async function requestAnswer() {
      if (!state.selected || state.busy) return
      state.busy = true
      renderPanel()
      try {
        const response = await fetch(API_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            selected: state.selected,
            answer: state.answer,
            messages: state.messages,
            sessionId: currentSessionId(),
          }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload || payload.ok !== true) {
          const message = payload && payload.error && payload.error.message ? payload.error.message : S.requestFailed(response.status)
          throw new Error(message)
        }
        const text = payload.value && payload.value.text ? String(payload.value.text) : ''
        if (!text) throw new Error(S.emptyAnswer)
        state.messages.push({ role: 'assistant', text })
        persist()
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        state.messages.push({ role: 'error', text: S.explainFailed(message) })
      } finally {
        state.busy = false
        renderPanel()
      }
    }

    function currentSessionId() {
      const attribute = document.querySelector('[data-session-id]')
      if (attribute) {
        const value = attribute.getAttribute('data-session-id')
        if (value) return value
      }
      return undefined
    }

    function persist() {
      if (localStorage.getItem(SAVE_KEY) !== '1') return
      try {
        localStorage.setItem(CONV_KEY, JSON.stringify({
          selected: state.selected,
          answer: state.answer,
          messages: state.messages,
          savedAt: Date.now(),
        }))
      } catch {
        // ignore quota errors
      }
    }

    function restoreSaved() {
      if (localStorage.getItem(SAVE_KEY) !== '1') return
      try {
        const raw = localStorage.getItem(CONV_KEY)
        if (!raw) return
        const saved = JSON.parse(raw)
        if (!saved || !Array.isArray(saved.messages)) return
        state.selected = typeof saved.selected === 'string' ? saved.selected : ''
        state.answer = typeof saved.answer === 'string' ? saved.answer : ''
        state.messages = saved.messages.filter((item) => item && (item.role === 'user' || item.role === 'assistant' || item.role === 'error') && typeof item.text === 'string')
      } catch {
        // ignore broken saved state
      }
    }

    function toast(text) {
      if (!toastEl) {
        toastEl = h('div', { class: 'dx-toast', 'data-dsh-explain-ui': '' })
        document.body.append(toastEl)
      }
      toastEl.textContent = text
      toastEl.classList.add('dx-show')
      window.clearTimeout(toastEl._timer)
      toastEl._timer = window.setTimeout(() => {
        toastEl.classList.remove('dx-show')
      }, 2200)
    }

    return { name: 'dsh-explain', inject: ['slots', 'sidebarRight', 'sidebarRightTabs'], apply }
  },
})
