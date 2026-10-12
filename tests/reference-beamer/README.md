# 固定 Beamer 对照

上游固定为 Beamer **v3.76**，commit `5616b785a9dff1024fa31cc3a3bd11f8d9b40aaf`，来源为[官方源码](https://github.com/josephwright/beamer/tree/5616b785a9dff1024fa31cc3a3bd11f8d9b40aaf)。不随扩展分发该源码；下载与编译产物都在忽略的 `tmp/reference-beamer/`。

`reference.tex` 与 `reference.qmd` 使用同一组文字，覆盖标题页、frame title、信息栏、三段式 footline、三类 block、无序/有序列表、章节页及其后续页面。`madrid.tex` 和 `cambridgeus.tex` 仅选择原版主题，不覆写颜色或模板。它们不是逐像素等同的布局规范。

在仓库根目录执行：

```sh
python3 tests/reference-beamer/build.py
node tests/reference-beamer/capture.mjs
```

第一条需要 Python 3、Tectonic 与 Poppler 的 `pdftoppm`，首次需要网络获取固定源码与 Tectonic 的 TeX/字体资源。脚本下载固定 commit 的归档，把所有上游 base/theme/font 文件放入显式搜索目录，防止缓存中的另一版本主题取代固定来源。Tectonic 每次编译有 600 秒上限，PNG 渲染有 60 秒上限；日志保留类和样式版本。第二条复用 Chrome/CDP harness，每页捕获到 `tmp/reference-beamer/output/html-*.png`，不改回归基线。

此流程为可选的还原度审查，不进入日常 `npm test`，也不要与回归套件同时运行。运行时扩展不依赖 Python、Tectonic 或 Poppler。构建环境目前只锁定 Beamer commit；TeX bundle 与渲染器版本记录在检查结果中，未来要跨环境逐像素比较时还需固定这些依赖。

## 本次对照结论

2026-10-13：Tectonic 0.17.0 编译两份 5 页 PDF，日志确认 Beamer 3.76；Poppler 26.10.0 将每页渲染为 1280×720 PNG。对应 Quarto 1.10.19 的两份 5 页 HTML 以同视口捕获，逐页检查了标题、信息栏、footline 和正文。没有发现此样例中的文字裁切或相互遮挡；这不代表所有内容和可访问性已穷尽验证。

| 项目 | 对照观察 | 处理 |
|:---|:---|:---|
| Madrid chrome 与配色角色 | 上游默认无 headline，蓝色标题带与三格 footline；扩展沿用其角色与布局关系 | 保持；默认色值仍由独立配色测试验证 |
| CambridgeUS chrome | 上游红灰信息栏、浅灰 frame title、三格 footline；扩展沿用其主要结构 | 保持；不把截图相似度当作像素一致保证 |
| CambridgeUS 正文结构与 block | 上游普通标题与列表结构色为蓝色，alert 为红色；扩展结构色为红色、alert block 标题为描边黄色 | 是已记录的设计偏离，保持 |
| 标题页、block 表面 | 原版带圆角与 shadow，扩展更平面；标题文字字重、正文间距也不同 | 记录外观差异，本轮不将其判为已接受偏离或自动修复；进一步还原需单独决定并验证 |
| 列表 | 原版含立体圆形符号，扩展为扁平符号 | 符合项目要求，保持 |
| 章节页 | 原版独立 `section page` 模板，包含章节编号并居中；扩展采用通栏标题区 | 已明确的章节适配，保持 |
| 字体与正文位置 | 原版使用 TeX 字体并默认垂直居中 frame 正文；扩展本地字体、默认正文靠上 | 字体与网页排版选择，不能用跨字体逐像素误差判断排序/布局正确性 |

Tectonic 的 PDF 后端提示部分原版导航链接 annotation 边界略超出 MediaBox；可见页面检查未见正文问题。链接矩形与完整 PDF 可访问性不属于本次视觉验收。HTML 的日期格式由 Quarto 解析，不能把日期格式化差异当作主题配色缺陷。

后续修改默认外观时同时审查原版对照、项目允许偏离与已有视觉基线，并按 [AGENTS.md](../../AGENTS.md) 更新相关设计说明、模板和测试。
