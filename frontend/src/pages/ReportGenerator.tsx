'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CopyOutlined, DownloadOutlined, FilePdfOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Input, Segmented, Space, Typography, message } from 'antd';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { fetchReport } from '../api';

type TimeRange = '24h' | '7d' | '30d';

const FALLBACK_REPORT = `# 🛡️ SOC Security Operations Report

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

  const generate = useCallback(async (selected: TimeRange) => {
    setLoading(true);
    try {
      const response = await fetchReport(selected);
      const content = typeof response?.markdown_content === 'string' ? response.markdown_content.trim() : '';
      if (!content || content === '# report\nwho' || content === '# report \\n who') {
        setMarkdown(FALLBACK_REPORT);
        message.warning('Report service returned no content; showing the SOC baseline template.');
      } else {
        setMarkdown(response.markdown_content);
      }
    } catch {
      setMarkdown(FALLBACK_REPORT);
      message.warning('Report service is unavailable; showing the SOC baseline template.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void generate('7d'); }, [generate]);

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
    // html2pdf is loaded only for explicit export, keeping the editor lightweight.
    // @ts-expect-error html2pdf.js is an optional runtime export dependency.
    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf().set({ margin: 12, filename: `soc-report-${range}.pdf`, image: { type: 'jpeg', quality: .96 }, html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(target).save();
  };

  return (
    <main className="soc-report-page">
      <div className="soc-report-toolbar">
        <Space wrap>
          <Segmented<TimeRange> options={[{ label: '24 Hours', value: '24h' }, { label: '7 Days', value: '7d' }, { label: '30 Days', value: '30d' }]} value={range} onChange={(value) => setRange(value)} />
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
            <ReactMarkdown urlTransform={(url: string) => url} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{
              img: ({ node: _node, ...props }: any) => <img {...props} className="soc-report-chart" loading="lazy" alt={props.alt || 'SOC report chart'} />,
              code: ({ node: _node, className, children, ...props }: any) => <code className={className} {...props}>{children}</code>,
            }}>{markdown}</ReactMarkdown>
          </article>
        </Card>
      </div>

      <style jsx global>{`
        .soc-report-page { padding: 24px; min-height: 100%; background: var(--bg-content, #0d1117); }
        .soc-report-toolbar { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
        .soc-report-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; height: calc(100vh - 174px); min-height: 680px; }
        .soc-report-card { height: 100%; overflow: hidden; border-color: #30363d; }
        .soc-report-card .ant-card-body { height: calc(100% - 57px); padding: 0; overflow: auto; }
        .editor-card textarea.ant-input { height: 100% !important; min-height: 100% !important; padding: 18px; resize: none; border: 0; border-radius: 0; font: 13px/1.6 SFMono-Regular, Consolas, 'Liberation Mono', monospace; background: #0d1117; color: #e6edf3; }
        .soc-report-markdown { padding: 24px 30px 48px; color: #e6edf3; line-height: 1.65; overflow-wrap: anywhere; }
        .soc-report-markdown h1, .soc-report-markdown h2 { padding-bottom: .35em; border-bottom: 1px solid #30363d; }
        .soc-report-markdown h1 { font-size: 2em; } .soc-report-markdown h2 { margin-top: 1.7em; font-size: 1.45em; } .soc-report-markdown h3 { margin-top: 1.4em; }
        .soc-report-markdown blockquote { margin: 16px 0; padding: 8px 16px; color: #9da7b3; background: rgba(56,139,253,.08); border-left: 4px solid #388bfd; }
        .soc-report-markdown table { width: 100%; margin: 16px 0 24px; border-spacing: 0; border-collapse: collapse; font-size: 13px; }
        .soc-report-markdown th, .soc-report-markdown td { padding: 9px 12px; border: 1px solid #30363d; text-align: left; }
        .soc-report-markdown th { color: #f0f6fc; background: #21262d; font-weight: 600; }
        .soc-report-markdown tbody tr:nth-child(even) { background: rgba(110,118,129,.08); }
        .soc-report-markdown code { padding: 2px 6px; color: #79c0ff; background: #161b22; border: 1px solid #30363d; border-radius: 5px; font-family: SFMono-Regular, Consolas, monospace; }
        .soc-report-markdown img { display: block; max-width: 100%; height: auto; margin: 20px auto; border: 1px solid #30363d; border-radius: 8px; background: #161b22; }
        .soc-report-markdown hr { height: 1px; border: 0; background: #30363d; margin: 28px 0; }
        .soc-report-markdown strong { color: #f0f6fc; }
        @media (max-width: 960px) { .soc-report-toolbar { align-items: flex-start; flex-direction: column; } .soc-report-grid { grid-template-columns: 1fr; height: auto; } .soc-report-card { min-height: 640px; } }
        @media print { .soc-report-toolbar, .editor-card { display: none !important; } .soc-report-page { padding: 0; background: white; } .soc-report-grid { display: block; height: auto; } .preview-card { border: 0; } .preview-card .ant-card-head { display: none; } .preview-card .ant-card-body { overflow: visible; } .soc-report-markdown { color: black; } .soc-report-markdown img { break-inside: avoid; } }
      `}</style>
    </main>
  );
}
