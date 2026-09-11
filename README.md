# Beamer for Quarto Reveal.js

一个高仿 LaTeX Beamer `Madrid` / `CambridgeUS` 的 Quarto Reveal.js 格式扩展。它保留 frame title、三段式 footline 和经典配色，同时使用扁平列表符号与适合网页演示的紧凑内容排版。

- `madrid`：默认蓝色主题，遵循 Madrid 的无 headline 布局（与原版 `secheader` 选项一致，可用 `beamer-secheader: true` 开启）。
- `cambridgeus`：白底红色标题、红灰 headline 与三段式 footline；标题块不带底色，标题与作者信息的间距比 Madrid 的实心标题盒更紧凑。
- 页眉页脚在 DOM 解析完成后立即注入（早于 Reveal.js 的首帧），首帧即呈现完整信息栏；仅依赖布局的光学对齐在初始化后进行。通过格式配置开启原生 `progress: true` 时，footline 顶部的进度线会在 Reveal.js 初始化完成后出现。
- 内容超出 frame 可用高度时，会在浏览器控制台输出一条包含 frame id 与实际溢出像素的告警（`.scrollable`、`.smaller` 或超长标题导致的滚动页除外），避免内容被静默裁切。
- 长 frame title 会自动缩小并增高，不会被固定高度裁切。
- 数学公式默认使用扩展内置的固定版本 KaTeX，断网打开也能完整渲染；根号等可伸缩符号采用矢量路径，规则线会随字号统一缩放。
- 拉丁字符使用扩展内置的 Libertinus Sans，避免不同系统因缺少字体而产生版式漂移；中文继续使用各平台原生 CJK 字体回退。
- 默认关闭 Reveal.js 菜单、控制按钮、进度条和画布外边距；菜单与控制按钮可通过格式配置开启，原生进度会自动转换为 footline 顶部的 Beamer 细进度线。

## 本地预览

```bash
quarto preview template.qmd
```

仓库根目录的 `template.qmd` 是可直接修改的完整示例；`template-cambridgeus.qmd` 是 CambridgeUS 变体的对应示例：

```bash
quarto preview template-cambridgeus.qmd
```

开发时建议使用 `quarto preview`。直接打开旧的 `file://` 页面时，浏览器可能继续复用旧 HTML 或主题 CSS 缓存；重新渲染后关闭旧标签页再打开，或执行一次强制刷新即可。新生成的 HTML 会引用带内容哈希的 CSS 文件，分发或部署时不会继承这类旧缓存。

## 安装

将 `_extensions/beamerslides` 目录复制到 Quarto 项目根目录的 `_extensions/` 下即可；扩展发布到 Git 仓库后，也可以在项目根目录使用 `quarto add <仓库地址>`。格式名使用 `beamerslides-revealjs`，这是为了避开 Quarto 内置 LaTeX Beamer 的 `beamer` 名称。

## 在文档中使用

扩展安装后，在 YAML 中选择格式：

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

主题选项：

| 选项 | 默认值 | 说明 |
|:---|:---|:---|
| `beamer-variant` | `madrid` | 可选 `madrid` 或 `cambridgeus` |
| `beamer-secheader` | 按变体决定 | Madrid 默认关闭，CambridgeUS 默认开启；设置 `true` / `false` 可覆盖 |
| `beamer-progress` | `false` | 在 footline 顶部显示细进度条；格式中的 `progress: true` 也会启用同一条进度线 |

页码由三段式 footline 统一显示为“当前页 / 总页数”，因此 Reveal.js 自带的浮动 `slide-number` 会被主题替代，通常无需另行开启。标记为 `visibility="uncounted"` 的页面不显示页码，也不会进入总页数或推进进度。开启 Reveal.js 菜单时，按钮会自动避开 headline、frame title、logo 和 footline。

页脚会优先读取短元数据。作者与机构会合并显示为“作者（机构）”：

```yaml
short-title: "短标题"
short-author: "张三"
short-institute: "示例大学"
short-date: "2026"
beamer-secheader: true
beamer-progress: true
```

