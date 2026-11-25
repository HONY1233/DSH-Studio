/** OMP settings exposed by the Studio GUI; exact public allowlist. */
export declare const GUI_SETTING_DEFINITIONS: {
    readonly "providers.cacheWarming": {
        readonly type: "enum";
        readonly values: readonly ["off", "streaming", "idle"];
        readonly default: "idle";
        readonly zh: "提示缓存预热";
        readonly en: "Prompt cache warming";
        readonly note: "空闲预热可能发出计费请求；沿用 Runtime 的成本收益判断。";
        readonly noteEn: "Idle warming may incur charges; native cost-benefit checks apply.";
    };
    readonly "task.speculativeLaunch": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "流式提前启动子代理";
        readonly en: "Speculative task launch";
    };
    readonly "providers.openaiLiveSteering": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "OpenAI 实时纠偏";
        readonly en: "OpenAI live steering";
    };
    readonly "telemetry.otlpExportEnabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "OTLP 导出";
        readonly en: "OTLP export";
    };
    readonly "advisor.evictStaleResults": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "清理 Advisor 旧工具结果";
        readonly en: "Evict stale advisor results";
    };
    readonly "task.agentCompactionThresholdOverrides": {
        readonly type: "thresholds";
        readonly default: {};
        readonly zh: "子代理压缩阈值";
        readonly en: "Agent compaction thresholds";
        readonly note: "按代理名称配置，例如 {\"task\":\"80%\",\"reviewer\":90000}；null 清除继承。";
        readonly noteEn: "Map agent names to percentages or token counts; null clears inherited entries.";
    };
    readonly "mnemopi.scoping": {
        readonly type: "enum";
        readonly values: readonly ["global", "per-project", "per-project-tagged"];
        readonly default: "per-project";
        readonly zh: "记忆作用域";
        readonly en: "Memory scope";
    };
    readonly "tier.openai": {
        readonly type: "enum";
        readonly values: readonly ["none", "auto", "default", "flex", "scale", "priority", "ultrafast"];
        readonly default: "none";
        readonly zh: "OpenAI 默认服务档位";
        readonly en: "OpenAI default tier";
    };
    readonly "tier.anthropic": {
        readonly type: "enum";
        readonly values: readonly ["none", "priority"];
        readonly default: "none";
        readonly zh: "Anthropic 默认服务档位";
        readonly en: "Anthropic default tier";
    };
    readonly "tier.google": {
        readonly type: "enum";
        readonly values: readonly ["none", "flex", "priority"];
        readonly default: "none";
        readonly zh: "Google 默认服务档位";
        readonly en: "Google default tier";
    };
    readonly "tier.subagent": {
        readonly type: "enum";
        readonly values: readonly ["inherit", "none", "auto", "default", "flex", "scale", "priority", "ultrafast"];
        readonly default: "inherit";
        readonly zh: "子代理默认服务档位";
        readonly en: "Subagent default tier";
    };
    readonly "tier.advisor": {
        readonly type: "enum";
        readonly values: readonly ["inherit", "none", "auto", "default", "flex", "scale", "priority", "ultrafast"];
        readonly default: "none";
        readonly zh: "Advisor 默认服务档位";
        readonly en: "Advisor default tier";
    };
    readonly "codexResets.autoRedeem5h": {
        readonly type: "enum";
        readonly values: readonly ["unset", "yes", "no"];
        readonly default: "unset";
        readonly zh: "Codex 5 小时窗口重置";
        readonly en: "Codex 5-hour reset policy";
    };
    readonly "codexResets.autoRedeemWeekly": {
        readonly type: "enum";
        readonly values: readonly ["unset", "yes", "no"];
        readonly default: "unset";
        readonly zh: "Codex 周窗口重置";
        readonly en: "Codex weekly reset policy";
    };
    readonly "codexResets.minBlockedMinutes": {
        readonly type: "number";
        readonly default: 60;
        readonly zh: "Codex 最短受限时间（分钟）";
        readonly en: "Codex minimum blocked minutes";
    };
    readonly "codexResets.keepCredits": {
        readonly type: "number";
        readonly default: 0;
        readonly zh: "Codex 保留重置券";
        readonly en: "Codex resets to retain";
    };
    readonly "codexResets.salvageHorizonHours": {
        readonly type: "number";
        readonly default: 12;
        readonly zh: "Codex 到期利用窗口（小时）";
        readonly en: "Codex reset expiry horizon (hours)";
    };
    readonly "disassembler.backend": {
        readonly type: "enum";
        readonly values: readonly ["auto", "ida", "ghidra", "none"];
        readonly default: "auto";
        readonly zh: "反汇编后端";
        readonly en: "Disassembler backend";
    };
    readonly "disassembler.maxOpen": {
        readonly type: "number";
        readonly default: 4;
        readonly zh: "同时打开的数据库上限";
        readonly en: "Maximum open databases";
    };
    readonly "disassembler.idleCloseSec": {
        readonly type: "number";
        readonly default: 900;
        readonly zh: "空闲关闭时间（秒）";
        readonly en: "Idle close timeout (seconds)";
    };
    readonly "spelling.autocomplete": {
        readonly type: "enum";
        readonly values: readonly ["off", "auto", "ngram", "smollm", "apple"];
        readonly default: "auto";
        readonly zh: "输入预测引擎";
        readonly en: "Input prediction engine";
        readonly note: "自动使用本地 N-gram；SmolLM2 需显式下载。Windows 不提供 Apple 引擎。";
        readonly noteEn: "Auto uses local N-gram. SmolLM2 requires an explicit download; Apple is unavailable on Windows.";
    };
    readonly steeringMode: {
        readonly type: "enum";
        readonly values: readonly ["all", "one-at-a-time"];
        readonly default: "one-at-a-time";
        readonly zh: "Steering 消息处理";
        readonly en: "Steering message delivery";
        readonly note: "运行中插入的纠偏消息按条或批量处理。";
        readonly noteEn: "Deliver queued steering messages one at a time or together.";
    };
    readonly followUpMode: {
        readonly type: "enum";
        readonly values: readonly ["all", "one-at-a-time"];
        readonly default: "one-at-a-time";
        readonly zh: "Follow-up 消息处理";
        readonly en: "Follow-up message delivery";
        readonly note: "一轮结束后按条或批量处理排队消息。";
        readonly noteEn: "Drain follow-up messages one at a time or together.";
    };
    readonly interruptMode: {
        readonly type: "enum";
        readonly values: readonly ["immediate", "wait"];
        readonly default: "immediate";
        readonly zh: "纠偏消息中断时机";
        readonly en: "Steering interruption";
        readonly note: "决定纠偏消息何时中断正在执行的工具；不改变停止任务按钮。";
        readonly noteEn: "Controls when a steering message interrupts tools, not the Stop button.";
    };
    readonly personality: {
        readonly type: "enum";
        readonly values: readonly ["default", "friendly", "pragmatic", "none"];
        readonly default: "default";
        readonly zh: "回答风格";
        readonly en: "Response style";
        readonly note: "设置主代理系统提示中的沟通风格。";
        readonly noteEn: "Set the main agent's system-prompt communication style.";
    };
    readonly textVerbosity: {
        readonly type: "enum";
        readonly values: readonly ["low", "medium", "high"];
        readonly default: "low";
        readonly zh: "回答详略";
        readonly en: "Response verbosity";
        readonly note: "仅对支持该参数的 OpenAI Responses 和 Codex 模型生效。";
        readonly noteEn: "Applies to supported OpenAI Responses and Codex models only.";
    };
    readonly "compaction.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "自动压缩上下文";
        readonly en: "Automatic context compaction";
    };
    readonly "compaction.midTurnEnabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "轮次中途压缩";
        readonly en: "Mid-turn compaction";
        readonly note: "在安全的工具循环边界检查压缩阈值。";
        readonly noteEn: "Check thresholds at safe tool-loop boundaries.";
    };
    readonly "compaction.thresholdPercent": {
        readonly type: "number";
        readonly default: -1;
        readonly min: -1;
        readonly max: 100;
        readonly zh: "压缩阈值（%）";
        readonly en: "Compaction threshold (%)";
        readonly note: "-1 使用默认阈值；固定 token 阈值优先，模型专属设置也可能覆盖。";
        readonly noteEn: "-1 uses the default; token and model-specific thresholds can take precedence.";
    };
    readonly "compaction.thresholdTokens": {
        readonly type: "number";
        readonly default: -1;
        readonly min: -1;
        readonly zh: "压缩阈值（tokens）";
        readonly en: "Compaction threshold (tokens)";
        readonly note: "-1 使用百分比阈值；指定 token 数时优先于百分比。";
        readonly noteEn: "-1 uses the percentage; an explicit token limit takes precedence.";
    };
    readonly "compaction.supersedeReads": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "清理旧读取结果";
        readonly en: "Supersede stale reads";
        readonly note: "重新读取文件时清理被替代的旧结果。";
        readonly noteEn: "Prune older results when a file is read again.";
    };
    readonly "edit.fuzzyMatch": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "编辑模糊匹配";
        readonly en: "Fuzzy edit matching";
    };
    readonly "edit.fuzzyThreshold": {
        readonly type: "number";
        readonly default: 0.95;
        readonly min: 0;
        readonly max: 1;
        readonly step: 0.01;
        readonly zh: "编辑匹配阈值";
        readonly en: "Edit match threshold";
        readonly note: "0 到 1 之间的相似度。";
        readonly noteEn: "Similarity between 0 and 1.";
    };
    readonly "edit.blockAutoGenerated": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "保护自动生成的文件";
        readonly en: "Protect generated files";
    };
    readonly "edit.enforceSeenLines": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "仅编辑已查看的行";
        readonly en: "Require previously viewed lines";
    };
    readonly "lsp.formatOnWrite": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "写入时格式化";
        readonly en: "Format on write";
    };
    readonly "lsp.diagnosticsOnWrite": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "写入后返回诊断";
        readonly en: "Diagnostics after write";
    };
    readonly "lsp.diagnosticsOnEdit": {
        readonly type: "boolean";
        readonly default: false;
        readonly zh: "编辑后返回诊断";
        readonly en: "Diagnostics after edit";
    };
    readonly "bash.autoBackground.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "长命令自动转后台";
        readonly en: "Background long commands";
    };
    readonly "bash.direnv": {
        readonly type: "enum";
        readonly values: readonly ["auto", "off"];
        readonly default: "auto";
        readonly zh: "direnv 环境加载";
        readonly en: "Load direnv environment";
        readonly note: "遵守 direnv 自身的允许列表。";
        readonly noteEn: "Honors the direnv allow list.";
    };
    readonly "task.maxConcurrency": {
        readonly type: "number";
        readonly default: 32;
        readonly zh: "子任务并发上限";
        readonly en: "Maximum concurrent subagents";
        readonly note: "0 表示不限。";
        readonly noteEn: "0 means unlimited.";
    };
    readonly "task.maxRecursionDepth": {
        readonly type: "number";
        readonly default: 2;
        readonly min: -1;
        readonly zh: "子任务递归深度";
        readonly en: "Subagent recursion depth";
        readonly note: "-1 表示不限，0 禁止递归。";
        readonly noteEn: "-1 means unlimited; 0 disables recursion.";
    };
    readonly "task.maxRuntimeMs": {
        readonly type: "number";
        readonly default: 0;
        readonly zh: "子任务最长运行时间（毫秒）";
        readonly en: "Subagent time limit (ms)";
        readonly note: "硬时限；0 表示不限。";
        readonly noteEn: "Hard time limit; 0 means unlimited.";
    };
    readonly "task.softRequestBudget": {
        readonly type: "number";
        readonly default: 200;
        readonly zh: "子任务请求软预算";
        readonly en: "Subagent soft request budget";
        readonly note: "达到软预算后提示收尾；0 关闭预算。";
        readonly noteEn: "Prompts the agent to wrap up at the soft budget; 0 disables it.";
    };
    readonly "retry.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "自动重试";
        readonly en: "Automatic retries";
    };
    readonly "retry.maxRetries": {
        readonly type: "number";
        readonly default: 10;
        readonly zh: "最大重试次数";
        readonly en: "Maximum retries";
    };
    readonly "model.toolCallLoopGuard.enabled": {
        readonly type: "boolean";
        readonly default: true;
        readonly zh: "工具调用循环保护";
        readonly en: "Tool-call loop guard";
    };
    readonly "model.toolCallLoopGuard.threshold": {
        readonly type: "number";
        readonly default: 5;
        readonly zh: "重复工具调用阈值";
        readonly en: "Repeated tool-call threshold";
    };
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
export type GuiSettingKey = keyof typeof GUI_SETTING_DEFINITIONS;
type DefinitionValue<D> = D extends {
    type: 'enum';
    values: readonly (infer V)[];
} ? V : D extends {
    type: 'boolean';
} ? boolean : D extends {
    type: 'number';
} ? number : D extends {
    type: 'strings';
} ? string[] : D extends {
    type: 'thresholds';
} ? Record<string, number | string | null> : string;
export type GuiSettingsSnapshot = {
    [K in GuiSettingKey]?: DefinitionValue<(typeof GUI_SETTING_DEFINITIONS)[K]>;
};
export declare const GUI_SETTING_KEYS: GuiSettingKey[];
export declare function isGuiSettingKey(key: string): key is GuiSettingKey;
export declare function validateGuiSetting(key: GuiSettingKey, value: unknown): void;
export {};
//# sourceMappingURL=gui-settings.d.ts.map