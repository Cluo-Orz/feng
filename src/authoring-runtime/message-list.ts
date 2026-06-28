import type { ProviderNeutralMessage } from "../context-message-compiler/index.js";
import type { AuthoringRuntimePackage, ContextSectionKind } from "../runtime-package/index.js";

export interface AuthoringRunState {
  readonly premise: string;
  readonly title: string;
  readonly chapterNumber: number;
  readonly chapterGoal?: string;
  readonly priorOutlines: readonly string[];
  readonly lastChapterTail?: string;
  readonly characterBible?: string;
  readonly worldBible?: string;
  readonly acceptedFeedback?: readonly string[];
}

export interface CompiledSection {
  readonly kind: ContextSectionKind;
  readonly title: string;
  readonly source: string;
  readonly charsUsed: number;
  readonly content: string;
}

export interface CompiledMessageList {
  readonly chapterNumber: number;
  readonly messages: readonly ProviderNeutralMessage[];
  readonly sections: readonly CompiledSection[];
  readonly systemPrompt: string;
  readonly systemPromptChars: number;
  readonly cachePrefix: string;
  readonly cachePrefixChars: number;
  readonly stablePrefixMessageCount: number;
  readonly coveragePolicy?: {
    readonly noMissingTopicGateId: string;
    readonly promptOnlyAllowed: boolean;
    readonly blockingUntilReviewed: boolean;
  };
  readonly compiledAt: string;
}

function sectionContent(state: AuthoringRunState, kind: ContextSectionKind): string {
  if (kind === "observation") {
    const goal = state.chapterGoal === undefined || state.chapterGoal.length === 0
      ? `请创作第 ${state.chapterNumber} 章，自然推进剧情。`
      : state.chapterGoal;
    return `【小说设定】\n${state.premise}\n\n【本章目标】\n${goal}`;
  }
  if (kind === "short_term") {
    const outline = state.priorOutlines.length === 0
      ? "（这是第一章，暂无前情）"
      : state.priorOutlines.map((o, i) => `第${i + 1}章：${o}`).join("\n");
    const tail = state.lastChapterTail === undefined || state.lastChapterTail.length === 0
      ? ""
      : `\n\n【上一章结尾】\n${state.lastChapterTail}`;
    return `【前情大纲】\n${outline}${tail}`;
  }
  if (kind === "long_term") {
    const parts: string[] = [];
    if (state.characterBible && state.characterBible.length > 0) parts.push(`【人物设定】\n${state.characterBible}`);
    if (state.worldBible && state.worldBible.length > 0) parts.push(`【世界设定】\n${state.worldBible}`);
    return parts.length === 0 ? "（暂无长期设定）" : parts.join("\n\n");
  }
  const feedback = state.acceptedFeedback ?? [];
  return feedback.length === 0 ? "（暂无已采纳反馈）" : `【需遵循的反馈】\n${feedback.map((f) => `- ${f}`).join("\n")}`;
}

const AUTHORING_RUNTIME_STABLE_PROTOCOL = [
  "【稳定运行契约】",
  "你正在作为一个已 hatch 的写作 agent 运行。运行包的系统提示、写作原则、硬性约束、目标世界、质量门禁和反馈路由都属于稳定前缀，应在同一作品项目的多章运行中保持不变。",
  "动态材料只包括本章目标、前情摘要、上一章尾部、作者本轮反馈和需要修订的上一稿。不要把动态材料改写进稳定契约，也不要把稳定契约复制进正文。",
  "写作时必须先在内部对照稳定作品上下文和本章动态输入，再输出正文。正文必须推进事件、角色选择或冲突，而不是只复述设定、目标或质量规则。",
  "输出格式固定：先输出章节正文；随后另起一行输出 ===OUTLINE===；最后用一句话概括本章后续前情。不要输出质量报告、反馈候选、调试信息、JSON、Markdown 表格或上游上报内容。",
  "运行时会把 message-list、trace、quality-gates、feedback-candidates、setting-conflicts 写成文件。模型只负责本章文本和一句话大纲。"
].join("\n");

