'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopyOutlined, DeleteOutlined, DoubleLeftOutlined, DoubleRightOutlined, DownloadOutlined, FilePdfOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Card, Input, Segmented, Space, Tooltip, Upload, message } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import type { UploadProps } from 'antd';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { fetchReport } from '../api';

type TimeRange = '24h' | '7d' | '30d';
type ThemeMode = 'light' | 'dark';
type TemplateContext = Record<string, string>;
type PlaceholderDefinition = {
  key: string;
  token: string;
  label: string;
  group: string;
  description: string;
  value: string;
};

const COMPANY_NAME_KEY = 'soc_report_company_name';
const COMPANY_LOGO_KEY = 'soc_report_company_logo';
const DEFAULT_LOGO = '/seclink-logo.png';
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 1024 * 1024;
const TEMPLATE_PANEL_KEY = 'soc_report_template_panel_collapsed';

const getTemplatePanelCollapsed = () => {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(TEMPLATE_PANEL_KEY) === 'true'; }
  catch { return false; }
};

const DEFAULT_PLACEHOLDERS: PlaceholderDefinition[] = [
  { key: 'company.name', token: '{{company.name}}', label: 'Company name', group: 'Brand', description: 'Organization shown in the report header.', value: 'Argus' },
  { key: 'company.logo', token: '{{company.logo}}', label: 'Company logo', group: 'Brand', description: 'Uploaded logo rendered in preview and PDF.', value: DEFAULT_LOGO },
  { key: 'report.title', token: '{{report.title}}', label: 'Report title', group: 'Report', description: 'Display title for the report.', value: 'SOC Security Operations Report' },
  { key: 'metrics.mttd', token: '{{metrics.mttd}}', label: 'MTTD', group: 'Metrics', description: 'Mean time to detect.', value: 'N/A' },
  { key: 'metrics.mttr', token: '{{metrics.mttr}}', label: 'MTTR', group: 'Metrics', description: 'Mean time to respond or resolve.', value: 'N/A' },
];

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const renderTemplate = (source: string, context: TemplateContext) => source.replace(
  /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
  (token, key: string) => {
    const value = context[key];
    if (typeof value !== 'string') return token;
    if (key === 'company.logo') return value;
    return escapeHtml(value);
  },
);

const displayPlaceholderValue = (value: string) => (
  /^data:image\/(png|jpeg|webp);base64,/.test(value) ? 'Generated image' : value || '—'
);

const getThemeMode = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  try { return localStorage.getItem('siem_ui_theme') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
};

const FALLBACK_REPORT = `<div class="argus-report-header" style="display:flex; align-items:center; gap:14px; border-bottom:2px solid #3b82f6; padding-bottom:14px; margin-bottom:20px;">
  <img src="{{company.logo}}" alt="Company logo" class="argus-report-logo" style="width:52px; height:52px; object-fit:contain; margin:0; border:0; background:transparent;" />
  <div class="argus-report-title-group" style="display:flex; flex-direction:column; gap:5px;">
    <span class="argus-brand-wordmark argus-report-wordmark" style="font-family:'Orbitron','Share Tech Mono',monospace; font-size:28px; font-weight:800; letter-spacing:.08em; line-height:1;">{{company.name}}</span>
    <span class="argus-report-title" style="font-size:13px; font-weight:700; letter-spacing:.12em;">{{report.title}}</span>
  </div>
</div>

> **Classification:** Internal — SOC Operations  
> **Reporting Window:** Last 7 days  
> **Status:** Sample operational baseline

---

## 1. Executive Summary

The environment's current security posture is **ELEVATED**. The SOC analyzed **745 alerts**, including **165 high or critical events**, and resolved **38 of 52 incident tickets (73.1%)**. Mean time to detect was **4.2m** and mean time to resolve was **14.2m**.

| Posture | Total Alerts | Critical + High | Resolution Rate |
|---|---:|---:|---:|
| **ELEVATED** | **745** | **165** | **73.1%** |

## 2. Core Metrics & Alert Severity

| Severity | Alert Count | Share |
|---|---:|---:|
| Critical | 45 | 6.0% |
| High | 120 | 16.1% |
| Medium | 230 | 30.9% |
| Low | 250 | 33.6% |
| Informational | 100 | 13.4% |

### Top 5 Triggered Detection Rules

| Rank | Detection Rule | Alerts |
|---:|---|---:|
| 1 | Multiple Failed Authentication Attempts | 126 |
| 2 | Suspicious PowerShell Execution | 94 |
| 3 | Malware Signature Detected | 78 |
| 4 | Impossible Travel Authentication | 61 |
| 5 | Outbound Connection to Threat Intel IOC | 47 |

## 3. Alert Trend & Incident Response

| Metric | Value |
|---|---:|
| Total Incident Tickets | **52** |
| Resolved Tickets | **38** |
| Mean Time to Detect (MTTD) | **{{metrics.mttd}}** |
| Mean Time to Respond/Resolve (MTTR) | **{{metrics.mttr}}** |

### Open Critical and High-Priority Tickets

| Ticket | Priority | Incident | Status |
|---|---|---|---|
| \`INC-2026-00421\` | **Critical** | Potential domain administrator compromise | Investigating |
| \`INC-2026-00417\` | **Critical** | C2 beacon detected on finance endpoint | Contained |
| \`INC-2026-00409\` | **High** | Abnormal privileged account activity | Triaged |

## 4. Top RBA Risk Entities

| Rank | Risk Entity | Type | Risk Score | Tier |
|---:|---|---|---:|---|
| 1 | \`192.168.1.50\` | IP | **96.4** | Critical |
| 2 | \`admin_user\` | User | **91.8** | Critical |
| 3 | \`FIN-WS-042\` | Host | **87.3** | High |

## 5. SOC Operational Recommendations

1. **Accelerate priority incident handling:** assign named owners and containment deadlines to all open critical incidents.
2. **Reduce concentrated detection risk:** hunt across the highest-scoring IP, host, and user entities.
3. **Tune high-volume detections:** review false-positive concentration without weakening detection coverage.
4. **Improve response efficiency:** automate repetitive enrichment and containment actions.
`;

