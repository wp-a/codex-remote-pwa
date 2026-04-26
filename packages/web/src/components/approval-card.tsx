import type { ApprovalRequest } from "@codex-remote/shared";

import { approvalScopeLabel } from "../copy.js";

type ApprovalCardProps = {
  approval: ApprovalRequest;
  onApproveOnce: (approvalId: string) => void;
  onApproveTurn: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
};

export function ApprovalCard({
  approval,
  onApproveOnce,
  onApproveTurn,
  onReject,
}: ApprovalCardProps) {
  return (
    <article className="approval-card">
      <span className="timeline-card__type">授权请求</span>
      <h3>{approvalScopeLabel(approval.scope)}</h3>
      <p>{approval.reason}</p>
      <div className="approval-card__actions">
        <button onClick={() => onApproveOnce(approval.id)} type="button">
          允许一次
        </button>
        <button onClick={() => onApproveTurn(approval.id)} type="button">
          本轮允许
        </button>
        <button onClick={() => onReject(approval.id)} type="button">
          拒绝
        </button>
      </div>
    </article>
  );
}
