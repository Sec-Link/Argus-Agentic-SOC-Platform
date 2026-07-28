import Detections from '../../../../../modules/detections/Detections';

export default async function DetectionRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await params;
  const ruleId = p?.id ? decodeURIComponent(p.id) : undefined;
  return <Detections initialRuleId={ruleId} />;
}
