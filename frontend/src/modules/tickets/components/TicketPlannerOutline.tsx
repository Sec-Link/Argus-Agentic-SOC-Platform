import React, { useState } from 'react';
import { Button, Select, Tag } from 'antd';
import dayjs from 'dayjs';
import type { TicketInvestigationRun, TicketInvestigationSession } from 'services/tickets';
import styles from './TicketLayout.module.css';

type Props = {
  session: TicketInvestigationSession;
  planner: TicketInvestigationRun;
  onSelectRun: (runId: string) => void;
};

const statusText: Record<TicketInvestigationRun['status'], string> = {
  open: 'Queued', running: 'Running', completed: 'Completed', blocked: 'Evidence blocked',
  exhausted: 'Budget exhausted', failed: 'Failed', paused: 'Paused', cancelled: 'Cancelled',
};
const roundOf = (run: TicketInvestigationRun) => {
  const round = run.synthesis?.plan?.round_number;
  return typeof round === 'number' && Number.isInteger(round) && round > 0 ? round : 0;
};
const roundLabel = (round: number) => round ? `Round ${round}` : 'Unassigned';

export default function TicketPlannerOutline({ session, planner, onSelectRun }: Props) {
  const [chosenRound, setChosenRound] = useState<number | null>(null);
  const workers = (session.runs || []).filter((run) => run.role === 'worker' && (!run.parent_id || run.parent_id === planner.id));
  const rounds = [...new Set(workers.map(roundOf))].sort((a, b) => a - b);
  const selectedRound = chosenRound !== null && rounds.includes(chosenRound) ? chosenRound : rounds[rounds.length - 1] || 0;
  const roundIndex = rounds.indexOf(selectedRound);
  const decisionLabels: Record<string, string> = {
    continue_investigation: 'Continue investigation', wait_for_input: 'Waiting for input', final_report: 'Submit for independent review and reporting',
  };
  const updatedAt = workers[workers.length - 1]?.created_at;

  return <section className={styles.ticketPlannerOutline} aria-label="Investigation plan">
    {workers.length ? <header className={styles.ticketPlannerOutlineHead}>
      <h3>Next investigation steps</h3>
      {selectedRound > 0 ? <p>Current planned round: {selectedRound}</p> : null}
    </header> : null}
    {!workers.length ? null : <>
      {rounds.length > 1 ? <nav className={styles.ticketPlannerRoundNav} aria-label="Investigation plan rounds">
        <Button size="small" disabled={roundIndex <= 0} onClick={() => setChosenRound(rounds[roundIndex - 1])}>Previous round</Button>
        <Select size="small" aria-label="Select investigation round" value={selectedRound} onChange={setChosenRound} options={rounds.map((round) => ({ value: round, label: roundLabel(round) }))} />
        <Button size="small" disabled={roundIndex >= rounds.length - 1} onClick={() => setChosenRound(rounds[roundIndex + 1])}>Next round</Button>
        <span>{roundLabel(selectedRound)} · {roundIndex + 1} / {rounds.length}</span>
      </nav> : null}
      {workers.some((worker) => !worker.synthesis?.plan) ? <p className={styles.ticketPlannerMuted}>Some historical tasks have no structured plan metadata. Their original objectives are preserved; priority, round and Artifact selections remain unrecorded.</p> : null}
      <div className={styles.ticketPlannerTableWrap}>
        <table className={styles.ticketPlannerTable} aria-label="Planner investigation plan">
          <thead><tr>{['Priority', 'Capability', 'Investigation action', 'Start condition / prerequisites', 'Selected Artifacts / sources', 'Expected deliverable'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
          <tbody>{workers.filter((worker) => roundOf(worker) === selectedRound).map((worker) => {
            const plan = worker.synthesis?.plan;
            const assignment = worker.synthesis?.assignment;
            const number = workers.findIndex((run) => run.id === worker.id) + 1;
            return <tr key={worker.id}>
              <td><strong>{plan?.priority || 'Not recorded'}</strong></td>
              <td>{plan?.capability || <span className={styles.ticketPlannerMuted}>Capability not specified</span>}{assignment?.method_key ? <small>Method: {assignment.method_key}</small> : null}</td>
              <td>
                <button type="button" className={styles.ticketPlannerAction} onClick={() => onSelectRun(worker.id)}>#{number}. {worker.title}</button>
                <Tag>{statusText[worker.status]}</Tag>
                <details><summary>Rationale and parameters</summary>
                  {plan?.reason ? <p>{plan.reason}</p> : null}
                  <p>{worker.objective || 'No objective recorded'}</p>
                  <small>Worker: {worker.id}</small>
                </details>
                {worker.result?.outcome ? <details><summary>Execution result and Planner review</summary>
                  <p>{worker.result.conclusion}</p>
                  {worker.result.remaining ? <p>Remaining work: {worker.result.remaining}</p> : null}
                  {worker.result.next_operation ? <p>Next operation: {worker.result.next_operation}</p> : null}
                  <p>{worker.synthesis?.result_hash ? 'Planner has recorded receipt of this result' : 'Awaiting Planner result review'}</p>
                  {worker.synthesis?.reason ? <p>{worker.synthesis.reason}</p> : null}
                </details> : null}
              </td>
              <td>{plan?.start_condition || <span className={styles.ticketPlannerMuted}>Prerequisites not recorded separately</span>}</td>
              <td>{plan?.artifacts?.length ? plan.artifacts.map((artifact, index) => <code key={`${artifact}_${index}`}>{artifact}</code>) : <span className={styles.ticketPlannerMuted}>Exact Artifact selection not recorded</span>}
                {assignment?.source_key ? <small>Source: {assignment.source_key}</small> : null}
              </td>
              <td>{plan?.expected_output || <span className={styles.ticketPlannerMuted}>Not recorded separately. Expand the investigation action to read the original objective.</span>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <footer className={styles.ticketPlannerFooter}>
        <span>{updatedAt ? `Latest task created: ${dayjs(updatedAt).format('YYYY-MM-DD HH:mm:ss')}` : ''}</span>
        <span>Plan fields describe intended work. Click an investigation action for execution details.</span>
      </footer>
    </>}
    {planner.result?.action ? <section className={styles.ticketPlannerDecision} aria-label="Planner next decision">
      <h4>Next decision · {decisionLabels[planner.result.action] || planner.result.action}</h4>
      {planner.result.reason ? <p>{planner.result.reason}</p> : null}
      {planner.result.required_material ? <p>Required material: {planner.result.required_material}</p> : null}
    </section> : null}
  </section>;
}
