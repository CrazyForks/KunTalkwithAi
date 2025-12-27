# EveryTalk Web 功能实现清单 (对齐安卓端)

本文件用于追踪 Web 端功能的实现进度，确保与 Android 端功能一致。

## 一、核心聊天功能 (Core Chat)
- [x] **文本对话**
    - [x] 发送/接收文本消息
    - [ ] 流式响应 (Streaming) - *需接入真实 API*
    - [x] Markdown 渲染
        - [x] 代码高亮 (支持多种编程语言)
        - [x] 表格渲染 (Table)
        - [x] 列表/引用/链接
        - [x] LaTeX 数学公式渲染
    - [ ] **增强预览功能**
        - [ ] 网页链接预览 (Web Page Preview)
        - [ ] 代码块一键复制
        - [ ] 代码块全屏/折叠
- [ ] **多模态与高级能力** (根据不同模型支持情况)
    - [ ] **图像识别 (Vision)**
        - [ ] 上传图片进行问答 (GPT-4o, Gemini, Claude 3)
    - [ ] **文档解析**
        - [ ] 上传 PDF/TXT/DOCX 等文档进行分析 (Gemini 1.5 Pro, Claude 3, Qwen-Long)
    - [ ] **音频解析**
        - [ ] 上传音频文件进行理解 (Gemini 1.5 Pro)
    - [ ] **视频解析**
        - [ ] 上传视频文件进行理解 (Gemini 1.5 Pro)
    - [ ] **代码执行**
        - [ ] Python 代码沙箱执行 (如 Gemini Code Execution)
    - [ ] **深度思考 (Thinking)**
        - [ ] 展示模型的思考过程 (OpenAI o1/Gemini Thinking/DeepSeek R1)
    - [ ] **联网搜索 (Web Search)**
        - [ ] 谷歌搜索 (Google Search via Gemini)
        - [ ] 自定义搜索 API (SerpApi/Google CSE)
        - [ ] 智谱联网搜索 (Zhipu AI)
    - [ ] **文件提取与处理**
        - [ ] 支持 txt, pdf, docx, xlsx 等格式的文本提取
    - [ ] **交互式可视化**
        - [ ] ECharts 图表渲染 (基于代码执行结果)
        - [ ] Mermaid 流程图/时序图渲染
        - [ ] HTML/SVG 预览
        - [ ] Vega/Vega-Lite 图表支持
- [ ] **消息操作**
    - [ ] 复制消息内容
    - [ ] 重新生成 (Regenerate)
    - [ ] 编辑消息
    - [ ] 删除消息

## 二、图像生成 (Image Generation)
- [ ] **基础生成**
    - [ ] 文生图 (Text-to-Image) - *需接入真实 API*
    - [ ] 图生图 (Image-to-Image)
- [ ] **参数调整**
    - [ ] 图片比例 (Aspect Ratio)
    - [ ] 迭代步数 (Steps)
    - [ ] 引导系数 (Guidance Scale)
- [ ] **历史记录**
    - [ ] 生成历史查看
    - [ ] 图片保存/下载

## 三、会话管理 (Conversation Management)
- [ ] **侧边栏列表**
    - [ ] 按时间排序的会话列表
    - [ ] 区分 文本/图像 会话
- [ ] **会话操作**
    - [ ] 新建会话
    - [ ] 重命名会话
    - [ ] 删除会话
    - [ ] 置顶会话
    - [ ] 分组管理 (创建/添加/移除)
- [ ] **搜索**
    - [ ] 搜索历史会话

## 四、模型与配置管理 (Settings & Config)
- [ ] **API 配置**
    - [ ] 添加自定义 API 配置 (OpenAI/Gemini/Claude/SiliconFlow 等)
    - [ ] 编辑/删除配置
    - [ ] 设为默认配置
- [ ] **对话参数**
    - [ ] System Prompt 设置
    - [ ] Temperature (随机性)
    - [ ] Top P (核采样)
    - [ ] Max Tokens (最大长度)
    - [ ] 联网搜索开关
- [ ] **数据导入/导出**
    - [ ] 导出配置与聊天记录 (JSON)
    - [ ] 导入配置与聊天记录

## 五、数据同步与存储 (Storage & Sync)
- [ ] **本地持久化**
    - [ ] IndexedDB/LocalStorage 存储 (离线可用，刷新不丢失)
- [x] **跨端同步**
    - [x] 生成连接二维码
    - [x] WebSocket 实时通信客户端
    - [ ] 处理同步过来的消息/流数据

## 六、界面与体验 (UI/UX)
- [x] 响应式布局 (适配移动/桌面)
- [x] 深色模式 UI
- [x] 消息自动滚动
- [x] 动画效果 (Framer Motion)