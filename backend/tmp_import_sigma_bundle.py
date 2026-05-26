import json,re
from pathlib import Path
from django.db import transaction
from detections.models import LocalDetectionRule, LocalDetectionRuleVersion

p=Path(r'C:\Users\qk\detction-sigma-elk-splunk\detction-sigma-elk-splunk\sigma_rules_bundle.js')
text=p.read_text(encoding='utf-8',errors='ignore')
start=text.find('[')
if start<0:
    raise RuntimeError('bundle format invalid')
arr=json.loads(text[start:])
pat_id=re.compile(r'(?mi)^id:\s*(.+?)\s*$')
pat_title=re.compile(r'(?mi)^title:\s*(.+?)\s*$')
created=updated=skipped=0

for item in arr:
    yaml_text=str(item.get('yaml') or '')
    if not yaml_text.strip():
        skipped+=1
        continue
    m=pat_id.search(yaml_text)
    if m:
        rid=m.group(1).strip().strip('"').strip("'")
    else:
        mt=pat_title.search(yaml_text)
        base=(mt.group(1).strip() if mt else 'rule')
        rid=re.sub(r'[^a-zA-Z0-9_-]+','-',base).strip('-').lower()
    if not rid:
        skipped+=1
        continue

    payload={
        'id':rid,'rule_id':rid,'name':rid,'type':'query','enabled':False,
        'severity':'low','risk_score':50,'yaml':yaml_text,
        'source_path':str(item.get('path') or ''),
        'source_repo':str(item.get('source') or ''),
        'source_url':str(item.get('url') or ''),
    }

    with transaction.atomic():
        rule=LocalDetectionRule.objects.filter(rule_uuid=rid).first()
        if not rule:
            rule=LocalDetectionRule.objects.create(
                rule_uuid=rid,name=rid,enabled=False,rule_type='query',severity='low',
                risk_score=50,version=1,payload=payload,created_by='bundle-import',
                updated_by='bundle-import',is_deleted=False
            )
            LocalDetectionRuleVersion.objects.create(
                rule=rule,version=1,change_type='create',payload=payload,changed_by='bundle-import'
            )
            created+=1
        else:
            rule.version+=1
            rule.payload=payload
            rule.is_deleted=False
            rule.updated_by='bundle-import'
            rule.save()
            LocalDetectionRuleVersion.objects.create(
                rule=rule,version=rule.version,change_type='update',payload=payload,changed_by='bundle-import'
            )
            updated+=1

print({'total':len(arr),'created':created,'updated':updated,'skipped':skipped})
