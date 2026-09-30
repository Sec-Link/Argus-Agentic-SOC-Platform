import type { Workflow as BaseWorkflow } from '../../api';

export interface Workflow extends BaseWorkflow {
  variables?: Record<string, unknown>;
  secret_variables?: Record<string, string>;
  configured_secret_variables?: string[];
}

export {
  // types
  type WorkflowStep,
  type PrefectDeployment,
  type WorkflowSchedule,
  type WorkflowEdge,
  type WorkflowExecution,
  type StepExecution,
  type ActionInfo,
  type WorkflowStats,
  type SavedWorkflowNode,
  type TicketWorkflowBinding,

  listWorkflows,
  getWorkflow,
  listPrefectDeployments,
  deleteWorkflowSchedule,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  listTicketWorkflowBindings,
  createTicketWorkflowBinding,
  updateTicketWorkflowBinding,
  deleteTicketWorkflowBinding,
  executeWorkflow,
  cloneWorkflow,
  activateWorkflow,
  deactivateWorkflow,
  listWorkflowExecutions,
  subscribeWorkflowProgress,
  getWorkflowExecution,
  cancelWorkflowExecution,
  refreshPrefectExecutionStatus,
  getAvailableActions,
  getWorkflowStats,
  listSavedWorkflowNodes,
  createSavedWorkflowNode,
  updateSavedWorkflowNode,
  deleteSavedWorkflowNode,
  // Publish & Import
  publishWorkflow,
  exportWorkflow,
  // Server-manifest recovery is intentionally disabled (not deleted) because
  // disaster recovery is out of scope and manifest/DB UUIDs may not match.
  // listPublishedManifests,
  // importWorkflowFromManifest,
  importWorkflowFromFile,
} from '../../api';