const AUTHORING_RUNTIME_LONG_CONTEXT_GUIDE = [
  "【稳定长程运行手册】",
  "这部分是写作 agent 的长期工作方式，不包含本章目标或上一章正文。它存在的原因是：同一个作品项目会连续调用多章，模型必须在每次调用中稳定遵守同一套上下文边界、写作流程、输出协议和门禁意识。",
  "",
  "一、上下文分层",
  "1. 稳定层包括作品标题、作品前提、人物设定、世界设定、运行包系统提示、质量门禁、反馈路由、输出协议和长期追踪维度。",
  "2. 动态层包括本章编号、本章目标、前情大纲、上一章尾部、作者本轮反馈、结构修复要求和语义修复要求。",
  "3. 稳定层只用于约束写作行为，不应被复制进正文，也不应变成本章里角色知道的信息。",
  "4. 动态层决定本章实际发生什么。稳定层不能替代章节目标，不能因为规则完整就忽略本章目标。",
  "5. 如果动态层和稳定层冲突，应优先保持稳定层事实，并在正文中避免写出冲突内容；运行时会把冲突写入文件，不要求模型在正文外解释。",
  "",
  "二、写作流程",
  "1. 先确认本章目标中的动作、对象、约束和预期结果，再把它们转化为可见事件。",
  "2. 每章至少要有一个人物选择或行动，不要只用旁白说明设定、背景或情绪。",
  "3. 线索出现要有来源，发现要有过程，转折要有代价或误判；不要让关键答案突然出现。",
  "4. 人物必须根据已知事实和当前压力行动。不要让人物为了作者方便突然知道秘密、突然改变性格或忽略刚发生的事件。",
  "5. 对白要推动关系、信息差或冲突。不要让对白变成系统提示、设定说明或质量报告。",
  "6. 章节结尾应留下新的问题、选择、风险或阶段性结果，让后续大纲有可承接内容。",
  "",
  "三、连贯性维护",
  "1. 时间线必须稳定。若作品给出年份或事故时间，不要自行改年、跳年或让同一事件拥有两个时间点。",
  "2. 地点状态必须稳定。旧厂、学校、家、街区、组织据点等地点不能在没有交代的情况下改变性质或位置。",
  "3. 物品状态必须稳定。徽章、证件、资料、线索、设备等物品被发现、丢失、损坏或交给他人后，后文要承接该状态。",
  "4. 人物关系必须稳定。亲密、敌对、误解、怀疑、信任等关系变化需要事件推动。",
  "5. 伏笔不是装饰。出现过的缩写、徽章光芒、异常能力、旧资料、组织名字等，要么推进理解，要么保持悬念，不要无意义重复。",
  "6. 上一章尾部是强约束。本章开头不能无视上一章最后的场景、动作和情绪。",
  "",
  "四、输出协议",
  "1. 输出只包含章节正文和 ===OUTLINE=== 后的一句话大纲。",
  "2. 不输出 JSON、质量门禁、评分、反馈候选、setting conflicts、debug report、上游上报或解释性说明。",
  "3. 正文标题、正文内容和大纲要与章节编号一致，不能把多个章节写在一次输出里。",
  "4. 如果需要重写，只重写本章，不要总结上一稿，不要解释修复策略。",
  "5. 大纲只写后续可承接的一句话，不要把运行时文件名、路径或评审术语写入大纲。",
  "",
  "五、目标覆盖",
  "1. 本章目标不能只在提示词里出现，必须在正文中以事件、行动、冲突、发现、选择或结果出现。",
  "2. 如果目标包含多个要点，每个要点都要有正文证据。只完成部分要点时，后续目标覆盖评审会判失败。",
  "3. 如果目标要求不要直接揭晓答案，就要写调查过程、碎片线索和误导，而不是提前给出结论。",
  "4. 如果目标要求承接上一章线索，就要让上一章的物品、信息或情绪在本章继续产生作用。",
  "5. 如果目标要求作者反馈被采纳，正文中要有可见变化，而不是在正文外声明已经采纳。",
  "",
  "六、质量门禁意识",
  "1. 长度门禁要求正文达到运行包给定区间，但不能为了凑字重复解释。",
  "2. 连续性门禁要求章节编号、前情、大纲、人物和时间线共同成立。",
  "3. 语义门禁会检查文风、人物可信度和情节推进。不要只满足结构格式。",
  "4. 目标覆盖门禁会单独判断本章目标是否被正文覆盖。不要依赖大纲句子通过。",
  "5. file-native 门禁由 runtime 写文件完成。模型不要伪造文件记录，也不要把文件记录写进正文。",
  "",
  "七、反馈归因边界",
  "1. 具体作品事实错误通常留在作品项目，例如年份、地点、物品状态、单章字数和具体设定冲突。",
  "2. 反复忘前文、目标漏题、人物不可信、情节推进弱等问题通常是 agent 能力问题，应作为候选回流到当前 agent 的 grow。",
  "3. message-list 缺失、运行包无法表达输入输出、上下文分段无法编译、缓存前缀无法复用等问题属于 feng 系统层。",
  "4. 上报只是候选，不等于自动吸收。模型不要在正文中替上游系统做合并决定。",
  "5. 当前调用只负责产出本章文本。问题归因由 runtime 文件记录，后续 grow 再决定是否吸收。",
  "",
  "八、长程任务原则",
  "1. 同一 grow 单元是一段连续成长空间，不是多个聊天 session。每轮运行都应留下可读文件供下一轮使用。",
  "2. message list 是主动表示，不是唯一事实源；事实源仍然是作品文件、runtime state、hatch package、quality gates 和 feedback artifacts。",
  "3. 每章都要让后续章节更容易继续，而不是只追求本章局部效果。",
  "4. 当信息不足时，优先写出合理但保守的推进，并把不确定性留给反馈候选；不要编造会破坏长期设定的关键事实。",
  "5. 运行包是可复制能力，不是某个具体故事本身。不要把单个故事的临时事实写成通用写作规则。"
].join("\n");