export default function ReportGenerator() {
  const [range, setRange] = useState<TimeRange>('7d');
  const [markdown, setMarkdown] = useState(FALLBACK_REPORT);
  const [loading, setLoading] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getThemeMode);
  const [templateContext, setTemplateContext] = useState<TemplateContext>(() => Object.fromEntries(DEFAULT_PLACEHOLDERS.map((item) => [item.key, item.value])));
  const [placeholders, setPlaceholders] = useState<PlaceholderDefinition[]>(DEFAULT_PLACEHOLDERS);
  const [companyName, setCompanyName] = useState('Argus');
  const [companyLogo, setCompanyLogo] = useState(DEFAULT_LOGO);
  const [placeholderSearch, setPlaceholderSearch] = useState('');
  const [templatePanelCollapsed, setTemplatePanelCollapsed] = useState(getTemplatePanelCollapsed);
  const reportRequestId = useRef(0);
  const editorRef = useRef<TextAreaRef>(null);
  const editorMirrorRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const expectedScrollTop = useRef<{ editor: number | null; preview: number | null }>({ editor: null, preview: null });
  const suppressScrollUntil = useRef({ editor: 0, preview: 0 });
  const cursorHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightedPreviewHeading = useRef<HTMLElement | null>(null);

  const setTemplatePanel = (collapsed: boolean) => {
    setTemplatePanelCollapsed(collapsed);
    try { localStorage.setItem(TEMPLATE_PANEL_KEY, String(collapsed)); } catch {}
  };

  const syncScroll = useCallback((source: HTMLElement, target: HTMLElement | null, sourceName: 'editor' | 'preview', targetName: 'editor' | 'preview') => {
    if (!target) return;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.scrollHeight - target.clientHeight;
    if (sourceRange <= 0 || targetRange <= 0) return;

    const preview = previewScrollRef.current;
    const mirror = editorMirrorRef.current;
    const editor = editorRef.current?.resizableTextArea?.textArea;
    const points: Array<{ editor: number; preview: number }> = [{ editor: 0, preview: 0 }];
    if (preview && mirror && editor) {
      const editorRange = Math.max(0, editor.scrollHeight - editor.clientHeight);
      const previewRange = Math.max(0, preview.scrollHeight - preview.clientHeight);
      const editorAnchors = Array.from(mirror.querySelectorAll<HTMLElement>('[data-scroll-section]'));
      const previewAnchors = Array.from(preview.querySelectorAll<HTMLElement>('#report-preview-container h1, #report-preview-container h2, #report-preview-container h3, #report-preview-container h4, #report-preview-container h5, #report-preview-container h6'));
      const previewRect = preview.getBoundingClientRect();
      const count = Math.min(editorAnchors.length, previewAnchors.length);
      for (let index = 0; index < count; index += 1) {
        const editorTop = Math.min(editorRange, Math.max(0, editorAnchors[index].offsetTop - 18));
        const previewRawTop = previewAnchors[index].getBoundingClientRect().top - previewRect.top + preview.scrollTop;
        const previewTop = Math.min(previewRange, Math.max(0, previewRawTop - 24));
        const previous = points[points.length - 1];
        if (editorTop > previous.editor + 1 && previewTop > previous.preview + 1) {
          points.push({ editor: editorTop, preview: previewTop });
        }
      }
      const previous = points[points.length - 1];
      if (editorRange > previous.editor + 1 || previewRange > previous.preview + 1) {
        points.push({ editor: editorRange, preview: previewRange });
      }
    }

    const sourceKey = sourceName;
    const targetKey = targetName;
    let nextTop = (source.scrollTop / sourceRange) * targetRange;
    if (points.length > 1) {
      let upperIndex = points.findIndex((point) => point[sourceKey] >= source.scrollTop);
      if (upperIndex < 0) upperIndex = points.length - 1;
      const lowerIndex = Math.max(0, upperIndex - 1);
      const lower = points[lowerIndex];
      const upper = points[upperIndex];
      const sectionRange = upper[sourceKey] - lower[sourceKey];
      const progress = sectionRange > 0 ? (source.scrollTop - lower[sourceKey]) / sectionRange : 0;
      nextTop = lower[targetKey] + Math.max(0, Math.min(1, progress)) * (upper[targetKey] - lower[targetKey]);
    }
    if (Math.abs(target.scrollTop - nextTop) < 1) return;
    expectedScrollTop.current[targetName] = nextTop;
    suppressScrollUntil.current[targetName] = performance.now() + 120;
    target.scrollTop = nextTop;
  }, []);

  const handleLinkedScroll = useCallback((sourceName: 'editor' | 'preview', source: HTMLElement) => {
    const expected = expectedScrollTop.current[sourceName];
    if (expected !== null && Math.abs(source.scrollTop - expected) < 2) {
      expectedScrollTop.current[sourceName] = null;
      suppressScrollUntil.current[sourceName] = 0;
      return;
    }
    if (expected !== null && performance.now() < suppressScrollUntil.current[sourceName]) return;
    expectedScrollTop.current[sourceName] = null;
    suppressScrollUntil.current[sourceName] = 0;
    if (sourceName === 'editor') {
      syncScroll(source, previewScrollRef.current, 'editor', 'preview');
    } else {
      syncScroll(source, editorRef.current?.resizableTextArea?.textArea ?? null, 'preview', 'editor');
    }
  }, [syncScroll]);

  const alignPreviewToHeadingAtCursor = useCallback((textarea: HTMLTextAreaElement) => {
    const caret = textarea.selectionStart;
    const lines = markdown.split('\n');
    let lineStart = 0;
    let insideFence = false;
    let headingIndex = 0;
    let selectedHeadingIndex: number | null = null;
    for (const line of lines) {
      const lineEnd = lineStart + line.length;
      const fenceLine = /^\s*(```|~~~)/.test(line);
      const isHeading = !insideFence && /^\s{0,3}#{1,6}\s+\S/.test(line);
      if (caret >= lineStart && caret <= lineEnd) {
        if (isHeading) selectedHeadingIndex = headingIndex;
        break;
      }
      if (isHeading) headingIndex += 1;
      if (fenceLine) insideFence = !insideFence;
      lineStart = lineEnd + 1;
    }
    if (selectedHeadingIndex === null) return;

    const preview = previewScrollRef.current;
    if (!preview) return;
    const headings = preview.querySelectorAll<HTMLElement>('#report-preview-container h1, #report-preview-container h2, #report-preview-container h3, #report-preview-container h4, #report-preview-container h5, #report-preview-container h6');
    const heading = headings[selectedHeadingIndex];
    if (!heading) return;
    const previewRange = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const nextTop = Math.min(previewRange, Math.max(0, heading.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop - 24));
    expectedScrollTop.current.preview = nextTop;
    suppressScrollUntil.current.preview = performance.now() + 160;
    preview.scrollTop = nextTop;

    highlightedPreviewHeading.current?.classList.remove('cursor-locked-section');
    heading.classList.add('cursor-locked-section');
    highlightedPreviewHeading.current = heading;
    if (cursorHighlightTimer.current) clearTimeout(cursorHighlightTimer.current);
    cursorHighlightTimer.current = setTimeout(() => {
      heading.classList.remove('cursor-locked-section');
      if (highlightedPreviewHeading.current === heading) highlightedPreviewHeading.current = null;
      cursorHighlightTimer.current = null;
    }, 900);
  }, [markdown]);

  useEffect(() => () => {
    if (cursorHighlightTimer.current) clearTimeout(cursorHighlightTimer.current);
    highlightedPreviewHeading.current?.classList.remove('cursor-locked-section');
  }, []);

  const generate = useCallback(async (selected: TimeRange) => {
    const requestId = ++reportRequestId.current;
    setLoading(true);
    try {
      const response = await fetchReport(selected);
      if (requestId !== reportRequestId.current) return;
      const content = typeof response?.markdown_content === 'string' ? response.markdown_content.trim() : '';
      if (!content || content === '# report\nwho' || content === '# report \\n who') {
        setMarkdown(FALLBACK_REPORT);
        message.warning('Report service returned no content; showing the SOC baseline template.');
      } else {
        setMarkdown(response.markdown_content);
      }
      if (response?.template_context && typeof response.template_context === 'object') {
        setTemplateContext(Object.fromEntries(Object.entries(response.template_context).map(([key, value]) => [key, String(value ?? '')])));
      }
      if (Array.isArray(response?.placeholder_catalog) && response.placeholder_catalog.length) {
        setPlaceholders(response.placeholder_catalog.map((item: PlaceholderDefinition) => ({ ...item, value: String(item.value ?? '') })));
      }
    } catch {
      if (requestId !== reportRequestId.current) return;
      setMarkdown(FALLBACK_REPORT);
      message.warning('Report service is unavailable; showing the SOC baseline template.');
    } finally {
      if (requestId === reportRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void generate('7d'); }, [generate]);
  useEffect(() => {
    try {
      const savedName = localStorage.getItem(COMPANY_NAME_KEY);
      const savedLogo = localStorage.getItem(COMPANY_LOGO_KEY);
      if (savedName) setCompanyName(savedName);
      if (savedLogo && (/^data:image\/(png|jpeg|webp);base64,/.test(savedLogo) || savedLogo.startsWith('/'))) setCompanyLogo(savedLogo);
    } catch {}
  }, []);
  useEffect(() => {
    const syncTheme = () => setThemeMode(getThemeMode());
    window.addEventListener('siem_theme_changed', syncTheme as EventListener);
    window.addEventListener('storage', syncTheme);
    return () => {
      window.removeEventListener('siem_theme_changed', syncTheme as EventListener);
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

  const resolvedContext = useMemo<TemplateContext>(() => ({
    ...templateContext,
    'company.name': companyName.trim() || 'Company',
    'company.logo': companyLogo,
  }), [companyLogo, companyName, templateContext]);
  const renderedMarkdown = useMemo(() => renderTemplate(markdown, resolvedContext), [markdown, resolvedContext]);
  const editorMirrorContent = useMemo(() => {
    let insideFence = false;
    let sectionIndex = 0;
    const lines = markdown.split('\n');
    return lines.map((line, lineIndex) => {
      const fenceLine = /^\s*(```|~~~)/.test(line);
      const isHeading = !insideFence && /^\s{0,3}#{1,6}\s+\S/.test(line);
      const anchorIndex = isHeading ? sectionIndex++ : null;
      const content = (
        <React.Fragment key={`${lineIndex}-${anchorIndex ?? 'line'}`}>
          {anchorIndex !== null ? <span data-scroll-section={anchorIndex} className="editor-scroll-anchor" /> : null}
          {line}{lineIndex < lines.length - 1 ? '\n' : ''}
        </React.Fragment>
      );
      if (fenceLine) insideFence = !insideFence;
      return content;
    });
  }, [markdown]);
  const visiblePlaceholders = useMemo(() => {
    const query = placeholderSearch.trim().toLowerCase();
    return placeholders.filter((item) => item.key !== 'company.logo' && (!query || `${item.label} ${item.key} ${item.description}`.toLowerCase().includes(query)));
  }, [placeholderSearch, placeholders]);
  const placeholderGroups = useMemo(() => {
    const groups = new Map<string, PlaceholderDefinition[]>();
    visiblePlaceholders.forEach((item) => groups.set(item.group, [...(groups.get(item.group) || []), item]));
    return Array.from(groups.entries());
  }, [visiblePlaceholders]);
  const filename = useMemo(() => `soc-security-operations-report-${range}.md`, [range]);

  const saveCompanyName = (value: string) => {
    setCompanyName(value);
    try { localStorage.setItem(COMPANY_NAME_KEY, value); } catch {}
  };
  const setLogo = (value: string) => {
    setCompanyLogo(value);
    try {
      if (value === DEFAULT_LOGO) localStorage.removeItem(COMPANY_LOGO_KEY);
      else localStorage.setItem(COMPANY_LOGO_KEY, value);
    } catch { message.warning('The logo is too large to save in this browser.'); }
  };
  const beforeLogoUpload: UploadProps['beforeUpload'] = (file) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      message.error('Use a PNG, JPEG, or WebP logo.');
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_LOGO_BYTES) {
      message.error('Logo must be 1 MB or smaller.');
      return Upload.LIST_IGNORE;
    }
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' && setLogo(reader.result);
    reader.onerror = () => message.error('Unable to read this logo.');
    reader.readAsDataURL(file);
    return false;
  };
  const copyToken = async (token: string) => {
    try { await navigator.clipboard.writeText(token); message.success(`${token} copied.`); }
    catch { message.error('Unable to copy placeholder.'); }
  };
  const insertToken = (token: string) => {
    const textarea = editorRef.current?.resizableTextArea?.textArea;
    const start = textarea?.selectionStart ?? markdown.length;
    const end = textarea?.selectionEnd ?? start;
    setMarkdown(`${markdown.slice(0, start)}${token}${markdown.slice(end)}`);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const copyMarkdown = async () => {
    try { await navigator.clipboard.writeText(markdown); message.success('Markdown copied.'); }
    catch { message.error('Unable to copy Markdown.'); }
  };
  const exportMarkdown = () => {
    const url = URL.createObjectURL(new Blob([renderedMarkdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };
  const exportPdf = async () => {
    const target = document.getElementById('report-preview-container');
    if (!target) return;
    target.classList.add('pdf-export-mode');
    try {
      await document.fonts?.ready;
      const images = Array.from(target.querySelectorAll('img'));
      await Promise.all(images.map(async (image) => {
        if (!image.complete) {
          await new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          });
        }
        try { await image.decode(); } catch {}
      }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      // html2pdf is loaded only for explicit export, keeping the editor lightweight.
      // @ts-expect-error html2pdf.js is an optional runtime export dependency.
      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf().set({ margin: 12, filename: `soc-report-${range}.pdf`, image: { type: 'jpeg', quality: .96 }, html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(target).save();
    } catch {
      message.error('Unable to export PDF.');
    } finally {
      target.classList.remove('pdf-export-mode');
    }
  };

  return (
    <main className={`soc-report-page theme-${themeMode}`}>
      <div className="soc-report-heading">
        <div>
          <span className="soc-report-eyebrow">REPORT DESIGNER</span>
          <h1>Security report workspace</h1>
          <p>Compose a reusable Markdown template with live SOC metrics and your organization branding.</p>
        </div>
      </div>
      <div className="soc-report-toolbar">
        <Space wrap>
          <Segmented<TimeRange> options={[{ label: '24 Hours', value: '24h' }, { label: '7 Days', value: '7d' }, { label: '30 Days', value: '30d' }]} value={range} onChange={(value) => { setRange(value); void generate(value); }} />
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void generate(range)}>Regenerate</Button>
        </Space>
        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={() => void copyMarkdown()}>Copy Template</Button>
          <Button icon={<DownloadOutlined />} onClick={exportMarkdown}>Export Resolved Markdown</Button>
          <Button icon={<FilePdfOutlined />} onClick={() => void exportPdf()}>Download PDF</Button>
        </Space>
      </div>

      <div className={`soc-report-workspace${templatePanelCollapsed ? ' template-panel-collapsed' : ''}`}>
        {templatePanelCollapsed ? (
          <aside className="template-panel-rail" aria-label="Template data panel">
            <Tooltip title="Expand template data" placement="right">
              <Button type="text" className="template-panel-toggle" icon={<DoubleRightOutlined />} onClick={() => setTemplatePanel(false)} aria-label="Expand template data" />
            </Tooltip>
            <span className="template-panel-rail-label">Template data</span>
          </aside>
        ) : (
        <Card
          title="Template data"
          extra={<Tooltip title="Collapse template data"><Button type="text" size="small" className="template-panel-toggle" icon={<DoubleLeftOutlined />} onClick={() => setTemplatePanel(true)} aria-label="Collapse template data" /></Tooltip>}
          className="soc-report-card setup-card"
        >
          <div className="template-data-layout">
          <section className="report-setup-section">
            <div className="report-section-label">Brand</div>
            <label className="report-field-label" htmlFor="report-company-name">Company name</label>
            <Input id="report-company-name" value={companyName} maxLength={80} onChange={(event) => saveCompanyName(event.target.value)} placeholder="Company name" />
            <div className="report-logo-row">
              <div className="report-logo-preview"><img src={companyLogo} alt="Current company logo" /></div>
              <Space direction="vertical" size={6}>
                <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={beforeLogoUpload}>
                  <Button icon={<UploadOutlined />}>Upload logo</Button>
                </Upload>
                {companyLogo !== DEFAULT_LOGO ? <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setLogo(DEFAULT_LOGO)}>Use default</Button> : null}
              </Space>
            </div>
            <div className="report-field-help">PNG, JPEG, or WebP · maximum 1 MB · saved in this browser</div>
          </section>
          <section className="report-setup-section placeholder-library">
            <div className="report-section-label">Placeholder library</div>
            <Input.Search value={placeholderSearch} onChange={(event) => setPlaceholderSearch(event.target.value)} allowClear placeholder="Search fields" />
            <div className="placeholder-groups">
              {placeholderGroups.map(([group, items]) => (
                <div className="placeholder-group" key={group}>
                  <div className="placeholder-group-title">{group}</div>
                  {items.map((item) => (
                    <div className="placeholder-item" key={item.key}>
                      <div className="placeholder-item-copy">
                        <strong>{item.label}</strong>
                        <code>{item.token}</code>
                        <span title={displayPlaceholderValue(String(resolvedContext[item.key] ?? item.value))}>{displayPlaceholderValue(String(resolvedContext[item.key] ?? item.value))}</span>
                      </div>
                      <Space size={2}>
                        <Tooltip title="Copy placeholder"><Button type="text" size="small" aria-label={`Copy ${item.label} placeholder`} icon={<CopyOutlined />} onClick={() => void copyToken(item.token)} /></Tooltip>
                        <Tooltip title="Insert at cursor"><Button type="text" size="small" aria-label={`Insert ${item.label} placeholder`} icon={<PlusOutlined />} onClick={() => insertToken(item.token)} /></Tooltip>
                      </Space>
                    </div>
                  ))}
                </div>
              ))}
              {!placeholderGroups.length ? <div className="placeholder-empty">No matching placeholders.</div> : null}
            </div>
          </section>
          </div>
        </Card>
        )}

        <div className="soc-report-editor-grid">
          <Card title="Markdown Editor" extra={<span className="scroll-link-label">Section linked</span>} className="soc-report-card editor-card">
            <div ref={editorMirrorRef} className="editor-scroll-mirror" aria-hidden="true">{editorMirrorContent}</div>
            <Input.TextArea
              ref={editorRef}
              aria-label="SOC report Markdown editor"
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              onScroll={(event) => handleLinkedScroll('editor', event.currentTarget)}
              onClick={(event) => alignPreviewToHeadingAtCursor(event.currentTarget)}
              onKeyUp={(event) => alignPreviewToHeadingAtCursor(event.currentTarget)}
              spellCheck={false}
              wrap="soft"
            />
          </Card>
          <Card title="Live Preview" extra={<span className="scroll-link-label">Section linked</span>} className="soc-report-card preview-card">
            <div ref={previewScrollRef} className="preview-scroll-pane" onScroll={(event) => handleLinkedScroll('preview', event.currentTarget)}>
              <article id="report-preview-container" className="soc-report-markdown">
                <ReactMarkdown urlTransform={(url: string) => /^data:image\/(png|jpeg|webp);base64,/.test(url) ? url : defaultUrlTransform(url)} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{
                  img: ({ node: _node, className, src, ...props }: any) => {
                    const chartClass = typeof src === 'string' && src.startsWith('data:image/png;base64,') && !String(className || '').includes('argus-report-logo') ? 'soc-report-chart' : '';
                    return <img {...props} src={src} className={[className, chartClass].filter(Boolean).join(' ')} loading="eager" alt={props.alt || 'SOC report image'} />;
                  },
                  code: ({ node: _node, className, children, ...props }: any) => <code className={className} {...props}>{children}</code>,
                }}>{renderedMarkdown}</ReactMarkdown>
              </article>
            </div>
          </Card>
        </div>
      </div>

      <style jsx global>{`
        .soc-report-page { width:100%; max-width:100%; min-width:0; padding:24px; min-height:100%; overflow-x:hidden; box-sizing:border-box; transition:background-color .2s ease; }
        .soc-report-page.theme-dark { background: #0d1117; color: #e6edf3; }
        .soc-report-page.theme-light { background: #f3f4f6; color: #111827; }
        .soc-report-heading { display:flex; justify-content:space-between; max-width:1720px; margin:0 auto 22px; }
        .soc-report-eyebrow { display:block; margin-bottom:7px; color:#64748b; font-size:10px; font-weight:700; letter-spacing:.16em; }
        .soc-report-heading h1 { margin:0; font-size:30px; font-weight:650; letter-spacing:-.035em; line-height:1.2; }
        .soc-report-heading p { margin:8px 0 0; color:#64748b; font-size:13px; line-height:1.55; }
        .theme-dark .soc-report-heading p, .theme-dark .soc-report-eyebrow { color:#94a3b8; }
        .soc-report-toolbar { display: flex; justify-content: space-between; gap: 16px; margin: 0 auto 16px; max-width: 1720px; }
        .soc-report-workspace { display:grid; grid-template-columns:minmax(230px,280px) minmax(0,1fr); width:100%; min-width:0; gap:16px; height:calc(100vh - 250px); min-height:680px; max-width:1720px; margin:0 auto; transition:grid-template-columns .22s cubic-bezier(.22,1,.36,1); }
        .soc-report-workspace.template-panel-collapsed { grid-template-columns:44px minmax(0,1fr); }
        .soc-report-editor-grid { display:grid; grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr); min-width:0; gap:16px; height:100%; min-height:0; }
        .soc-report-card { min-width:0; height:100%; overflow:hidden; border-radius:12px; box-shadow:0 1px 2px rgba(15,23,42,.04); }
        .theme-dark .soc-report-card { color: #e6edf3; background: #161b22; border-color: #1f2937; }
        .theme-dark .soc-report-card .ant-card-head { color: #f0f6fc; background: #161b22; border-bottom-color: #1f2937; }
        .theme-light .soc-report-card { color: #111827; background: #ffffff; border-color: #e5e7eb; }
        .theme-light .soc-report-card .ant-card-head { color: #111827; background: #ffffff; border-bottom-color: #e5e7eb; }
        .soc-report-card .ant-card-body { height: calc(100% - 57px); padding: 0; overflow: auto; }
        .setup-card { height:100%; }
        .setup-card .ant-card-body { height:calc(100% - 57px); padding:16px 14px 20px; overflow:auto; }
        .template-data-layout { display:flex; flex-direction:column; gap:18px; }
        .template-data-layout .placeholder-library { padding-top:18px; border-top:1px solid #e2e8f0; }
        .theme-dark .template-data-layout .placeholder-library { border-top-color:#30363d; }
        .template-panel-toggle.ant-btn { color:#64748b; opacity:.65; }
        .template-panel-toggle.ant-btn:hover { color:#2563eb !important; opacity:1; background:rgba(37,99,235,.08) !important; }
        .template-panel-rail { display:flex; height:100%; min-height:0; flex-direction:column; align-items:center; gap:18px; padding:10px 4px; border:1px solid #e2e8f0; border-radius:12px; background:#fff; box-sizing:border-box; }
        .theme-dark .template-panel-rail { border-color:#1f2937; background:#161b22; }
        .template-panel-rail-label { color:#64748b; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; writing-mode:vertical-rl; }
        .theme-dark .template-panel-rail-label { color:#94a3b8; }
        .report-setup-section { display:flex; flex-direction:column; gap:10px; }
        .report-section-label { color:#64748b; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
        .theme-dark .report-section-label, .theme-dark .report-field-help { color:#94a3b8; }
        .report-field-label { font-size:12px; font-weight:600; }
        .report-field-help { color:#64748b; font-size:11px; line-height:1.45; }
        .report-logo-row { display:flex; align-items:center; gap:12px; }
        .report-logo-preview { display:grid; width:72px; height:72px; place-items:center; overflow:hidden; border:1px solid #e2e8f0; border-radius:10px; background:#fff; }
        .report-logo-preview img { max-width:58px; max-height:58px; object-fit:contain; }
        .theme-dark .report-logo-preview { border-color:#30363d; }
        .placeholder-library { min-height:0; }
        .placeholder-groups { display:flex; flex-direction:column; gap:16px; margin-top:4px; }
        .placeholder-group { display:flex; flex-direction:column; gap:7px; }
        .placeholder-group-title { color:#64748b; font-size:11px; font-weight:650; }
        .theme-dark .placeholder-group-title { color:#94a3b8; }
        .placeholder-item { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:7px 6px 7px 9px; border:1px solid #e2e8f0; border-radius:9px; background:#fff; }
        .theme-dark .placeholder-item { border-color:#30363d; background:#0d1117; }
        .placeholder-item-copy { display:flex; min-width:0; flex-direction:column; gap:3px; }
        .placeholder-item-copy strong { font-size:12px; font-weight:600; }
        .placeholder-item-copy code { width:max-content; max-width:100%; overflow:hidden; color:#2563eb; font:10.5px/1.35 SFMono-Regular,Consolas,monospace; text-overflow:ellipsis; white-space:nowrap; }
        .theme-dark .placeholder-item-copy code { color:#79c0ff; }
        .placeholder-item-copy span { max-width:170px; overflow:hidden; color:#64748b; font-size:10.5px; text-overflow:ellipsis; white-space:nowrap; }
        .theme-dark .placeholder-item-copy span { color:#94a3b8; }
        .placeholder-empty { padding:22px 0; color:#64748b; font-size:12px; text-align:center; }
        .theme-dark .preview-card .ant-card-body { background: #0d1117; }
        .theme-light .preview-card .ant-card-body { background: #f8fafc; }
        .editor-card .ant-card-body { position:relative; overflow:hidden; }
        .editor-scroll-mirror { position:absolute; inset:0; width:100%; height:100%; padding:18px; overflow-y:scroll; visibility:hidden; box-sizing:border-box; overflow-wrap:break-word; white-space:pre-wrap; word-break:normal; font:13px/1.6 SFMono-Regular,Consolas,'Liberation Mono',monospace; }
        .editor-scroll-anchor { display:inline-block; width:0; height:0; padding:0; }
        .preview-card .ant-card-body { overflow:hidden; }
        .preview-scroll-pane { height:100%; overflow:auto; overflow-anchor:none; overscroll-behavior:contain; }
        .scroll-link-label { color:#64748b; font-size:10px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; }
        .theme-dark .scroll-link-label { color:#94a3b8; }
        .editor-card textarea.ant-input { position:relative; z-index:1; height:100% !important; min-height:100% !important; padding:18px; resize:none; border:0; border-radius:0; overflow-anchor:none; overscroll-behavior:contain; overflow-wrap:break-word; white-space:pre-wrap; word-break:normal; font:13px/1.6 SFMono-Regular,Consolas,'Liberation Mono',monospace; }
        .theme-dark .editor-card textarea.ant-input { background: #0d1117; color: #e6edf3; }
        .theme-light .editor-card textarea.ant-input { background: #ffffff; color: #111827; }
        .soc-report-markdown { width: min(100%, 1080px); min-height: 100%; margin: 0 auto; padding: 48px clamp(28px, 5vw, 72px) 72px; line-height: 1.68; overflow-wrap: anywhere; box-sizing: border-box; }
        .theme-dark .soc-report-markdown { color: #cbd5e1; background: #111827; }
        .theme-light .soc-report-markdown { color: #334155; background: #ffffff; }
        .argus-report-header { color: #3b82f6; }
        .argus-report-logo { flex: 0 0 auto; box-shadow: none !important; }
        .argus-report-wordmark { color: #60a5fa !important; text-shadow: none; }
        .argus-report-title { color: #f8fafc; }
        .theme-light .argus-report-wordmark { color: #2563eb !important; }
        .theme-light .argus-report-title { color: #0f172a; }
        .soc-report-markdown h1, .soc-report-markdown h2, .soc-report-markdown h3 { color: #f8fafc; letter-spacing: -.015em; }
        .theme-light .soc-report-markdown h1, .theme-light .soc-report-markdown h2, .theme-light .soc-report-markdown h3 { color: #0f172a; }
        .soc-report-markdown h1 { margin: 0 0 24px; font-size: 2em; }
        .soc-report-markdown h2 { margin: 56px 0 20px; padding-top: 18px; border-top: 1px solid #273244; font-size: 1.45em; }
        .theme-light .soc-report-markdown h2 { border-top-color: #e2e8f0; }
        .soc-report-markdown h3 { margin: 36px 0 14px; font-size: 1.05em; font-weight: 650; }
        .soc-report-markdown .cursor-locked-section { border-radius:6px; background:rgba(37,99,235,.12); box-shadow:0 0 0 6px rgba(37,99,235,.12); transition:background-color .18s ease,box-shadow .18s ease; }
        .soc-report-markdown blockquote { margin: 20px 0 30px; padding: 14px 18px; color: #cbd5e1; background: rgba(37,99,235,.08); border-left: 3px solid #2563eb; border-radius: 0 8px 8px 0; }
        .soc-report-markdown blockquote p { margin: 0; }
        .theme-light .soc-report-markdown blockquote { color: #475569; background: #f8fafc; border-left-color: #2563eb; }
        .soc-report-markdown table { width: 100%; margin: 18px 0 32px; border-spacing: 0; border-collapse: collapse; font-size: 13px; }
        .soc-report-markdown th, .soc-report-markdown td { padding: 11px 12px; border: 0; border-bottom: 1px solid #273244; text-align: left; }
        .soc-report-markdown th { color: #f8fafc; background: rgba(100,116,139,.10); font-size: 11px; font-weight: 700; letter-spacing: .045em; text-transform: uppercase; }
        .theme-light .soc-report-markdown th, .theme-light .soc-report-markdown td { border-bottom-color: #e2e8f0; }
        .theme-light .soc-report-markdown th { color: #475569; background: #f8fafc; }
        .soc-report-markdown code { padding: 2px 6px; color: #79c0ff; background: #161b22; border: 1px solid #30363d; border-radius: 5px; font-family: SFMono-Regular, Consolas, monospace; }
        .theme-light .soc-report-markdown code { color: #075985; background: #f1f5f9; border-color: #cbd5e1; }
        .soc-report-markdown img { display: block; max-width: 100%; height: auto; margin: 24px auto 36px; border: 0; border-radius: 12px; background: #f8fafc; }
        .soc-report-chart { width: 100% !important; max-width: none !important; image-rendering: auto; box-shadow: 0 1px 3px rgba(15,23,42,.12); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .theme-light .soc-report-markdown img { background: #f8fafc; }
        .soc-report-markdown hr { height: 1px; border: 0; background: #273244; margin: 36px 0; }
        .theme-light .soc-report-markdown hr { background: #e2e8f0; }
        .soc-report-markdown strong { color: #f0f6fc; }
        .theme-light .soc-report-markdown strong { color: #0f172a; }
        /* Enforce black text and clean white background during PDF export */
        .pdf-export-mode { width: 100% !important; max-width: none !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background-color: #ffffff !important; color: #0f172a !important; }
        .pdf-export-mode h1, .pdf-export-mode h2, .pdf-export-mode h3,
        .pdf-export-mode p, .pdf-export-mode li, .pdf-export-mode td { color: #0f172a !important; }
        .pdf-export-mode blockquote { background-color: #f1f5f9 !important; border-left-color: #0284c7 !important; color: #1e293b !important; }
        .pdf-export-mode blockquote p { color: #1e293b !important; }
        .pdf-export-mode table th { background-color: #f8fafc !important; color: #0f172a !important; border-bottom-color: #cbd5e1 !important; }
        .pdf-export-mode table td { border-bottom-color: #e2e8f0 !important; color: #334155 !important; }
        .pdf-export-mode strong { color: #0f172a !important; }
        .pdf-export-mode code { color: #075985 !important; background: #f1f5f9 !important; border-color: #cbd5e1 !important; }
        .pdf-export-mode img { max-width:100% !important; height:auto; border:0 !important; box-shadow:none !important; break-inside:avoid; page-break-inside:avoid; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
        .pdf-export-mode .soc-report-chart { display:block; width:100% !important; max-width:none !important; height:auto !important; background:#f8fafc !important; }
        .pdf-export-mode .argus-report-logo { display:block; flex:0 0 52px; width:52px !important; min-width:52px !important; max-width:52px !important; height:52px !important; margin:0 !important; object-fit:contain !important; background:transparent !important; border:0 !important; }
        .pdf-export-mode hr { background: #cbd5e1 !important; }
        .pdf-export-mode .argus-report-header { color: #2563eb !important; border-bottom-color: #2563eb !important; }
        .pdf-export-mode .argus-report-wordmark { color: #0369a1 !important; text-shadow: none !important; }
        .pdf-export-mode .argus-report-title { color: #0f172a !important; }
        .pdf-export-mode .cursor-locked-section { background:transparent !important; box-shadow:none !important; }
        @media (max-width: 1280px) { .soc-report-workspace { grid-template-columns:minmax(210px,250px) minmax(0,1fr); height:auto; } .soc-report-workspace.template-panel-collapsed { grid-template-columns:44px minmax(0,1fr); } .soc-report-editor-grid { grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); height:auto; } .setup-card,.template-panel-rail,.editor-card,.preview-card { min-height:720px; } }
        @media (max-width: 900px) { .soc-report-heading h1 { font-size:26px; } .soc-report-toolbar { align-items:flex-start; flex-direction:column; } .soc-report-workspace,.soc-report-workspace.template-panel-collapsed,.soc-report-editor-grid { grid-template-columns:1fr; height:auto; } .template-panel-rail { min-height:44px; height:44px; flex-direction:row; justify-content:center; } .template-panel-rail-label { writing-mode:horizontal-tb; } .soc-report-card { min-height:580px; } .setup-card { min-height:580px; } .soc-report-markdown { padding:36px 24px 56px; } }
        @media print { .soc-report-heading, .soc-report-toolbar, .setup-card, .template-panel-rail, .editor-card { display:none !important; } .soc-report-page { padding:0; background:white; } .soc-report-workspace, .soc-report-editor-grid { display:block; height:auto; } .preview-card { border:0; } .preview-card .ant-card-head { display:none; } .preview-card .ant-card-body, .preview-scroll-pane { height:auto; overflow:visible; } .soc-report-markdown { color:black; } .soc-report-markdown img { break-inside:avoid; } }
      `}</style>
    </main>
  );
}
