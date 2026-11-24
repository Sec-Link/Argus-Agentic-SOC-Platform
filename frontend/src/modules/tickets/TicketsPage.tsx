import React, { useEffect, useState } from 'react';
import { App, Button, Tabs } from 'antd';
import { addSlaTicketWorklog, fetchSlaTicket, fetchSlaTicketAttachments, fetchSlaTicketTimeline, fetchSlaTickets, updateSlaTicketStatus, uploadSlaTicketAttachment } from 'services/tickets';
import type { SlaTicketAttachment, SlaTicketDetail, SlaTicketListItem, SlaTicketWorkLog } from '../../types';
import SlaTicketDetailView from './components/SlaTicketDetailView';
import SlaTicketListView from './components/SlaTicketListView';
import { useGuide } from '../../components/layout/useGuide';
import type { GuideStep } from '../../components/layout/useGuide';

// One guide for both the /tickets list and the /tickets/[id] detail view; steps whose anchors are not on screen are skipped.
const GUIDE_STEPS: GuideStep[] = [
  {
    selector: '[data-tour="tk-header"]',
    title: '1. Incidents',
    description: 'This is the incident queue. Every ticket created from alerts or by hand is listed here with its status, severity, owner and SLA.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="tk-filters"]',
    title: '2. Filter the queue',
    description: 'Combine Severity, Status, Owner and SLA filters to narrow the list. Use Clear filters to start over.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="tk-search"]',
    title: '3. Search',
    description: 'Search by text, or use field queries such as status:pending owner:alice to find specific incidents quickly.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="tk-range"]',
    title: '4. Time range',
    description: 'Limit the list to incidents created in the last 15 minutes up to 30 days, or choose a custom range.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="tk-new"]',
    title: '5. New Incident',
    description: 'Open a ticket manually when something needs tracking that no alert created for you.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="tk-charts"]',
    title: '6. Chart panel',
    description: 'Severity, Status, SLA and Owner breakdowns. Click a legend entry or a slice to filter the list by it.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="tk-batch"]',
    title: '7. Batch actions',
    description: 'Tick rows in the table, then Assign, Edit, Export, Close or Delete them all at once.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="tk-table"]',
    title: '8. Incident list',
    description: 'Open an incident to investigate it. Switch between Table View and Summary View with the toggle above.',
    placement: 'top',
  },
  {
    selector: '[data-tour="td-header"]',
    title: '1. Incident overview',
    description: 'The ticket number with its current status and severity. Use Refresh to reload the latest data and Pending to pause or resume work on the incident.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="td-tabs"]',
    title: '2. Incident tabs',
    description: 'Incident Info shows the full picture. War Room is the working log for the team, and Evidence lists observables and attached files.',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="td-case"]',
    title: '3. Case Details',
    description: 'Key facts about this incident: ticket number, SIEM event ID, status, priority and created and updated times.',
    placement: 'right',
  },
  {
    selector: '[data-tour="td-decision"]',
    title: '4. Decision Actions',
    description: 'Move the incident forward: Acknowledge, mark it Triaged or Contained, then Resolved with a category and verdict.',
    placement: 'right',
  },
  {
    selector: '[data-tour="td-summary"]',
    title: '5. AI Summary',
    description: 'A short AI-generated summary of what happened, produced when you run the SOC AI Assistant.',
    placement: 'left',
  },
  {
    selector: '[data-tour="td-timeline"]',
    title: '6. Timeline and alerts',
    description: 'Switch between Timeline, Alerts, Raw Message and Tasks to see how the incident unfolded and the original alert data.',
    placement: 'left',
  },
  {
    selector: '[data-tour="td-comment"]',
    title: '7. Comment',
    description: 'Write a comment for the team or use suggestions from the AI Assistant, then click Send.',
    placement: 'top',
  },
  {
    selector: '[data-tour="td-ai"]',
    title: '8. SOC AI Assistant',
    description: 'Run AI Assistant to interpret and summarize the alert, or open Chat to ask questions about this incident.',
    placement: 'left',
  },
];

