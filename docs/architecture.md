# 项目设计约定

本文是维护者的设计入口，集中记录跨文件的设计依据与约束。稳定约束保护公开行为和内容完整性；当前实现说明现有机制及其原因，不要求永久保留相同文件组织或调用形式；已知限制与待办记录未实现或未验证的目标，不能当作现有保证。

## 文档与配置的职责

| 位置 | 负责的内容 |
|:---|:---|
| 本文 | 设计目标、稳定约束、当前实现及依据、已知限制 |
| [AGENTS.md](../AGENTS.md) | 编码代理的工作入口、修改规则和验证命令 |
| [README.md](../README.md) | 安装、写作语法、选项、变量参考和使用限制 |
| [_extension.yml](../_extensions/beamerslides/_extension.yml) | Quarto 实际读取的格式预设和扩展版本 |
| [package.json](../package.json)、[package-lock.json](../package-lock.json) | 开发命令、Node 要求和锁定的测试依赖 |
| 代码旁的注释 | 局部实现中非显然的原因、边界条件，以及对应设计约定的链接 |
| [CHANGELOG.md](../CHANGELOG.md) | 面向使用者的版本变化 |

具体默认值以可执行配置或变量声明为准，使用者可调项集中在 README。本文解释这些值的角色和依赖关系，避免再维护一张完整的默认值表。发现实现与约定不一致时，应明确记录差距，并让修复、文档与验证保持一致。

## 目标与设计边界

交付物是 Quarto Reveal.js 格式扩展，格式名为 `beamerslides-revealjs`。主要目标是还原 Beamer Madrid 与 CambridgeUS 的标题页、frame title、信息栏、三段式 footline 和 block 风格，同时适配网页演示。

