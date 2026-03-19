/* =============================================================
   CALCULATOR  —  script.js
   Fully refactored: structured state, precision math,
   real % semantics, keyboard support, backspace, history,
   theme toggle, ripple feedback, operator replacement.
   ============================================================= */

(() => {
  'use strict';

  /* ──────────────────────────────────────────────────────────
     CONSTANTS
  ────────────────────────────────────────────────────────── */
  const MAX_DIGITS   = 12;
  const HIST_LIMIT   = 60;
  const OPS          = ['+', '−', '×', '÷'];

  /** Button definitions — label, CSS class(es), aria-label */
  const BTN_DEFS = [
    { label: 'AC', cls: 'fn',           aria: 'All clear'     },
    { label: '⌫',  cls: 'fn',           aria: 'Backspace'     },
    { label: '%',  cls: 'fn op-adj',    aria: 'Percent'       },
    { label: '÷',  cls: 'op',           aria: 'Divide'        },
    { label: '7' }, { label: '8' }, { label: '9' },
    { label: '×',  cls: 'op',           aria: 'Multiply'      },
    { label: '4' }, { label: '5' }, { label: '6' },
    { label: '−',  cls: 'op',           aria: 'Subtract'      },
    { label: '1' }, { label: '2' }, { label: '3' },
    { label: '+',  cls: 'op',           aria: 'Add'           },
    { label: '+/−',cls: 'fn',           aria: 'Toggle sign'   },
    { label: '0',  cls: '',             aria: 'Zero'          },
    { label: '.',  cls: '',             aria: 'Decimal point' },
    { label: '=',  cls: 'eq',          aria: 'Equals'        },
  ];

  /* ──────────────────────────────────────────────────────────
     STATE  —  single source of truth
  ────────────────────────────────────────────────────────── */
  const s = {
    cur:       '0',    // string being typed / shown
    prev:      null,   // Number: left-hand operand
    op:        null,   // pending operator symbol
    fresh:     false,  // true right after '=' was pressed
    err:       false,  // error state flag
    history:   [],     // [{expr, val}]
  };

  /* ──────────────────────────────────────────────────────────
     DOM REFS
  ────────────────────────────────────────────────────────── */
  const gridEl    = document.getElementById('grid');
  const mainLine  = document.getElementById('mainLine');
  const exprLine  = document.getElementById('exprLine');
  const histDrawer= document.getElementById('histDrawer');
  const histInner = document.getElementById('histInner');
  const histEmpty = document.getElementById('histEmpty');
  const histBtn   = document.getElementById('histBtn');
  const themeBtn  = document.getElementById('themeBtn');

  /* ──────────────────────────────────────────────────────────
     BUILD BUTTON GRID
  ────────────────────────────────────────────────────────── */
  const opEls = {};   // op symbol → button element (for lit class)

  BTN_DEFS.forEach(def => {
    const el = document.createElement('button');
    el.className = 'btn' + (def.cls ? ' ' + def.cls : '');
    el.textContent = def.label;
    el.dataset.lbl = def.label;
    if (def.aria) el.setAttribute('aria-label', def.aria);
    gridEl.appendChild(el);
    if (OPS.includes(def.label)) opEls[def.label] = el;
  });

  /* ──────────────────────────────────────────────────────────
     NUMBER HELPERS
  ────────────────────────────────────────────────────────── */

  /**
   * Reduce floating-point noise.
   * e.g.  0.1 + 0.2  →  0.3  (not 0.30000000000000004)
   */
  function precise(n) {
    if (!isFinite(n)) return n;           // keep Infinity as-is for now
    return parseFloat(n.toPrecision(10));
  }

  /**
   * Unified display formatter — returns a string ≤ MAX_DIGITS wide.
   *   • Mid-typing strings (ending in '.' or just '-') pass through.
   *   • Very large/small numbers use exponential notation.
   *   • Trailing decimal zeros are trimmed.
   */
  function fmt(str) {
    // Pass-through: mid-typing states
    if (str === '-' || str.endsWith('.')) return str;

    const n = Number(str);
    if (!isFinite(n) || isNaN(n)) return 'Error';

    const abs = Math.abs(n);

    // Exponential for very large / very small
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-7)) {
      return n.toExponential(4).replace(/\.?0+e/, 'e');
    }

    // Integer part character budget
    const intChars = String(Math.abs(Math.trunc(n))).length + (n < 0 ? 1 : 0);
    if (intChars >= MAX_DIGITS) return String(Math.round(n));

    // Available decimal slots
    const slots = MAX_DIGITS - intChars - 1;          // -1 for '.'
    if (!Number.isInteger(n) && slots > 0) {
      const fixed = precise(n).toFixed(Math.min(slots, 8));
      return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    }
    return String(Math.trunc(n));
  }

  /** Adjust font-size class based on string length */
  function sizeClass(str) {
    if (str.length > 9)  return 'sz-sm';
    if (str.length > 6)  return 'sz-md';
    return '';
  }

  /* ──────────────────────────────────────────────────────────
     ARITHMETIC
  ────────────────────────────────────────────────────────── */

  /**
   * Returns a Number result, or null to signal division-by-zero.
   */
  function compute(a, b, op) {
    switch (op) {
      case '+': return precise(a + b);
      case '−': return precise(a - b);
      case '×': return precise(a * b);
      case '÷': return b === 0 ? null : precise(a / b);
      default:  return b;
    }
  }

  /* ──────────────────────────────────────────────────────────
     RENDER
  ────────────────────────────────────────────────────────── */
  function render() {
    // Main display
    if (s.err) {
      mainLine.textContent = 'Can\'t ÷ by 0';
      mainLine.className   = 'main-line error';
    } else {
      const displayed = fmt(s.cur);
      mainLine.textContent = displayed;
      mainLine.className   = 'main-line ' + sizeClass(displayed);
    }

    // Highlight active operator
    OPS.forEach(op => {
      if (opEls[op]) opEls[op].classList.toggle('lit', s.op === op && !s.fresh && !s.err);
    });
  }

  /* ──────────────────────────────────────────────────────────
     ACTIONS
  ────────────────────────────────────────────────────────── */
  function doAC() {
    Object.assign(s, { cur: '0', prev: null, op: null, fresh: false, err: false });
    exprLine.innerHTML = '&nbsp;';
  }

  function doBack() {
    if (s.err || s.fresh) { doAC(); return; }
    if (s.cur.length <= 1 || s.cur === '-0') { s.cur = '0'; return; }
    s.cur = s.cur.slice(0, -1);
    if (s.cur === '-') s.cur = '0';
  }

  function doSign() {
    if (s.err) return;
    const n = Number(s.cur);
    if (isNaN(n) || n === 0) return;
    s.cur = s.cur.startsWith('-') ? s.cur.slice(1) : '-' + s.cur;
  }

  /**
   * Context-aware percentage — matches real iOS/Android calculator:
   *   Standalone:      500%  →  5
   *   After + or −:   200 + 10%  →  operand is (200 × 0.10) = 20  → result 220
   *   After × or ÷:   200 × 10%  →  operand is 0.10  → result 20
   */
  function doPercent() {
    if (s.err) return;
    const cur = Number(s.cur);
    if (isNaN(cur)) return;

    if (s.prev !== null && (s.op === '+' || s.op === '−')) {
      s.cur = String(precise(s.prev * (cur / 100)));
    } else {
      s.cur = String(precise(cur / 100));
    }
  }

  function doOperator(op) {
    if (s.err) return;

    const cur = Number(s.cur);

    // Operator replacement: if we just pressed an operator and haven't
    // typed a new number yet, simply swap the pending operator.
    if (s.op !== null && !s.fresh && s.cur === '0' && s.prev !== null) {
      s.op = op;
      exprLine.textContent = fmt(String(s.prev)) + ' ' + op;
      render();
      return;
    }

    // Chain: if there's already a pending op, evaluate it first
    if (s.prev !== null && s.op !== null && !s.fresh) {
      const result = compute(s.prev, cur, s.op);
      if (result === null) { s.err = true; render(); return; }
      s.cur  = String(result);
      s.prev = result;
    } else {
      s.prev = cur;
    }

    s.op    = op;
    s.fresh = false;
    exprLine.textContent = fmt(String(s.prev)) + ' ' + op;
    s.cur = '0';
  }

  function doEquals() {
    if (s.err || s.op === null || s.prev === null) return;

    const a   = s.prev;
    const b   = Number(s.cur);
    const res = compute(a, b, s.op);

    const exprStr = fmt(String(a)) + ' ' + s.op + ' ' + fmt(s.cur) + ' =';
    exprLine.textContent = exprStr;

    if (res === null) { s.err = true; render(); return; }

    addHistory(exprStr, res);

    s.cur   = String(res);
    s.prev  = null;
    s.op    = null;
    s.fresh = true;
  }

  function doDigit(d) {
    if (s.err) doAC();
    if (s.fresh) { s.cur = d; s.fresh = false; return; }
    if (s.cur === '0') { s.cur = d; return; }
    // Guard max digit count (excluding '-' and '.')
    if (s.cur.replace(/[^0-9]/g, '').length >= MAX_DIGITS) return;
    s.cur += d;
  }

  function doDot() {
    if (s.err) doAC();
    if (s.fresh) { s.cur = '0.'; s.fresh = false; return; }
    if (!s.cur.includes('.')) s.cur += '.';
  }

  /* ──────────────────────────────────────────────────────────
     DISPATCH  — single entry point for all inputs
  ────────────────────────────────────────────────────────── */
  function dispatch(label) {
    switch (label) {
      case 'AC':  doAC();               break;
      case '⌫':   doBack();             break;
      case '+/−': doSign();             break;
      case '%':   doPercent();          break;
      case '.':   doDot();              break;
      case '=':   doEquals();           break;
      default:
        if (OPS.includes(label))        doOperator(label);
        else if (/^[0-9]$/.test(label)) doDigit(label);
    }
    render();
  }

  /* ──────────────────────────────────────────────────────────
     HISTORY
  ────────────────────────────────────────────────────────── */
  function addHistory(expr, val) {
    s.history.unshift({ expr, val });
    if (s.history.length > HIST_LIMIT) s.history.pop();
    renderHistory();
  }

  function renderHistory() {
    // Clear existing rows
    histInner.querySelectorAll('.hist-row').forEach(el => el.remove());
    histEmpty.style.display = s.history.length ? 'none' : '';

    s.history.forEach(({ expr, val }) => {
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.innerHTML = `<span class="hist-expr">${expr}</span>
                       <span class="hist-val">${fmt(String(val))}</span>`;
      row.addEventListener('click', () => {
        Object.assign(s, { cur: String(val), prev: null, op: null, fresh: true, err: false });
        exprLine.textContent = expr;
        render();
      });
      histInner.appendChild(row);
    });
  }

  /* ──────────────────────────────────────────────────────────
     BUTTON CLICK  +  RIPPLE
  ────────────────────────────────────────────────────────── */
  gridEl.addEventListener('click', e => {
    const btn = e.target.closest('.btn');
    if (!btn) return;

    // Ripple
    const r    = document.createElement('span');
    r.className= 'ripple';
    const rect = btn.getBoundingClientRect();
    const sz   = Math.max(rect.width, rect.height);
    r.style.cssText = `width:${sz}px;height:${sz}px;
      left:${e.clientX - rect.left - sz / 2}px;
      top:${e.clientY  - rect.top  - sz / 2}px`;
    btn.appendChild(r);
    r.addEventListener('animationend', () => r.remove(), { once: true });

    dispatch(btn.dataset.lbl);
  });

  /* ──────────────────────────────────────────────────────────
     KEYBOARD SUPPORT
  ────────────────────────────────────────────────────────── */
  const KEY_MAP = {
    'Escape':    'AC',
    'Backspace': '⌫',
    'Delete':    'AC',
    'Enter':     '=',
    '*':         '×',
    'x':         '×',
    '/':         '÷',
    '-':         '−',
    '+':         '+',
    '%':         '%',
    '.':         '.',
    ',':         '.',    // numpad locale
  };
  '0123456789'.split('').forEach(d => { KEY_MAP[d] = d; });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 't' || e.key === 'T') { toggleTheme(); return; }
    if (e.key === 'h' || e.key === 'H') { toggleHistory(); return; }

    const label = KEY_MAP[e.key];
    if (!label) return;
    e.preventDefault();

    // Flash matching button
    const match = [...gridEl.querySelectorAll('.btn')]
      .find(b => b.dataset.lbl === label);
    if (match) {
      match.classList.add('active');
      setTimeout(() => match.classList.remove('active'), 130);
    }

    dispatch(label);
  });

  /* ──────────────────────────────────────────────────────────
     THEME TOGGLE
  ────────────────────────────────────────────────────────── */
  function toggleTheme() {
    const html    = document.documentElement;
    const isDark  = html.dataset.theme !== 'light';
    html.dataset.theme = isDark ? 'light' : 'dark';
    themeBtn.classList.toggle('active', !isDark);
  }
  themeBtn.addEventListener('click', toggleTheme);

  /* ──────────────────────────────────────────────────────────
     HISTORY DRAWER TOGGLE
  ────────────────────────────────────────────────────────── */
  function toggleHistory() {
    const isOpen = histDrawer.classList.toggle('open');
    histBtn.classList.toggle('active', isOpen);
  }
  histBtn.addEventListener('click', toggleHistory);

  /* ──────────────────────────────────────────────────────────
     INIT
  ────────────────────────────────────────────────────────── */
  render();

})();
