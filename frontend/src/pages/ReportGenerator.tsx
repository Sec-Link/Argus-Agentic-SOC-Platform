'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopyOutlined, DownloadOutlined, FilePdfOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Input, Segmented, Space, message } from 'antd';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { fetchReport } from '../api';

type TimeRange = '24h' | '7d' | '30d';
type ThemeMode = 'light' | 'dark';

const getThemeMode = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  try { return localStorage.getItem('siem_ui_theme') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
};

const FALLBACK_REPORT = `<div class="argus-report-header" style="display:flex; align-items:center; gap:14px; border-bottom:2px solid #3b82f6; padding-bottom:14px; margin-bottom:20px;">
  <img src="/seclink-logo.png" alt="SecLink Argus logo" class="argus-report-logo" style="width:52px; height:52px; object-fit:contain; margin:0; border:0; background:transparent;" />
  <div class="argus-report-title-group" style="display:flex; flex-direction:column; gap:5px;">
    <span class="argus-brand-wordmark argus-report-wordmark" style="font-family:'Orbitron','Share Tech Mono',monospace; font-size:28px; font-weight:800; letter-spacing:.14em; line-height:1;">Argus</span>
    <span class="argus-report-title" style="font-size:13px; font-weight:700; letter-spacing:.12em;">SOC SECURITY OPERATIONS REPORT</span>
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
| Mean Time to Detect (MTTD) | **4.2m** |
| Mean Time to Respond/Resolve (MTTR) | **14.2m** |

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
  const reportRequestId = useRef(0);

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
    const syncTheme = () => setThemeMode(getThemeMode());
    window.addEventListener('siem_theme_changed', syncTheme as EventListener);
    window.addEventListener('storage', syncTheme);
    return () => {
      window.removeEventListener('siem_theme_changed', syncTheme as EventListener);
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

  const filename = useMemo(() => `soc-security-operations-report-${range}.md`, [range]);
  const copyMarkdown = async () => {
    try { await navigator.clipboard.writeText(markdown); message.success('Markdown copied.'); }
    catch { message.error('Unable to copy Markdown.'); }
  };
  const exportMarkdown = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
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
      <div className="soc-report-toolbar">
        <Space wrap>
          <Segmented<TimeRange> options={[{ label: '24 Hours', value: '24h' }, { label: '7 Days', value: '7d' }, { label: '30 Days', value: '30d' }]} value={range} onChange={(value) => { setRange(value); void generate(value); }} />
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void generate(range)}>Regenerate</Button>
        </Space>
        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={() => void copyMarkdown()}>Copy Markdown</Button>
          <Button icon={<DownloadOutlined />} onClick={exportMarkdown}>Export File</Button>
          <Button icon={<FilePdfOutlined />} onClick={() => void exportPdf()}>Download PDF</Button>
        </Space>
      </div>

      <div className="soc-report-grid">
        <Card title="Markdown Editor" className="soc-report-card editor-card">
          <Input.TextArea aria-label="SOC report Markdown editor" value={markdown} onChange={(event) => setMarkdown(event.target.value)} spellCheck={false} />
        </Card>
        <Card title="Live Preview" className="soc-report-card preview-card">
          <article id="report-preview-container" className="soc-report-markdown">
            <ReactMarkdown urlTransform={(url: string) => url.startsWith('data:image/png;base64,') ? url : defaultUrlTransform(url)} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{
              img: ({ node: _node, className, src, ...props }: any) => {
                const chartClass = typeof src === 'string' && src.startsWith('data:image/png;base64,') ? 'soc-report-chart' : '';
                return <img {...props} src={src} className={[className, chartClass].filter(Boolean).join(' ')} loading="eager" alt={props.alt || 'SOC report image'} />;
              },
              code: ({ node: _node, className, children, ...props }: any) => <code className={className} {...props}>{children}</code>,
            }}>{markdown}</ReactMarkdown>
          </article>
        </Card>
      </div>

      <style jsx global>{`
        .soc-report-page { padding: 24px; min-height: 100%; transition: background-color .2s ease; }
        .soc-report-page.theme-dark { background: #0d1117; color: #e6edf3; }
        .soc-report-page.theme-light { background: #f3f4f6; color: #111827; }
        .soc-report-toolbar { display: flex; justify-content: space-between; gap: 16px; margin: 0 auto 16px; max-width: 1720px; }
        .soc-report-grid { display: grid; grid-template-columns: minmax(340px, .72fr) minmax(0, 1.28fr); gap: 16px; height: calc(100vh - 174px); min-height: 680px; max-width: 1720px; margin: 0 auto; }
        .soc-report-card { height: 100%; overflow: hidden; border-radius: 12px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
        .theme-dark .soc-report-card { color: #e6edf3; background: #161b22; border-color: #1f2937; }
        .theme-dark .soc-report-card .ant-card-head { color: #f0f6fc; background: #161b22; border-bottom-color: #1f2937; }
        .theme-light .soc-report-card { color: #111827; background: #ffffff; border-color: #e5e7eb; }
        .theme-light .soc-report-card .ant-card-head { color: #111827; background: #ffffff; border-bottom-color: #e5e7eb; }
        .soc-report-card .ant-card-body { height: calc(100% - 57px); padding: 0; overflow: auto; }
        .theme-dark .preview-card .ant-card-body { background: #0d1117; }
        .theme-light .preview-card .ant-card-body { background: #f8fafc; }
        .editor-card textarea.ant-input { height: 100% !important; min-height: 100% !important; padding: 18px; resize: none; border: 0; border-radius: 0; font: 13px/1.6 SFMono-Regular, Consolas, 'Liberation Mono', monospace; }
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
        .pdf-export-mode img { width: 100% !important; max-width: none !important; background: #f8fafc !important; border: 0 !important; box-shadow: none !important; break-inside: avoid; page-break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .pdf-export-mode .argus-report-logo { background: transparent !important; border: 0 !important; }
        .pdf-export-mode hr { background: #cbd5e1 !important; }
        .pdf-export-mode .argus-report-header { color: #2563eb !important; border-bottom-color: #2563eb !important; }
        .pdf-export-mode .argus-report-wordmark { color: #0369a1 !important; text-shadow: none !important; }
        .pdf-export-mode .argus-report-title { color: #0f172a !important; }
        @media (max-width: 1080px) { .soc-report-toolbar { align-items: flex-start; flex-direction: column; } .soc-report-grid { grid-template-columns: 1fr; height: auto; } .soc-report-card { min-height: 640px; } .soc-report-markdown { padding: 36px 24px 56px; } }
        @media print { .soc-report-toolbar, .editor-card { display: none !important; } .soc-report-page { padding: 0; background: white; } .soc-report-grid { display: block; height: auto; } .preview-card { border: 0; } .preview-card .ant-card-head { display: none; } .preview-card .ant-card-body { overflow: visible; } .soc-report-markdown { color: black; } .soc-report-markdown img { break-inside: avoid; } }
      `}</style>
    </main>
  );
}
