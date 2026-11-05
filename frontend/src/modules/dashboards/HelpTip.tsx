import React, { useState } from 'react';
import { Popover, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

interface Detail {
  what: string;
  how: string;
  why: string;
  fix?: string;
}

/** Long-form explanations shown when the "?" is clicked (what / how calculated / why it matters / how to improve). */
const DETAILS: Record<string, Detail> = {
  logCoverage: {
    what: 'The share of configured log source categories that actually sent logs recently.',
    how: 'Receiving categories ÷ configured categories. A category is configured once at least one log source is assigned to it, and receiving when any of its sources had documents in the scan window.',
    why: 'A category with no logs is a blind spot: even good rules cannot detect anything there.',
    fix: 'Check agents/shippers for the silent categories, or assign the right sources in Configure.',
  },
  receiving: {
    what: 'How many configured categories are receiving logs.',
    how: 'Categories with documents in the window ÷ all configured categories. The window is shown in the title (default 7 days).',
    why: 'Shows at a glance whether the monitored estate is actually reporting.',
    fix: 'Open the red category cards to see which sources went quiet and when they were last seen.',
  },
  enabledRules: {
    what: 'How many detection rules are switched on, out of the whole rule library.',
    how: 'Enabled rules ÷ total rules (non-deleted). Enabled follows the rule state saved in the platform, which is updated when the rule is published to or synced from Kibana.',
    why: 'Only enabled rules detect anything or count toward ATT&CK coverage. A large library with few enabled rules gives a false sense of security.',
    fix: 'Review disabled rules, enable the ones that match your log sources, and publish them to Kibana.',
  },
  withData: {
    what: 'Enabled rules whose log source category is currently receiving data.',
    how: 'For each enabled rule, its categories are derived from its index patterns (or name/tags as a fallback). The rule counts here if any of those categories is active.',
    why: 'These rules can actually fire. This is the effective part of your rule set.',
  },
  withoutData: {
    what: 'Enabled rules that have no log data to run on.',
    how: 'Enabled rules whose categories all received no logs in the window.',
    why: 'They look like coverage but cannot trigger, so they hide real gaps.',
    fix: 'Restore the log feed for that category, or disable/retarget the rule.',
  },
  unknown: {
    what: 'Enabled rules that cannot be tied to any log source category.',
    how: 'The rule has no index pattern matching a known source and its name/tags give no clue. Overly broad patterns (e.g. *) are ignored on purpose.',
    why: 'We cannot tell whether such rules have data, so the other counts are a lower bound.',
    fix: 'Add a specific index pattern to the rule, then re-check.',
  },
  unclassified: {
    what: 'Log sources found in Elasticsearch that no category rule matched.',
    how: 'The scan lists indices/data streams, normalizes names (drops dates and versions) and classifies them by name, module and ECS category. Leftovers appear here.',
    why: 'Unclassified sources are not counted in any category, so real log sources may be missing from coverage.',
    fix: 'Drag a source onto its category, or click × to ignore noise such as metrics and internal indices. Manual choices override auto-classification.',
  },
  unmonitored: {
    what: 'Log sources that send data but have no enabled rule attributed to them.',
    how: 'Sources with documents in the window and zero enabled rules that match their name/pattern.',
    why: 'Data is being collected but nothing is looking at it.',
    fix: 'Add or enable rules for these sources. Click to review them in Coverage settings.',
  },
  attackCoverage: {
    what: 'How much of the MITRE ATT&CK technique catalog your enabled rules cover.',
    how: 'Techniques with at least one enabled rule ÷ all parent techniques in the synced catalog. Sub-techniques count toward their parent. Rule mapping comes from Sigma attack.* tags and Kibana threat fields.',
    why: 'Shows which adversary behaviors you can and cannot currently detect.',
    fix: 'Tag rules with attack.<tactic> then attack.t<id>, enable them, and publish to Kibana.',
  },
  techniques: {
    what: 'The number of ATT&CK techniques with at least one enabled rule.',
    how: 'Distinct parent techniques mapped by enabled rules ÷ total techniques in the catalog. Sync the catalog in Coverage settings if the total looks wrong.',
    why: 'The absolute count complements the percentage, since catalog size changes between ATT&CK versions.',
  },
  matrix: {
    what: 'The ATT&CK matrix: each column is a tactic, each cell a technique.',
    how: 'Cell color follows the number of enabled rules mapped to that technique; grey means no rule. A technique shared by several tactics appears in each.',
    why: 'Quickly shows where coverage is thin across the attack lifecycle.',
    fix: 'Click a tactic or technique to open the matching rules, then add or enable rules for grey cells that matter to you.',
  },
};

interface Props {
  label: React.ReactNode;
  /** One-line hint shown on hover. */
  tip: React.ReactNode;
  /** Key into DETAILS; when set, clicking the icon opens a detail popover. */
  id?: keyof typeof DETAILS | string;
}

const Section: React.FC<{ title: string; text?: string }> = ({ title, text }) =>
  text ? (
    <div style={{ marginBottom: 10 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {title}
      </Typography.Text>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{text}</div>
    </div>
  ) : null;

/** Label with a "?" icon: hover for a short hint, click for a detailed explanation popover. */
const HelpTip: React.FC<Props> = ({ label, tip, id }) => {
  const [open, setOpen] = useState(false);
  const detail = id ? DETAILS[id] : undefined;
  const icon = (
    <QuestionCircleOutlined style={{ marginLeft: 6, fontSize: 12, opacity: 0.6, cursor: detail ? 'pointer' : 'help' }} />
  );
  if (!detail) {
    return (
      <span>
        {label}
        <Tooltip title={tip}>{icon}</Tooltip>
      </span>
    );
  }
  // The popover is anchored to a wrapper span (not to the Tooltip) so the two never fight over the same element;
  // the hover hint is suppressed while the detail popover is open.
  return (
    <span>
      {label}
      <Popover
        trigger="click"
        open={open}
        onOpenChange={setOpen}
        placement="bottomLeft"
        overlayStyle={{ maxWidth: 360 }}
        title={<span>{label}</span>}
        content={
          <div style={{ maxWidth: 340 }}>
            <Section title="What it is" text={detail.what} />
            <Section title="How it is calculated" text={detail.how} />
            <Section title="Why it matters" text={detail.why} />
            <Section title="How to improve" text={detail.fix} />
          </div>
        }
      >
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-block' }}>
          <Tooltip title={tip} open={open ? false : undefined}>
            {icon}
          </Tooltip>
        </span>
      </Popover>
    </span>
  );
};

export default HelpTip;
