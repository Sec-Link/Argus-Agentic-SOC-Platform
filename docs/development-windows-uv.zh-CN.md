# Windows Prefect debugging

## VS Code 调试

先确保 Prefect Server 与 deployment 已准备好：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-prefect.ps1 -SkipWorker -SkipConsumer
```

然后在 VS Code 选择：

- `Debug: Prefect Worker + Flows`：调试事件消费者、Worker 和 Flow 子进程。
- `Debug: Workflow`：调试 Django API、事件消费者、Prefect Worker，以及每次 Flow Run 创建的 `prefect.engine` 子进程。
- `Debug: Full Stack`：在上述基础上同时调试 Next.js 服务端，并启动第二组独立的 deployment、work pool 和 Worker。

三个可见调试入口都会先完整执行一次调试前置任务，再启动其中的调试配置，因此 Next.js 不会早于 Prefect 检查启动。前置任务会检查 Django 迁移，并停止脚本管理的普通 Worker 和消费者，随后由调试器启动所需 Worker 和一个事件消费者；它不会启动 Prefect Server，也不会自动应用数据库迁移。迁移检查失败时，先运行 `uv run python backend/manage.py migrate workflows`。浏览器请手动打开 `http://127.0.0.1:3000`，React 客户端断点使用浏览器 DevTools。

前置任务按 `soar-generic/soar-generic-deployment` 查询第一组 deployment，不读取 `.env` 中的 deployment ID。`Debug: Full Stack` 使用 `Prepare: Full Stack Debug`，向同一个准备脚本传入 `-WithSecondDeployment`，创建或更新第二组 deployment 和 process pool，并保留第一组配置：

| Deployment | Work pool | 调试 Worker |
| --- | --- | --- |
| `soar-generic-deployment` | `argus-workflows` | `argus-debug-worker` |
| `soar-generic-deployment-debug-2` | `argus-workflows-debug-2` | `argus-debug-worker-2` |

两组使用同一个 `soar-generic` flow、Prefect Server 和 Django 事件消费者，各自的 Worker 只监听对应 pool。只有 `Debug: Full Stack` 会准备并启动第二组；另外两个调试入口仍只启动第一组。第二个 Worker 也支持 Flow 子进程断点，调试日志写入 `.run/debugpy/worker-2/`。在 workflow 设置中分别选择两个 deployment，即可验证不同执行目标。

需要单独检查其他 deployment 时，手动运行 `scripts/prepare-prefect-debug.ps1 -DeploymentName <名称>`；它仍要求使用 `soar-generic` flow，内置第一组调试 Worker 仍只监听 `argus-workflows` pool。

准备完成后，可运行 `python scripts/check-prefect-debug.py`，只读检查 Full Stack 的两个 Worker 是否使用不同名称和 pool，以及 Prefect 中是否存在对应的兼容 deployment。
