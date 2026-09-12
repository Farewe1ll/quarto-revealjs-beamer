# Beamer for Quarto Reveal.js

一个高仿 LaTeX Beamer `Madrid` / `CambridgeUS` 的 Quarto Reveal.js 格式扩展。它保留 frame title、三段式 footline 与经典配色，同时改用扁平列表符号和适合网页演示的紧凑排版。

- `madrid`（默认）：蓝色主题。遵循上游 Madrid 的**无 headline** 布局——`beamerthemeMadrid.sty` 里 `\beamer@secheaderfalse` 是默认值，并据此把 headline 模板换成空模板；把 `beamer-secheader` 设为 `true` 即可恢复信息栏。
- `cambridgeus`：白底红字、红灰 headline 与三段式 footline。上游把 `titlelike` 的背景设为白色，本主题写作 `transparent`（在浅色页面上等价），所以标题块看起来没有底色。
- 页眉页脚在 DOM 解析完成后、Reveal.js 首帧之前注入，首帧就是完整的；只有依赖布局的光学对齐放在初始化之后。
- 内容超页会在控制台告警；长 frame title 自动缩小并增高标题带，超过基准高度 2.28 倍时整页转为可滚动。
- 公式用扩展内置的固定版本 KaTeX，断网可用；拉丁字符用内置的 Libertinus Sans，避免跨系统字体缺失导致的版式漂移。

## 安装

把 `_extensions/beamerslides` 复制到项目根目录的 `_extensions/` 下即可；扩展发布到 Git 仓库后，也可以在项目根目录执行 `quarto add <仓库地址>`。

格式名是 `beamerslides-revealjs`——刻意避开 Quarto 内置 LaTeX Beamer 的 `beamer`。

## 快速开始

仓库根目录的两个模板可直接修改，也都用来演示本主题的全部能力。两者逐页对应，便于对照两种外观。两个 front matter 都只写文档本身的信息——标题、作者、日期、`bibliography`、`lang` 与 `beamer-variant`，主题选项一律留默认值，因此打开模板看到的就是该变体的出厂样子（Madrid 默认无页眉，CambridgeUS 默认有页眉）；全部可选开关集中在文末「可选开关」一页，可整段复制。参考文献页两个模板都用默认的 `paginate` 模式，`refs-overflow: scroll` 列在那张表里：

```bash
quarto preview template.qmd                # Madrid
quarto preview template-cambridgeus.qmd    # CambridgeUS
```

最小可用的 front matter：

```yaml
---
title: "报告标题"
subtitle: "副标题"
author:
  - name: "姓名"
    email: "name@example.edu"
    orcid: "0000-0002-1825-0097"
    affiliations: "机构"
date: today
format: beamerslides-revealjs
beamer-variant: madrid
---
```

开发时用 `quarto preview`。直接打开旧的 `file://` 页面时浏览器可能复用缓存的 HTML 或主题 CSS；重渲染后关掉旧标签页再打开，或强刷一次即可。新生成的 HTML 引用的是带内容哈希的 CSS 文件名，分发与部署不会继承这类缓存。

## 文档选项

| 选项 | 默认值 | 说明 |
|:---|:---|:---|
| `beamer-variant` | `madrid` | `madrid` 或 `cambridgeus` |
| `beamer-secheader` | 按变体 | Madrid 关闭、CambridgeUS 开启；可用 `true` / `false` 覆盖 |
| `beamer-progress` | `false` | footline 顶部的细进度条；格式里的 `progress: true` 也会启用同一条线 |
| `short-title` / `short-author` / `short-institute` / `short-date` | 无 | footline 与页眉优先使用的短值；缺省时回退到 Quarto 生成的标题、作者、机构、日期 |
| `refs-title` | 第一页标题 | 参考文献续页的基础标题 |
| `refs-order` | `citation` | 设为 `declaration` 时按 `.bib` 声明顺序排列文献 |
| `refs-overflow` | `paginate` | 设为 `scroll` 时文献留在同一页内滚动 |

作者与机构在 footline 里合并为「作者（机构）」。非法的变体或布尔值会告警并回退到安全默认值；未知的 `refs-order` / `refs-overflow` 同样告警并回退。

**格式层预设的 Reveal.js 选项**（见 `_extensions/beamerslides/_extension.yml`）决定版面而非内容，因此没有做成元数据开关。在 front matter 里重新声明同名选项即可覆盖：