若未提供短值，扩展会回退到 Quarto 生成的标题、作者、机构和日期。非法的变体或布尔值会输出警告，并使用安全的默认行为。

## 自定义配色

整套外观由 CSS 自定义属性驱动，默认值写在 `_extensions/beamerslides/_palette.scss`，并且**按 Beamer 的混色代数取值**（`structure`、`structure!75!black`、`structure!50!black` 等），而不是按观感挑选。需要注意 `--beamer-structure` 与 `--beamer-primary` 是**两个不同的角色**：

- `--beamer-structure` 是 Beamer 的 `structure` 色，列表符号、无填充 block 的标题文字都从它派生。Madrid 下等于 `beamer@blendedblue` = `rgb(0.2,0.2,0.7)`，量化为 `#3333b2`。
- `--beamer-primary` 是当前变体的强调色：Madrid 下与 `structure` 相同，CambridgeUS 下是 beaver 的 `darkred` `#cc0000`（用于 frame title 文字、标题页等）。

**⚠️ 一处有意偏离 Beamer：CambridgeUS 的 `structure` 是红色，不是蓝色。**

beaver 从不重定义 `structure`，所以上游 CambridgeUS 的列表符号与 block 标题是蓝色 `#3333b2`——那是主题的原样，但在红灰主调的版面里蓝色像个外来色。本扩展把 `structure` 指向该变体自己的 `darkred`，并用与 whale/orchid 相同的代数派生暗阶：

```text
structure          = darkred          = #cc0000
structure!75!black = darkred!75!black = #990000
structure!50!black = darkred!50!black = #660000
```

受影响的只有列表符号（无序/有序）与无填充 block 的标题文字。若你想恢复上游的蓝色，一行即可：

```css
.reveal.beamer-cambridgeus {
  --beamer-structure: #3333b2;
  --beamer-structure-2: #262686;
  --beamer-structure-3: #1a1a59;
}
```

注意 `example text` 在 Beamer 里是 `green!50!black`，**与 `structure` 无关**（默认颜色主题钉死，beaver/orchid 都不重定义），所以它的蓝/红变体取值相同。

覆盖时请注意两点：

1. 变量可以写在 `.reveal`、`.reveal.beamer-madrid` / `.reveal.beamer-cambridgeus` 上，也可以直接写在 `:root` 上——两个变体的调色板都按 `:root` 级选择器声明（CambridgeUS 用 `:where(:root).beamer-cambridgeus` 保持同等特异性），因此文档级 `:root` 覆盖对两种变体都生效。
2. `--beamer-primary` 只影响正文强调色；frame title、标题页色块、页眉页脚、`--beamer-structure` 各自有独立变量，需要一并覆盖。

`--beamer-alert`（`red` / beaver 的 `darkred!80!gray`）与 `--beamer-example`（`green!50!black`，注意 xcolor 的 `green` 是 `rgb(0,1,0)`，故为 `#008000` 而非 `#004000`）是**基础色**；三种 block 的标题底色由它们按 `!75!black` 派生，block 正文底色再由标题底色按 `!10!bg` 派生。因此覆盖基础色即可联动整套 block 配色。

最简单的做法是复制仓库里的 `examples/custom-palette.css`，只改一个种子色，其余由 `color-mix()` 按 Beamer 的关系派生：

```yaml
format:
  beamerslides-revealjs:
    theme: [default, _extensions/beamerslides/beamer.scss, examples/custom-palette.css]
```

若不想接管 `theme` 列表（扩展自带的主题名 `beamer.scss` 与 Quarto 内置主题查找同名，直接写会报 `beamer.scss.scss` 找不到），用 `css:` 追加样式表即可：

```yaml
format:
  beamerslides-revealjs:
    css: examples/custom-palette.css
```

该文件以 `/*-- scss:rules --*/` 开头：Quarto 要求 `theme:` 里的样式文件带 SCSS 层标记，这一行对 `css:` 路径无害。三条路径（`css:`、`theme:`、随仓库提供的示例文件）与两种变体都由回归测试覆盖（`palette-css` / `palette-theme` / `palette-example` / `palette-cambridgeus` fixture）；`color-mix()` 派生结果与 xcolor 的字面量最多相差 1/255（`color-mix()` 逢半进一，xcolor 在 sp 量化后逢半截断），需要逐通道完全一致时请直接覆盖字面量。

