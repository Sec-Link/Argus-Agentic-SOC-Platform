'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getRbacMe } from 'services/accounts';
import { permissionByKey } from '../../../../../route';
import Detections from '../../../../../modules/detections/Detections';
import React from 'react';

export default function DetectionRulePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [ruleId, setRuleId] = React.useState<string | undefined>(undefined);
  const [ready, setReady] = React.useState(false);

  useEffect(() => {
    params.then((p) => {
      setRuleId(p?.id ? decodeURIComponent(p.id) : undefined);
    });
  }, [params]);

  useEffect(() => {
    const perm = permissionByKey['detection'];
    if (!perm) {
      setReady(true);
      return;
    }
    getRbacMe()
      .then((me) => {
        const perms: string[] = Array.isArray(me?.permissions) ? me.permissions : [];
        if (!me?.is_superuser && !perms.includes(perm)) {
          router.replace('/settings/detection');
        } else {
          setReady(true);
        }
      })
      .catch(() => {
        // On error fall back to the list page rather than showing a blank screen.
        router.replace('/settings/detection');
      });
  }, [router]);

  if (!ready) return null;
  return <Detections initialRuleId={ruleId} />;
}