`width: 1280`、`height: 720`、`margin: 0`、`center: false`、`controls: false`、`menu: false`、`progress: false`、`slide-number: false`、`transition: none`、`background-transition: none`、`navigation-mode: linear`、`hash: true`、`history: false`、`minimal: true`、`preview-links: auto`、`code-overflow: wrap`、`highlight-style: github`、`date-format: long`，以及内置 KaTeX。

两点容易踩到的细节：

- **`slide-number`**：页码由三段式 footline 统一显示为「当前页 / 总页数」，Reveal 自带的浮动页码被 `display: none !important` 强制隐藏——写 `slide-number: true` 也不会让它出现。
- **`center`**：默认 `false`，但 Quarto 会给一级章节页加 `center` 类，主题据此居中章节页内容；band 与 minimal 两种外观另用 `justify-content: flex-start` 把色带钉在页眉下方（原因见下文）。给任意一页加 `{.center}` 可以单独把它改成居中。

标记 `visibility="uncounted"` 的页面不显示页码，也不计入总页数或进度。开启 Reveal 菜单时，按钮会自动避开 headline、frame title、logo 与 footline。

## 页面层级与章节页

一级标题生成章节页，二级标题生成普通 frame：

```markdown
# 第一部分

## 第一张内容页 {data-subsection="方法"}

正文内容。
```

`data-subsection` 可选；启用 headline 时若不提供，副导航显示当前 frame title。对称的 `data-section` 覆盖 headline 左半部分显示的章节名（默认取最近一个一级标题的文本）。

### 三种章节页外观

用属性**逐页**选择：

```markdown
# 默认                          通栏色带，紧贴页眉下方
# 居中徽标 {.section-badge}      居中圆角块 + 阴影，左右内缩 12%，字号 1.62em
# 纯文字 {.section-minimal}      只有文字、无底色，居中，字号 1.4em
```

- **默认是通栏色带**，与 frame title 同构：文字左边缘与 frame title、正文严格对齐（都在 `x=58`）。这是 Beamer 的行为——`\section` 页复用 frametitle 模板。色带**在文档流中**，高度由标题自身撑开，因此标题折行到几行，正文都从色带下方开始。
- **`.section-badge`** 是装饰性选择：居中、圆角、带阴影，**标题与正文作为一个整体居中**，正文宽度与徽标对齐。它是三种外观里唯一有填充的——CambridgeUS 的章节底色本身透明，badge 若也透明，阴影就会画在一个看不见的方块上、只剩文字下方一条多余的横线；该变体因此改用 `--beamer-primary`（酒红）填充，可用 `--beamer-section-badge-bg` / `--beamer-section-badge-fg` 覆盖。
- **`.section-minimal`** 用于弱化章节页，或在底色与背景冲突时使用。它没有底色，所以标题用变体强调色（`--beamer-section-minimal-fg`）而不是色带的白字——那在浅色页面上就是白底白字。它没有色带要填，所以不保留色带的高度：标题上下各留 `--beamer-section-minimal-gap`（默认 18px）的空白，正文紧跟其后。

三种外观的**正文一律使用正文字色**（`--beamer-ink`），与普通 frame 一致。

外观差异全部由 `beamer.scss` 里的 `--beamer-section-*` 变量表达，`beamer.js` 只负责给 `<section>` 打上 `beamer-section-slide` 类：几何是声明式的，不需要任何人告诉样式表标题有多高。

> **属性只决定章节页长什么样，不能决定它是否存在。** Reveal.js 按 `slide-level` 在渲染前就把 `#` 切成了独立 `<section>`，扩展运行时页面已经存在。

## Beamer 组件

```markdown
::: {.block title="定义"}
普通内容。
:::

::: {.exampleblock title="示例"}
成功或示例内容。
:::

::: {.alertblock title="注意"}
需要强调的内容。
:::
```

三个类各有别名，效果相同：`.beamer-block`、`.example-block`、`.alert-block`；裸的 `.block` 也接受。

block 标题渲染为**真实文本节点**（不是 CSS 伪元素），因此可以 Ctrl+F 搜索、选中复制，也能被读屏软件读取。标题保持字面文本（不解析 markdown，避免 `a_b_c` 被误当作强调）。手写 HTML 时仍可用 `data-title`，由 CSS 伪元素兜底。

两种变体的 block 外观不同，这同样是 Beamer 的行为：

- **Madrid** 加载 `orchid` colortheme，其中 `block title` 带底色（`bg=structure.fg!75!black`），所以三种 block 都有实色标题条，正文是标题色的 10% 淡染（`bg!10!bg`）：普通块深蓝 `#262686`、示例块深绿 `#006000`、警示块深红 `#bf0000`。
- **CambridgeUS** 只加载 `beaver`，**不加载 `orchid`**，而 `beamercolorthemedefault` 里 `block title` 只有 `parent=structure`、没有背景色，于是三种 block 都**没有填充**，只有圆角与阴影，靠标题文字颜色区分。