`testPaletteAlgebra` 会从上游主题源码推导期望色值并与浏览器实测比对，因此「调色板是否真的等于 Beamer」是可回归的事实——只靠截图基线做不到这一点，因为基线由本实现自身生成，无法发现自洽的错误。

标题页会显示可点击的邮箱地址；ORCID 使用内嵌矢量 iD 图标，并以作者名右上方的小角标呈现，避免位图缩放模糊。多位作者继续使用同一组 `name`、`email`、`orcid` 和 `affiliations` 字段。

行内公式默认放大 `2%`，行间公式放大 `6%`。内置 KaTeX 及其字体不依赖 CDN。若文档依赖 KaTeX 尚未支持的 MathJax 专用语法，可以覆盖回 Quarto 的 MathJax（此时 MathJax 本身是否离线取决于用户的 Quarto 配置）：

```yaml
format:
  beamerslides-revealjs:
    html-math-method: mathjax
```

## 页面层级

一级标题生成章节页，二级标题生成普通 frame：

```markdown
# 第一部分

## 第一张内容页 {data-subsection="方法"}

正文内容。
```

`data-subsection` 是可选的；启用 headline 时，如果没有提供该属性，副导航会显示当前 frame title。

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

block 标题会渲染为真实文本节点（而不是 CSS 伪元素），因此在浏览器里可以被 Ctrl+F 搜索、选中复制，也能被读屏软件读取。标题保持字面文本（不解析 markdown，避免 `a_b_c` 之类的标题被误当作强调）。手写 HTML 时仍可用 `data-title` 属性，此时由 CSS 伪元素兜底。

**两种变体的 block 外观不同，这同样是 Beamer 的行为**：

- **Madrid** 加载 `orchid` colortheme，它给 `block title` 设了底色，所以三种 block 都有实色标题条，正文是标题色的 10% 淡染：普通块深蓝 `#262686`、示例块深绿 `#006000`、警示块深红 `#bf0000`。
- **CambridgeUS** 只加载 `beaver`，**不加载 `orchid`**；beaver 也不碰 `block title`，于是底色为空，三种 block 都**没有填充**，只有圆角与阴影，靠**标题文字颜色**区分。

CambridgeUS 的三种 block 按**语义层级**设计（这是有意偏离上游的一处，上游是蓝/绿/褐红）：

| block | 外观 | 来源 | 对比度 |
|:---|:---|:---|:---|
| 普通 `block` | 红字 `#cc0000`，无填充 | `structure`，与列表符号同色 | 5.79:1 |
| 示例 `exampleblock` | 绿字 `#008000`，无填充 | `example text`，Beamer 钉死 | 5.05:1 |
| 警示 `alertblock` | **黄底 `#ffd700` + 近黑加粗字 `#1a1a1a`** | 警告牌样式 | **12.4:1** |

警示块是**唯一带填充的 block**，也是唯一字重为 700 的（其余为 650）—— 靠"填充 + 字重 + 色相"三重区分，语义权重最高。

**为什么黄只能当底色、不能当文字色**：警告黄在浅色页面上物理上不可读。实测警告黄 1.38:1、金黄 1.60:1、纯黄 1.06:1，而正文需要 ≥4.5:1。警告牌之所以能成立，正是因为它是"黄底 + 深色字"。所以这里把黄用作**标题带底色**，文字用近黑，实测 12.4:1。

**为什么 `--beamer-alert` 保持红色**：它同时驱动 `.alert` 行内强调和 `h4`，这两处直接坐在浅色页面上，若改成黄就会一起变得不可读。只有 block 标题带是黄的。

若希望在 CambridgeUS 下也得到实色标题条，覆盖对应变量即可：

```yaml
format:
  beamerslides-revealjs:
    css: filled-blocks.css
```

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

行内辅助类包括：

