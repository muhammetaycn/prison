import type { ConcreteTarget, Localized } from "@/models/common";
import type { IntentAnalysis } from "@/models/intent";
import type { Operation, SpecFlags } from "@/models/spec";
import { FALLBACK_TASK_TYPE, listTaskTypes, resolveTaskProfile } from "@/core/task-types/registry";
import { fill, fold } from "@/core/text/normalize";
import { DOMAIN_HINTS, LOCAL_TEXT, PROTECTED_SIGNALS, STACK_PATTERN } from "@/templates/local-engine";
import { phrase } from "@/templates/phrases";
import { extractGoal, titleFromGoal } from "./goal";
import type { IntentInput } from "../types";

/**
 * Rule-based fallback analyzer, used only when no AI provider is configured.
 * It produces the same IntentAnalysis shape as the LLM path, so every downstream engine
 * (resolver, compiler, critic) behaves identically. Its understanding is shallower and the UI says so.
 */

const SIGNALS = {
  existing: /(mevcut|var olan|varolan|halihazirda|su anki|suanki|existing|current|my (site|app|project|repo|website|code|store)|现有|已有|原有|当前|目前的|我的(?:网站|应用|项目|代码|仓库|系统))/,
  possessive: /(?<![a-z])(proje|site|websitesi|web sitesi|uygulama|app|kod|repo|sistem|sayfa|magaza|hesab|blog)[a-z]*?(m|im|um)(i|u|e|a|de|da|deki|daki|in|un)?(?![a-z])/,
  newSystem: /(sifirdan|yeni bir|yeni (proje|site|uygulama|sistem)|from scratch|new (app|project|site|website|system)|build (a|an) |从零开始|从头创建|新(?:的)?(?:应用|项目|网站|系统))/,
  preserve: /(bozmadan|bozma\b|bozulmadan|degistirmeden|dokunmadan|koru|without breaking|don'?t break|preserve|keep (the )?existing|保留|保护|保持.{0,8}(?:不变|原样|现有)|不(?:要)?(?:破坏|改变|修改).{0,8}(?:架构|功能|设计))/,
  codingHint: /(?<![a-z])(kod|code|implement|entegr|integrat|api|endpoint|repo|component|fonksiyon|function|script|代码|编程|软件开发|接口|仓库|数据库|组件|函数|脚本|前端|后端|登录页面|注册页面)/,
  deployPositive: /(deploy|canliya al|yayina al|production'?a|prod'?a|yayinla|publish|部署|上线|发布(?!文案|计划|说明|指南|策略|会|稿))/,
  deployNegative:
    /((deploy|canli|yayin|production|prod)\S*\s+(etme|yapma|alma|etmesin|yapmasin|olmasin|izin verme)|(don'?t|do not|never|no) (deploy|publish|push)|(?:不要|请勿|禁止|不得|不许|不允许|无需|不用|不)(?:\s*直接|\s*自动|\s*再)?\s*(?:部署|发布|上线|推送)|(?:禁止|不得|不要|请勿)[^，。；;\n]{0,12}(?:部署|发布|上线))/,
  advice: /((sadece|yalnizca)\s+(oneri|tavsiye|analiz|incele|rapor)|only (suggest|recommend|advise|analy|review)|degisiklik yapma|(oneri|tavsiye)\s+(ver|sun)|(?:只|仅|仅仅|只是|只需)(?:做|进行|提供|给出)?(?:分析|审查|评估|建议|研究|解释|说明|报告)|(?:不要|请勿|禁止)(?:直接)?(?:修改|改动|更改)(?:代码|项目|系统|文件))/,
  analysis: /(analiz|incele|degerlendir|analy|review|audit|denetle|分析|审查|评估|诊断|审核|评审|对比)/,
  research: /(arastir|research|kaynak|literatur|研究|调查|调研|文献|资料来源)/,
  rewrite: /(sifirdan|from scratch|yeniden yaz|rewrite|从头重写|全部重写|从零重写)/,
  implement: /(uygula|implement|degistir|apply|实现|应用|实施|修改|更改|改动)/,
};

/** Han signals are kept local; registered/custom task profiles retain their own signal sets. */
const CHINESE_TASK_SIGNALS: Record<string, Array<[RegExp, number]>> = {
  coding: [[/代码|编程|软件开发|函数|组件|前端|后端|仓库|程序|项目/u, 1], [/登录|注册|接口|数据库|集成/u, 2], [/网页|网站|页面|应用程序/u, 2]],
  software_architecture: [[/架构|微服务|系统设计|模块结构|可扩展/u, 3]],
  debugging: [[/调试|报错|崩溃|故障|修复错误|查找错误|根本原因/u, 4]],
  security_analysis: [[/安全审计|安全分析|漏洞|威胁模型|渗透测试/u, 4]],
  research: [[/研究|调研|调查|文献|资料来源/u, 3]],
  deep_research: [[/深度研究|深入研究|全面调研|文献综述/u, 5]],
  data_analysis: [[/数据分析|统计分析|数据集|数据趋势|数据可视化/u, 4]],
  image_generation: [[/生成图像|生成图片|画图|绘画|绘制|插画|海报|三维模型|三维建模/u, 3]],
  image_editing: [[/编辑图片|修图|抠图|去除背景|修改图像|修改图片|重绘/u, 4]],
  video_generation: [[/视频|动画|短片|影片|镜头|剪辑/u, 3]],
  writing: [[/写作|撰写|文章|故事|小说|邮件|剧本/u, 2]],
  content_generation: [[/内容创作|内容计划|文案|宣传内容/u, 3]],
  social_media: [[/社交媒体|社媒|小红书|公众号|抖音|微博/u, 4]],
  marketing: [[/营销|广告|品牌推广|市场推广/u, 3]],
  seo: [[/搜索引擎优化|搜索排名|网站排名/u, 4]],
  automation: [[/自动化|定时任务|工作流|定时执行/u, 4]],
  agent_task: [[/智能体|多智能体|自动操作文件|代理系统/u, 3]],
  file_analysis: [[/分析文件|检查文件|读取文件|分析报告|分析文档/u, 4]],
  document_generation: [[/生成文档|创建文档|生成报告|演示文稿|幻灯片|制作文档/u, 3]],
  ui_ux: [[/用户体验|界面设计|交互设计|可用性|无障碍/u, 4]],
  business_strategy: [[/商业策略|商业计划|创业计划|业务战略/u, 3]],
  education: [[/教学|学习计划|教程|课程|讲解|学习方法/u, 3]],
};

const CHINESE_PROTECTED_SIGNALS: Array<{ pattern: RegExp; text: Localized }> = [
  { pattern: /(?:保留|保护|保持|不破坏|不要破坏)[^，。；;\n]{0,10}(?:现有功能|原有功能|用户流程)/u, text: { tr: "Mevcut işlevsellik", en: "Existing functionality", zh: "现有功能" } },
  { pattern: /(?:保留|保护|保持|不要修改|不改变|不修改)[^，。；;\n]{0,10}架构/u, text: { tr: "Mevcut mimari", en: "Existing architecture", zh: "现有架构" } },
  { pattern: /(?:保留|保持|不要修改|不改变)[^，。；;\n]{0,10}(?:设计|界面)/u, text: { tr: "Mevcut görsel tasarım", en: "Current visual design", zh: "当前的视觉设计" } },
  { pattern: /(?:保留|保持|不要修改|不改变)[^，。；;\n]{0,10}(?:路由|链接|网址|url)/u, text: { tr: "Mevcut URL'ler ve route'lar", en: "Existing URLs and routes", zh: "现有的 URL 和路由" } },
  { pattern: /(?:保留|保护|不要删除|禁止删除|不删除|不要丢失|不得删除)[^，。；;\n]{0,10}数据|数据不(?:得|能)?丢失/u, text: { tr: "Mevcut veriler (veri kaybı olmadan)", en: "Existing data (no data loss)", zh: "现有数据（不丢失数据）" } },
];
const CHINESE_NEGATED_ACTION = /(?:不要|请勿|禁止|不得|不许|不允许|不)(?:\s*直接|\s*自动)?[^，。；;\n]{0,8}(?:修改|更改|改动|实现|应用|实施)/gu;
const CHINESE_PROHIBITION = /(?:不要|请勿|禁止|不得|不许|不允许|不)(?:直接|自动|再)?(?:修改|更改|改动|删除|破坏|部署|发布|上线|推送)/u;

const CHINESE_DOMAIN_SIGNALS: Record<string, RegExp> = {
  payments: /支付|付款|收款|结账|订阅|购物车/u,
  authentication: /登录|注册|身份验证|认证|会话|密码/u,
  "search visibility": /搜索引擎|搜索排名|网站索引|站点地图/u,
  data: /数据库|数据迁移|数据模式|数据表/u,
  "social media": /社交媒体|社媒|公众号|小红书|抖音|微博/u,
  "operating system": /操作系统|系统版本/u,
  "visual design": /图像|图片|插画|海报|徽标|三维模型|三维建模/u,
  "API development": /接口|回调|微服务/u,
  "mobile development": /移动应用|手机应用|安卓|移动开发/u,
  "e-commerce": /电商|电子商务|网店|库存|订单/u,
  notifications: /通知|推送消息|短信|发送邮件/u,
  testing: /单元测试|集成测试|测试用例|端到端测试/u,
  performance: /性能|优化速度|缓存|加载速度/u,
  security: /安全|漏洞|加密|防火墙/u,
  automation: /自动化|定时任务|工作流/u,
};

const TARGET_SIGNALS: Array<[RegExp, ConcreteTarget]> = [
  [/(?<![a-z])codex/, "codex"],
  [/(?<![a-z])claude/, "claude"],
  [/(?<![a-z])(chat ?gpt|gpt)/, "gpt"],
  [/(?<![a-z])gemini/, "gemini"],
];

const stemCache = new Map<string, RegExp>();
function stemRegex(stem: string): RegExp {
  let re = stemCache.get(stem);
  if (!re) {
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9])${escaped}`);
    stemCache.set(stem, re);
  }
  return re;
}

export function detectTargetMention(folded: string): ConcreteTarget | null {
  for (const [pattern, target] of TARGET_SIGNALS) if (pattern.test(folded)) return target;
  return null;
}

export function scoreTaskTypes(folded: string, mentioned: ConcreteTarget | null): Array<{ id: string; score: number }> {
  return listTaskTypes().map((profile) => {
    let score = 0;
    for (const signal of profile.localSignals) {
      const [stem, weight] = typeof signal === "string" ? [signal, 1] : signal;
      if (stemRegex(stem).test(folded)) score += weight;
    }
    for (const [pattern, weight] of CHINESE_TASK_SIGNALS[profile.id] ?? []) {
      if (pattern.test(folded)) score += weight;
    }
    if (mentioned === "codex" && profile.id === "coding") score += 2;
    return { id: profile.id, score };
  });
}

function pickTaskTypes(scores: Array<{ id: string; score: number }>): { primary: string; secondary: string[] } {
  const max = Math.max(0, ...scores.map((s) => s.score));
  if (max === 0) return { primary: FALLBACK_TASK_TYPE, secondary: [] };
  const primary = scores.find((s) => s.score === max)!.id;
  const threshold = Math.max(2, max * 0.5);
  const secondary = scores
    .filter((s) => s.id !== primary && s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.id);
  return { primary, secondary };
}

function operationFor(flags: SpecFlags, family: string, fallback: Operation, primary: string): Operation {
  if (flags.adviceOnly) return "advise";
  if (flags.codingRequired && flags.existingSystem) return "modify_existing";
  if (flags.codingRequired && flags.newSystem) return "create_new";
  if (primary === "automation") return "automate";
  if (family === "analysis") return flags.researchRequired ? "research" : "analyze";
  return fallback;
}

export function analyzeIntentLocally(input: IntentInput): IntentAnalysis {
  const { rawRequest, language } = input;
  const folded = fold(rawRequest);
  const mentioned = detectTargetMention(folded);
  const { primary, secondary } = pickTaskTypes(scoreTaskTypes(folded, mentioned));
  const profile = resolveTaskProfile(primary);

  const existing = SIGNALS.existing.test(folded) || SIGNALS.possessive.test(folded);
  const isNew = !existing && SIGNALS.newSystem.test(folded);
  const deployNegated = SIGNALS.deployNegative.test(folded);
  const deployPositive = !deployNegated && SIGNALS.deployPositive.test(folded);
  const adviceOnly = SIGNALS.advice.test(folded);
  const engineeringBuild =
    profile.family === "engineering" && primary !== "security_analysis" && primary !== "ui_ux";
  const coding =
    !adviceOnly && (engineeringBuild || SIGNALS.codingHint.test(folded) || mentioned === "codex");

  const flags: SpecFlags = {
    existingSystem: existing,
    newSystem: isNew,
    preserveArchitecture: existing && SIGNALS.preserve.test(folded),
    executionRequired: !adviceOnly && (coding || primary === "automation" || primary === "agent_task"),
    analysisRequired: adviceOnly || profile.family === "analysis" || SIGNALS.analysis.test(folded),
    researchRequired: profile.family === "analysis" || SIGNALS.research.test(folded),
    codingRequired: coding,
    deploymentRequired: deployPositive,
    visualGenerationRequired: profile.family === "visual",
    adviceOnly,
  };

  const { goal, clauses } = extractGoal(rawRequest);
  const hints = DOMAIN_HINTS.filter((hint) => hint.pattern.test(folded) || CHINESE_DOMAIN_SIGNALS[hint.domain.en]?.test(folded));
  const domain = hints[0]?.domain[language] ?? profile.label[language].toLocaleLowerCase(language);
  const stack = [...new Set([...folded.matchAll(STACK_PATTERN)].map((m) => m[1]!))];

  const conflicts: string[] = [];
  if (flags.preserveArchitecture && SIGNALS.rewrite.test(folded)) conflicts.push(LOCAL_TEXT.conflictRewrite[language]);
  if (adviceOnly && (deployPositive || SIGNALS.implement.test(folded.replace(SIGNALS.advice, "").replace(CHINESE_NEGATED_ACTION, "")))) {
    conflicts.push(phrase("conflictAdviceExecution", language));
  }

  const contextSummary = existing
    ? fill(LOCAL_TEXT.contextExisting[language], { domain })
    : isNew
      ? fill(LOCAL_TEXT.contextNew[language], { domain })
      : "";

  return {
    title: titleFromGoal(goal),
    primary_goal: goal,
    secondary_goals: [],
    task_type: primary,
    secondary_task_types: secondary,
    domain,
    operation: operationFor(flags, profile.family, profile.defaultOperation, primary),
    target_ai_mentioned: mentioned,
    expected_output: { format: profile.expectedFormat[language], description: "", deliverables: [] },
    existing_system: flags.existingSystem,
    new_system: flags.newSystem,
    preserve_architecture: flags.preserveArchitecture,
    execution_required: flags.executionRequired,
    analysis_required: flags.analysisRequired,
    research_required: flags.researchRequired,
    coding_required: flags.codingRequired,
    deployment_required: flags.deploymentRequired,
    deployment_permission: deployNegated ? "forbidden" : deployPositive ? "allowed" : "unspecified",
    visual_generation_required: flags.visualGenerationRequired,
    advice_only: adviceOnly,
    role: profile.role[language],
    context_summary: contextSummary,
    current_system: "",
    known_facts: stack.map((tech) => fill(LOCAL_TEXT.mentionedTech[language], { tech })),
    explicit_requirements: clauses.length > 1 ? clauses : [],
    implicit_requirements: [
      ...hints.flatMap((hint) => hint.implicitRequirements.map((t) => t[language])),
    ],
    constraints: adviceOnly ? [phrase("adviceOnly", language)] : [],
    protected_elements: [...PROTECTED_SIGNALS, ...CHINESE_PROTECTED_SIGNALS].filter((s) => s.pattern.test(folded)).map((s) => s.text[language]),
    allowed_operations: [],
    disallowed_operations: [
      ...(deployNegated ? [phrase("denyDeploy", language)] : []),
      ...(adviceOnly ? [phrase("denyDirectChanges", language)] : []),
      ...clauses.filter((clause) => CHINESE_PROHIBITION.test(clause)),
    ],
    required_actions: [],
    assumptions: existing && coding ? [phrase("assumeRepoAccess", language)] : [],
    unknowns: [
      ...hints.flatMap((hint) => hint.unknowns.map((t) => t[language])),
      ...(existing && coding && stack.length === 0 ? [phrase("unknownStack", language)] : []),
    ],
    conflicts,
    success_conditions: [],
    execution_plan: null,
  };
}