CambridgeUS 的三种 block 按**语义层级**取色（这是有意偏离上游蓝/绿/褐红的一处）：

| block | 外观 | 来源 | 对页面背景的对比度 |
|:---|:---|:---|:---|
| 普通 | 红字 `#cc0000`，无填充 | `structure`，与列表符号同色 | 5.79:1 |
| 示例 | 绿字 `#008000`，无填充 | `example text`，Beamer 钉死为 `green!50!black` | 5.05:1 |
| 警示 | 黄字 `#ffcd00` + 3px 黑描边，无填充，字重 700 | 见下 | 描边 20.7:1 |

警示块额外用 700 字重（其余 650）。**黄色为什么必须加黑边**：单靠 `#ffcd00` 对浅色页面只有 1.48:1，远低于正文所需的 4.5:1，会发白难辨；加 3px 黑边后每个字形获得一圈深色轮廓，字身仍是黄色。实现用 `-webkit-text-stroke` 配合 `paint-order: stroke fill`——后者把描边画在**字身之后**，否则描边居中于字形轮廓、会把黄色吃掉。宽度是在真实演示尺寸下扫掠 2/3/4/5px 并排比较后定的：2px 显得畏缩，5px 像一条黑杠且黄色被压薄，**3–4px 可用，取 3px**。可用 `--beamer-block-alert-title-stroke` 调整。

若想在 CambridgeUS 下也得到实色标题条：

```css
/* filled-blocks.css */
.reveal.beamer-cambridgeus {
  --beamer-block-title-bg: #a30000;
  --beamer-block-title-fg: #f2f2f2;
  --beamer-block-example-title-bg: #006000;
  --beamer-block-example-title-fg: #ffffff;
  --beamer-block-alert-title-bg: #bf0000;
  --beamer-block-alert-title-fg: #ffffff;
}
.reveal.beamer-cambridgeus .beamer-block {
  background: color-mix(in srgb, var(--beamer-block-title-band) 10%, #fff);
}
```

```yaml
format:
  beamerslides-revealjs:
    css: filled-blocks.css
```

### 行内辅助类

- `[重要]{.alert}`：警示色文字，取 `--beamer-alert`（Madrid 红、CambridgeUS 酒红）。
- `[文字]{.fg style="--col: #2c7550"}`：自定义前景色。
- `[文字]{.bg style="--col: #f5dfe1"}`：自定义背景色。
- `[[跳转]{.button}](#目标)`：Beamer 风格按钮。

## 内容格式

**表格**采用与 `quarto-revealjs-clean` 相近的轻量规则：表头不用实色填充，只保留主题色文字、表头分隔线与表格底线；caption 居中。

```markdown
| 变量 | 含义 |
|:---|:---|
| x | 解释变量 |

: 变量说明
```

**代码块**支持 Quarto 原生的文件名、语法高亮、行号与复制按钮：

````markdown
```{.r filename="analysis.R"}
quarto::quarto_render("slides.qmd")
```
````

**行内代码**有两个独立的量：字号和色块的位置。

字号由 `$code-inline-font-size` 决定（默认 `0.8125em`），主题在 `.reveal code:not(pre code)` 里直接声明它——因为 Quarto 各版本并不一致：1.10 把 `.reveal code` 的字号设为 `$revealjs-code-inline-font-size`，而它是从 `$code-font-size * 0.875` 推导出来的，所以只要改这个变量、别动共享的 `$code-font-size`；1.4 与 1.5 则完全不设字号，行内代码和正文一样大。等宽字体栈的 x-height 比 Libertinus Sans 大约 8%，所以 1.10 默认的 `0.875em` 会让同一行里的代码看着比正文更大（1.4/1.5 的 `1em` 更明显）；`0.8125em` 让 x-height 与正文齐平，大写字母约小一成，基线不动。

色块的上下留白**不对称**（`padding: 0.21em 0.25em 0`），这是有意的：行内元素的盒子挂在基线上，高度由**等宽字体自己的** ascent/descent 决定，而这两个值相对眼睛看到的文字是不对称的（本机字体栈为基线上 22.98px、基线下 7.98px，正文大写高度 20px）。上下留白相等时盒子上沿只比正文大写线高 5.1px、下沿却落到基线下 9.4px，读起来就是「方框下坠」。留白全部放在上方后，眼睛真正比较的两个间距——盒子上方到正文大写线、盒子下方到基线——在本机字体栈上实测 8.9px 对 8.2px（改前是 5.1px 对 9.4px）。平衡点随字体变化（Linux 上回退的 DejaVu Sans Mono 约 0.13em、Liberation Mono 约 0.29em），所以样式里的取值是三者的折中，测试断言同时接受这三者、但拒绝旧的对称留白。