- `[重要]{.alert}`：警示色文字。
- `[文字]{.fg style="--col: #2c7550"}`：自定义前景色。
- `[文字]{.bg style="--col: #f5dfe1"}`：自定义背景色。
- `[[跳转]{.button}](#目标)`：Beamer 风格按钮。

有序列表编号、`.bg` 与 `.button` 会在字体加载、窗口缩放和切换幻灯片后按当前字体的可见字形重新校正基线，因此离线 HTML 与 HTTP 预览使用同一套对齐逻辑。

页面结构上，所有标题类元素都以 `58px` 为文字内边距，与正文同宽：标题页色块宽 `1164px`（等于 Beamer 的 `\textwidth`），frame title 与章节页标题带是**通栏色带**（`1280px`）但文字同样从 `x=58` 起排。因此章节页标题、frame title、列表正文的左边缘严格对齐。

章节页按 Beamer 的做法复用 frame title 模板——紧贴页眉下方的通栏色带，而不是居中的徽标块。frame title 与章节页标题带都不带边框，headline 下方也不画分隔线（infolines 不画）：两个变体的标题都是纯色块，不额外加线。

页脚第三格按 infolines 的 `\hfill 日期 \hfill 页码` 排布：日期在整格内居中（不受页码挤压），页码贴右。

## 内容格式

表格采用与 `quarto-revealjs-clean` 相近的轻量规则：表头不使用实色填充，只保留主题色文字、表头分隔线和表格底线。caption 默认居中：

```markdown
| 变量 | 含义 |
|:---|:---|
| x | 解释变量 |

: 变量说明
```

代码块支持 Quarto 原生的文件名、语法高亮、行号和复制按钮：

````markdown
```{.r filename="analysis.R"}
quarto::quarto_render("slides.qmd")
```
````

图片继续使用 Quarto 原生 figure 语法，主题会约束最大尺寸并统一居中图注：

```markdown
![图注](assets/figure.svg){#fig-example width="90%"}
```

文献引用无需主题专用语法。在 YAML 中设置 `bibliography`，正文使用 `[@key]`，最后放置参考文献容器：

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
assets/
└── normal-density.svg
examples/
└── custom-palette.css
references.bib
template.qmd
template-cambridgeus.qmd
tests/
├── fixtures/
├── lib/
│   └── harness.mjs
└── run-tests.mjs
```

## 测试

需要 Quarto、Node.js 22+ 和 Chrome/Chromium。首次运行先安装锁定的测试依赖：

```bash
npm ci
npm test
```

测试会渲染两个变体、显式选项与自包含离线示例，检查元数据、邮箱与 ORCID、页眉页脚、列表、长标题、本地 KaTeX 与字体、文字背景对齐、表格对比度、代码块、图片、引用、16:9 / 4:3 视口、浏览器错误，以及 Madrid/CambridgeUS PDF 输出。另外还会断言：标题页色块铺满 textwidth、block 标题是真实文本、页眉页脚在 Reveal 就绪之前完成注入（逐帧检查无"就绪但缺页脚"的帧）、非法选项的警告与回退、以及超页内容会产出带 frame id 的控制台告警。截图会与 `tests/baselines/` 中受版本控制的基线比较；实际截图、差异图与 PDF 写入 `tests/_artifacts/`，该目录不会进入版本控制。

页面就绪等待默认最长 20 秒；慢速环境可通过 `BEAMERSLIDES_PAGE_READY_TIMEOUT_MS` 调整，例如 `BEAMERSLIDES_PAGE_READY_TIMEOUT_MS=30000 npm test`。

只有确认视觉变化符合预期后，才应更新基线：

```bash
npm run test:update-visuals
```

内容组织方式参考了 [quarto-revealjs-clean](https://github.com/grantmcdermott/quarto-revealjs-clean)；默认行为与色彩角色依据 Beamer 官方的 [Madrid](https://github.com/josephwright/beamer/blob/main/base/themes/theme/beamerthemeMadrid.sty) 和 [CambridgeUS](https://github.com/josephwright/beamer/blob/main/base/themes/theme/beamerthemeCambridgeUS.sty) 主题源码。

## License

MIT