type Props = {
  initialTicketNumber?: string;
  onNavigate?: (path: string) => void;
};

const TicketsPage: React.FC<Props> = ({ initialTicketNumber, onNavigate }) => {
  const { message } = App.useApp();
  const guide = useGuide(GUIDE_STEPS);
  const [slaTickets, setSlaTickets] = useState<SlaTicketListItem[]>([]);
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaDetailOpen, setSlaDetailOpen] = useState(false);
  const [slaDetail, setSlaDetail] = useState<SlaTicketDetail | null>(null);
  const [slaAttachments, setSlaAttachments] = useState<SlaTicketAttachment[]>([]);
  const [slaWorkLogs, setSlaWorkLogs] = useState<SlaTicketWorkLog[]>([]);
  const [slaStatus, setSlaStatus] = useState<string>('');
  const [slaNotes, setSlaNotes] = useState<string>('');
  const [slaQuery, setSlaQuery] = useState<Record<string, string>>({});

  const normalizeQuery = (q?: Record<string, string | number | undefined | null>) => {
    const out: Record<string, string> = {};
    Object.entries(q || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      const s = String(v).trim();
      if (!s) return;
      out[k] = s;
    });
    return out;
  };

  const loadSla = async (nextQuery?: Record<string, string | number | undefined | null>) => {
    setSlaLoading(true);
    const finalQuery = nextQuery ? normalizeQuery(nextQuery) : slaQuery;
    if (nextQuery) setSlaQuery(finalQuery);
    try {
      const res = await fetchSlaTickets(finalQuery);
      setSlaTickets(Array.isArray(res) ? res : (res?.results ?? []));
    } catch (err: any) {
      setSlaTickets([]);
      const status = err?.response?.status;
      if (status === 404) {
        message.error('SLA tickets API 404: restart the dev server, ensure the /api proxy is configured, and backend has /api/v1/tickets/');
      } else {
        message.error('Failed to load SLA tickets');
      }
    } finally {
      setSlaLoading(false);
    }
  };

  useEffect(() => { loadSla(); }, []);

  const openSlaDetail = async (ticketNumber: string) => {
    if (onNavigate) onNavigate(`/tickets/${encodeURIComponent(ticketNumber)}`);
    setSlaDetailOpen(true);
    setSlaDetail(null);
    setSlaAttachments([]);
    setSlaWorkLogs([]);
    setSlaStatus('');
    setSlaNotes('');
    try {
      setSlaLoading(true);
      const [detail, attachmentsResp, timelineResp] = await Promise.all([
        fetchSlaTicket(ticketNumber),
        fetchSlaTicketAttachments(ticketNumber),
        fetchSlaTicketTimeline(ticketNumber),
      ]);
      setSlaDetail(detail);
      setSlaStatus(detail?.status ?? '');
      setSlaAttachments(Array.isArray(attachmentsResp) ? attachmentsResp : []);
      setSlaWorkLogs(Array.isArray(timelineResp?.work_logs) ? timelineResp.work_logs : []);
    } catch (err: any) {
      message.error('Failed to load ticket details');
    } finally {
      setSlaLoading(false);
    }
  };

  const refreshSlaWorkLogs = async (ticketNumber: string) => {
    const timelineResp = await fetchSlaTicketTimeline(ticketNumber);
    setSlaWorkLogs(Array.isArray(timelineResp?.work_logs) ? timelineResp.work_logs : []);
  };

  const submitSlaStatus = async (statusOverride?: string) => {
    if (!slaDetail?.ticket_number) return;
    const nextStatus = statusOverride || slaStatus;
    if (!nextStatus) {
      message.warning('Select a status');
      return;
    }
    setSlaLoading(true);
    try {
      const updated = await updateSlaTicketStatus(slaDetail.ticket_number, { status: nextStatus, notes: slaNotes || undefined });
      setSlaDetail(updated);
      if (statusOverride) setSlaStatus(nextStatus);
      try {
        const timelineResp = await fetchSlaTicketTimeline(slaDetail.ticket_number);
        setSlaWorkLogs(Array.isArray(timelineResp?.work_logs) ? timelineResp.work_logs : []);
      } catch {}
      message.success('Status updated');
      loadSla();
    } catch (err: any) {
      const apiError = err?.response?.data?.error;
      message.error(apiError ? String(apiError) : 'Failed to update status');
    } finally {
      setSlaLoading(false);
    }
  };

  const addWorkLog = async (logEntry: string) => {
    if (!slaDetail?.ticket_number) return;
    const text = (logEntry || '').trim();
    if (!text) return;
    setSlaLoading(true);
    try {
      await addSlaTicketWorklog(slaDetail.ticket_number, { log_entry: text });
      const timelineResp = await fetchSlaTicketTimeline(slaDetail.ticket_number);
      setSlaWorkLogs(Array.isArray(timelineResp?.work_logs) ? timelineResp.work_logs : []);
      message.success('Sent');
    } catch (err: any) {
      const apiError = err?.response?.data?.error || err?.response?.data?.detail;
      message.error(apiError ? String(apiError) : 'Failed to send');
    } finally {
      setSlaLoading(false);
    }
  };

  const uploadWorkLogImage = async (file: File) => {
    if (!slaDetail?.ticket_number) throw new Error('No ticket selected');
    setSlaLoading(true);
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '');
      const safeName = file.name && file.name.trim() ? file.name : `paste_${ts}.png`;
      const uploaded = await uploadSlaTicketAttachment(slaDetail.ticket_number, file, safeName);
      const attachmentsResp = await fetchSlaTicketAttachments(slaDetail.ticket_number);
      setSlaAttachments(Array.isArray(attachmentsResp) ? attachmentsResp : []);
      return uploaded;
    } finally {
      setSlaLoading(false);
    }
  };

  useEffect(() => {
    if (!initialTicketNumber) return;
    if (slaDetailOpen && slaDetail?.ticket_number === initialTicketNumber) return;
    openSlaDetail(initialTicketNumber);
  }, [initialTicketNumber]);

  useEffect(() => {
    if (!initialTicketNumber && slaDetailOpen) {
      setSlaDetailOpen(false);
    }
  }, [initialTicketNumber, slaDetailOpen]);

  const closeSlaDetail = () => {
    setSlaDetailOpen(false);
    if (onNavigate) onNavigate('/tickets');
  };

  return (
    <>
      {slaDetailOpen ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>Ticket Details</div>
            <Button onClick={closeSlaDetail}>Back to List</Button>
          </div>
          {!slaDetail ? (
            <div style={{ padding: 16 }}>Loading...</div>
          ) : (
            <SlaTicketDetailView
              ticket={slaDetail}
              attachments={slaAttachments}
              workLogs={slaWorkLogs}
              statusValue={slaStatus}
              notesValue={slaNotes}
              onStatusChange={setSlaStatus}
              onNotesChange={setSlaNotes}
              onSubmitStatus={submitSlaStatus}
              onAddWorkLog={addWorkLog}
              onUploadWorkLogImage={uploadWorkLogImage}
              onRefresh={() => openSlaDetail(slaDetail.ticket_number)}
              onRefreshWorkLogs={() => refreshSlaWorkLogs(slaDetail.ticket_number)}
              loading={slaLoading}
            />
          )}
        </div>
      ) : (
        <SlaTicketListView
          tickets={slaTickets}
          loading={slaLoading}
          onRefresh={loadSla}
          onOpenDetail={openSlaDetail}
        />
      )}
      {guide}
    </>
  );
};

export default TicketsPage;