**图片**沿用 Quarto 原生 figure 语法，主题约束最大尺寸并统一居中图注：

```markdown
![图注](assets/figure.svg){#fig-example width="90%"}
```

**引用**无需主题专用语法：

```yaml
bibliography: references.bib
link-citations: true
```

```markdown
正文引用 [@key]。

## 参考文献

::: {#refs}
:::
```

**公式**默认行内放大 `2%`、行间放大 `6%`。内置 KaTeX 及其字体不依赖 CDN，断网可用，但**不是单文件自包含的**：Quarto 把 `html-math-method.url` 编译成一段运行时脚本，由它按相对路径 `_extensions/beamerslides/katex/…` 动态插入 `<link>` 与 `<script>`，因此 `embed-resources: true` 看不到、也不会内联它们。实测：把 HTML 与 `_extensions/beamerslides/` 一起搬走可正常渲染（KaTeX 返回 200）；只搬 HTML 则两个文件都 404，而渲染器的 `throwOnError: false` 会让它**静默降级**成原始 `$…$`。所以要让 `_extensions/beamerslides/` 与 HTML 同行，或自己把 KaTeX 的 CSS/JS 内联进去。若文档依赖 KaTeX 不支持的 MathJax 专用语法，可以覆盖回去（此时是否离线取决于你的 Quarto 配置）：

```yaml
format:
  beamerslides-revealjs:
    html-math-method: mathjax
```

**标题页**会显示可点击的邮箱地址；ORCID 使用内嵌矢量 iD 图标，以作者名右上方的小角标呈现，避免位图缩放模糊。多位作者继续使用同一组 `name`、`email`、`orcid`、`affiliations` 字段。

## 参考文献分页与排序

文献表没有上界，所以参考文献页是最容易溢出的一页。默认**自动分页**，也可以一键改成**整页滚动**：

```yaml
refs-overflow: scroll   # 默认 paginate；scroll = 文献留在 Quarto 生成的那一页里滚动
```

按 `item` 属性声明每页条数：

```markdown
## 参考文献 {item="6"}

::: {#refs}
:::

## 参考文献（续） {item="6"}
```

- **`item` 是每页条数的上限，不是保证值。** 断页还受**实测高度**约束（一条长文献可能占两倍高度），装不下时这一页会被切得更短，**多出来的条目自动排到后续页**（不够就生成续页）。反过来条目短也不会超过 `item` 硬塞——想一页放更多就把 `item` 调大。续页会复制声明页的版式与标题。
- 续页必须**紧跟**在带 `::: {#refs}` 的那一页后面，中间不能插入别的 frame：扩展只把**相邻**的 `item` 页当作续页，这样文档别处一个无关的 `## 某页 {item="3"}` 不会被误当成文献页而吸走条目。
- **所有参考文献页都标记为 `uncounted`**，页脚总页数**不会因为文献分成几页而变化**。
- **默认模式下**断页是**量出来**的，所以参考文献页不需要滚动就能看全（Quarto 给文献页带的 `.scrollable` 只是保底）。唯一的例外是**单条文献自己就比整页高**：它独占一页，那一页仍可滚动（兜底规则是「一页至少要放下一条」，否则分页无法推进）。除此之外，任何一页要滚动才能看完都是扩展的 bug。
- 声明页数与实际需要不符时会在控制台告警：**不够**时报出加了几页以及**第一条被移走的条目**（方便你把断点往前挪）；**多声明**时报出哪一页是空的。空页**不会**被自动删除（删掉可能连带删掉你在那页写的内容），只提示你处理。
- `refs-title` 设置续页的基础标题，不写就取第一页的 `##` 标题；某一页自己写的 `##` 标题始终优先。
- `refs-order: declaration` 按 `.bib` 的**声明顺序**排列文献（多个文件按列出顺序拼接）；默认 `citation` 保持 citeproc 的排序，**既有文档不受影响**。citeproc 排完序后 HTML 里没有任何字段记录原始位置，所以扩展直接读 `.bib` 抽 key——这是一次**保守的模式匹配**，读不出或数量对不上时会**告警并退回 citeproc 序**，不会猜。
- `--beamer-refs-font-size`（默认 `0.9em`）是文献表唯一的字号开关；调小它会装下更多条目，自动断页会跟着适应。
- `refs-overflow: scroll` 完全不分组：所有条目留在 `::: {#refs}` 那一页，装不下就**页内滚动**，页眉、frame title、页脚仍固定不动。它同样标记 `uncounted`，所以两种模式**不会改变页脚的总页数**。它是 `item` 的对立面，同时声明 `item` 时会告警并**忽略**分页断点。