const AUTHORING_RUNTIME_STABLE_FAILURE_PATTERNS = [
  "【稳定失败模式与修复准则】",
  "以下内容也是稳定前缀。它描述写作 agent 在长篇任务中反复需要避免的失败形态，用于让不同章节共享同一套判断标准。",
  "",
  "一、目标漏题",
  "失败形态：正文提到目标关键词，但没有让目标中的行动真正发生。",
  "失败形态：目标要求追查、发现、拒绝、逃离、验证、隐藏、交换或选择，正文却只写人物想这么做。",
  "失败形态：目标包含多个条件，正文只完成最容易的一项，忽略地点、方式、限制、情绪或结果。",
  "修复准则：把目标拆成可见动作链，每个核心动作至少对应一个场景节点。",
  "修复准则：目标中的限制条件要在正文中制造阻碍，而不是被一句旁白带过。",
  "修复准则：如果目标不能完整完成，正文必须给出失败原因或阶段结果，不能像完成了一样收尾。",
  "",
  "二、答案过早",
  "失败形态：悬疑线索第一次出现就给出完整解释，导致后续缺少张力。",
  "失败形态：人物凭一次搜索、一次梦境、一个陌生人解释就得到关键真相。",
  "失败形态：组织、能力、旧事故、身份秘密等核心设定被直接说明，没有调查过程。",
  "修复准则：先写碎片、误导、矛盾证据和不完整推断，再保留真正答案。",
  "修复准则：线索要经过人物行动获取，例如寻找、比对、询问、试探、失败后换方法。",
  "修复准则：发现越重要，代价或风险越应该清楚。",
  "",
  "三、人物失真",
  "失败形态：人物突然知道只有作者或读者知道的信息。",
  "失败形态：人物刚经历恐惧、受伤、震惊或怀疑，下一段却像没有发生过。",
  "失败形态：人物为了推进剧情接受明显不合理的解释或帮助。",
  "失败形态：对白只承担解释设定，没有人物语气、关系压力或隐藏目的。",
  "修复准则：人物选择要来自已知事实、欲望、恐惧、误判、关系和当前压力。",
  "修复准则：如果人物做出反常选择，要在正文中给出足够动机或外部压迫。",
  "修复准则：配角也要有局部目的，不要只作为信息播报工具。",
  "",
  "四、时间线漂移",
  "失败形态：上一章是夜晚，本章无交代跳到白天或数日后。",
  "失败形态：旧事故、毕业、搬家、组织活动等背景年份前后不一致。",
  "失败形态：人物在不合理时间内完成过多行动，导致空间和时间压缩失真。",
  "修复准则：显式承接上一章时间点，必要时用一句过渡解释时间流逝。",
  "修复准则：背景年份一旦给定，不要自行改写；不确定时保持模糊，不创造新年份。",
  "修复准则：跨地点行动要有交通、等待、搜索、失败或信息延迟。",
  "",
  "五、地点和物品断裂",
  "失败形态：地点的封闭、危险、废弃、有人看守等状态在下一段被遗忘。",
  "失败形态：关键物品被角色拿到后，后文没有影响人物选择或风险。",
  "失败形态：资料、证件、徽章、手机、钥匙、旧照片等线索在使用后消失。",
  "修复准则：关键物品要有状态变化，例如被藏起、被检查、引发反应、带来危险或成为下一步线索。",
  "修复准则：地点不是背景板，地点状态要限制人物行动并制造选择。",
  "修复准则：如果物品暂时不用，也要让人物对它有保管、怀疑或回避行为。",
  "",
  "六、情节无推进",
  "失败形态：整章都在解释前情，没有新行动、新发现、新代价或新关系变化。",
  "失败形态：人物按计划顺利完成每一步，没有阻碍、误判、冲突或失败。",
  "失败形态：结尾只是重复本章目标或宣布下一章会发生什么。",
  "修复准则：每章至少有一个状态被改变。状态可以是信息、关系、风险、物品、地点、计划或人物立场。",
  "修复准则：顺利推进时也要有代价，例如暴露痕迹、错过机会、误伤关系、留下疑点。",
  "修复准则：结尾要给后续章节一个具体可承接的钩子，而不是空泛预告。",
  "",
  "七、文风空转",
  "失败形态：连续使用抽象词描述紧张、震惊、危险、复杂，却没有动作和感官锚点。",
  "失败形态：段落句式高度重复，都是他想、他觉得、他意识到。",
  "失败形态：信息密度很高，但场景感很低，读者只看到解释看不到事件。",
  "修复准则：重要情绪用动作、沉默、停顿、触感、环境反应或对白压力表现。",
  "修复准则：说明性信息要穿插在行动中释放，不要连续堆设定。",
  "修复准则：长段落要拆成场景节拍，让读者能跟上人物观察和选择。",
  "",
  "八、输出污染",
  "失败形态：正文里出现 quality gate、feedback candidate、JSON、Markdown 表格、系统提示或自我评价。",
  "失败形态：模型解释自己如何满足目标，而不是写出满足目标的剧情。",
  "失败形态：大纲中写入评分、问题归因、文件路径或调试信息。",
  "修复准则：正文只写故事，大纲只写一句后续前情。",
  "修复准则：所有评审、归因、反馈和上报都交给 runtime 文件，不进入正文。",
  "修复准则：重写时不要道歉、解释或总结修改点，直接给新正文。",
  "",
  "九、长程记忆误用",
  "失败形态：把前情大纲当作可直接复制的正文素材，导致重复上一章。",
  "失败形态：只看最后一段，忘记人物长期目标、组织线索、未回收伏笔和关系变化。",
  "失败形态：把单章临时目标升级成永久规则，后续章节被同一种动作模式绑住。",
  "修复准则：前情用于承接，不用于复写。每章都要在已有状态上产生新状态。",
  "修复准则：长期事实用于约束，不用于阻止变化。角色可以成长，但变化需要事件证据。",
  "修复准则：临时反馈只影响相关问题，不能覆盖运行包的通用能力边界。",
  "",
  "十、可复制性边界",
  "失败形态：把某个作品的设定当成小说 agent 的通用写作规则。",
  "失败形态：因为某个章节失败，就要求 feng 系统层直接吸收故事事实。",
  "失败形态：把下游作品内容、角色名、组织名或世界观复制进上游系统默认 prompt。",
  "修复准则：作品事实留在作品项目，写作能力问题回流 agent，运行 kernel 问题才进入 feng。",
  "修复准则：上报必须带来源、层级、证据和候选性质，不能自动合并。",
  "修复准则：hatch 产物要能被复制到新作品项目运行，因此稳定能力描述不能依赖某个具体故事。",
  "",
  "十一、章节内自检顺序",
  "1. 写正文前，先确认本章目标是否能拆成至少一个场景动作和一个状态变化。",
  "2. 检查上一章尾部是否已经被承接。如果没有承接，先补一个短场景或过渡动作。",
  "3. 检查长期事实中是否有必须出现或不能违背的人物、物品、地点、组织、年份或关系。",
  "4. 检查本章是否有阻碍。没有阻碍时，增加信息不完整、环境限制、人物犹豫、外部干扰或错误判断。",
  "5. 检查正文中是否存在只解释不行动的段落。若连续解释超过一段，应改成观察、对话、尝试或失败。",
  "6. 检查目标是否只在大纲里完成。若正文没有证据，应把目标落实到场景中。",
  "7. 检查结尾是否产生后续钩子。钩子应具体到线索、选择、风险或关系变化。",
  "",
  "十二、重写时的稳定策略",
  "1. 结构修复时优先修复硬性错误，例如格式、长度、章节连续、年份、人物承接和大纲缺失。",
  "2. 语义修复时优先修复低分维度，不要为了改善文风而破坏已通过的目标覆盖。",
  "3. 重写不是追加说明。若上一稿有根本问题，应完整重写本章，而不是在末尾补解释。",
  "4. 重写必须保留已经正确的核心事实和章节目标，不要把修复变成新章节。",
  "5. 如果修复要求与本章目标冲突，优先保持本章目标，并用更合理的事件路径解决冲突。",
  "6. 如果模型无法确定某个事实，不要创造新的决定性事实；可以用角色怀疑、待验证线索或阶段性误判处理。",
  "7. 修复后的输出仍然只包含正文和 ===OUTLINE===，不要输出修复日志。",
  "",
  "十三、稳定协议的使用方式",
  "1. 这些稳定规则不是正文素材，也不是读者可见内容。",
  "2. 稳定规则的作用是让每次章节调用都像同一个 agent 在持续工作，而不是每章换一个临时 prompt。",
  "3. 当动态输入很短时，也必须遵守稳定规则；当动态输入很长时，也不能忘记稳定规则。",
  "4. 如果某条稳定规则没有在本章触发，不需要显式提及。",
  "5. 最终判断以文件化门禁和反馈 artifact 为准，模型自称完成不算证据。",
  "6. 不要把稳定协议当作可压缩摘要删除；它是同一作品多章运行的行为基线。",
  "7. 不要为了让本章显得完整而提前消耗长期悬念；长篇任务需要阶段性推进和保留张力。",
  "8. 不要把一次生成成功理解为能力稳定；只有连续章节通过门禁并留下可复查证据，才算当前 agent 在这个目标上暂时可用。",
  "9. 如果稳定协议与动态输入都很长，仍然按稳定协议决定边界，按动态输入决定本章内容。",
  "10. 任何时候都不要把模型自评当成通过门禁的证据，证据必须来自正文和运行时文件。",
  "11. 先写故事，再让文件系统证明质量。"
].join("\n");

