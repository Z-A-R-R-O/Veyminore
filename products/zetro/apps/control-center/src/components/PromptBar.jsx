'use client';

import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowUp02Icon,
  Attachment01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  File02Icon,
  Globe02Icon,
  HelpCircleIcon,
  Mail01Icon,
  Mic01Icon,
  PlusSignIcon,
  SparklesIcon,
  Tick02Icon
} from '@hugeicons/core-free-icons';
import SlingButton from './SlingButton.jsx';
import WakeSlider from './WakeSlider.jsx';
import './PromptBar.css';

const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];
const EASE_IN_OUT = [0.77, 0, 0.175, 1];
const LINE = 22;
const EDGE = 11;

export const DEFAULT_SOURCES = [
  {
    key: 'files',
    name: 'Photos & files',
    description: 'Upload from this device',
    icon: Attachment01Icon,
    attach: true
  },
  { key: 'workspace', name: 'Workspace Code', description: 'Active project repository & files', icon: File02Icon },
  { key: 'rct', name: 'RCT Review Gate', description: 'Independent code qualification', icon: Tick02Icon },
  { key: 'agr', name: 'AGR Worker Fleet', description: 'Autonomous agent generation', icon: SparklesIcon },
  { key: 'web', name: 'Web search', description: 'Live verified results', icon: Globe02Icon }
];

export const DEFAULT_COMMANDS = [
  { key: 'plan', name: '/plan', description: 'Generate IFZ execution route plan' },
  { key: 'verify', name: '/verify', description: 'Trigger independent verification gate' },
  { key: 'summarize', name: '/summarize', description: 'Digest the active run events so far' },
  { key: 'audit', name: '/audit', description: 'Inspect authority bounds and scope' },
  { key: 'draft', name: '/draft', description: 'Draft code increment or spec package' },
  { key: 'tasks', name: '/tasks', description: 'Turn objective into bounded task envelopes' }
];

export const DEFAULT_MODELS = [
  { key: 'standard', name: 'ZETRO Standard', tag: 'Charter v1.2' },
  { key: 'eco', name: 'ECO Mode', tag: 'Fast' },
  { key: 'build', name: 'Build Mode', tag: 'Code' },
  { key: 'review', name: 'Review Mode', tag: 'Read-only' },
  { key: 'design', name: 'Design Mode', tag: 'Product' },
  { key: 'qual', name: 'Qualification Mode', tag: 'Strict' },
  { key: 'recovery', name: 'Recovery Mode', tag: 'Reconcile' }
];

export const DEFAULT_EFFORTS = ['Low', 'Medium', 'High', 'Strict', 'Max'];

export const EFFORT_LABELS = {
  Low: 'Minimal',
  Medium: 'Balanced',
  High: 'Deep',
  Strict: 'Strict',
  Max: 'Max'
};

export const EFFORT_SUBTITLES = {
  Low: 'Fast',
  Medium: 'Standard',
  High: 'Extended',
  Strict: 'Proof',
  Max: 'Exhaustive'
};

export const EFFORT_DESCRIPTIONS = {
  Low: 'Fast execution with minimal reasoning depth',
  Medium: 'Balanced deliberation with standard verification',
  High: 'Extended reasoning with multi-step verification',
  Strict: 'Rigid boundary checks and proof receipts',
  Max: 'Exhaustive qualification, deep reasoning & proof'
};

const mix = (a, b, t) => a + (b - a) * t;
const pathAt = (a, b, t) => {
  let d = '';
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? 'L' : 'M'}${mix(a[i], b[i], t).toFixed(2)} ${mix(a[i + 1], b[i + 1], t).toFixed(2)}`;
  }
  return `${d}Z`;
};

const parseToken = draft => {
  const m = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!m) return null;
  return { kind: m[2] === '@' ? 'at' : 'slash', query: m[3].toLowerCase(), start: m.index + m[1].length };
};

const renderIcon = (icon, size) =>
  isValidElement(icon) ? icon : <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} />;

function SendGlyph({ busy, morphDuration, squash, tilt }) {
  const reduce = useReducedMotion();
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(
      t,
      target,
      reduce ? { duration: 0 } : { duration: morphDuration / 1000, ease: EASE_IN_OUT }
    );
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, 'change', v => {
    pathRef.current?.setAttribute('d', pathAt(ARROW_UP, SQUARE, v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})` : '';
    }
  });

  return (
    <svg
      ref={svgRef}
      className="prompt-bar__glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, t.get())} />
    </svg>
  );
}