## 配色与变量

整套外观由 CSS 自定义属性驱动，默认值写在 `_extensions/beamerslides/_palette.scss`，并且**按 Beamer 的混色代数取值**（`structure`、`structure!75!black`……），而不是按观感挑选。

### 两个不同的角色：`structure` 与 `primary`

- `--beamer-structure` 是 Beamer 的 `structure`：列表符号、无填充 block 的标题文字、`h3`–`h6` 都取自它。Madrid 下等于 `beamer@blendedblue` = `rgb(0.2,0.2,0.7)`，量化为 `#3333b2`。
- `--beamer-primary` 是当前变体的强调色：Madrid 下与 `structure` 相同；CambridgeUS 下是 beaver 的 `darkred` `#cc0000`，用于 frame title 文字、标题页色块等。它**只影响正文强调色**，其余部件各有独立变量。

`--beamer-alert` 与 `--beamer-example` 是**基础色**：三种 block 的标题底色由它们按 `!75!black` 派生，block 正文底色再由标题底色按 `!10!bg` 派生，因此覆盖基础色即可联动整套 block 配色。注意 xcolor 的 `green` 是 `rgb(0,1,0)`，所以 `green!50!black` 是 `#008000` 而不是 `#004000`。

### ⚠️ 一处有意偏离 Beamer

**CambridgeUS 的 `structure` 是红色，不是蓝色。** beaver 从不重定义 `structure`，所以上游 CambridgeUS 的列表符号与 block 标题是蓝色 `#3333b2`——那是主题的原样，但在红灰主调里蓝色像个外来色。本扩展把 `structure` 指向该变体自己的 `darkred`，并用与 whale/orchid 相同的代数派生暗阶：

```text
structure          = darkred          = #cc0000
structure!75!black = darkred!75!black = #990000
structure!50!black = darkred!50!black = #660000
```

受影响的只有列表符号与无填充 block 的标题文字。恢复上游蓝色只需一行：

```css
.reveal.beamer-cambridgeus {
  --beamer-structure: #3333b2;
  --beamer-structure-2: #262686;
  --beamer-structure-3: #1a1a59;
}
```

`example text` 在 Beamer 里被 `beamercolorthemedefault` 钉死为 `green!50!black`，**与 `structure` 无关**（beaver/orchid 都不重定义），所以两个变体取值相同。

### 变量参考

下表按用途分组覆盖 `_palette.scss` 里的全部 48 个变量；`-fg` 是同一行的前景变量，`/ -2`、`/ -3` 是它的两个暗阶，`--beamer-block-alert-title-stroke` 一行的三项分别对应宽度、颜色与字重。CambridgeUS 覆盖其中 41 个，未标注“同左”或另列的取值与 Madrid 相同。`--beamer-active-headline-height` 由 `beamer-no-headline` 在关闭页眉时折叠为 `0px`。

