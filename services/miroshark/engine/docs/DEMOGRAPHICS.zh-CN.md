<sup>[English](DEMOGRAPHICS.md) · 中文</sup>

# 人口学接地

MiroShark 的人设通常是图谱接地的:每个智能体都是 LLM 对某个出自知识图谱构建过程的实体(一个校友群体、一名记者、一家交易所、一个监管机构……)的诠释。这让它们在*叙事上*接地——智能体的世界观来自图谱中真实的关系——但并不约束它们的人口学形态。

人口学接地是一个可选层,它会从 NVIDIA **Nemotron-Personas** parquet 数据集中为每个实体拉取真实的、类人口普查的一行,并作为锚点喂给人设生成器。人设仍由 LLM 撰写;种子只是告诉它,这个智能体比如说是一位 34 岁、住在 Tampines、持有学士学位、收入处于 S$60–80k 区间的女性教师。图谱上下文与网络增强仍然驱动着智能体的*世界观*——种子只是固定人口学基线。

该功能纯属增量:
- 当 `DEMOGRAPHICS_COUNTRY` 为空时,什么都不变
- 当国家代码未知时,采样器会记录一条警告并跳过
- 当 `duckdb` / `huggingface_hub` 未安装时,采样器会跳过
- 当 M 个实体只有 N 个种子可用时(M > N),前 N 个智能体会拿到种子,其余回退到仅图谱生成

## 启用它

```bash
# .env
DEMOGRAPHICS_COUNTRY=sg     # 或 "us"
```

然后 `pip install -r backend/requirements.txt` 拉取 `duckdb` 和
`huggingface_hub`。在第一次模拟运行时,采样器会把所选国家的 Nemotron parquet 下载到
`backend/data/nemotron/<country>/`(约数百 MB),并为后续运行缓存它。

## 国家包

国家配置位于 `backend/app/countries/*.json`——每个国家一个文件,自动注册。每个包声明:

| field            | meaning                                              |
| ---------------- | ---------------------------------------------------- |
| `code`           | 环境变量 / API 使用的短代码(`sg`、`us`、……）       |
| `name`           | 显示名称                                             |
| `flag_emoji`     | 用于国家选择器 UI                                    |
| `dataset.repo_id`| HuggingFace 数据集 id                                |
| `dataset.local_paths` | 下载前先检查的 parquet glob                     |
| `dataset.download_dir` | HF 快照落地的位置                              |
| `geography.field` | 用于对人设分桶的列(例如 `planning_area`、`state`） |
| `geography.values`| 该列的合法取值                                      |
| `geography.groups`| 命名的多地域预设(例如 `north-east`）               |
| `filter_fields`  | 群组选择器的 UI 提示                                 |
| `max_agents` / `default_agents` | 智能体数量上限                         |

要添加新国家,只需在 `backend/app/countries/` 中现有的两个文件旁丢入一个新的 JSON 文件。注册表会在下一次进程启动时拾取它。无需改代码。

## API

- `GET /api/countries` — 已安装的包列表(可公开的安全摘要)
- `GET /api/countries/<code>` — 单个包的完整过滤 schema(地域取值、分组、过滤字段、智能体上限)

当前激活的国家(若有)会作为 `active_country` 在列表端点上报告,以便 SPA 预先选中它。

## 种子如何抵达 LLM

`WonderwallProfileGenerator.generate_profiles_from_entities()` 会在每次模拟中调用一次
`demographic_sampler.sample_seeds()`,把返回的行与实体配对,并把每个实体的一行作为提示词中新增的
`DEMOGRAPHIC ANCHOR` / `AUDIENCE ANCHOR` 块,传入
`_build_individual_persona_prompt` / `_build_group_persona_prompt`。

对于个人实体,种子被当作智能体自身的人口学特征。对于组织实体,种子被当作目标受众中的一个典型关注者——用于本地化声音与语气,而非重新定义该机构。

在 LLM 响应之后,任何未设置的字段(`age`、`gender`、`profession`、`country`)会回退到种子的取值,从而让智能体保持内部一致。

## 与既有各层的可组合性

种子是既有人设栈中的第四层:

1. 图谱属性(Neo4j 实体属性)
2. 图谱关系(BFS 扩展的邻域)
3. 网络增强(针对单薄人设的 LLM 网络调研)
4. **人口学种子(新增)** — Nemotron 行,限定国家范围

每一层都独立可选。禁用图谱搜索或网络增强不会禁用人口学接地,反之亦然。

## 局限

- 对于给定的 `(country, seed)` 对,采样是确定性的,因此同一情景在同一国家下的两次运行会产生相同的人口学组合。改变 `demographic_filters.seed` 即可重新洗牌。
- Nemotron 的 schema 在各国家分片之间并不统一;采样器通过静默跳过这些过滤器来容忍缺失的列。
- 配对是按位置进行的(经过一次确定性洗牌后,实体 i ↔ 种子 i)。它不会尝试把实体类型与人口学匹配——例如一个 “exchange” 实体可能与一个教师种子配对。提示词的框架(`DEMOGRAPHIC ANCHOR` 对 `AUDIENCE ANCHOR`)会为组织实体处理这一点;对于个人,则会要求 LLM 自行调和。
