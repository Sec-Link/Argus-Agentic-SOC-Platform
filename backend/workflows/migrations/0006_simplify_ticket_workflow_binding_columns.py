from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('workflows', '0005_ticket_workflow_binding'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE workflows_ticketworkflowbinding
                    DROP COLUMN IF EXISTS trigger_event,
                    DROP COLUMN IF EXISTS priority_filter,
                    DROP COLUMN IF EXISTS category_filter,
                    DROP COLUMN IF EXISTS target_status,
                    DROP COLUMN IF EXISTS dedup_strategy,
                    DROP COLUMN IF EXISTS is_active;
            """,
            reverse_sql="""
                ALTER TABLE workflows_ticketworkflowbinding
                    ADD COLUMN IF NOT EXISTS trigger_event varchar(50) NOT NULL DEFAULT 'on_create',
                    ADD COLUMN IF NOT EXISTS priority_filter varchar(50) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS category_filter varchar(100) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS target_status varchar(50) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS dedup_strategy varchar(50) NOT NULL DEFAULT 'once_per_ticket',
                    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
            """,
        ),
    ]