- Madrid 默认关闭 headline，CambridgeUS 默认开启；文档元数据可以覆盖。
- 列表允许扁平化；表格、代码、图片及内容间距可以借鉴 [quarto-revealjs-clean](https://github.com/grantmcdermott/quarto-revealjs-clean)。外观参考与代码依赖分别管理。
- 优先沿用 Quarto/Pandoc 原生写作语法；扩展专用语法限于主题组件和主题选项。
- 布局优先由 CSS 表达；只有字体墨迹、动态标题高度、文献断页等依赖实际几何的工作交给 JavaScript。
- 字体与数学资源随扩展分发。新增运行时资源时同时考虑离线、相对路径、版本和许可证。

以下是当前实现的有意偏离，后续视觉修改应明确说明影响并同步样例与基线：

| 设计 | 当前选择与依据 |
|:---|:---|
| CambridgeUS 结构色 | 取红色以统一红灰主调；上游保留默认蓝色结构色 |
| CambridgeUS 警示 block | 黄字、黑描边、较重字重；这是本项目的视觉选择 |
| CambridgeUS 行内警示色 | 使用未掺灰的 darkred；上游 beaver 使用 darkred 与 gray 的混色。它与黄色 block 标题分别定制 |
| 章节页 | 默认通栏标题区，另有 badge 与 minimal；这些是 Reveal.js 章节页的适配设计 |
| 字体与列表 | 本地 Libertinus Sans、系统 CJK 回退、扁平列表；目标是网页可读性和可重复渲染 |

上游 Beamer 的 `section page` 有独立模板，`\section` 本身也不必自动生成页面。通栏章节标题区与 frametitle 对齐，是本扩展的选择。上游依据见 [Madrid](https://github.com/josephwright/beamer/blob/main/base/themes/theme/beamerthemeMadrid.sty)、[CambridgeUS](https://github.com/josephwright/beamer/blob/main/base/themes/theme/beamerthemeCambridgeUS.sty)、[beaver 配色](https://github.com/josephwright/beamer/blob/main/base/themes/color/beamercolorthemebeaver.sty)、[默认内主题](https://github.com/josephwright/beamer/blob/main/base/themes/inner/beamerinnerthemedefault.sty)。新增上游还原结论时应记录具体来源；这些链接指向可变的上游分支。

## 实现职责

| 文件或目录 | 职责 | 修改边界 |
|:---|:---|:---|
| [_extension.yml](../_extensions/beamerslides/_extension.yml) | 格式预设、主题和 filter 入口 | 与文档内容元数据分开；维持现有格式名 |
| [beamer.lua](../_extensions/beamerslides/beamer.lua) | 验证元数据、输出浏览器元数据、注册资源、规范化 block | 在 AST 层处理结构；浏览器几何留给 JS |
| [_palette.scss](../_extensions/beamerslides/_palette.scss) | 两种变体的基础字面量 | 派生关系写在使用处，见下一节 |
| [beamer.scss](../_extensions/beamerslides/beamer.scss) | 布局、排版、组件、派生变量、打印规则 | 单纯样式变化优先在此实现 |
| [beamer.js](../_extensions/beamerslides/beamer.js) | DOM 装饰、光学对齐、滚动层、文献排序与分页、Reveal 集成 | 保持首帧、Reveal 模型及内容完整性约束；当前分阶段实现见 L1 |
| [fonts](../_extensions/beamerslides/fonts)、[katex](../_extensions/beamerslides/katex) | 固定版本的第三方运行时资源 | 更新来源、版本、完整性信息与许可证 |
| [template.qmd](../template.qmd)、[template-cambridgeus.qmd](../template-cambridgeus.qmd) | 两种变体逐页对应的功能总览 | 保持默认外观示例；可选开关与默认值分别展示 |
| [tests/fixtures](../tests/fixtures)、[tests/baselines](../tests/baselines) | 可重复输入与审阅过的截图 | 新增有区分力的场景；基线变更须有设计依据 |
| [tests/suites](../tests/suites)、[tests/reference-beamer](../tests/reference-beamer) | 新增场景的职责分组、固定上游视觉对照输入 | 仍用串行入口；原版对照编译不成为扩展或日常测试依赖 |
| [tests/run-tests.mjs](../tests/run-tests.mjs)、[tests/lib/harness.mjs](../tests/lib/harness.mjs) | 功能断言与测试基础设施 | 主题规则留在用例，浏览器/服务/资源清理留在 harness |

按职责拆分文件时保留现有分发入口和行为。新增构建步骤应同时解决产物更新、安装后路径、离线打开和 CI 验证，避免仅为文件拆分增加运行时依赖。

## 公共接口与内部状态

| 接口类别 | 维护约定 |
|:---|:---|
| 文档元数据 | `beamer-*`、`short-*`、`refs-*` 等已在 README 列出的选项；新增时同步 Lua 验证、默认值、浏览器映射和用例 |
| 页面属性 | `data-section`、`data-subsection`、`item`、`visibility="uncounted"`；保持原生属性与扩展解释的边界 |
| 写作类与定制 hook | block 类及别名、章节外观类、`.alert` / `.fg` / `.bg` / `.button`、`.beamer-orcid-icon`；以 README 中的用法为公共接口 |
| 配色与几何变量 | README 列出的可覆盖 CSS 属性；声明位置与依赖关系遵守 C1–C3 |
| 文献容器 | 作者声明的 `#refs` 和扩展生成的 `.beamer-refs` 都允许文档 CSS 定制；保持引用 id 唯一 |

`beamerChrome`、`beamerDecorated` 等初始化 dataset 标记属于内部状态，不代表工作已成功完成。已在 README 公开的 CSS 变量仍是定制接口，即使 JS 会写入它们；其输入、兜底和测量结果的区别见 C3。其他未文档化的测量属性不自动成为稳定接口。开放新 hook 时说明用途、所有权与验证。

`.beamer-orcid-icon` 是公开的定制 hook，即使主题自身没有按该类选择元素，也不能按“内部未使用”删除。无效的枚举元数据应有告警并回退到文档化默认值；新增选项沿用 Lua 验证与浏览器映射的分工。

## 配色与 CSS 变量约定

### C1：基础值与派生值分别声明

`_palette.scss` 只声明字面量。Madrid 在 `:root` 上声明，CambridgeUS 用 `:where(:root).beamer-cambridgeus` 保持相同特异性，以便文档级覆盖。

由其他变量计算的值在 `beamer.scss` 的使用处声明。CSS 自定义属性中的 `var()` 在声明所在元素上解析；若把派生值定义在根元素，之后在 `.reveal` 覆盖输入变量时，继承下来的派生结果可能仍是旧值。

| 输入角色 | 在使用处派生的结果 |
|:---|:---|
| `--beamer-headline-height` | `.reveal` 上的有效 headline 高度；关闭时归零 |
| 章节颜色、变体强调色 | badge 填充、minimal 标题色 |
| CambridgeUS 的结构色、示例色 | 普通和 example block 的标题文字色 |
| 当前 block 的标题底色 | Madrid block 的正文淡染 |

### C2：语义角色保持独立

`structure` 表达列表、h3–h6 和 minimal 章节标题等结构色，也供 CambridgeUS 普通 block 标题派生；`primary` 表达变体强调色，并作为 CambridgeUS badge 填充的兜底。两个角色取值相同时仍保留分别定制的能力。

Madrid 加载的 orchid 给 block 标题提供填充；CambridgeUS 使用 beaver，不加载 orchid，因此 block 默认无填充。Madrid 的标题底色是按上游混色关系计算后保存的字面量，正文底色再从当前标题底色实时派生。`--beamer-soft` 是独立主题表面，不是 block 正文底色。修改 `--beamer-alert` 或 `--beamer-example` 不等于修改 Madrid 对应 block 的标题底色。

CambridgeUS 的普通和 example 标题文字分别从 `structure` 和 `example` 派生，警示标题则使用独立的黄色、描边和字重。`--beamer-alert` 用于行内强调，不驱动该黄色标题。徽标默认需要可见填充，因此 CambridgeUS 在透明章节色带之外提供强调色兜底。

精确的默认色值与自定义种子色派生分别验证；浏览器混色与上游量化可能存在少量通道差异。容差由相关测试规定，更新时应解释依据。

### C3：覆盖位置与所有权明确

使用者可以按 README 通过 `css:` 或完整主题路径下的 `theme:` 覆盖公共变量。对关键基础变量，覆盖测试应同时覆盖根元素和 `.reveal` 层，并验证派生面。

直接覆盖派生变量时还需考虑声明位置：例如 CambridgeUS 的 block 标题文字色在 `.reveal.beamer-cambridgeus` 上声明，根元素上的同名变量会被该声明取代。派生变量的直接覆盖应写在该层或组件层，并检查特异性和加载顺序。

当前几何变量的所有权如下；具体数值仍由源码及 README 的变量参考维护：

| 变量 | 作者输入与静态兜底 | 当前运行时写入 |
|:---|:---|:---|
| `--beamer-frame-height` | 从主题所在元素读取基准高度，控制缩字号和滚动阈值的比例 | JS 在各 slide 上写入实测标题高度；避免将这个结果再次当成基准输入 |
| `--beamer-logo-top` | CSS 在 logo 使用处根据有效 headline 与 frame 高度计算兜底 | JS 在 `.reveal` 上写入当前页实测 chrome 下方的位置 |
| `--beamer-logo-reserve` | CSS 提供标题横向预留的兜底 | JS 在 `.reveal` 上按实测 logo 宽度细化预留 |

文档级静态声明与运行时内联写入有不同的级联位置；公开这些变量不意味着根元素上的直接赋值一定能锁定测量结果。持续覆盖需要针对实际写入元素考虑级联优先级。新增测量变量时说明写入者、读取者和重新测量时机，避免把输出反馈成输入。

## 浏览器生命周期

当前运行时为一个 IIFE，通过元数据和 `window.Reveal` 集成。关键逻辑在 `decorateChrome`、`injectChrome`、`finishDecorate` 和 `connect` 中。以下描述现有实现；重构可以改变组织形式，但要验证对应的稳定约束。

### L1：首帧完整，新增页面进入 Reveal 模型

**稳定约束：** Reveal 首帧显示时具备完整 chrome（headline、frametitle、footline）；新增文献页有自己的 chrome 并进入 Reveal 模型；排序先于断页，文献分页不改变可计数页面的总数。初始化失败应有可辨识的诊断。

**当前实现：** 第一阶段在幻灯片 DOM 已解析时执行。Lua 的 in-header bootstrap 先在根元素设置变体类；JS 在根元素和 `.reveal` 设置相应类，分别支持基础调色板和局部派生样式。`MutationObserver`、DOMContentLoaded 和有上限的轮询配合等待。现有调用顺序及其依赖为：

1. 解析变体、headline、progress 和参考文献模式，设置主题类。
2. 应用每页的布局类、基础标题预留空间及滚动层，让分页测量使用这些样式确定的内容区域。
3. 按需排序文献，显示待测量页和隐藏祖先并拟合真实标题，再分页；恢复显示状态，分页结果标记为 `uncounted`。
4. 重新读取 leaf slides，计算页数并注入每页 chrome。
5. 整理标题页、ORCID 和文字包装，进行首轮对齐。

第二阶段等待 Reveal 就绪。自动创建了文献页时通过 `Reveal.sync()` 注册，再集成 Reveal 配置、更新动态标题高度、定位原生 UI，并绑定字体加载、resize、slidechanged 和打印事件。第一阶段也有必要的几何测量，两阶段的区分依据是 Reveal 集成依赖。文献资源/几何更新后的重新分页见 R2。

### L2：重复事件与失败路径可控

- 完成后的装饰入口重复调用应避免追加重复 chrome 或文献页。
- 初始化当前采用失败后停止的策略：DOM 重排中途出错时记录错误并停止盲目重试。dataset 标记在工作开始前写入，单靠标记不足以证明初始化成功。
- 字体加载、缩放、切页会触发对齐和布局更新。高频请求按帧合并，写入几何前后避免循环测量。
- `beforeprint` 的必要对齐同步完成；打印检查使用打印布局的几何。
- 一旦引入重新初始化或插件销毁，应明确 timer、observer、事件监听器和生成节点的生命周期；当前实现针对每个文档的一次初始化。

## 布局与内容约束

### G1：固定 chrome 与正文滚动分开

页眉、frame title、章节标题区和 footline 保持在正文滚动层之外。允许滚动的正文放进 `.beamer-scroll`，其内缩从 slide 的内容区域取得；章节页额外计入文档流中的标题区及下外边距。滚动与普通模式的首行位置应一致。

取消滚动时把内容按顺序移回 slide。包装与还原保留作者节点、属性、标题和备注；保持标题直接位于 slide 下，footline 放在最后，避免遮住正文。

`.section-badge` 当前按标题与正文整体居中处理，`.scrollable` / `.smaller` 在此组合下不产生正文滚动；显式 `.scrollable` 有告警。长内容应使用 band 或 minimal。增加 badge 滚动能力属于布局设计变更。

### G2：对齐与溢出有明确语义

标题带、章节标题区和正文沿共同文字内边距对齐。默认标题页色块铺满正文宽度；footline 第三格中的日期居中，页码贴右。

光学校正作用于文字包装或 marker，保持色块与内容盒子的几何。区分行盒、字体盒和实际墨迹；像素实验中的局部数值留在代码或验证记录，本文只维护约束。

长 frame title 自动降字号并增高标题带；严重超长时使用正文滚动。普通页面溢出时报告 frame id 与像素量；显式滚动页和打印布局采用各自规则。打印与屏幕应保持内容区域的 padding 约定。

logo 与菜单位置依据当前页 chrome 和实测 logo 尺寸确定。章节标题区也属于固定 chrome；居中的 badge 不占据同一个顶部区域。运行时定位变量与静态兜底分别维护。

格式预设关闭 Quarto 的 `auto-stretch`。Reveal 的剩余高度计算与本扩展固定高度页框组合时，会将单张顶层图片的宽高写为零；图片改用作者尺寸与主题最大尺寸。分发测试同时检查普通安装和隔离 HTML 中的图片实际解码及可见尺寸。手动 `.r-stretch` 或重新开启自动拉伸不属于当前支持范围。

### G3：保留原生语义与可访问文本

正文中的 h3–h6 使用结构色，并保持字号逐级下降；选择器也覆盖 columns、block 和 callout 内的子标题。这是本扩展的网页排版选择。

有序列表尊重 `start`、`value`、`reversed`、`type` 和嵌套编号。任务列表、tabset 导航及脚注列表各有独立语义，样式规则应限定作用范围。

Lua 生成的 block 标题保持字面文本，输出真实文本节点以便搜索、复制和辅助技术读取。手写 `data-title` 的伪元素保留兼容作用。避免为常规 Markdown 内容新增一套替代语法。

字体回退、颜色对比度和真实文本节点分别验证。几何测试或描边对比度数值通过，仅证明对应断言，完整的辅助技术可用性仍需专项检查。

## 参考文献子系统

### R1：分页保持条目与作者内容完整

- `refs-order: citation` 保留 citeproc 产生的排序；选项名不意味着强制按引用出现顺序排序。
- declaration 排序发生在分页前；分页后每条真实文献只归属一页，保持 key、链接和内容。
- `item` 是每页条数上限，实际高度决定是否提前断页；单条超过一页时至少放入一条并允许滚动，以保证推进。
- 声明的续页只识别紧邻文献页、带 `item` 且无自己正文的页面；notes 不算正文。其他页面的同名属性不会自动成为续页声明。
- 续页保留作者的类和标题层级，生成页继承最后一页的布局；排除 Reveal 的 present/past/future 状态类。
- 文献页均为 `uncounted`，包括无引用条目的文献页；新增页进入 Reveal 模型并获得 chrome。多声明的空页保留并告警。
- `refs-overflow: scroll` 将全部条目留在原文献页，使用与普通正文相同的固定 chrome / 内层滚动机制，不产生分页；同时声明的 `item` 被忽略并告警。

**当前续页识别：** 检查 slide 自身的节点，并穿透已有的 `.beamer-scroll` 包装。除 h1/h2、生成的 chrome、文献容器与 `aside.notes` 外，任何元素都算作者内容；图片即使没有文字也会阻断续页识别。普通文档脚注的 aside 不属于 speaker notes，不应按空文本误判为续页。

### R2：测量使用真实内容区域

隐藏的 slide 及祖先 stack 可能没有几何。测量期间临时显示所需祖先，在结束或异常路径恢复原显示状态。文献容器和列表的层级保持一致；高度比较作用于实际正文滚动区域。

**稳定约束：** 分页测量与最终条目所在容器采用一致的布局和列表层级；有滚动层时，条目列表必须位于层内，否则对空层的高度检查会失去意义。

**当前实现：** 测量逐条加入 clone，通过浏览器的 `scrollHeight` / `clientHeight` 判断容纳能力，最后移动真实条目。每页布局类、实际标题高度及滚动层在填入测量条目前确定，包括生成页与隐藏祖先。测量期间不报告尚未断页的正文溢出；所有临时显示状态在 `finally` 恢复。

初始化保存已排序的真实条目、作者声明页及生成页。字体 ready/loadingdone/loadingerror、文献图片 load/error、resize、afterprint 和可见文献页的尺寸变化按尾沿合并后重新分页；打印布局等 Reveal 建立 PDF 包装层后更新，`pdf-ready` 与 `beforeprint` 同步校正。条目顺序、作者声明页与 notes 保留，多余生成页在移动真实条目后删除；新增页补齐 chrome 并加入尺寸观察，删除页解除观察。屏幕页集合变化时 `Reveal.sync()` 并保持当前页仍可导航；打印页集合变化时直接增减对应 `.pdf-page` 包装与背景，避免重新同步破坏已建立的打印布局。条目归属未变时恢复正文滚动位置，重复相同分页告警不重复输出。更新失败记录错误并停止后续重分页。

屏幕与 PDF 使用相同的逻辑幻灯片尺寸测量文献，不使用 PDF 包装层经 `pdfPageHeightOffset` 缩短后的高度决定断页；百分比尺寸以视口显式计算，避免打印文档总高度反馈成单页高度。临时尺寸及显示状态均在 `finally` 中恢复。打印更新须等所有文献页的包装层连接到文档；更新后每个分页文献页对应一张纸，校正 Reveal 可能按旧高度预留的多张纸，并保留 `margin` 对纸张尺寸的影响。每轮测量先清除上一轮的 `beamer-refs-fit` 标记，测量完成后重新设置。打印样式只对已确认可容纳的文献页释放内层 overflow，避免包装层的像素取整产生滚动裁切；超高单条及 `refs-overflow: scroll` 保持滚动兜底。标准打印导出应在字体与文献图片加载完成后进行。

延迟字体与图片、标题阈值两侧、h1/h2、4:3、重复事件和超高单条均有专项场景；任意作者脚本在不触发上述事件时修改文献，不属于自动重新分页保证。慢字体样例没有额外溢出，延迟图片样例在旧实现上产生 148px 溢出，更新后消除。首帧仍采用同步初始分页，不等待资源无限加载。

### R3：排序解析失败可诊断

**稳定约束：** 选择 `refs-order: declaration` 时，按文献文件的声明顺序建立排序；识别到读取或 key 匹配异常时，回退 citeproc 序并告警。排序不应把已分页条目重新集中到首个容器。非 BibTeX 文献源、复杂 header 和 key 解析边界应明确说明。

**当前实现：** HTML 不保留声明位置，Lua 使用 Pandoc 自带的 BibTeX/BibLaTeX 读取器取得各文件的 `references` 列表，再按文件顺序拼接 key；`.bib`、`.biblatex` 使用 `biblatex`，`.bibtex` 使用 `bibtex`。不再按行匹配 header，因此字段或 comment 中的伪 header 不构成声明，真实跨行 header 正常解析。不新增运行时依赖。

Lua 在不支持的文件类型、读取/解析失败或重复 key 时告警并不输出排序位置。JS 接受渲染条目为声明列表的子集，但拒绝重复声明/渲染 key 和没有声明位置的渲染 key；后者包括只在文档 `references` 元数据中定义的条目。排序仍发生在分页前，并限制在各现有容器中。停用重排不会跳过 Quarto/Pandoc 对文献源本身的校验。解析失败路径和浏览器排序路径分别测试，不能只依赖数量或成员检查证明解析正确。

## 分发与兼容性

扩展运行资源放在 `_extensions/beamerslides` 内，开发工具与测试依赖由根目录管理。新脚本或样式通过 Quarto 的扩展/依赖机制注册，并验证安装后相对路径。[THIRD_PARTY.md](../_extensions/beamerslides/THIRD_PARTY.md)记录随附资源的来源、版本与完整性信息。

离线资源目录与单文件交付分别验证。普通输出随 HTML 携带引用的扩展资源；单文件模式需同时检查 `embed-resources` 与 `self-contained-math`。已在 Quarto 1.10.19 下验证现有 [offline fixture](../tests/fixtures/offline.qmd) 单独搬到临时目录后仍能渲染公式；其他版本的行为由对应验证确定。

最低版本要求以 `_extension.yml` 为准，为 Quarto 1.4.557，与 [CI workflow](../.github/workflows/test.yml) 的最低测试版本一致。此前声明的 1.4.0 没有对应官方发布记录，本次收紧至可获取并验证的补丁版本，不表示所有更早版本均已被证明不兼容。Node 与 Chrome 是开发测试要求，扩展使用者无需安装 Node 来渲染文档。分发集成用例需要 Git 与 zip，用于打包已跟踪和未忽略的待交付文件。

## 验证与变更流程

常用命令由 `package.json` 定义，操作要求见 [AGENTS.md](../AGENTS.md)。当前外部命令和 CDP 等待均有上限，避免永久挂起；默认值和覆盖方式见 README 的环境变量参考，调整时应考虑截图/PDF 在共享 runner 上的耗时。套件通过逐项 teardown 单独报告清理错误。扩展 harness 或编写探针时同样应保持等待有界、诊断不覆盖原错误，以及一项清理失败不跳过其余资源释放。

**当前资源所有权：** `withBrowser` 在 `finally` 中关闭浏览器并删除它的 profile；它不关闭回调或外部启动的本地服务器。页面/CDP 会话由创建者关闭，服务器由启动者在 `finally` 中关闭。套件跨用例复用浏览器，因此有自己的逐项 teardown。Chrome 的进程组在普通关闭和信号路径中都处理，信号处理使用同步清理。

当前套件共享临时输入和输出目录，运行锁在重置输出前取得。未来并行化应先隔离这些资源。

**当前重试机制：** 命令错误保留退出状态、信号、启动错误码和超时标记。渲染仅对 SIGSEGV/SIGBUS/SIGABRT，或对应的常规崩溃退出码与原生崩溃诊断组合，最多尝试三次；普通校验失败、权限、缺失命令、超时与未分类错误直接失败。各次失败和重试原因写入忽略的 artifacts；多次失败以首次错误为 cause 保留完整错误列表，即使重试成功仍保留之前的证据。每次 fixture 渲染重建临时输入并在 `finally` 清理。

页面就绪检查 document、Reveal、实际 chrome、公式与字体；只有该条件超时才可有限重载，浏览器运行时错误直接失败。页面求值异常不再按消息模式重试，创建失败的 target 由创建者关闭。PDF 重试仍限于签名/最小体积检查，不能证明 PDF 的完整语义。语义断言自身不重试；`tests/lib/check-harness.mjs` 验证普通失败次数、超时、暂态失败、首次证据、重试耗尽及页面创建失败清理。

页面就绪重试也保留首次及后续失败状态，即使重载后恢复；重试耗尽、后续运行时错误和重载本身失败均保留首次错误为 cause。分发字体检查要求实际匹配且加载完成的 FontFace，不能仅使用对未声明字体也返回 true 的 `document.fonts.check()`。

| 约定或变更范围 | 当前主要测试（串行入口为 [run-tests.mjs](../tests/run-tests.mjs)，新增文献/分发场景在 [reference-updates.mjs](../tests/suites/reference-updates.mjs)） |
|:---|:---|
| C1–C3：默认配色、覆盖和派生关系 | `testPaletteAlgebra`、`testPaletteOverrides` |
| L1–L2：首帧与元数据集成 | `testInjectionTiming`、`testOptions`、`testInvalidOptions` |
| G1：滚动、章节外观和还原 | `testScrollLayers`、`testSectionStyles`、`testBadgeScrollIsInert` |
| G2：对齐、logo、菜单、打印 | `testMadrid`、`testCambridgeUs`、`testCjkChipAlignment`、`testLogoPlacement`、`testMenuClearsChrome`、`testPrintMatchesScreenPadding` |
| G2–G3：内容间距、列表和可访问标题 | `testSpacing`、`testDocumentFootnotes`、`testBlockTitles`、`testBehavior` |
| R1–R3：文献页 | `testReferencesPagination`、`testReferencesMultifile`、`testReferencesDeclarationOrder`、`testReferencesFinalGeometry`、`testReferencesDelayedResources`、[打印分页与资源更新](../tests/suites/reference-print.mjs)及其余 `testReferences*`；解析/读取失败另由 `tests/lib/check-bibliography.lua` 覆盖 |
| 离线、分发与视口 | `testOffline`、`testDistribution`、`testFourThreeViewport`；分发归档与仓库外安装由 `tests/lib/distribution.mjs` 管理 |

测试名定位现有覆盖，每个名称并不代表相关约定已被穷尽验证。修复缺陷时增加能在旧实现上失败的场景；跨变量派生、初始化顺序与文献分页修改应运行完整套件。

**测试证据：** 配色模型从上游混色关系独立推导期望值，截图基线来自本实现，两者不能相互替代。平台的 CJK 回退字体可能不同，现有行内代码检查因此比较同一截图或同一页面两种状态中的墨迹，不为这些探针保存固定基线。量化、混色和字形的具体容差及其局部依据留在测试旁。

视觉基线的更新操作见 AGENTS；产物含义和比较容差见 [baselines/README.md](../tests/baselines/README.md)。截图应与语义、几何和上游依据结合判断，不能单凭通过基线比较就证明上游还原度。

纯文档修改检查引用路径、代码/配置对应关系和 Markdown 格式；无需因此更新视觉基线。改动 qmd 结构、样式或运行时行为时，执行相应渲染与浏览器验证，并记录版本、检查范围和未覆盖部分。

## 已知限制与待办

| 状态 | 事项 | 修复或验证标准 |
|:---|:---|:---|
| 已修复并回归验证 | 引用子集曾因数量不等回退；逐行扫描曾静默产生错误声明顺序 | 已改用 Pandoc 读取器并验证子集、多文件、伪 header、跨行 header、重复与未匹配 key；见 R3 |
| 实现限制 | badge 与正文滚动组合不生效 | 保留现有告警；改变组合语义时同时验证 centering 和滚动 |
| 已修复并回归验证 | 长文献页标题与加载后的图片曾导致分页后正文溢出 | 初始分页拟合实际标题；资源/几何事件更新分页，保留条目、声明页与 Reveal 模型 |
| 已修复并回归验证 | 渲染重试过宽、按异常文本推断竞态 | 分类重试、明确就绪条件、保留各次证据；参见验证流程 |
| 已验证 | 最低版本声明收紧至 1.4.557，与 CI 一致 | 本机官方 1.4.557 的完整功能、打印与分发套件通过；固定视觉基线比较在当前版本执行 |
| 已补充并验证 | 仓库外安装、模板复制与隔离离线打开 | 1.4.557 和 1.10.19 分别验证 add/template，两种变体渲染；复制开发文件范围由 `.quartoignore` 限定 |
| 已建立有限对照 | 固定 Beamer v3.76 的同内容样张 | 两种主题各 5 页，与 HTML 逐页审查；[输入、环境与观察](../tests/reference-beamer/README.md)说明已接受偏离；不证明所有页面的像素一致 |

## 约定如何演进

| 注释内容 | 维护位置 |
|:---|:---|
| 长期跨文件设计规则与取舍 | 本文；原处删除重复正文，必要时留简短指引 |
| 修改、验证与资源使用的操作要求 | 根目录 AGENTS；原处保留局部执行原因 |
| 选择器特异性、测量公式、解析边界、回归场景及其容差 | 相应源码或测试旁，避免脱离实现上下文 |
| 模板的写作说明、示例配置及讲者 notes | 原模板或示例，保持复制后可理解 |
| Quarto SCSS 分区标记、许可证与第三方注释 | 原处保留，不作为普通说明删除 |

失效的实验描述删除；仍解释当前取舍的证据保留并改写为当前原因。面向使用者的行为变化归入 CHANGELOG，不要求把每段实现历史都搬进版本记录。

改变公共选项、CSS hook、默认外观或生命周期时，同步相关约定、README、模板和测试。涉及新的重大取舍时，补充简短记录：问题、最终决定、依据、影响范围、验证方式；记录可先放在本文，条目增多后再拆成独立设计决策文件。

已知缺陷被修复后更新其状态和测试映射。未来模块拆分与测试并行化按独立变更推进，保持每一步可验证。

本次复核后的实施顺序、变更边界与验收标准见[推进计划](implementation-plan.md)。计划中的候选方案经验证后才能成为设计约定。