| 用途 | 变量 | Madrid | CambridgeUS |
|:---|:---|:---|:---|
| 结构色 | `--beamer-structure` / `-2` / `-3` | `#3333b2` / `#262686` / `#1a1a59` | `#cc0000` / `#990000` / `#660000` |
| 强调色 | `--beamer-primary` / `-2` / `-3` | `#3333b2` / `#262686` / `#1a1a59` | `#cc0000` / `#8f0000` / `#7a0000` |
| 正文 | `--beamer-ink`、`--beamer-muted` | `#202124`、`#5f6670` | 同左 |
| 底色 / 分隔线 | `--beamer-soft`、`--beamer-line` | `#eaeaf4`、`#b8b8d8` | `#f8f2f2`、`#d7b9bc` |
| 基础色 | `--beamer-alert`、`--beamer-example` | `#ff0000`、`#008000` | `#cc0000`、`#008000` |
| frame title | `--beamer-frame-bg`、`--beamer-frame-fg` | `#3333b2`、`#ffffff` | `#f2f2f2`、`#cc0000` |
| 标题页色块 | `--beamer-title-bg`、`-fg`、`--beamer-title-subtitle-fg` | `#3333b2`、`#ffffff`、`rgba(255,255,255,.9)` | `transparent`、`#cc0000`、`#7a0000` |
| 章节页色带 | `--beamer-section-title-bg`、`-fg`、`--beamer-section-minimal-fg` | `#3333b2`、`#ffffff`、`--beamer-structure` | `transparent`、`#cc0000`、`--beamer-structure` |
| 章节页徽标 | `--beamer-section-badge-bg`、`-fg` | 同色带 | `--beamer-primary`、`#ffffff` |
| 页眉左 / 右 | `--beamer-headline-section-bg`/`-fg`、`--beamer-headline-subsection-bg`/`-fg` | `#1a1a59`/`#fff`、`#3333b2`/`#fff` | `#a30000`/`#f2f2f2`、`#d9d9d9`/`#7a0000` |
| 页脚三格 | `--beamer-footline-author-bg`/`-fg`、`-title-bg`/`-fg`、`-date-bg`/`-fg` | `#1a1a59`、`#262686`、`#3333b2`（均白字） | `#a30000`/`#f2f2f2`、`#ececec`/`#8f0000`、`#d9d9d9`/`#7a0000` |
| 进度线 | `--beamer-progress` | `rgba(255,255,255,.8)` | `#cc0000` |
| block 标题 | `--beamer-block-title-bg`/`-fg`、`-example-title-bg`/`-fg`、`-alert-title-bg`/`-fg` | `#262686`/`#fff`、`#006000`/`#fff`、`#bf0000`/`#fff` | `transparent`/`--beamer-structure`、`transparent`/`--beamer-example`、`transparent`/`#ffcd00` |
| 警示标题描边 | `--beamer-block-alert-title-weight`、`-stroke`、`-stroke-color` | `650`、`0`、未设 | `700`、`3px`、`#000000` |
| 几何 | `--beamer-headline-height`、`--beamer-frame-height`、`--beamer-footline-height`、`--beamer-logo-reserve` | `32px`、`58px`、`30px`、`225px` | 同左 |
| 文献表 | `--beamer-refs-font-size` | `0.9em` | 同左 |

### 覆盖方式

两个变体的调色板都按 `:root` 级选择器声明（CambridgeUS 用 `:where(:root).beamer-cambridgeus` 保持同等特异性），所以写在 `.reveal`、`.reveal.beamer-*` 或直接写在 `:root` 上都能生效——文档级 `:root` 覆盖对两种变体都有效。

最省事的做法是复制 `examples/custom-palette.css`，只改一个种子色，其余由 `color-mix()` 按 Beamer 的关系派生：

```yaml
format:
  beamerslides-revealjs:
    css: examples/custom-palette.css
```

若想接管 `theme` 列表，**必须写成扩展主题的路径**：

```yaml
format:
  beamerslides-revealjs:
    theme: [default, _extensions/beamerslides/beamer.scss, examples/custom-palette.css]
```

直接写裸名 `beamer.scss` 会失败——Quarto 把它当作内置主题去 `formats/revealjs/themes/` 查找，报 `readfile '…/themes/beamer.scss.scss'`。`custom-palette.css` 以 `/*-- scss:rules --*/` 开头：`theme:` 里的样式文件需要 SCSS 层标记，这一行对 `css:` 路径无害。三条路径（`css:`、`theme:`、随仓库提供的示例文件）与两种变体都有回归测试覆盖（`palette-css` / `palette-theme` / `palette-example` / `palette-cambridgeus` fixture）。

`color-mix()` 的派生结果与 xcolor 字面量最多相差 **2/255**（xcolor 的 sp 量化取整，加上 Chrome ≥ 118 在 oklab 而非 srgb 里插值 `color-mix()`），回归测试按这个容差断言；需要逐通道完全一致时请直接覆盖字面量。

### 标题层级用哪个变量

`h1`–`h6` 的颜色分属四套规则，没有统一开关：

| 层级 | 颜色来源 |
|:---|:---|
| `h1`（章节页标题） | `--beamer-section-title-fg`；badge 用 `--beamer-section-badge-fg`，minimal 用 `--beamer-section-minimal-fg` |
| `h2`（frame title） | `--beamer-frame-fg` |
| `h3` / `h4` / `h5` / `h6` | `--beamer-structure` |

因此 `beamer.scss` 里的 `$presentation-heading-color`（默认 `#1b3761`）**只是一个遗留值**：Quarto 需要它生成 Reveal 的 `--r-heading-color`，但那个变量已不再决定任何可见颜色。**要改标题颜色请改上表的变量，不要改它。**

