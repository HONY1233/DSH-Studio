/** Native settings whose behavior is also available in Studio. */
export declare const GUI_SECOND_BATCH_SETTINGS: {
    readonly "contextPromotion.enabled": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "上下文溢出时提升模型";
        readonly en: "Promote model on context overflow";
        readonly note: "模型配置了更大上下文目标时，溢出后可切换模型而不是压缩。";
        readonly noteEn: "On overflow, use the model's configured larger-context target instead of compaction.";
    };
    readonly includeWorkspaceTree: {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "在上下文中包含工作区树";
        readonly en: "Include workspace tree in context";
        readonly note: "目录变化可能影响提示缓存。";
        readonly noteEn: "Directory changes can invalidate prompt caching.";
    };
    readonly "workspace.additionalDirectories": {
        readonly type: "strings";
        readonly default: string[];
        readonly zh: "附加工作区目录";
        readonly en: "Additional workspace directories";
        readonly note: "每行一个目录；这些目录会成为 Agent 可以访问的工作区根目录。相对路径按项目目录解析。";
        readonly noteEn: "One directory per line. These become workspace roots accessible to the agent; relative paths resolve against the project.";
    };
    readonly "memory.backend": {
        readonly type: "enum";
        readonly values: readonly ["off", "local", "hindsight", "mnemopi", "sharpshooter"];
        readonly default: "off";
        readonly zh: "记忆后端";
        readonly en: "Memory backend";
        readonly note: "记忆后端可使用模型服务；Hindsight 会向配置的服务发送会话内容。";
        readonly noteEn: "Memory backends can use model services; Hindsight sends conversation content to its configured service.";
    };
    readonly "mnemopi.autoRecall": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "Mnemopi 自动召回";
        readonly en: "Mnemopi automatic recall";
        readonly note: "在会话首轮召回记忆。";
        readonly noteEn: "Recall memories on the first session turn.";
    };
    readonly "mnemopi.autoRetain": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "Mnemopi 自动保留";
        readonly en: "Mnemopi automatic retention";
        readonly note: "从已完成的对话轮次保留记忆。";
        readonly noteEn: "Retain memories from completed turns.";
    };
    readonly "mnemopi.recallLimit": {
        readonly type: "number";
        readonly default: 8;
        readonly min: 1;
        readonly zh: "Mnemopi 召回条数";
        readonly en: "Mnemopi recall limit";
    };
    readonly "mnemopi.injectionTokenLimit": {
        readonly type: "number";
        readonly default: 5000;
        readonly min: 256;
        readonly zh: "Mnemopi 注入上限（tokens）";
        readonly en: "Mnemopi injection limit (tokens)";
    };
    readonly "mnemopi.debug": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "Mnemopi 调试日志";
        readonly en: "Mnemopi debug logging";
        readonly note: "调试日志可能包含记忆相关信息。";
        readonly noteEn: "Debug logs may contain memory-related information.";
    };
    readonly "hindsight.apiUrl": {
        readonly type: "string";
        readonly default: "http://localhost:8888";
        readonly zh: "Hindsight 服务地址";
        readonly en: "Hindsight service URL";
        readonly note: "服务位于 Runtime 所在的环境；保存地址不代表服务已连接。";
        readonly noteEn: "The URL is resolved in the Runtime environment; saving it does not verify connectivity.";
    };
    readonly "hindsight.scoping": {
        readonly type: "enum";
        readonly values: readonly ["global", "per-project", "per-project-tagged"];
        readonly default: "per-project-tagged";
        readonly zh: "Hindsight 记忆作用域";
        readonly en: "Hindsight memory scope";
    };
    readonly "hindsight.autoRecall": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "Hindsight 自动召回";
        readonly en: "Hindsight automatic recall";
        readonly note: "在会话首轮召回记忆。";
        readonly noteEn: "Recall memories on the first session turn.";
    };
    readonly "hindsight.autoRetain": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "Hindsight 自动保留";
        readonly en: "Hindsight automatic retention";
        readonly note: "定期将对话轮次发送至 Hindsight 服务。";
        readonly noteEn: "Periodically send conversation turns to the Hindsight service.";
    };
    readonly "hindsight.recallMaxTokens": {
        readonly type: "number";
        readonly default: 1024;
        readonly min: 1;
        readonly zh: "Hindsight 召回上限（tokens）";
        readonly en: "Hindsight recall limit (tokens)";
    };
    readonly "hindsight.debug": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "Hindsight 调试日志";
        readonly en: "Hindsight debug logging";
        readonly note: "调试日志可能包含记忆相关信息。";
        readonly noteEn: "Debug logs may contain memory-related information.";
    };
    readonly "edit.mode": {
        readonly type: "enum";
        readonly values: readonly ["apply_patch", "hashline", "patch", "replace", "sloppy", "none"];
        readonly default: "hashline";
        readonly zh: "编辑模式";
        readonly en: "Edit mode";
        readonly note: "模型专属规则或环境变量可能改变实际使用的模式。";
        readonly noteEn: "Model-specific rules or environment variables may change the effective mode.";
    };
    readonly readLineNumbers: {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "读取结果默认显示行号";
        readonly en: "Show line numbers in reads";
        readonly note: "Hashline 编辑模式仍会显示行号。";
        readonly noteEn: "Hashline edit mode still displays line numbers.";
    };
    readonly "read.defaultLimit": {
        readonly type: "number";
        readonly default: 300;
        readonly min: 1;
        readonly max: 3000;
        readonly zh: "默认读取行数";
        readonly en: "Default read line limit";
        readonly note: "仅用于未指定行数的读取；实际结果也受输出限制。";
        readonly noteEn: "Used when no explicit line limit is provided; output limits still apply.";
    };
    readonly "read.summarize.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "结构化代码读取摘要";
        readonly en: "Structural code read summaries";
        readonly note: "未指定选择范围时可返回代码结构摘要。";
        readonly noteEn: "Return a structural code summary when no selector is provided.";
    };
    readonly "read.renderMarkdown": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "Markdown 读取预览";
        readonly en: "Markdown read previews";
        readonly note: "在读取工具卡片中渲染 Markdown。";
        readonly noteEn: "Render Markdown in read tool cards.";
    };
    readonly "lsp.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "启用 LSP 工具";
        readonly en: "Enable the LSP tool";
    };
    readonly "lsp.lazy": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "延迟启动语言服务器";
        readonly en: "Start language servers lazily";
        readonly note: "首次需要时启动；已启动的服务器不会因此停止。";
        readonly noteEn: "Start on first use; already running servers are not stopped.";
    };
    readonly "lsp.shared": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "复用语言服务器";
        readonly en: "Reuse language servers";
        readonly note: "对后续启动的服务器连接生效；现有连接保持不变。";
        readonly noteEn: "Applies to subsequent server connections; existing connections remain unchanged.";
    };
    readonly "bash.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "启用 Agent Bash 工具";
        readonly en: "Enable the agent Bash tool";
        readonly note: "不影响 Studio 底部终端。";
        readonly noteEn: "Does not affect the Studio terminal.";
    };
    readonly "shellMinimizer.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "压缩 Shell 输出";
        readonly en: "Minimize shell output";
        readonly note: "压缩返回给 Agent 的常见命令输出。";
        readonly noteEn: "Compress common command output returned to the agent.";
    };
    readonly "eval.py": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "启用 Python Eval";
        readonly en: "Enable Python eval";
    };
    readonly "eval.js": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "启用 JavaScript Eval";
        readonly en: "Enable JavaScript eval";
    };
    readonly "python.interpreter": {
        readonly type: "string";
        readonly default: "";
        readonly zh: "Python 解释器路径";
        readonly en: "Python interpreter path";
        readonly note: "留空自动发现；已运行的内核可能需要重建。";
        readonly noteEn: "Leave empty for discovery; a running kernel may need to be recreated.";
    };
    readonly "async.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "启用异步任务";
        readonly en: "Enable asynchronous jobs";
    };
    readonly "async.maxJobs": {
        readonly type: "number";
        readonly default: 100;
        readonly min: 1;
        readonly max: 100;
        readonly zh: "后台任务并发上限";
        readonly en: "Maximum concurrent background jobs";
    };
    readonly "tools.maxTimeout": {
        readonly type: "number";
        readonly default: 0;
        readonly min: 0;
        readonly zh: "工具超时上限（秒）";
        readonly en: "Maximum tool timeout (seconds)";
        readonly note: "0 表示不设置全局上限；各工具仍有自己的默认值。";
        readonly noteEn: "0 removes the global cap; individual tools retain their defaults.";
    };
    readonly "plan.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "启用 Plan 模式";
        readonly en: "Enable Plan mode";
    };
    readonly "plan.defaultOnStartup": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "新会话默认进入 Plan";
        readonly en: "Start new sessions in Plan";
        readonly note: "仅对没有明确模式的新会话生效。";
        readonly noteEn: "Applies only to new sessions without an explicit mode.";
    };
    readonly "goal.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "启用 Goal 模式";
        readonly en: "Enable Goal mode";
    };
    readonly "loop.mode": {
        readonly type: "enum";
        readonly values: readonly ["prompt", "compact", "reset"];
        readonly default: "prompt";
        readonly zh: "Loop 轮次策略";
        readonly en: "Loop iteration strategy";
        readonly note: "重复提示、先压缩，或开始新会话。";
        readonly noteEn: "Repeat the prompt, compact first, or start a new session.";
    };
    readonly "task.isolation.enabled": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "允许隔离子任务";
        readonly en: "Allow isolated subagents";
        readonly note: "只允许按需使用隔离；没有请求隔离的子任务仍共享工作区。";
        readonly noteEn: "Allows isolation when requested; other subagents share the workspace.";
    };
    readonly "task.isolation.apply": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "自动应用隔离任务修改";
        readonly en: "Apply isolated task changes";
        readonly note: "关闭时保留补丁或分支供后续处理。";
        readonly noteEn: "When disabled, retain the patch or branch for later review.";
    };
    readonly "task.isolation.merge": {
        readonly type: "enum";
        readonly values: readonly ["patch", "branch"];
        readonly default: "patch";
        readonly zh: "隔离任务合并方式";
        readonly en: "Isolated task merge strategy";
        readonly note: "使用补丁应用或创建提交并合并分支。";
        readonly noteEn: "Apply a patch or create commits and merge a branch.";
    };
};
//# sourceMappingURL=gui-second-batch-settings.d.ts.map