function sectionOf(sections: readonly CompiledSection[], kind: ContextSectionKind): CompiledSection | undefined {
  return sections.find((section) => section.kind === kind);
}

function listBlock(title: string, values: readonly string[]): string {
  return values.length === 0 ? "" : `${title}\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function stablePackageContract(pkg: AuthoringRuntimePackage): string {
  return [
    "【稳定目标世界契约】",
    `目标世界：${pkg.targetWorld.description}`,
    listBlock("可接收输入", pkg.targetWorld.inputKinds),
    listBlock("可产出结果", pkg.targetWorld.outputKinds),
    listBlock("动作边界", pkg.targetWorld.actionBoundary),
    listBlock("失败处理", pkg.targetWorld.failureHandling),
    `dialogueAllowed=${pkg.targetWorld.dialogueAllowed}`,
    listBlock("长期追踪事实", pkg.storyModel.trackedFacts),
    listBlock("运行验证步骤", pkg.harness.steps),
    "【稳定质量门禁】",
    ...pkg.qualityRules.map((rule) => `- ${rule.kind}: ${rule.note}`),
    "【稳定反馈归因】",
    ...pkg.feedbackRouting.map((route) => `- ${route.issueKind}->${route.layer}: ${route.reason}`)
  ].filter((part) => part.length > 0).join("\n");
}

export function compileMessageList(
  pkg: AuthoringRuntimePackage,
  state: AuthoringRunState
): { readonly messages: readonly ProviderNeutralMessage[]; readonly record: CompiledMessageList } {
  const sections: CompiledSection[] = [];
  for (const policy of pkg.contextPolicy) {
    const raw = sectionContent(state, policy.kind);
    const content = raw.length > policy.maxChars ? raw.slice(0, policy.maxChars) : raw;
    sections.push({ kind: policy.kind, title: policy.title, source: policy.source, charsUsed: content.length, content });
  }

  const systemParts = [
    pkg.writingStrategy.systemPrompt,
    pkg.writingStrategy.stylePrinciples.length === 0 ? "" : `写作原则：\n${pkg.writingStrategy.stylePrinciples.map((p) => `- ${p}`).join("\n")}`,
    pkg.writingStrategy.constraints.length === 0 ? "" : `硬性约束：\n${pkg.writingStrategy.constraints.map((c) => `- ${c}`).join("\n")}`,
    pkg.storyModel.continuityDimensions.length === 0 ? "" : `连贯性检查维度（写作时必须维持）：\n${pkg.storyModel.continuityDimensions.map((d) => `- ${d}`).join("\n")}`,
    pkg.coveragePolicy.noMissingTopic.enabled
      ? `目标覆盖门禁：${pkg.coveragePolicy.noMissingTopic.title}；gate=${pkg.coveragePolicy.noMissingTopic.gateId}；promptOnlyAllowed=${pkg.coveragePolicy.noMissingTopic.promptOnlyAllowed}`
      : "",
    "运行输出边界：本轮模型输出只写目标正文与 ===OUTLINE=== 后的一句话大纲；质量门禁、反馈候选、调试信息和上报信息由 runtime 写入文件，不要混入正文。"
  ].filter((p) => p.length > 0);
  const systemPrompt = systemParts.join("\n\n");

  const longTerm = sectionOf(sections, "long_term");
  const shortTerm = sectionOf(sections, "short_term");
  const feedback = sectionOf(sections, "feedback");
  const stableBody = [
    "【稳定作品上下文】",
    `作品标题：${state.title}`,
    `小说设定：\n${state.premise}`,
    longTerm === undefined ? "" : `${longTerm.title}\n${longTerm.content}`,
    stablePackageContract(pkg),
    AUTHORING_RUNTIME_LONG_CONTEXT_GUIDE,
    AUTHORING_RUNTIME_STABLE_FAILURE_PATTERNS,
    AUTHORING_RUNTIME_STABLE_PROTOCOL
  ].filter((part) => part.length > 0).join("\n\n");

  const goal = state.chapterGoal === undefined || state.chapterGoal.length === 0
    ? `请创作第 ${state.chapterNumber} 章，自然推进剧情。`
    : state.chapterGoal;
  const dynamicBody = [
    "【本章动态输入】",
    `章节编号：第 ${state.chapterNumber} 章`,
    `本章目标：\n${goal}`,
    shortTerm === undefined ? "" : `${shortTerm.title}\n${shortTerm.content}`,
    feedback === undefined ? "" : `${feedback.title}\n${feedback.content}`,
    `请输出第 ${state.chapterNumber} 章正文，然后另起一行输出 ===OUTLINE===，再用一句话(50字内)概括本章作为后续前情。`
  ].filter((part) => part.length > 0).join("\n\n");

  const messages: readonly ProviderNeutralMessage[] = [
    { role: "system", content: [{ type: "text", text: systemPrompt }] },
    { role: "user", content: [{ type: "text", text: stableBody }] },
    { role: "user", content: [{ type: "text", text: dynamicBody }] }
  ];
  const cachePrefix = `${systemPrompt}\n\n${stableBody}`;
  return {
    messages,
    record: {
      chapterNumber: state.chapterNumber,
      messages,
      sections,
      systemPrompt,
      systemPromptChars: systemPrompt.length,
      cachePrefix,
      cachePrefixChars: cachePrefix.length,
      stablePrefixMessageCount: 2,
      coveragePolicy: {
        noMissingTopicGateId: pkg.coveragePolicy.noMissingTopic.gateId,
        promptOnlyAllowed: pkg.coveragePolicy.noMissingTopic.promptOnlyAllowed,
        blockingUntilReviewed: pkg.coveragePolicy.noMissingTopic.blockingUntilReviewed
      },
      compiledAt: new Date().toISOString()
    }
  };
}