`h3`–`h6` 同时构成一条递减的字号阶梯：`0.91em` → `0.78em` → `0.68em` → `0.6em`（根字号 30px 时为 27.3 / 23.4 / 20.4 / 18.0 px）。回归测试断言这条阶梯严格递减，以及四级标题对页面背景的对比度都达到 WCAG AA（4.5:1）。

## 版面几何

所有标题类元素都以 `58px` 为文字内边距，与正文同宽：标题页色块宽 `1164px`（即正文宽度，对应 Beamer 标题页那个不带 `wd=` 的 `beamercolorbox` 铺满 `\textwidth`），frame title 与章节页色带是**通栏**（`1280px`）但文字同样从 `x=58` 起排——因此章节页标题、frame title、列表正文的左边缘严格对齐。frame title 与章节页色带都不带边框，headline 下方也不画分隔线（infolines 不画）。

页脚第三格按 infolines 的 `\hfill 日期 \hfill 页码` 排布：日期在整格内居中（不受页码挤压），页码贴右。

**标题文字的光学居中**由 `beamer.js` 在渲染后校正：`align-items: center` 居中的是行盒而不是字形墨迹，而中文标题没有降部、墨迹几乎全在基线上方，视觉上偏高（实测 58px 色带内约 5px）；英文因有降部则相反，偏低约 7px。两者偏移方向相反，只能逐个量出真实墨迹边界后微调——这是 CSS 单独做不到的。实现上把标题文字包一层 `span`，位移加在它身上，所以**色块本身不会跟着移动**。有序列表编号、`.bg` 与 `.button` 也会在字体加载、窗口缩放和切换幻灯片后按当前字体的可见字形重新校正基线，因此离线 HTML 与 HTTP 预览使用同一套对齐逻辑。

**内容超页**会在浏览器控制台输出一条包含 frame id 与实际溢出像素的告警（`.scrollable`、`.smaller` 或超长标题导致的滚动页除外），避免内容被静默裁切。给 frame 加 `.scrollable`（或 `.smaller`、由超长标题触发的 `beamer-long-frame-title`）后，**正文在 frame 内部滚动，而页眉、frame title 与页脚固定不动**：`beamer.js` 把正文搬进一个 `.beamer-scroll` 内层，它内缩到 frame 的 padding box，所以正文位置与不滚动时完全一致。Quarto 的文档级脚注页与参考文献页默认就带 `.smaller .scrollable`，同样适用。

**长 frame title** 会自动缩小（两档：超过基准 1.59 倍、2.03 倍时各降一档）并增高标题带，不会被固定高度裁切；高度超过基准的 2.28 倍时整页转为可滚动。

## 文件结构

```text
_extensions/beamerslides/
├── _extension.yml
├── _palette.scss
├── beamer-fonts.css
├── beamer.lua
├── beamer.js
├── beamer.scss
├── fonts/
├── katex/
└── THIRD_PARTY.md
.github/workflows/test.yml
assets/
└── normal-density.svg
examples/
└── custom-palette.css
package.json
references.bib
template.qmd
template-cambridgeus.qmd
tests/
├── baselines/          # 受版本控制的截图基线
├── fixtures/           # 渲染用 .qmd 与 .bib
├── lib/harness.mjs     # Chrome/CDP、渲染器、静态服务器、截图比对
└── run-tests.mjs
```

## 测试

需要 Quarto、Node.js 22+、Chrome/Chromium：

```bash
npm ci     # 安装锁定的测试依赖
npm test
```

测试渲染两个变体、显式选项与自包含离线示例，覆盖：

- 元数据、邮箱与 ORCID、页眉页脚、三段式 footline 的排布；
- 列表（无序/有序/嵌套/`start`/`value`/`reversed` 的语义）、长 frame title、章节页三种外观（最简外观另外断言标题上下的留白相等）；
- 本地 KaTeX 与内置字体、行内辅助类、行内代码的字号与行内位置、标题文字的光学对齐；
- 表格对比度、代码块、图片、引用；16:9 与 4:3 视口；Madrid / CambridgeUS 的 PDF 输出；
- 断言标题页色块铺满 textwidth、block 标题是真实文本、页眉页脚在 Reveal 就绪**之前**完成注入（逐帧检查没有「已就绪但缺页脚」的帧）、滚动层的构建与还原、参考文献分页与排序；
- 断言非法选项的告警与回退，以及超页内容会产出带 frame id 的控制台告警。