export default function PromptBar({
  value,
  onChange,
  placeholder = 'Ask IFZ or assign tasks to workers…',
  sources = DEFAULT_SOURCES,
  commands = DEFAULT_COMMANDS,
  models = DEFAULT_MODELS,
  defaultModel = '',
  selectedModel = undefined,
  onModelChange = undefined,
  efforts = DEFAULT_EFFORTS,
  defaultEffort = '',
  onEffortChange,
  busy = false,
  onSend,
  onStop,
  onAttach,
  onDictate,
  attachments: propAttachments = undefined,
  onAddAttachment = undefined,
  onRemoveAttachment = undefined,
  headerSlot = null,
  background = 'linear-gradient(180deg, #17181e 0%, #111216 100%)',
  color = '#f4f4f2',
  menuBackground = '#181920',
  sparkColor = 'var(--accent, #8ce6b8)',
  sparkBoost = 1,
  width = 820,
  radius = 20,
  maxRows = 6,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.96,
  className = ''
}) {
  const reduce = useReducedMotion();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const glowRef = useRef(null);
  const sparkRef = useRef(null);
  const typing = useRef({ energy: 0, strokes: 0 });
  const boost = useRef(sparkBoost);
  boost.current = sparkBoost;
  const introRef = useRef(true);
  const rowRefs = useRef([]);
  const lastOpen = useRef(null);
  const dictation = useRef(0);
  const latest = useRef({});
  latest.current = {
    onSend,
    onStop,
    onAttach,
    onDictate,
    onEffortChange,
    onModelChange,
    onAddAttachment,
    onRemoveAttachment
  };

  const [internalDraft, setInternalDraft] = useState('');
  const draft = value !== undefined ? value : internalDraft;
  const setDraft = useCallback(
    next => {
      if (typeof next === 'function') {
        const val = next(draft);
        if (value === undefined) setInternalDraft(val);
        onChange?.(val);
      } else {
        if (value === undefined) setInternalDraft(next);
        onChange?.(next);
      }
    },
    [draft, value, onChange]
  );

  const [internalAttachments, setInternalAttachments] = useState([]);
  const attachments = propAttachments !== undefined ? propAttachments : internalAttachments;

  const [internalModelKey, setInternalModelKey] = useState(defaultModel || (models[0]?.key ?? ''));
  const modelKey = selectedModel !== undefined ? selectedModel : internalModelKey;

  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortIndex, setEffortIndex] = useState(() => {
    const i = efforts.indexOf(defaultEffort);
    return i >= 0 ? i : Math.max(0, Math.floor((efforts.length - 1) / 2));
  });

  useEffect(() => {
    if (defaultEffort) {
      const i = efforts.indexOf(defaultEffort);
      if (i >= 0 && i !== effortIndex) {
        setEffortIndex(i);
      }
    }
  }, [defaultEffort, efforts]);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [effortInteracting, setEffortInteracting] = useState(false);
  const [holdingVisibility, setHoldingVisibility] = useState(false);
  const fadeTimerRef = useRef(null);
  const prevBusy = useRef(busy);

  const model = models.find(m => m.key === modelKey) ?? models[0];
  const token = dismissed ? null : parseToken(draft);
  const open = plusOpen ? 'at' : (token?.kind ?? (modelOpen ? 'model' : effortOpen ? 'effort' : null));
  const query = plusOpen ? '' : (token?.query ?? '');
  const list = useMemo(() => {
    if (open === 'at') return sources.filter(s => s.name.toLowerCase().includes(query));
    if (open === 'slash') return commands.filter(c => c.name.replace(/^\//, '').toLowerCase().startsWith(query));
    if (open === 'model') return models;
    return [];
  }, [open, query, sources, commands, models]);
  const cursor = Math.min(active, Math.max(0, list.length - 1));
  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const armed = busy || canSend;
  const sendVisible = canSend || busy || holdingVisibility;
  const level = efforts[effortIndex] ?? '';
  const levelLabel = EFFORT_LABELS[level] || level;
  const levelSub = EFFORT_SUBTITLES[level] || '';
  const maxed = efforts.length > 1 && effortIndex === efforts.length - 1;

  useEffect(() => {
    if (canSend || busy) {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      setHoldingVisibility(false);
    }
  }, [canSend, busy]);

  useEffect(() => {
    if (prevBusy.current && !busy) {
      setHoldingVisibility(true);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = setTimeout(() => {
        setHoldingVisibility(false);
        fadeTimerRef.current = null;
      }, 5000);
    }
    prevBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  const closeMenus = useCallback(() => {
    setPlusOpen(false);
    setModelOpen(false);
    setEffortOpen(false);
  }, []);

  useLayoutEffect(() => {
    const glow = glowRef.current;
    if (!glow || !open) return;
    const row = rowRefs.current[cursor];
    if (!row) {
      glow.style.opacity = '0';
      return;
    }
    const fresh = lastOpen.current !== open;
    lastOpen.current = open;
    if (fresh) glow.style.transition = 'none';
    glow.style.top = `${row.offsetTop}px`;
    glow.style.height = `${row.offsetHeight}px`;
    glow.style.opacity = '1';
    if (fresh) {
      void glow.offsetHeight;
      glow.style.transition = '';
    }
  }, [open, cursor, list]);

  useEffect(() => {
    if (!open) lastOpen.current = null;
  }, [open]);

  useEffect(() => {
    if (!plusOpen && !modelOpen && !effortOpen) return undefined;
    const onDown = e => {
      if (!rootRef.current?.contains(e.target)) closeMenus();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [plusOpen, modelOpen, effortOpen, closeMenus]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const max = LINE * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [draft, maxRows]);

  useEffect(
    () => () => {
      dictation.current += 1;
    },
    []
  );

  // Magic Canvas Sparks on Max Effort
  useEffect(() => {
    const canvas = sparkRef.current;
    if (!maxed || reduce || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    typing.current.strokes = 0;
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let due = 0;
    let speed = 1;
    let pulse = 0;
    const parts = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = burst => {
      parts.push({
        x: Math.random() * w,
        y: burst ? h * (0.2 + Math.random() * 0.8) : h + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4
      });
    };
    const tick = now => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const typed = typing.current;
      const gain = boost.current;
      typed.energy *= Math.exp(-dt / 0.8);
      pulse *= Math.exp(-dt / 0.16);
      if (typed.strokes > 0) {
        typed.strokes = 0;
        if (gain > 0) pulse = 1;
      }
      const energy = typed.energy * gain;
      speed += (1 + energy * 6 - speed) * (1 - Math.exp(-dt / 0.15));
      due += dt;
      while (due > 0.14) {
        due -= 0.14;
        if (parts.length < 30) spawn(false);
      }
      ctx.clearRect(0, 0, w, h);
      const computedSpark = getComputedStyle(canvas).getPropertyValue('--pb-spark').trim() || '#8ce6b8';
      ctx.fillStyle = computedSpark;
      ctx.shadowColor = computedSpark;
      ctx.shadowBlur = 6 + energy * 10 + pulse * 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        const twinkle = 0.7 + 0.3 * Math.sin((now / 160) * (1 + energy) + p.phase);
        p.y += p.vy * dt * speed;
        if (p.y < -4) {
          p.y = h + 3;
          p.x = Math.random() * w;
        }
        const edge = Math.min(1, Math.max(0, p.y / 14), Math.max(0, (h - p.y) / 14));
        ctx.globalAlpha = Math.min(1, Math.sin(k * Math.PI) * (0.9 + energy * 0.25) * twinkle) * edge;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin((now / 900) * (1 + energy * 0.8) + p.phase) * p.sway,
          p.y,
          p.r * twinkle * (1 + energy * 0.35),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    resize();
    for (let i = 0; i < 26; i += 1) spawn(true);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [maxed, reduce, sparkColor]);

  // Global Intro Animation: CardNav-Style Horizontal Clip-Path Unroll & Staggered Reveal
  useLayoutEffect(() => {
    const capsule = rootRef.current;
    if (!capsule || !introRef.current) return;
    introRef.current = false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const width = capsule.offsetWidth || 860;
    const height = capsule.offsetHeight || 148;
    const r = radius || 20;

    capsule.animate(
      [
        { clipPath: `inset(0px ${Math.max(0, (width - height) / 2)}px round ${height / 2}px)`, opacity: 0 },
        { clipPath: `inset(0px 0px round ${r}px)`, opacity: 1 }
      ],
      { duration: 750, delay: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
    );

    const staggerEls = capsule.querySelectorAll('.ifz-prompt-chips-bar, .prompt-bar__input, .prompt-bar__bar');
    staggerEls.forEach((el, index) => {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ],
        { duration: 520, delay: 280 + index * 48, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
      );
    });
  }, [radius]);

  // Magic Bento Dynamic Cursor Glow Handlers
  const handleCapsulePointerMove = useCallback(e => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty('--mouse-x', `${x.toFixed(1)}px`);
    el.style.setProperty('--mouse-y', `${y.toFixed(1)}px`);
    el.style.setProperty('--mouse-hot', '1');
  }, []);

  const handleCapsulePointerLeave = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--mouse-hot', '0');
  }, []);

  const setEffort = i => {
    const next = Math.max(0, Math.min(efforts.length - 1, i));
    if (next === effortIndex) return;
    setEffortIndex(next);
    latest.current.onEffortChange?.(efforts[next]);
  };

  const effortFromPointer = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = (e.clientX - rect.left - EDGE) / Math.max(1, rect.width - 2 * EDGE);
    setEffort(Math.round(k * (efforts.length - 1)));
  };

  const onEffortKey = e => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (step) {
      e.preventDefault();
      setEffort(effortIndex + step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setEffort(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setEffort(efforts.length - 1);
    } else if (e.key === 'Escape') {
      setEffortOpen(false);
      focusInput();
    }
  };

  const stepAt = i => `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${i / Math.max(1, efforts.length - 1)})`;
  const fillAt = i => (i === efforts.length - 1 ? '100%' : `calc(${stepAt(i)} + 7px)`);

  const pick = row => {
    if (open === 'model') {
      if (selectedModel === undefined) setInternalModelKey(row.key);
      latest.current.onModelChange?.(row.key);
      setModelOpen(false);
      focusInput();
      return;
    }
    const head = token ? draft.slice(0, token.start) : draft;
    if (row.attach) {
      setDraft(head);
      Promise.resolve(latest.current.onAttach?.()).then(files => {
        if (!files) return;
        const fileList = Array.isArray(files) ? files : [files];
        if (propAttachments !== undefined) {
          fileList.forEach(f => latest.current.onAddAttachment?.(f));
        } else {
          setInternalAttachments(a => [...a, ...fileList]);
        }
      });
    } else if (open === 'at') {
      setDraft(`${head}@${row.name} `);
    } else {
      setDraft(`${head}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    focusInput();
  };

  const send = () => {
    if (!canSend || busy) return;
    latest.current.onSend?.(draft.trim(), { attachments, model, effort: level });
    setDraft('');
    if (propAttachments === undefined) {
      setInternalAttachments([]);
    }
    setDismissed(false);
    closeMenus();
    focusInput();

    // Don't hide immediately after sending: Wait 5 sec, then gradually hide (fade out)
    setHoldingVisibility(true);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setHoldingVisibility(false);
      fadeTimerRef.current = null;
    }, 5000);
  };

  const toggleListen = () => {
    if (listening) {
      dictation.current += 1;
      setListening(false);
      return;
    }
    const seq = ++dictation.current;
    setListening(true);
    Promise.resolve(latest.current.onDictate?.()).then(
      text => {
        if (seq !== dictation.current) return;
        setListening(false);
        if (text) setDraft(d => (d.trim() ? `${d.trimEnd()} ${text}` : text));
        focusInput();
      },
      () => {
        if (seq === dictation.current) setListening(false);
      }
    );
  };

  const onKeyDown = e => {
    if (open && list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((cursor + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(list[cursor]);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        closeMenus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const down = e => {
    if (e.button !== 0 || !armed) return;
    setPressed(true);
  };
  const up = () => setPressed(false);

  return (
    <div
      ref={rootRef}
      className={`prompt-bar ifz-prompt-capsule${className ? ` ${className}` : ''}`}
      data-busy={busy ? '' : undefined}
      data-max={maxed ? '' : undefined}
      onPointerMove={handleCapsulePointerMove}
      onPointerLeave={handleCapsulePointerLeave}
      style={{
        '--pb-bg': background,
        '--pb-ink': color,
        '--pb-menu': menuBackground,
        '--pb-w': `${width}px`,
        '--pb-radius': `${radius}px`,
        '--pb-spark': sparkColor,
        '--pb-press': pressScale
      }}
    >
      {/* Optional Top Header Slot for IFZ Route Chips & Constraint Status */}
      {headerSlot}

      {/* Menu / Dropdown Popovers */}
      {open ? (
        <div
          className="prompt-bar__menu"
          role={open === 'effort' ? 'dialog' : 'listbox'}
          aria-label={
            open === 'at' ? 'Sources' : open === 'slash' ? 'Commands' : open === 'model' ? 'Models' : 'Effort'
          }
          data-kind={open}
        >
          {open === 'effort' ? (
            <>
              <div className="prompt-bar__effort-head">
                <span className="prompt-bar__effort-title">Effort &amp; Reasoning</span>
                <span className="prompt-bar__effort-level">{level}</span>
                <span className="prompt-bar__effort-help" title="Higher effort activates deeper independent verification gates">
                  <HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.8} />
                </span>
              </div>
              <div className="prompt-bar__effort-ends">
                <span>Fast execution</span>
                <span>Max qualification</span>
              </div>
              <div
                className="prompt-bar__effort-track"
                role="slider"
                tabIndex={0}
                aria-label="Effort"
                aria-valuemin={0}
                aria-valuemax={efforts.length - 1}
                aria-valuenow={effortIndex}
                aria-valuetext={level}
                style={{ '--pb-effort-x': stepAt(effortIndex), '--pb-effort-fill': fillAt(effortIndex) }}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {}
                  e.currentTarget.focus({ preventScroll: true });
                  effortFromPointer(e);
                }}
                onPointerMove={e => {
                  if (e.buttons & 1) effortFromPointer(e);
                }}
                onKeyDown={onEffortKey}
              >
                <span className="prompt-bar__effort-fill" />
                {efforts.map((label, i) => (
                  <i key={label} className="prompt-bar__effort-dot" style={{ left: stepAt(i) }} />
                ))}
                <span className="prompt-bar__effort-thumb" />
              </div>
            </>
          ) : (
            <>
              <span ref={glowRef} className="prompt-bar__glow" aria-hidden="true" />
              {list.map((row, i) => (
                <button
                  key={row.key}
                  ref={el => {
                    rowRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  className="prompt-bar__row"
                  onMouseDown={e => e.preventDefault()}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(row)}
                >
                  {open === 'at' ? <span className="prompt-bar__row-icon">{renderIcon(row.icon, 15)}</span> : null}
                  <span className="prompt-bar__row-name">{row.name}</span>
                  {row.description ? <span className="prompt-bar__row-desc">{row.description}</span> : null}
                  {open === 'model' ? (
                    <>
                      <span className="prompt-bar__row-tag">{row.tag}</span>
                      <span className="prompt-bar__row-check" data-on={row.key === model?.key ? '' : undefined}>
                        <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.5} />
                      </span>
                    </>
                  ) : null}
                </button>
              ))}
              {list.length === 0 ? <div className="prompt-bar__empty">No matches for “{query}”</div> : null}
            </>
          )}
        </div>
      ) : null}

      {/* Main Composer Field */}
      <div
        className="prompt-bar__field"
        role="presentation"
        data-max={maxed ? '' : undefined}
        onPointerDown={e => {
          if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
        }}
        onClick={focusInput}
      >
        <canvas ref={sparkRef} className="prompt-bar__sparks" aria-hidden="true" />
        {attachments.length > 0 ? (
          <div className="prompt-bar__chips">
            {attachments.map((file, i) => (
              <span key={`${typeof file === 'string' ? file : file?.name}-${i}`} className="prompt-bar__chip">
                <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={2} />
                <span className="prompt-bar__chip-name">{typeof file === 'string' ? file : file?.name}</span>
                <button
                  type="button"
                  className="prompt-bar__chip-x"
                  aria-label={`Remove ${typeof file === 'string' ? file : file?.name}`}
                  onClick={() => {
                    if (propAttachments !== undefined) {
                      latest.current.onRemoveAttachment?.(typeof file === 'object' && file?.id ? file.id : i);
                    } else {
                      setInternalAttachments(a => a.filter((_, j) => j !== i));
                    }
                  }}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="prompt-bar__input"
          rows={1}
          value={draft}
          placeholder={listening ? 'Listening to instructions…' : placeholder}
          aria-label="IFZ Prompt Input"
          onChange={e => {
            setDraft(e.target.value);
            typing.current.energy = Math.min(1.6, typing.current.energy + 0.22);
            typing.current.strokes = Math.min(4, typing.current.strokes + 1);
            setDismissed(false);
            closeMenus();
            setActive(0);
          }}
          onFocus={closeMenus}
          onKeyDown={onKeyDown}
        />

        {/* Bottom Toolbar inside the Composer */}
        <div className="prompt-bar__bar">
          {efforts.length > 0 ? (
            <div
              className="prompt-bar__effort-control"
              role="group"
              aria-label={`Reasoning Effort: ${levelLabel}`}
              data-interacting={effortInteracting ? 'true' : undefined}
              onPointerDown={() => setEffortInteracting(true)}
              onPointerUp={() => setEffortInteracting(false)}
              onPointerCancel={() => setEffortInteracting(false)}
            >
              {/* Minimal Floating Micro-Capsule: Appears ONLY on hover or interaction */}
              <div className="prompt-bar__effort-tooltip" role="tooltip" aria-hidden="true">
                <span className="effort-tooltip-dot" />
                <span className="effort-tooltip-name">{levelLabel}</span>
                {levelSub ? <span className="effort-tooltip-sub">{levelSub}</span> : null}
              </div>

              {/* The Sleek WakeSlider Equalizer Track */}
              <div className="prompt-bar__effort-wake">
                <WakeSlider
                  value={effortIndex}
                  min={0}
                  max={efforts.length - 1}
                  step={1}
                  bars={22}
                  height={20}
                  restHeight={6}
                  gap={2.5}
                  fillColor={sparkColor || 'var(--accent, #8ce6b8)'}
                  trackColor="rgba(255, 255, 255, 0.09)"
                  crestColor="#c4ffdf"
                  sensitivity={1.1}
                  reach={4.5}
                  skew={0.5}
                  glide={0.25}
                  onChange={val => {
                    setEffort(Math.round(val));
                  }}
                  ariaLabel={`Reasoning effort: ${levelLabel}`}
                />
              </div>
            </div>
          ) : null}
          <span className="prompt-bar__spacer" />
          <div
            className="prompt-bar__send-slot"
            data-visible={sendVisible ? 'true' : 'false'}
            aria-hidden={!sendVisible}
          >
            <SlingButton
              disabled={!busy && !canSend && !holdingVisibility}
              onSend={() => {
                if (busy) latest.current.onStop?.();
                else send();
              }}
              padColor={busy ? '#ef4444' : '#f5f5f5'}
              iconColor={busy ? '#ffffff' : '#18181b'}
              accentColor={busy ? '#ef4444' : '#f5f5f5'}
              wellColor={busy ? 'rgba(239, 68, 68, 0.2)' : '#27272a'}
              bandColor={busy ? 'rgba(239, 68, 68, 0.5)' : '#52525b'}
              size={40}
              strokeWidth={3}
              armAt={48}
              maxPull={160}
              launchSpeed={2600}
              recoil={0.2}
              flight={120}
              particles={32}
              spread={60}
              axis="any"
              tapSends
              ariaLabel={busy ? 'Stop Run' : 'Send Prompt to IFZ'}
            >
              {busy ? (
                <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden="true">
                  <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" />
                </svg>
              ) : (
                <HugeiconsIcon icon={ArrowUp02Icon} size={16} strokeWidth={2.4} />
              )}
            </SlingButton>
          </div>
        </div>
      </div>
    </div>
  );
}
