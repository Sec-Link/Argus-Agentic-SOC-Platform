# Workflow deployment 注册与升级

同一个 `PREFECT_API_URL` 下可以注册多个 deployment。Prefect 保存 deployment 定义，Django 消费 deployment 事件并维护本地注册表，workflow 的 `prefect_deployment_id` 保存明确的执行目标。未绑定的草稿可以保存；执行、发布和启用计划前必须选择有效的 deployment。

## 已有环境：先绑定，再升级

旧版允许空 `prefect_deployment_id` 使用 `.env` 的默认目标。新版移除这条回退路径，不自动猜测历史 workflow 应当去哪个 deployment。数据库迁移只建立注册表，不替用户填写历史绑定。

1. 在运行旧版代码期间，确认历史默认 deployment 的 UUID，并在 Prefect UI 核对 flow、pool 和 queue。记录实际使用该默认目标的 workflow，包含已发布、停用、带计划和暂时未执行的 workflow。不要把原本有绑定的 workflow 改成默认目标。
2. 对确认应继续使用旧默认目标的空绑定 workflow，调用现有详情 API：`PATCH /api/v1/workflows/workflows/<workflow UUID>/`，请求体为 `{"prefect_deployment_id":"<已确认的旧 deployment UUID>"}`，使用现有管理员会话或 API 认证。逐一检查响应并重新 GET，确认绑定已保存。不要将未知目标的草稿批量绑定到某个任意 deployment。
3. 对历史计划，在 Prefect 确认原有计划仍属于这个相同 UUID。这一步只是补全已有路由记录，不迁移计划、不新建第二份计划。确认所有应继续执行的 workflow 都已显式绑定，再移除旧版的环境变量回退。
4. 部署新版代码并运行 `python backend/manage.py migrate workflows`，然后重启 Django Web 和独立 `consume_prefect_events` 进程，使它们使用新的事件处理逻辑。保留 `PREFECT_API_URL` 及现有 Prefect 认证配置；旧 `PREFECT_DEPLOYMENT_ID` 不再读取，可以从运行环境删除。
5. 打开 workflow 的 deployment 列表，确认同步成功。消费者连接时读取完整列表，之后响应 deployment 事件并每 60 秒核对一次。检查已绑定目标仍可选，执行一个受控 workflow 验证路由。旧 `POST /api/v1/workflows/prefect/sync/` 接口已退役并返回 HTTP 410，不再从 deployment 创建 workflow。

以上是部署操作说明；代码变更本身不会读取旧 `.env`、改写生产 workflow 或执行迁移。若已提前升级且发现历史空绑定，应先停止这些 workflow 的触发和计划，核对原目标与计划后处理，不能用另一个默认目标掩盖缺失绑定。

## 日常使用

- 通过 Prefect 发布带 `soar` 标签、入口为 `backend/workflows/prefect/flow.py:run_soar_workflow` 的 deployment；Django 的事件消费者同步创建、更新和删除变化，连接恢复时核对当前 deployment 列表。列表还没有出现时先确认 consumer 正常运行与这两个兼容条件，等待下一次同步。
- 新建 workflow 时可以先保存未绑定草稿；准备发布和运行时选择注册的 deployment。删除 deployment 后，已有 workflow 保留 UUID 便于定位，运行不会自动转到其他 deployment。
- 有计划的 workflow 更换目标前，先在原 deployment 上删除全部原计划，包括暂停的计划，然后修改绑定并按需重建计划。第一版不自动搬迁计划，避免两个目标重复执行。
- 创建计划时先保存本地 UUID，再同步 Prefect。响应超时会保留计划并返回它的 ID；刷新计划列表后重试同步或删除该计划，不要重复新建。发布版本后如果计划同步失败，页面会提示具体错误，已发布版本和本地计划仍保留。
- Deployment 决定使用哪个 work pool / queue。同一 pool 下多个 Worker 可以接到任务；如果执行目标代表不同网络或站点，在 Prefect 配置对应的 pool / queue，再为 workflow 选择那个 deployment。
- `NOT_READY` 表示当前监听状态，不会自动清除注册或禁止选择；没有 Worker 接单时，Prefect 任务可能等待执行。注册可用性与 Worker 是否在线分别显示。
- Django 自动在 Prefect Secret 管理受限的 Worker API 凭据，无需手工 `PREFECT_WORKER_TOKEN`。各 Worker 仍需正确的 `BACKEND_ORIGIN` 和 workflow 解密密钥配置。

导入邮件示例默认为草稿：

```powershell
python backend/manage.py import_workflow_playbooks --recipient ops@example.com
```

需要同时绑定并启用时，必须明确给出已注册 UUID，之后仍需发布 workflow 快照：

```powershell
python backend/manage.py import_workflow_playbooks --recipient ops@example.com --deployment-id <UUID> --activate
```

`sync_prefect_schedules` 只同步已明确绑定的计划；未绑定、目标无效或同步失败时，命令列出计划 ID 并以失败状态退出，成功项的数量单独输出。它不为无计划的草稿选择 deployment，也不恢复全局默认值。