截图与 `tests/baselines/` 中受版本控制的基线比较（容差 1.5% 像素）；实际截图、差异图与 PDF 写入 `tests/_artifacts/`，该目录不进版本控制。行内代码方框相对正文的位置也来自像素：`chip-position` 这张截图会被扫描出正文的**大写线与基线**，再断言方框上下两侧的留白之差不超过 3px——用 canvas 推算基线在本页会差 1.4px，而这个差值会把它放大一倍，恰好足以放过要抓的那个下沉。`testPaletteAlgebra` 从**上游主题源码**推导期望色值再与浏览器实测比对——只靠截图做不到这一点，因为基线由本实现自身生成，发现不了自洽的错误。

### 环境变量

| 变量 | 默认 | 用途 |
|:---|:---|:---|
| `BEAMERSLIDES_PAGE_READY_TIMEOUT_MS` | `20000` | 页面就绪等待上限 |
| `BEAMERSLIDES_PAGE_READY_ATTEMPTS` | `3` | 「页面未就绪即重载」的次数 |
| `BEAMERSLIDES_CDP_TIMEOUT_MS` | `300000` | 单条 Chrome DevTools 命令的上限 |
| `BEAMERSLIDES_COMMAND_TIMEOUT_MS` | `300000` | 外部命令（如 `quarto render`）的上限 |
| `BEAMERSLIDES_CHROME_STARTUP_TIMEOUT_MS` | `45000` | 启动 Chrome 的上限 |
| `CHROME_BIN` | 自动探测 | 指定 Chrome/Chromium 可执行文件 |
| `SKIP_VISUAL_REGRESSION` | 未设 | 设为 `1` 时只写截图、不比对基线 |
| `UPDATE_VISUAL_BASELINES` | 未设 | 设为 `1` 时把当前截图写成新基线 |

CDP 与外部命令的上限都取 300 秒：危险是同一个，而走这条通道的 `Page.printToPDF` / `Page.captureScreenshot` 恰恰是整套里最慢的命令，又跑在同样拥挤的共享 CI runner 上。上限过宽只是让真正的挂死晚一点报出来；过窄会把「runner 慢」变成失败，后者更糟。没有它的话，一条永不到达回包的 `Runtime.evaluate` 会让套件**永久挂起**，并留下需要手工删除的陈旧锁。

### 重试与并发

测试对**实测统计出来的、与扩展代码无关的抖动**做了重试：

- `quarto render` 偶发 `SIGSEGV`（Quarto 的 Deno 运行时崩溃，同一输入下次即成功）；
- Reveal 偶尔不发布 `window.Reveal`（页面与字体都已就绪，就是没初始化）→ 页面重载；
- `Page.printToPDF` 偶发返回近乎空的文档（实测有一次只产出 1,148 字节，同一页面正常约 100 KB）。

渲染重试**包裹的是整个操作而不是命令参数**——`renderFixture` 在 `finally` 里删除临时输入，若只重试命令就会对着已删除的文件反复重试，把偶发崩溃变成必然失败（这个错误在本仓库真实发生过，已修）。重试只挽救「未完成／明显无效」的产物，真正的失败依然会失败；命令根本没启动起来（`ENOENT`/`EACCES`）时立即放弃，不会白等两次。`quarto render` 与 `Page.printToPDF` 的次数目前是代码里的固定值（各 3 次），只有页面重载次数可用上表的变量覆盖。

探针若读到**尚未生成**的元素会抛 `Cannot read properties of null`。这是竞态而非结论——页面稍后就绪、同一探针即通过——因此只对这类消息重试；真正「元素缺失」的探针仍会在自己的断言上失败。

**不要并发运行本套件。** 它会在仓库根目录写固定名字的临时文件、并共用同一个 `tests/_output`，两个进程会互相删输入、互相覆盖产物，表现为「某个探针读到 null」这类无关报错。套件启动时（在任何破坏性操作之前）会检查 `tests/.run-tests.lock`，若已有运行中的进程会直接报错并给出 pid。

只有确认视觉变化符合预期后，才应更新基线：

```bash
npm run test:update-visuals
```

## 致谢

内容组织方式参考了 [quarto-revealjs-clean](https://github.com/grantmcdermott/quarto-revealjs-clean)；默认行为与色彩角色依据 Beamer 官方的 [Madrid](https://github.com/josephwright/beamer/blob/main/base/themes/theme/beamerthemeMadrid.sty) 与 [CambridgeUS](https://github.com/josephwright/beamer/blob/main/base/themes/theme/beamerthemeCambridgeUS.sty) 主题源码，block 配色代数取自 [orchid](https://github.com/josephwright/beamer/blob/main/base/themes/color/beamercolorthemeorchid.sty) 与 [beaver](https://github.com/josephwright/beamer/blob/main/base/themes/color/beamercolorthemebeaver.sty)。

## License

MIT
