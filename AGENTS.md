# 项目工作指南

本项目交付 Quarto Reveal.js 扩展 `beamerslides-revealjs`，还原 Beamer Madrid/CambridgeUS，并允许扁平列表和适合网页的内容排版。

## 开始修改前

- 阅读 [项目设计约定](docs/architecture.md)，区分稳定约束、当前实现与待办目标；按本次改动查阅相关职责和测试。
- 使用与公共接口见 [README.md](README.md)；默认配置见 [_extension.yml](_extensions/beamerslides/_extension.yml)；开发命令见 [package.json](package.json)。
- 区分现有行为、必须保持的约束和待修复缺陷，避免把缺陷固化为兼容要求。

## 修改规则

- 变更放在相应职责层：Lua 处理元数据/AST，SCSS 处理外观，JS 处理浏览器测量与集成；入口位于 `_extensions/beamerslides/`。
- 保留格式名与已文档化接口，包括未被内部样式使用的公开 hook。更改默认外观或接口时同步受影响的设计约定、使用说明、模板和测试。
- 配色修改遵守 C1–C3；运行时修改验证相关 L/G/R 约束。现有调用形式可以重构，待办方案需先验证，不能直接当成已确立要求。
- 改进现有实现时控制范围；文件拆分、依赖更新、外观变化分别说明目的和影响。
- 第三方资源更新时同步 [来源与许可证记录](_extensions/beamerslides/THIRD_PARTY.md)。
- 注释按设计文档末尾的归属表维护：迁移跨文件规则后删除原处重复正文，保留必要指引和局部原因；保留机器标记、许可证及示例的写作说明。生成产物留在忽略目录。

## 验证与交付

- 测试需要 Quarto、Node 22+、Chrome/Chromium。依赖安装用 `npm ci`，回归套件用 `npm test`。
- 修改配置、Lua、SCSS、JS 或模板结构后运行相关验证；配色派生、初始化和文献分页变更运行完整套件。修复缺陷时补充能区分旧行为的场景。
- 同一 checkout 串行运行套件；它共享临时输入和输出目录，并有运行锁。
- 一次性浏览器探针复用 `tests/lib/harness.mjs` 的 `withBrowser`；页面/CDP 会话与本地服务另由创建者在 `finally` 中关闭，清理失败不跳过其余资源。Moli 可作额外检查，现有套件使用 Chrome/CDP。
- 仅在有意修改外观时运行 `npm run test:update-visuals`，并逐张检查变化；详见 [基线说明](tests/baselines/README.md)。
- 纯文档或注释变更检查链接、Markdown、实现对应关系；修改源码注释还要确认非注释内容与机器标记未变，无需更新截图基线。
- 交付说明写明修改内容、验证范围/结果和剩余限制，区分本次检查与历史检查。
